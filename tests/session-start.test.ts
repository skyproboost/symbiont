import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'

const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    return aList;\n}\n'

describe('slugOf', () => {
  it('нормализует имя проекта', () => {
    expect(slugOf('D:\\OSPanel\\domains\\labreadai-v2')).toBe('labreadai-v2')
    expect(slugOf('/home/user/My Project!')).toBe('my-project-')
  })
})

describe('handleSessionStart', () => {
  it('проект с конвенциями: additionalContext со сводкой + heartbeat', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-hook-proj-'))
    for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-hook-data-'))

    const out = handleSessionStart({ cwd: proj, source: 'startup' }, dataRoot)

    expect(out.hookSpecificOutput?.hookEventName).toBe('SessionStart')
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('только var')
    expect(ctx).toContain('Symbiont')

    const hb = JSON.parse(readFileSync(join(dataRoot, slugOf(proj), 'heartbeat-sessionstart.json'), 'utf8'))
    expect(hb.channel).toBe('SessionStart')
    expect(hb.source).toBe('startup')

    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
  })

  it('пустой проект: молчит (не занимает контекст), но heartbeat есть', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-hook-empty-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-hook-data2-'))
    const out = handleSessionStart({ cwd: proj }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
    expect(existsSync(join(dataRoot, slugOf(proj), 'heartbeat-sessionstart.json'))).toBe(true)
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
  })

  it('fail-open: несуществующий cwd не роняет хук', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-hook-data3-'))
    const out = handleSessionStart({ cwd: 'Z:\\нет\\такого\\пути' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined() // молчание, не исключение
    rmrf(dataRoot, { recursive: true, force: true })
  })
})
