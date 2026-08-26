import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { handlePreCompact } from '../src/hooks/pre-compact-core'

const LEGACY = 'function f(_oX) {\n  var sName = _oX.n\n  var aList = []\n  return aList\n}\n'

function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-life-proj-'))
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(10))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-life-data-'))
  return { proj, dataRoot, dataDir: join(dataRoot, slugOf(proj)) }
}

describe('SessionStart на compact/fork — переинъекция сводки (долг №4)', () => {
  it('source=compact: сводка переинжектится + честная пометка о сжатии', () => {
    const { proj, dataRoot } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot) // построить паспорт
    const out = handleSessionStart({ cwd: proj, source: 'compact', session_id: 's1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('Законы стиля') // сводка на месте (не пусто после сжатия)
    expect(ctx).toContain('контекст был сжат')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('source=compact: неиспользованные подачи снова подаваемы, использованные — помечены', () => {
    const { proj, dataRoot } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const dbPath = join(dataRoot, slugOf(proj), 'passport.db')
    let db = openDb(dbPath)
    db.run('CREATE TABLE IF NOT EXISTS jit_log(session_id TEXT NOT NULL, file TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT \'graph\', PRIMARY KEY(session_id, file))')
    db.run("INSERT INTO jit_log(session_id, file, used) VALUES('s1','a.ts',0),('s1','b.ts',1),('s2','c.ts',0)")
    db.close()
    handleSessionStart({ cwd: proj, source: 'compact', session_id: 's1' }, dataRoot)
    db = openDb(dbPath)
    const left = (db.query('SELECT session_id, file FROM jit_log ORDER BY file').all() as Array<{ session_id: string; file: string }>).map((r) => `${r.session_id}:${r.file}`)
    db.close()
    expect(left).toEqual(['s1:b.ts', 's2:c.ts']) // чужая сессия не тронута
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('source=fork: пометка про сабагентов (не наследуют контекст родителя)', () => {
    const { proj, dataRoot } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const out = handleSessionStart({ cwd: proj, source: 'fork', session_id: 'fork-1' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('форкнута')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('compact НЕ сбрасывает started_at сессии (идемпотентный open — Stop-гейт не слепнет)', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const db1 = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const before = (db1.query('SELECT started_at FROM sessions WHERE session_id=?').get('s1') as { started_at: string }).started_at
    db1.close()
    handleSessionStart({ cwd: proj, source: 'compact', session_id: 's1' }, dataRoot)
    const db2 = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const after = (db2.query('SELECT started_at FROM sessions WHERE session_id=?').get('s1') as { started_at: string }).started_at
    db2.close()
    expect(after).toBe(before) // та же сессия — первый старт не переписан
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('PreCompact — пульс перед сжатием (best-effort)', () => {
  it('оставляет heartbeat-precompact и не даёт вывода (побочный эффект)', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot) // создать dataDir/паспорт
    const out = handlePreCompact({ cwd: proj, session_id: 's1', trigger: 'auto' }, dataRoot)
    expect(out).toEqual({})
    expect(existsSync(join(dataDir, 'heartbeat-precompact.json'))).toBe(true)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('нет паспорта/каталога — не падает (fail-open)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'symbiont-life-empty-'))
    expect(handlePreCompact({ cwd: empty, session_id: 'x', trigger: 'manual' }, empty)).toEqual({})
    rmrf(empty)
  })
})
