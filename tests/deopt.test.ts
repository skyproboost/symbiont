/**
 * Деоптимизация уверенности (паттерн V8): замер, противоречащий накопленному
 * рейтингу, раздувает отклонение немедленно — закон перестаёт принуждаться
 * сейчас, а не после месяцев старения. Проверяется и чистая математика
 * (ratings), и сквозной путь через журнал (store): ярус падает, FSRS-интервал
 * не растёт.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { FactStore } from '../src/core/store'
import { confirmRating, isSurprise, liveTier, SURPRISE_GAP } from '../src/core/ratings'
import type { Fact } from '../src/miner/facts'

describe('confirmRating — сюрприз против подтверждения', () => {
  const law = { rating: 0.97, deviation: 0.05 }

  it('обычное подтверждение сжимает отклонение', () => {
    const next = confirmRating(law, 0.96)
    expect(isSurprise(law, 0.96)).toBe(false)
    expect(next.deviation).toBeLessThan(law.deviation)
  })

  it('сюрприз раздувает отклонение вместо сжатия', () => {
    const next = confirmRating(law, 0.8)
    expect(isSurprise(law, 0.8)).toBe(true)
    expect(next.deviation).toBeGreaterThan(law.deviation)
    // и рейтинг адаптируется быстрее, чем позволил бы старый вес dev×2
    expect(next.rating).toBeLessThan(0.94)
  })

  it('закон после сюрприза теряет ярус немедленно, не через старение', () => {
    const before = liveTier(law.rating, law.deviation, 100)
    expect(before).toBe('закон')
    const next = confirmRating(law, 0.78)
    const after = liveTier(next.rating, next.deviation, 100)
    expect(after).not.toBe('закон')
  })

  it('порог выше шума перемеров: сдвиг на сотые — не сюрприз', () => {
    expect(isSurprise(law, law.rating - SURPRISE_GAP + 0.01)).toBe(false)
    expect(isSurprise(law, law.rating - SURPRISE_GAP - 0.01)).toBe(true)
  })
})

describe('журнал — сюрприз не считается успешным повторением FSRS', () => {
  const fact = (over: Partial<Fact> = {}): Fact => ({
    area: 'форматирование',
    statement: 'отступы — 2 пробела',
    positive: 97,
    total: 100,
    prevalence: 0.97,
    tier: 'закон',
    ...over,
  })

  const freshStore = () =>
    new FactStore(openDb(join(mkdtempSync(join(tmpdir(), 'symbiont-deopt-')), 'p.db')))

  it('подтверждение растит стабильность, сюрприз — замораживает', () => {
    const s = freshStore()
    // LLM-источник: у него стабильность FSRS ведётся всегда
    s.assertAll([fact()], 'llm:layer2:test', '2026-07-01T00:00:00Z')
    const born = s.active()[0]

    // Обычное подтверждение через месяц — интервал вырос
    s.assertAll([fact({ prevalence: 0.96, positive: 96 })], 'llm:layer2:test', '2026-08-01T00:00:00Z')
    const confirmed = s.active()[0]
    expect(confirmed.stability!).toBeGreaterThan(born.stability!)

    // Сюрприз ещё через месяц — стабильность не выросла, отклонение раздулось
    s.assertAll([fact({ prevalence: 0.7, positive: 70 })], 'llm:layer2:test', '2026-09-01T00:00:00Z')
    const surprised = s.active()[0]
    expect(surprised.stability!).toBe(confirmed.stability!)
    expect(surprised.deviation!).toBeGreaterThan(confirmed.deviation!)
  })

  it('сквозной ярус: закон статистики падает в тот же замер, когда мир изменился', () => {
    const s = freshStore()
    s.assertAll([fact()], 'miner:layer0', '2026-07-01T00:00:00Z')
    // Несколько подтверждений — уверенность закона сжата
    s.assertAll([fact({ prevalence: 0.97 })], 'miner:layer0', '2026-07-08T00:00:00Z')
    s.assertAll([fact({ prevalence: 0.98, positive: 98 })], 'miner:layer0', '2026-07-15T00:00:00Z')
    expect(s.active(Date.parse('2026-07-15T00:00:00Z'))[0].tier).toBe('закон')

    // Мир изменился: тот же вердикт, но доля рухнула (полпроекта переехало)
    s.assertAll([fact({ prevalence: 0.8, positive: 80 })], 'miner:layer0', '2026-07-22T00:00:00Z')
    expect(s.active(Date.parse('2026-07-22T00:00:00Z'))[0].tier).not.toBe('закон')
  })
})
