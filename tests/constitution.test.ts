import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConstitution, upsertConstitution, renderConstitution } from '../src/core/constitution'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'

describe('конституция: хранение', () => {
  it('upsert идемпотентен: та же цель обновляет ограничение, не плодит дубль', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-const-'))
    upsertConstitution(dir, [{ goal: 'топ-1 по качеству разборов', constraint: 'не переписывать работающее' }])
    const c = upsertConstitution(dir, [
      { goal: 'Топ-1 по качеству разборов', constraint: 'улучшения сверх задачи — предлагать, не делать' },
      { goal: 'скорость страниц', constraint: 'не жертвовать точностью' },
    ])
    expect(c.pairs.length).toBe(2)
    expect(c.pairs[0].constraint).toContain('предлагать')
    rmrf(dir)
  })

  it('мусорные пары отбрасываются; битый файл = нет конституции (fail-open)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-const2-'))
    const c = upsertConstitution(dir, [{ goal: '', constraint: 'x' }, { goal: 'ок', constraint: 'ок' }, 'мусор' as never])
    expect(c.pairs.length).toBe(1)
    writeFileSync(join(dir, 'constitution.json'), '{битый')
    expect(readConstitution(dir)).toBe(null)
    rmrf(dir)
  })

  it('рендер — факты воли владельца', () => {
    const text = renderConstitution({ pairs: [{ goal: 'а', constraint: 'б' }], updated_at: '' })
    expect(text).toContain('Воля владельца')
    expect(text).toContain('цель: а · ограничение: б')
  })
})

describe('конституция в сводке сессии', () => {
  it('пустой проект с конституцией получает её (охрана с первого коммита)', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-const-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-const-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    upsertConstitution(dataDir, [{ goal: 'новый проект — топ-1 по надёжности', constraint: 'без демонов' }])

    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'c1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('Воля владельца')
    expect(ctx).toContain('топ-1 по надёжности')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('проект без конституции и фактов — прежнее молчание', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-const-np-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-const-npd-'))
    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'c2' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
    rmrf(proj)
    rmrf(dataRoot)
  })
})
