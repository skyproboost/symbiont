/**
 * Экспорт паспорта в AGENTS.md: единственная запись в репозиторий владельца,
 * и только по явной команде. Проверяется: создание файла с маркерами,
 * идемпотентное обновление секции с сохранением чужого текста, сухой прогон.
 */
import { describe, it, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { FactStore } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const CLI = join(import.meta.dirname, '..', 'src', 'cli', 'export.ts')

function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-exp-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-exp-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.6, 9, 0)
  new FactStore(db).assertAll(
    [{ area: 'форматирование', statement: 'кавычки — одинарные', positive: 97, total: 100, prevalence: 0.97, tier: 'закон' }],
    'miner:layer0',
  )
  db.close()
  return { proj, dataRoot }
}

const run = (proj: string, dataRoot: string, arg = '') =>
  spawnSync('bun', ['run', CLI, '--data', dataRoot, ...(arg ? [arg] : [])], { cwd: proj, encoding: 'utf8', timeout: 60_000 })

describe('экспорт паспорта в AGENTS.md', () => {
  it('создаёт файл с маркерами, законом и картой; повторный вызов не плодит секций', () => {
    const { proj, dataRoot } = makeWorld()
    const r = run(proj, dataRoot)
    expect(r.status).toBe(0)
    const target = join(proj, 'AGENTS.md')
    expect(existsSync(target)).toBe(true)
    const text = readFileSync(target, 'utf8')
    expect(text).toContain('BEGIN SYMBIONT PASSPORT')
    expect(text).toContain('кавычки — одинарные')
    expect(text).toContain('97 из 100')
    expect(text).toContain('src/core.ts')

    run(proj, dataRoot)
    const again = readFileSync(target, 'utf8')
    expect(again.split('BEGIN SYMBIONT PASSPORT').length).toBe(2) // одна секция, не две
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('чужой текст вокруг секции неприкосновенен', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'AGENTS.md'), '# Мои правила\n\nРуками написанное.\n')
    run(proj, dataRoot)
    const text = readFileSync(join(proj, 'AGENTS.md'), 'utf8')
    expect(text).toContain('Руками написанное.')
    expect(text).toContain('BEGIN SYMBIONT PASSPORT')
    // секция обновляется на месте, рукописное живо
    run(proj, dataRoot)
    const again = readFileSync(join(proj, 'AGENTS.md'), 'utf8')
    expect(again).toContain('Руками написанное.')
    expect(again.split('BEGIN SYMBIONT PASSPORT').length).toBe(2)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('сухой прогон печатает секцию и не трогает файл', () => {
    const { proj, dataRoot } = makeWorld()
    const r = run(proj, dataRoot, 'dry')
    expect(r.stdout).toContain('BEGIN SYMBIONT PASSPORT')
    expect(existsSync(join(proj, 'AGENTS.md'))).toBe(false)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('без паспорта — честный отказ, не пустой файл', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-exp-empty-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-exp-empty-data-'))
    const r = run(proj, dataRoot)
    expect(r.status).toBe(0)
    expect(existsSync(join(proj, 'AGENTS.md'))).toBe(false)
    rmrf(proj)
    rmrf(dataRoot)
  })
})
