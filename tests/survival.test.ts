/**
 * Записка выжившего: SessionStart(source=compact) реконструирует из журнала,
 * что ИМЕННО эта сессия правила и что ловил гейт, — дословно, а не пересказом
 * суммаризатора компакции (тот, по исследованиям, роняет ограничения и
 * середину работы). Crash-only: никакой записи на выходе — только
 * реконструкция на старте.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { recordEdit } from '../src/hooks/post-tool-core'
import { rmrf } from './_helpers'

function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-surv-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-surv-data-'))
  mkdirSync(join(proj, 'src'), { recursive: true })
  for (let i = 0; i < 3; i++) writeFileSync(join(proj, 'src', `m${i}.js`), "const x = 'a'\nconst y = 'b'\n")
  return { proj, dataRoot, dataDir: join(dataRoot, slugOf(proj)) }
}

describe('записка выжившего при компакции', () => {
  it('после compact сводка содержит правленные этой сессией файлы и поимки гейта', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    // Обычный старт сессии — паспорт строится
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'sv1' }, dataRoot)
    // Сессия работала: правки с подтверждённым авторством + поимка гейта
    const db = openDb(join(dataDir, 'passport.db'))
    recordEdit(db, 'sv1', 'src/m0.js')
    recordEdit(db, 'sv1', 'src/m1.js')
    db.run('CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))')
    db.query('INSERT INTO gate_log(session_id, file, law) VALUES(?,?,?)').run('sv1', 'src/m0.js', 'кавычки — одинарные')
    db.close()

    const out = handleSessionStart({ cwd: proj, source: 'compact', session_id: 'sv1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('src/m0.js, src/m1.js')
    expect(ctx).toContain('кавычки — одинарные')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('чужая сессия в записку не попадает (авторство подтверждается, не угадывается)', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'mine' }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'))
    recordEdit(db, 'other', 'src/m2.js') // параллельная сессия соседа
    db.close()

    const out = handleSessionStart({ cwd: proj, source: 'compact', session_id: 'mine' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    // m2.js может легитимно встретиться в сводке (карта проекта) — проверяется
    // именно строка записки: чужих правок в ней нет, а раз своих не было, нет и строки
    expect(ctx).not.toContain('правлено ЭТОЙ сессией')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('обычный старт записку не подаёт', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'))
    recordEdit(db, 's1', 'src/m0.js')
    db.close()
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').not.toContain('до сжатия')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
