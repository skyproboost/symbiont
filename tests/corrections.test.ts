import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { handleSessionStart, slugOf, detectCorrections } from '../src/hooks/session-start-core'
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

describe('поправка и потребление — одной парой', () => {
  const proj2 = mkdtempSync(join(tmpdir(), 'symbiont-atomic-'))
  const g2 = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj2, encoding: 'utf8' })
  g2('init', '-b', 'main')
  writeFileSync(join(proj2, 'a.js'), 'var data = 1;\n')
  g2('add', '.')
  g2('commit', '-m', 'base')

  const dataRoot2 = mkdtempSync(join(tmpdir(), 'symbiont-atomic-data-'))
  const db2 = () => join(dataRoot2, slugOf(proj2), 'passport.db')

  /** База, у которой ломается ровно потребление — имитация краха между записями. */
  function withFailingConsume(db: ReturnType<typeof openDb>) {
    return {
      query(sql: string) {
        const st = db.query(sql)
        if (!sql.startsWith('DELETE FROM model_state')) return st
        return { ...st, run: () => { throw new Error('крах между вставкой и потреблением') } } as typeof st
      },
      run: (sql: string, ...p: unknown[]) => db.run(sql, ...(p as never[])),
      close: () => db.close(),
    } as unknown as ReturnType<typeof openDb>
  }

  it('крах между записями не оставляет ни поправки, ни потреблённого состояния', () => {
    handleSessionStart({ cwd: proj2, source: 'startup', session_id: 'a1' }, dataRoot2)
    writeFileSync(join(proj2, 'a.js'), 'var data = 2;\n')
    handleStop({ cwd: proj2, session_id: 'a1' }, dataRoot2)
    writeFileSync(join(proj2, 'a.js'), 'var oData = 2;\n') // правка владельца

    const db = openDb(db2())
    const found = detectCorrections(withFailingConsume(db), proj2, 'a2')

    const corr = (db.query('SELECT COUNT(*) n FROM corrections').get() as { n: number }).n
    const state = (db.query("SELECT COUNT(*) n FROM model_state WHERE session_id='a1'").get() as { n: number }).n
    db.close()

    expect(found).toBe(0) // пара не легла — поправка не засчитана
    expect(corr, 'вставка обязана откатиться вместе с потреблением').toBe(0)
    expect(state, 'состояние осталось — следующий старт разберёт его заново').toBeGreaterThan(0)
  })

  it('после неудачи следующий проход доводит поправку до конца', () => {
    const db = openDb(db2())
    const found = detectCorrections(db, proj2, 'a3') // уже без подставы
    const corr = db.query('SELECT file, from_session FROM corrections').all() as Array<{ file: string; from_session: string }>
    const state = (db.query("SELECT COUNT(*) n FROM model_state WHERE session_id='a1'").get() as { n: number }).n
    db.close()

    expect(found).toBe(1)
    expect(corr).toHaveLength(1) // ровно одна, а не две
    expect(corr[0]?.file).toBe('a.js')
    expect(state).toBe(0)

    rmrf(proj2); rmrf(dataRoot2)
  })
})
