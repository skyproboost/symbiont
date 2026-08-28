/**
 * Устаревание: кандидаты на вытеснение, видимые без замера и без модели —
 * зона исчезла с диска, срок перепроверки вышел, правило давно не подтверждалось.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { FactStore } from '../src/core/store'
import { staleFacts, renderStale, STALE_DAYS } from '../src/gardener/stale'
import { zoneAreaOf } from '../src/miner/facts'
import type { Fact } from '../src/miner/facts'

const DAY = 24 * 3600_000

describe('кандидаты на вытеснение', () => {
  it('три класса различаются, живое не попадает', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-stale-'))
    mkdirSync(join(root, 'src'))
    const db = openDb(':memory:')
    const store = new FactStore(db)
    const now = Date.parse('2026-08-28T00:00:00Z')
    const iso = (ms: number): string => new Date(ms).toISOString()
    const facts: Fact[] = [
      { area: zoneAreaOf('форматирование', 'src'), statement: 'отступы — 2 пробела', positive: 40, total: 40, prevalence: 1, tier: 'закон' },
      { area: zoneAreaOf('форматирование', 'legacy'), statement: 'отступы — табы', positive: 40, total: 40, prevalence: 1, tier: 'закон' },
      { area: 'объявления', statement: 'кавычки — одинарные', positive: 40, total: 40, prevalence: 1, tier: 'закон' },
    ]
    store.assertAll(facts, 'miner:layer0', iso(now))
    store.assertAll([{ area: 'типы', statement: 'экспорты — только именованные', positive: 6, total: 6, prevalence: 0.9, tier: 'привычка' }], 'llm:x', iso(now))
    store.assertAll([{ area: 'типы', statement: 'алиасы — через type', positive: 6, total: 6, prevalence: 0.9, tier: 'привычка' }], 'llm:x', iso(now - (STALE_DAYS + 5) * DAY))
    // Без расписания FSRS правило не «пора перепроверить» — но календарь его видит
    db.query("UPDATE fact_journal SET stability=NULL WHERE statement='алиасы — через type'").run()
    // Свежее правило модели со стабильностью в один день: по FSRS уже пора
    db.query("UPDATE fact_journal SET stability=1, seen_at=? WHERE statement='экспорты — только именованные'").run(iso(now - 10 * DAY))

    const groups = staleFacts(db, root, now)
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.facts.map((f) => f.statement)]))
    expect(byKind['законы зон, которых нет на диске']).toEqual(['отступы — табы'])
    expect(byKind['правила модели с истёкшим сроком перепроверки']).toEqual(['экспорты — только именованные'])
    expect(byKind[`правила модели, не подтверждавшиеся дольше ${STALE_DAYS} дней`]).toEqual(['алиасы — через type'])
    const text = renderStale(groups)
    expect(text).toContain('Устаревание')
    expect(text).toContain('отступы (форматирование@legacy|отступы)')
    expect(renderStale([])).toContain('кандидатов нет')
    db.close()
    rmrf(root)
  })
})
