/**
 * Цена подачи с учётом повтора: вставленное хуком перечитывается каждым
 * следующим запросом до сжатия (экономика из разбора SoL-Pi).
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { accountFeedCost, applyLines, feedCostStats, renderFeedCost } from '../src/gardener/feed-cost'
import { setLang, lang } from '../src/core/i18n'

const inject = (event: string, text: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'attachment', isSidechain: false, attachment: { type: 'hook_additional_context', content: [text], hookName: event, hookEvent: event }, ...extra })
const answer = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { id, role: 'assistant', content: [{ type: 'text', text: 'ок' }] }, ...extra })
const boundary = (): string => JSON.stringify({ type: 'system', subtype: 'compact_boundary' })
const ours = (n: number): string => `Symbiont · ${'ж'.repeat(n - 11)}`

const EMPTY = { offset: 0, requests: 0, channels: {}, seen: [] as string[] }

describe('учёт повтора', () => {
  it('каждый ответ перечитывает живое, сжатие обнуляет живое', () => {
    const s = applyLines(EMPTY, [
      inject('SessionStart', ours(1000)),
      answer('a'),
      answer('a'), // вторая запись того же ответа — не второй запрос
      inject('UserPromptSubmit', ours(200)),
      answer('b'),
      boundary(),
      answer('c'),
    ])
    expect(s.requests).toBe(3)
    expect(s.channels.SessionStart).toEqual({ live: 0, once: 1000, replay: 2000 })
    expect(s.channels.UserPromptSubmit).toEqual({ live: 0, once: 200, replay: 200 })
  })

  it('чужая вставка и строки сабагента не считаются нашими', () => {
    const s = applyLines(EMPTY, [
      inject('PostToolUse:Edit', 'The memory index at MEMORY.md is 19.8KB'),
      inject('PreToolUse:Read', ours(300), { isSidechain: true }),
      inject('PreToolUse:Read', ours(100)),
      answer('a'),
      answer('z', { isSidechain: true }),
    ])
    expect(Object.keys(s.channels)).toEqual(['PreToolUse']) // канал без суффикса матчера
    expect(s.channels.PreToolUse.once).toBe(100)
    expect(s.requests).toBe(1)
  })
})

describe('дочитывание транскрипта', () => {
  it('по частям — то же, что за один проход; недописанная строка ждёт следующего хода; повтор идемпотентен', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-feedcost-'))
    const db = openDb(join(dir, 'p.db'))
    try {
      const tr = join(dir, 't.jsonl')
      const lines = [inject('SessionStart', ours(900)), answer('a'), inject('PreToolUse:Read', ours(150)), answer('b'), answer('c')]
      // первая часть + начало строки, которую сессия ещё пишет
      writeFileSync(tr, `${lines.slice(0, 2).join('\n')}\n${lines[2].slice(0, 20)}`, 'utf8')
      accountFeedCost(db, 's1', tr)
      appendFileSync(tr, `${lines[2].slice(20)}\n${lines.slice(3).join('\n')}\n`, 'utf8')
      accountFeedCost(db, 's1', tr)
      accountFeedCost(db, 's1', tr) // без новых строк — без изменений

      const whole = applyLines(EMPTY, lines)
      const row = db.query('SELECT requests, channels FROM feed_cost WHERE session_id=?').get('s1') as { requests: number; channels: string }
      expect(row.requests).toBe(whole.requests)
      expect(JSON.parse(row.channels)).toEqual(whole.channels)
      expect(whole.channels.SessionStart.replay).toBe(900 * 3)
      expect(whole.channels.PreToolUse.replay).toBe(150 * 2)
    } finally {
      db.close()
      rmrf(dir)
    }
  })

  it('файл короче прочитанного — учёт заново, а не смещение в никуда', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-feedcost2-'))
    const db = openDb(join(dir, 'p.db'))
    try {
      const tr = join(dir, 't.jsonl')
      writeFileSync(tr, `${[inject('SessionStart', ours(5000)), answer('a'), answer('b')].join('\n')}\n`, 'utf8')
      accountFeedCost(db, 's1', tr)
      writeFileSync(tr, `${[inject('SessionStart', ours(300)), answer('x')].join('\n')}\n`, 'utf8')
      accountFeedCost(db, 's1', tr)
      const row = db.query('SELECT requests, channels FROM feed_cost WHERE session_id=?').get('s1') as { requests: number; channels: string }
      expect(row.requests).toBe(1)
      expect(JSON.parse(row.channels).SessionStart).toEqual({ live: 300, once: 300, replay: 300 })
    } finally {
      db.close()
      rmrf(dir)
    }
  })

  it('нет транскрипта — тишина, не исключение', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-feedcost3-'))
    const db = openDb(join(dir, 'p.db'))
    try {
      accountFeedCost(db, 's1', null)
      accountFeedCost(db, 's1', join(dir, 'нет.jsonl'))
      expect(feedCostStats(db)).toBeNull()
    } finally {
      db.close()
      rmrf(dir)
    }
  })
})

describe('отчёт', () => {
  it('средняя появляется с трёх сессий и называет множитель и главный канал', () => {
    const before = lang()
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-feedcost4-'))
    const db = openDb(join(dir, 'p.db'))
    try {
      setLang('ru')
      for (let i = 0; i < 3; i++) {
        const tr = join(dir, `t${i}.jsonl`)
        const lines = [inject('SessionStart', ours(4000)), inject('UserPromptSubmit', ours(1000))]
        for (let r = 0; r < 100; r++) lines.push(answer(`m${r}`))
        writeFileSync(tr, `${lines.join('\n')}\n`, 'utf8')
        accountFeedCost(db, `s${i}`, tr)
        if (i === 1) expect(feedCostStats(db)).toBeNull() // две сессии — ещё не средняя
      }
      const s = feedCostStats(db)!
      expect(s.sessions).toBe(3)
      expect(s.oncePerSession).toBe(5000)
      expect(s.replayPerSession).toBe(500_000)
      expect(s.top).toEqual({ channel: 'SessionStart', share: 80 })
      const line = renderFeedCost(s)
      expect(line).toContain('~5.0 тыс.')
      expect(line).toContain('~500 тыс.')
      expect(line).toContain('×100')
      expect(line).toContain('SessionStart 80%')
      expect(renderFeedCost(null)).toBe('')
    } finally {
      setLang(before)
      db.close()
      rmrf(dir)
    }
  })
})
