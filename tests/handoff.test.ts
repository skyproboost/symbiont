import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'

const LEGACY = "function f() {\n  const a = 'x'\n  return a\n}\n"

describe('каскадный HANDOFF — «прошлая сессия сделала» (коммиты)', () => {
  function makeWorld() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-ho-proj-'))
    for (let i = 0; i < 5; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(6))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-ho-data-'))
    return { proj, dataRoot, dataDir: join(dataRoot, slugOf(proj)) }
  }

  it('нить прошлой сессии с коммитами → блок «сделала»', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot) // построить паспорт + таблицы
    // симулируем завершённую работу прошлой сессии с коммитами
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE IF NOT EXISTS session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL, commits TEXT NOT NULL DEFAULT \'[]\')')
    db.query('INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?)').run(
      's1',
      JSON.stringify(['src/gate.ts']),
      JSON.stringify(['feat: добавил страж защиты', 'fix: починил ложняк .parse']),
      new Date().toISOString(),
    )
    db.close()
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 's2' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('нить прошлой сессии')
    expect(ctx).toContain('прошлая сессия сделала')
    expect(ctx).toContain('добавил страж защиты')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('нить без коммитов → блока «сделала» нет (не выдумываем)', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE IF NOT EXISTS session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL, commits TEXT NOT NULL DEFAULT \'[]\')')
    db.query('INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?)').run(
      's1', JSON.stringify(['a.ts']), JSON.stringify([]), new Date().toISOString(),
    )
    db.close()
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 's2' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('нить прошлой сессии')
    expect(ctx).not.toContain('прошлая сессия сделала')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('старая схема session_threads без колонки commits → не падает (защита колонки)', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE IF NOT EXISTS session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL)')
    db.query('INSERT INTO session_threads(session_id, files, updated_at) VALUES(?,?,?)').run('s1', JSON.stringify(['a.ts']), new Date().toISOString())
    db.close()
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 's2' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('нить прошлой сессии') // не упало
    rmrf(proj)
    rmrf(dataRoot)
  })
})
