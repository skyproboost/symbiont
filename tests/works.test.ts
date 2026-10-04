/**
 * Сырьё работ садовника против «уже сделано»: полный пересчёт (init re) обязан
 * доходить до работ, чьё сырьё исчерпано прошлым проходом, — иначе «заново»
 * молча пропускало вербализацию, ради которой init срезает ранний срез слоя 2.
 */
import { describe, expect, it } from 'bun:test'
import { openDb, type Database } from '../src/core/db'
import { FactStore } from '../src/core/store'
import { WORKS } from '../src/gardener/works'
import type { Work, WorkContext } from '../src/gardener/scheduler'
import type { Fact } from '../src/miner/facts'

const T0 = Date.parse('2026-07-30T12:00:00.000Z')

const ctxOf = (db: Database, full: boolean): WorkContext => ({ db, projectRoot: 'D:/proj', dataDir: 'D:/data', nowMs: T0, full })

const fact = (statement: string): Fact[] => [{ area: 'семантика', statement, positive: 4, total: 6, prevalence: 0.8, tier: 'привычка' }]

const verbalize = WORKS.find((w) => w.id === 'verbalize') as Work

describe('verbalize — когда есть сырьё', () => {
  it('первичная вербализация: код есть, слой 2 не бегал — бежит и в фоне', () => {
    const db = openDb(':memory:')
    new FactStore(db).assertAll(fact('кавычки — одинарные'), 'miner:layer0', new Date(T0).toISOString())
    expect(verbalize.due(ctxOf(db, false))).toBe(true)
    db.close()
  })

  it('уже вербализовано: фон не повторяет, полный пересчёт повторяет', () => {
    const db = openDb(':memory:')
    const store = new FactStore(db)
    store.assertAll(fact('кавычки — одинарные'), 'miner:layer0', new Date(T0).toISOString())
    // Свежий факт слоя 2: перепроверка ему ещё не положена, сырьё «исчерпано»
    store.assertAll(fact('ошибки — возвращаются значением'), 'llm:layer2:m', new Date(T0).toISOString())
    expect(store.dueForReview(T0)).toEqual([])
    expect(verbalize.due(ctxOf(db, false))).toBe(false)
    expect(verbalize.due(ctxOf(db, true))).toBe(true)
    db.close()
  })

  it('кода нет — пересчёт не зовёт модель на пустом материале', () => {
    const db = openDb(':memory:')
    new FactStore(db).assertAll(fact('ошибки — возвращаются значением'), 'llm:layer2:m', new Date(T0).toISOString())
    expect(verbalize.due(ctxOf(db, true))).toBe(false)
    db.close()
  })
})
