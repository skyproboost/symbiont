import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { silentChannels, readBeats, renderDiagnosis } from '../src/hooks/diagnose'

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const DAY = 86_400_000

describe('silentChannels', () => {
  it('канал, молчащий 3+ прошлых сессий, — обнаружен', () => {
    // 4 прошлые сессии за последние дни; stop бил только очень давно
    const starts = [iso(1 * DAY), iso(2 * DAY), iso(3 * DAY), iso(4 * DAY)]
    const beats = [
      { channel: 'UserPromptSubmit', at: iso(0.5 * DAY) }, // свежий — жив
      { channel: 'Stop', at: iso(10 * DAY) }, // старше отсечки (3-я сессия = 3 дня) — молчит
    ]
    const silent = silentChannels(beats, starts)
    expect(silent).toContain('stop')
    expect(silent).not.toContain('userpromptsubmit')
  })

  it('канал, ни разу не бивший, — молчащий', () => {
    const starts = [iso(1 * DAY), iso(2 * DAY), iso(3 * DAY)]
    const silent = silentChannels([{ channel: 'Stop', at: iso(0.1 * DAY) }], starts)
    expect(silent).toContain('userpromptsubmit') // нет пульса вовсе
    expect(silent).not.toContain('stop')
  })

  it('мало истории (<3 сессий) — не паникуем', () => {
    expect(silentChannels([], [iso(DAY), iso(2 * DAY)])).toEqual([])
  })

  it('все каналы свежие — тишина не ложная', () => {
    const starts = [iso(DAY), iso(2 * DAY), iso(3 * DAY), iso(4 * DAY)]
    const beats = [
      { channel: 'UserPromptSubmit', at: iso(0.2 * DAY) },
      { channel: 'Stop', at: iso(0.3 * DAY) },
    ]
    expect(silentChannels(beats, starts)).toEqual([])
  })

  it('SessionEnd/PostToolUse не тревожим (best-effort/условные)', () => {
    const starts = [iso(DAY), iso(2 * DAY), iso(3 * DAY), iso(4 * DAY)]
    // только надёжные бьют; SessionEnd молчит — но его в EXPECTED нет
    const beats = [
      { channel: 'UserPromptSubmit', at: iso(0.2 * DAY) },
      { channel: 'Stop', at: iso(0.2 * DAY) },
    ]
    const silent = silentChannels(beats, starts)
    expect(silent).not.toContain('sessionend')
    expect(silent).not.toContain('posttooluse')
  })
})

describe('readBeats', () => {
  it('читает heartbeat-*.json, мусор пропускает', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-diag-'))
    writeFileSync(join(dir, 'heartbeat-stop.json'), JSON.stringify({ channel: 'Stop', at: iso(0) }))
    writeFileSync(join(dir, 'heartbeat-broken.json'), '{битый')
    writeFileSync(join(dir, 'other.json'), '{}')
    const beats = readBeats(dir)
    expect(beats.length).toBe(1)
    expect(beats[0].channel).toBe('Stop')
    rmrf(dir)
  })
})

describe('renderDiagnosis', () => {
  it('предупреждение с названиями каналов; пусто при тишине', () => {
    const w = renderDiagnosis(['stop', 'userpromptsubmit'])
    expect(w).toContain('самодиагностика')
    expect(w).toContain('Stop')
    expect(w).toContain('UserPromptSubmit')
    expect(w).toContain('сломанный хук')
    expect(renderDiagnosis([])).toBe('')
  })
})
