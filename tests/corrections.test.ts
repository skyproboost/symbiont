import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { handleStop } from '../src/hooks/stop-core'

describe('поправки владельца: модель написала → человек исправил', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-corr-'))
  const g = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
  g('init', '-b', 'main')
  const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    return aList;\n}\n'
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
  g('add', '.')
  g('commit', '-m', 'база')

  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-corr-data-'))
  const dbPath = () => join(dataRoot, slugOf(proj), 'passport.db')

  it('сессия 1: модель пишет файл, Stop запоминает состояние', () => {
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'c1' }, dataRoot)
    writeFileSync(join(proj, 'fresh.js'), 'var data = 1;\n')
    handleStop({ cwd: proj, session_id: 'c1' }, dataRoot)

    const db = openDb(dbPath())
    const st = db.query("SELECT * FROM model_state WHERE session_id='c1'").all() as any[]
    db.close()
    expect(st.some((r) => r.file === 'fresh.js')).toBe(true)
  })

  it('человек правит между сессиями → сессия 2 фиксирует поправку с «до»', () => {
    writeFileSync(join(proj, 'fresh.js'), 'var oData = 1;\n') // правка владельца: data → oData
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'c2' }, dataRoot)

    const db = openDb(dbPath())
    const corr = db.query('SELECT * FROM corrections').all() as any[]
    const stateLeft = db.query("SELECT COUNT(*) n FROM model_state WHERE session_id='c1'").get() as { n: number }
    db.close()

    expect(corr.length).toBe(1)
    expect(corr[0].file).toBe('fresh.js')
    expect(corr[0].before_content).toContain('var data') // «до» сохранено для будущего анализа
    expect(corr[0].from_session).toBe('c1')
    expect(stateLeft.n).toBe(0) // состояние потреблено — идемпотентность
  })

  it('нетронутые файлы поправками не считаются', () => {
    writeFileSync(join(proj, 'fresh.js'), 'var oData = 2;\n')
    handleStop({ cwd: proj, session_id: 'c2' }, dataRoot) // модель снова поработала
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'c3' }, dataRoot) // без правок человека... кроме?
    // c2-состояние совпадает с диском? handleStop записал ПОСЛЕ последней записи → совпадает → поправки нет
    const db = openDb(dbPath())
    const corr = db.query('SELECT COUNT(*) n FROM corrections').get() as { n: number }
    db.close()
    expect(corr.n).toBe(1) // осталась только первая
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
