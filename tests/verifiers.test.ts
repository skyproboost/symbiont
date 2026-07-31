import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import {
  mixedScriptTokens,
  checkAlphabetPurity,
  checkContentLinks,
  runContentVerifiers,
  contentVerifierActive,
  makeResolver,
} from '../src/verifiers/content'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePostTool } from '../src/hooks/post-tool-core'

describe('чистота алфавита (гомоглифы кир/лат)', () => {
  it('ловит слово со смешением кириллицы и латиницы', () => {
    // «Аndroid» — кириллическая А + латиница; «слoво» — латинская o в кириллице
    expect(mixedScriptTokens('Установи Аndroid сейчас')).toEqual(['Аndroid'])
    expect(mixedScriptTokens('это слoво с подвохом')).toEqual(['слoво'])
  })
  it('чистые слова любого алфавита — не флагает', () => {
    expect(mixedScriptTokens('купите iPhone и iPad')).toEqual([]) // латиница чистая
    expect(mixedScriptTokens('обычный русский текст про мАч и кВт')).toEqual([]) // кириллица чистая
    expect(mixedScriptTokens('COVID-19 IPv6 H2O')).toEqual([]) // латиница+цифры
  })
  it('код (```, `inline`) и URL исключены из проверки (анти-шум)', () => {
    expect(mixedScriptTokens('```\nconst Аpple = 1\n```')).toEqual([]) // огороженный код
    expect(mixedScriptTokens('текст `Аpple` инлайн')).toEqual([]) // инлайн-код
    expect(mixedScriptTokens('ссылка https://exАmple.com/x тут')).toEqual([]) // URL
  })
  it('дедуп одинаковых токенов; checkAlphabetPurity даёт одну находку с примерами', () => {
    const v = checkAlphabetPurity('Аndroid и снова Аndroid и слoво')
    expect(v).toHaveLength(1)
    expect(v[0].verifier).toContain('чистота алфавита')
    expect(v[0].detail).toContain('2 слов') // Аndroid (дедуп) + слoво
  })
  it('чистый текст — ноль находок', () => {
    expect(checkAlphabetPurity('совершенно нормальный русский текст')).toEqual([])
  })
})

describe('целостность ссылок', () => {
  const resolve = makeResolver(['content/a.md', 'content/b.md', 'content/hub.md'])

  it('битая внутренняя ссылка (несуществующий файл с контентным расширением)', () => {
    const v = checkContentLinks('content/x.md', '[живая](a.md) и [битая](ghost.md)', '.md', resolve)
    const broken = v.find((x) => x.verifier === 'битая внутренняя ссылка')
    expect(broken?.detail).toContain('ghost.md')
  })
  it('роут без расширения (может генериться кодом) — молчим', () => {
    const v = checkContentLinks('content/x.md', '[калькулятор](/calc/bmi)', '.md', resolve)
    expect(v.find((x) => x.verifier === 'битая внутренняя ссылка')).toBeUndefined()
  })
  it('один анкор на разные цели', () => {
    const v = checkContentLinks('content/x.md', '[тут](a.md) потом [тут](b.md)', '.md', resolve)
    const dup = v.find((x) => x.verifier === 'один анкор на разные цели')
    expect(dup?.detail).toContain('«тут»')
  })
  it('ссылка без текста (a11y/SEO)', () => {
    const v = checkContentLinks('content/x.md', '[](a.md)', '.md', resolve)
    expect(v.find((x) => x.verifier === 'ссылка без текста (a11y/SEO)')).toBeDefined()
  })
  it('мягкие yaml-значения не считаются битыми (данные, не навигация)', () => {
    const v = checkContentLinks('data/x.yaml', 'ghost: content/nope.md\n', '.yaml', resolve)
    expect(v.find((x) => x.verifier === 'битая внутренняя ссылка')).toBeUndefined()
  })
  it('без резолвера — битые не проверяются (не против чего), но не падаем', () => {
    expect(checkContentLinks('content/x.md', '[битая](ghost.md)', '.md', undefined)).toEqual([])
  })
})

describe('runContentVerifiers · активация по расширению', () => {
  it('код-файл не гейтится верификаторами контента', () => {
    expect(contentVerifierActive('.ts')).toBe(false)
    expect(runContentVerifiers('src/a.ts', 'const Аpple = 1', '.ts')).toEqual([])
  })
  it('контент-файл — активен', () => {
    expect(contentVerifierActive('.md')).toBe(true)
    expect(runContentVerifiers('a.md', 'слoво', '.md').length).toBeGreaterThan(0)
  })
})

describe('интеграция: verifier в PostToolUse-гейте', () => {
  function makeWorld() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-vf-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-vf-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    // graph_nodes/edges — как их всегда создаёт buildPassport (пусты для контент-проекта)
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
    db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
    // сущности для резолва битых ссылок
    db.run('CREATE TABLE entity_nodes(file TEXT PRIMARY KEY, kind TEXT, in_deg INTEGER, out_deg INTEGER, depth INTEGER, is_hub INTEGER)')
    db.query('INSERT INTO entity_nodes(file,kind,in_deg,out_deg,depth,is_hub) VALUES(?,?,?,?,?,?)').run('content/real.md', 'md', 1, 0, 0, 0)
    db.close()
    mkdirSync(join(proj, 'content'), { recursive: true })
    return { proj, dataRoot }
  }
  const touch = (proj: string, dataRoot: string, file: string, sid = 's1') =>
    handlePostTool({ cwd: proj, session_id: sid, tool_name: 'Write', tool_input: { file_path: join(proj, file) } }, dataRoot)

  it('правка контент-файла с гомоглифом и битой ссылкой — верификаторы срабатывают, дедуп держит', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'content', 'bad.md'), 'Читай про Аndroid и [битую](ghost.md) ссылку.')
    const out = touch(proj, dataRoot, 'content/bad.md')
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('чистота алфавита')
    expect(ctx).toContain('битая внутренняя ссылка')
    expect(touch(proj, dataRoot, 'content/bad.md')).toEqual({}) // дедуп: повтор молчит
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('чистый контент-файл молчит', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'content', 'ok.md'), 'Совершенно чистый русский текст со ссылкой [сюда](real.md).')
    expect(touch(proj, dataRoot, 'content/ok.md')).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })
})
