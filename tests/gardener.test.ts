import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { simhash, hamming } from '../src/gardener/simhash'
import { dedupeLlmFacts, dedupeLlmFactsSemantic } from '../src/gardener/dedupe'
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

/**
 * Смысловой дедуп. Пересказ той же мысли на другом языке не делит со своим
 * оригиналом ни одного слова, и лексика его не берёт: на собственном паспорте
 * SimHash не поймал ни одной из 31 размеченной пары. Судит модель, но двигать
 * журнал ей позволено только по правилам этого модуля.
 */
describe('dedupeLlmFactsSemantic', () => {
  const fact = (statement: string, area: string): Fact => ({ area, statement, positive: 3, total: 6, prevalence: 0.85, tier: 'привычка' })
  const freshDb = () => openDb(join(mkdtempSync(join(tmpdir(), 'symbiont-sem-')), 'p.db'))

  /** Шесть активных фактов: ниже этого числа модель не зовут вовсе. */
  const seed = (store: FactStore): void => {
    store.assertAll([fact('exports — named only, default export is not used', 'module structure')], 'llm:layer2:haiku', '2026-07-29T10:00:00Z')
    store.assertAll([fact('комментарии — на русском, код и идентификаторы — на английском', 'комментарии')], 'llm:layer2:haiku', '2026-07-29T10:00:00Z')
    store.assertAll([fact('catch — пишется без биндинга ошибки', 'обработка ошибок')], 'llm:layer2:haiku', '2026-07-29T10:00:00Z')
    store.assertAll([fact('проглоченная в catch ошибка — сопровождается комментарием', 'ошибки')], 'llm:layer2:haiku', '2026-07-29T11:00:00Z')
    store.assertAll([fact('comment language — Russian, while code stays English', 'style')], 'llm:layer2:sonnet', '2026-07-29T12:00:00Z')
    store.assertAll([fact('экспорт — только именованный, export default не используется', 'модули')], 'llm:layer2:sonnet', '2026-07-29T12:00:00Z')
  }

  it('пересказ на другом языке сливается, свежий побеждает', () => {
    const db = freshDb()
    const store = new FactStore(db)
    seed(store)
    // Модель видит список в порядке свежие→старые: 1 — «экспорт», 2 — «comment
    // language», 3 — «проглоченная», 4 — «catch без биндинга», 5 — «комментарии», 6 — «exports»
    const merges = dedupeLlmFactsSemantic(db, () => ({ model: 'fake', text: '[[1, 6], [2, 5]]' }))
    expect(merges.length).toBe(2)
    const active = store.active().map((f) => f.statement)
    expect(active).toContain('экспорт — только именованный, export default не используется')
    expect(active).not.toContain('exports — named only, default export is not used')
    expect(active.length).toBe(4)
    expect(store.journalSize()).toBe(6) // история цела: вытеснение, не удаление
    db.close()
  })

  it('молчание модели и мусор в ответе журнала не касаются', () => {
    for (const answer of [null, { model: 'fake', text: 'извини, не могу' }, { model: 'fake', text: '[[1]]' }]) {
      const db = freshDb()
      const store = new FactStore(db)
      seed(store)
      expect(dedupeLlmFactsSemantic(db, () => answer)).toEqual([])
      expect(store.active().length).toBe(6)
      db.close()
    }
  })

  it('придуманный номер не двигает факт, которого модель не видела', () => {
    const db = freshDb()
    const store = new FactStore(db)
    seed(store)
    const merges = dedupeLlmFactsSemantic(db, () => ({ model: 'fake', text: '[[1, 99], [2, 5, 0]]' }))
    expect(merges.length).toBe(1) // первая группа осталась без пары, вторая — с одной валидной
    expect(store.active().length).toBe(5)
    db.close()
  })

  it('на паре фактов модель не зовут: уборка дороже беспорядка', () => {
    const db = freshDb()
    const store = new FactStore(db)
    store.assertAll([fact('a — b', 'x')], 'llm:layer2:haiku')
    store.assertAll([fact('c — d', 'y')], 'llm:layer2:haiku')
    let called = 0
    dedupeLlmFactsSemantic(db, () => {
      called++
      return { model: 'fake', text: '[[1,2]]' }
    })
    expect(called).toBe(0)
    db.close()
  })
})
