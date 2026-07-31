import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { simhash, hamming } from '../src/gardener/simhash'
import { dedupeLlmFacts } from '../src/gardener/dedupe'
import { FactStore } from '../src/core/store'
import type { Fact } from '../src/miner/facts'

describe('simhash + hamming', () => {
  it('перефразировки близки, разные правила далеки', () => {
    const a = simhash('единые источники правды констант хранятся в одном месте модуля')
    const b = simhash('константы единый источник правды хранятся в одном месте')
    const c = simhash('стрелочные функции запрещены используются только function выражения')
    expect(hamming(a, b)).toBeLessThanOrEqual(12)
    expect(hamming(a, c)).toBeGreaterThan(20)
    expect(hamming(a, a)).toBe(0)
  })
})

describe('dedupeLlmFacts', () => {
  const fact = (statement: string, area = 'архитектура'): Fact => ({
    area,
    statement,
    positive: 3,
    total: 6,
    prevalence: 0.85,
    tier: 'привычка',
  })

  const freshDb = () => openDb(join(mkdtempSync(join(tmpdir(), 'symbiont-gard-')), 'p.db'))

  it('почти-дубли от разных моделей сливаются, свежий побеждает', () => {
    const db = freshDb()
    const store = new FactStore(db)
    store.assertAll([fact('единые источники правды констант хранятся в одном месте модуля')], 'llm:layer2:haiku', '2026-07-29T10:00:00Z')
    store.assertAll([fact('константы единый источник правды хранятся в одном месте')], 'llm:layer2:sonnet', '2026-07-29T12:00:00Z')
    store.assertAll([fact('стрелочные функции запрещены используются только function выражения', 'функции')], 'llm:layer2:sonnet', '2026-07-29T12:00:00Z')

    const merges = dedupeLlmFacts(db)
    expect(merges.length).toBe(1)
    expect(merges[0].kept).toContain('константы единый')

    const active = store.active().filter((f) => f.statement.includes('исто'))
    expect(active.length).toBe(1)
    expect(store.journalSize()).toBe(3) // история цела
    db.close()
  })

  it('статистические факты (не llm) не трогаются', () => {
    const db = freshDb()
    const store = new FactStore(db)
    store.assertAll([fact('отступы два пробела везде в проекте')], 'miner:layer0')
    store.assertAll([fact('отступы два пробела везде в этом проекте', 'форматирование')], 'llm:layer2:haiku')
    const merges = dedupeLlmFacts(db)
    expect(merges.length).toBe(0) // llm-факт один — сливать не с чем (miner неприкосновенен)
    db.close()
  })

  it('идемпотентность: повторный прогон ничего не сливает', () => {
    const db = freshDb()
    const store = new FactStore(db)
    store.assertAll([fact('правило раз про кэширование данных модулей')], 'llm:layer2:a', '2026-07-29T10:00:00Z')
    store.assertAll([fact('правило раз про кэширование данных модуля')], 'llm:layer2:b', '2026-07-29T11:00:00Z')
    expect(dedupeLlmFacts(db).length).toBe(1)
    expect(dedupeLlmFacts(db).length).toBe(0)
    db.close()
  })
})
