import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { zoneOf, recordLesson, lessonsForZones, countLessons } from '../src/gardener/lessons'
import { analyzeCorrections } from '../src/gardener/corrections'
import { slugOf } from '../src/hooks/session-start-core'
import { handleUserPrompt } from '../src/hooks/user-prompt-core'

const iso = (d: string): string => new Date(d).toISOString()

describe('lessons store', () => {
  it('zoneOf — каталог файла, корень отдельно', () => {
    expect(zoneOf('src/hooks/gate.ts')).toBe('src/hooks')
    expect(zoneOf('README.md')).toBe('(корень)')
    expect(zoneOf('a\\b\\c.ts')).toBe('a/b')
  })
  it('recordLesson дедуп (zone+statement) — повтор освежает, не плодит', () => {
    const db = openDb(':memory:')
    recordLesson(db, 'src/hooks', 'валидируй вход', 'correction:m', iso('2026-07-01'))
    recordLesson(db, 'src/hooks', 'валидируй вход', 'correction:m', iso('2026-07-20')) // тот же
    recordLesson(db, 'src/core', 'не глотай ошибку', 'correction:m', iso('2026-07-05'))
    expect(countLessons(db)).toBe(2)
    const fresh = lessonsForZones(db, ['src/hooks'], 5)
    expect(fresh[0].created_at).toBe(iso('2026-07-20')) // освежилось
    db.close()
  })
  it('lessonsForZones — по зонам, новые первыми, нет таблицы → пусто', () => {
    const db = openDb(':memory:')
    recordLesson(db, 'src/a', 'урок A', 'x', iso('2026-07-01'))
    recordLesson(db, 'src/b', 'урок B', 'x', iso('2026-07-10'))
    const got = lessonsForZones(db, ['src/a', 'src/b'], 5).map((l) => l.statement)
    expect(got).toEqual(['урок B', 'урок A'])
    expect(lessonsForZones(db, ['src/z'], 5)).toEqual([])
    db.close()
    expect(lessonsForZones(openDb(':memory:'), ['x'], 5)).toEqual([])
  })
})

describe('analyzeCorrections пишет зона-урок (мок-caller)', () => {
  it('поправка → правило-факт + урок по зоне файла', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-les-proj-'))
    mkdirSync(join(proj, 'src', 'hooks'), { recursive: true })
    writeFileSync(join(proj, 'src', 'hooks', 'gate.ts'), 'const validated = schema.parse(input)\n')
    const db = openDb(':memory:')
    db.run('CREATE TABLE corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, before_content TEXT, from_session TEXT, detected_at TEXT, analyzed INTEGER DEFAULT 0)')
    db.query('INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES(?,?,?,?)').run(
      'src/hooks/gate.ts',
      'const validated = input // без валидации\n',
      's0',
      iso('2026-07-20'),
    )
    const caller = () => ({
      text: '[{"area":"безопасность","statement":"валидируй вход перед использованием","evidence":["src/hooks/gate.ts"],"confidence":0.7}]',
      model: 'test',
    })
    const r = analyzeCorrections(db, proj, caller)
    expect(r.born).toBeGreaterThan(0)
    const lessons = lessonsForZones(db, ['src/hooks'], 5)
    expect(lessons.some((l) => l.statement.includes('валидируй вход'))).toBe(true)
    db.close()
    rmrf(proj)
  })
})

describe('JIT подтягивает урок по зоне касания', () => {
  it('упоминание файла из зоны с уроком → блок «уроки по зоне»', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-lesjit-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-lesjit-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL, in_deg INTEGER, out_deg INTEGER)')
    db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file,to_file))')
    db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/hooks/gate.ts', 0.2, 0, 0)
    recordLesson(db, 'src/hooks', 'валидируй вход перед использованием', 'correction:m', iso('2026-07-20'))
    db.close()

    const out = handleUserPrompt({ prompt: 'поправь gate.ts аккуратно', cwd: proj, session_id: 'z1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('уроки по зоне')
    expect(ctx).toContain('валидируй вход')
    // дедуп зоны: повтор в той же сессии не подкладывает урок снова
    const again = handleUserPrompt({ prompt: 'ещё раз gate.ts', cwd: proj, session_id: 'z1' }, dataRoot)
    expect(again.hookSpecificOutput?.additionalContext ?? '').not.toContain('уроки по зоне')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
