import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { FactStore, keyOf } from '../src/core/store'
import type { Fact } from '../src/miner/facts'

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
  new FactStore(openDb(join(mkdtempSync(join(tmpdir(), 'symbiont-store-')), 'p.db')))

describe('keyOf', () => {
  it('ключ — «область|предмет до тире»: разные вердикты дают один ключ', () => {
    expect(keyOf(fact())).toBe('форматирование|отступы')
    expect(keyOf(fact({ statement: 'отступы — табы' }))).toBe('форматирование|отступы')
    expect(keyOf(fact({ area: 'vue', statement: 'Vue-компоненты — <script setup>' }))).toBe(
      'vue|Vue-компоненты',
    )
  })
})

describe('FactStore', () => {
  it('рождение: новый факт активен', () => {
    const s = freshStore()
    const r = s.assertAll([fact()], 'miner:layer0')
    expect(r).toEqual({ born: 1, updated: 0, superseded: 0 })
    expect(s.active().length).toBe(1)
    expect(s.active()[0].statement).toBe('отступы — 2 пробела')
  })

  it('уточнение: тот же вердикт с новыми числами — update, журнал не растёт', () => {
    const s = freshStore()
    s.assertAll([fact()], 'miner:layer0')
    const r = s.assertAll([fact({ positive: 98, total: 101, prevalence: 0.97 })], 'miner:layer0')
    expect(r).toEqual({ born: 0, updated: 1, superseded: 0 })
    expect(s.journalSize()).toBe(1)
    expect(s.active()[0].positive).toBe(98)
  })

  it('вытеснение: смена вердикта — старый superseded, история цела', () => {
    const s = freshStore()
    s.assertAll([fact()], 'miner:layer0', '2026-07-01T00:00:00Z')
    const r = s.assertAll([fact({ statement: 'отступы — табы' })], 'miner:layer0', '2026-07-29T00:00:00Z')
    expect(r).toEqual({ born: 0, updated: 0, superseded: 1 })

    const active = s.active()
    expect(active.length).toBe(1)
    expect(active[0].statement).toBe('отступы — табы')

    const hist = s.history('форматирование|отступы')
    expect(hist.length).toBe(2)
    expect(hist[1].statement).toBe('отступы — 2 пробела')
    expect(hist[1].superseded_by).toBe(hist[0].id) // time-travel: кто кого вытеснил
  })

  it('тот же вердикт с иным ярусом — подтверждение (ярус теперь производный от рейтинга)', () => {
    const s = freshStore()
    s.assertAll([fact()], 'miner:layer0')
    s.assertAll([fact({ tier: 'привычка', prevalence: 0.8, positive: 80 })], 'miner:layer0')
    expect(s.journalSize()).toBe(1) // не вытеснение — уточнение измерения
    const row = s.active()[0]
    expect(row.confirmations).toBe(1)
    expect(row.rating).toBeLessThan(0.97) // рейтинг сдвинулся к свежему замеру
  })

  it('живой ярус: рождение с рейтингом, подтверждения сжимают отклонение', () => {
    const s = freshStore()
    s.assertAll([fact({ prevalence: 0.99, positive: 990, total: 1000 })], 'miner:layer0')
    const born = s.active()[0]
    expect(born.rating).toBeCloseTo(0.99)
    expect(born.deviation).toBeLessThanOrEqual(0.05)
    expect(born.tier).toBe('закон')

    s.assertAll([fact({ prevalence: 0.99, positive: 990, total: 1000 })], 'miner:layer0')
    expect(s.active()[0].deviation).toBeLessThan(born.deviation)
  })

  it('старение: неподтверждаемый LLM-факт тускнеет из привычки в гипотезу', () => {
    const s = freshStore()
    s.assertAll(
      [fact({ statement: 'ошибки — возвращаются значением', prevalence: 0.85, tier: 'привычка' })],
      'llm:layer2:test',
      '2026-07-29T00:00:00Z',
    )
    const fresh = s.active(Date.parse('2026-07-30T00:00:00Z'))[0]
    expect(fresh.tier).toBe('привычка')
    const aged = s.active(Date.parse('2026-10-15T00:00:00Z'))[0] // ~2.5 месяца без подтверждений
    expect(aged.tier).toBe('гипотеза')
  })

  it('несколько фактов разных областей живут независимо', () => {
    const s = freshStore()
    s.assertAll(
      [fact(), fact({ area: 'объявления', statement: 'переменные — только var' })],
      'miner:layer0',
    )
    expect(s.active().length).toBe(2)
  })
})
