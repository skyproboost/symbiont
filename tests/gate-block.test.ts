import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { handleStop } from '../src/hooks/stop-core'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { readGateMode } from '../src/gates/config'
import { buildStatusReport } from '../src/cli/reports'

/** Легаси-проект (законы var/табы/без стрелочных) + git + паспорт. */
function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-gb-proj-'))
  const g = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} → ${r.stderr}`)
    return r
  }
  g('init', '-b', 'main')
  const LEGACY = 'function f(_oX) {\n\tvar sName = _oX.n;\n\tvar aList = [];\n\tfor (var i = 0; i < 3; i++) { aList.push(i); }\n\treturn aList;\n}\n'
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
  g('add', '.')
  g('commit', '-m', 'база')
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-gb-data-'))
  handleSessionStart({ cwd: proj, source: 'startup', session_id: 'b-1' }, dataRoot)
  const dataDir = join(dataRoot, slugOf(proj))
  return { proj, dataRoot, dataDir }
}

describe('readGateMode', () => {
  it('нет файла/мусор — dry-run; mode=block — блокировка', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-gm-'))
    expect(readGateMode(dir)).toBe('dry-run')
    writeFileSync(join(dir, 'gate.json'), 'мусор{')
    expect(readGateMode(dir)).toBe('dry-run')
    writeFileSync(join(dir, 'gate.json'), '{"mode":"block"}')
    expect(readGateMode(dir)).toBe('block')
    rmrf(dir)
  })
})

describe('гейт в режиме блокировки', () => {
  const { proj, dataRoot, dataDir } = makeWorld()
  writeFileSync(join(dataDir, 'gate.json'), '{"mode":"block"}')

  it('нарушение → decision block с фактами и счётом предохранителя', () => {
    writeFileSync(join(proj, 'fresh.js'), 'const items = 1\nlet total = 0\n')
    const out = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('только var')
    expect(out.reason).toContain('fresh.js')
    expect(out.reason).toContain('1/8')
  })

  it('повторное нарушение блокирует снова (дедуп не глотает блок)', () => {
    const out = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('2/8')
  })

  it('чистый ход сбрасывает серию', () => {
    writeFileSync(join(proj, 'fresh.js'), 'function f() {\n\tvar x = 1;\n\treturn x;\n}\n')
    const clean = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    expect(clean.decision).toBeUndefined()
    writeFileSync(join(proj, 'fresh.js'), 'const again = 1\n')
    const out = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    expect(out.reason).toContain('1/8') // серия началась заново
  })

  it('предохранитель: 8-я блокировка подряд снимает гейт до конца сессии', () => {
    let last = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    for (let i = 0; i < 6; i++) {
      expect(last.decision).toBe('block')
      last = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    }
    // это 8-й подряд (1 из прошлого теста + 6 в цикле + этот)
    expect(last.decision).toBeUndefined()
    expect(last.hookSpecificOutput?.additionalContext).toContain('предохранитель')
    // после снятия — не блокирует, известные нарушения не повторяются (дедуп)
    const after = handleStop({ cwd: proj, session_id: 'b-1' }, dataRoot)
    expect(after.decision).toBeUndefined()
  })

  it('другая сессия — гейт снова боевой', () => {
    const out = handleStop({ cwd: proj, session_id: 'b-2' }, dataRoot)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('1/8')
  })

  it('/sym-status показывает режим блокировки', () => {
    expect(buildStatusReport(dataDir)).toContain('гейт (блокировка)')
  })

  it('сводка следующей сессии усиливает часто нарушаемое правило', () => {
    const db = openDb(join(dataDir, 'passport.db'))
    const ins = db.query('INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)')
    ins.run('x1', 'a.js', 'переменные — только var')
    ins.run('x2', 'b.js', 'переменные — только var')
    ins.run('x3', 'c.js', 'переменные — только var')
    db.close()
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'b-3' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('гейт чаще всего ловит')
    expect(ctx).toContain('только var')
  })

  it('cleanup', () => {
    rmrf(proj)
    rmrf(dataRoot)
    expect(true).toBe(true)
  })
})
