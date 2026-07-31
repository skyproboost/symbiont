import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import {
  initialStability,
  retrievability,
  confirmStability,
  isDue,
  RETENTION_THRESHOLD,
} from '../src/core/schedule'
import { FactStore } from '../src/core/store'
import { buildPrompt } from '../src/layer2/verbalize'
import type { Fact } from '../src/miner/facts'

const DAY = 86_400_000
const T0 = Date.parse('2026-07-30T00:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('кривая забывания (FSRS-4.5)', () => {
  it('свежий замер — полная уверенность', () => {
    expect(retrievability(14, iso(T0), T0)).toBe(1)
  })

  it('калибровка: ровно при t = S извлекаемость = 0.9 (порог due)', () => {
    expect(retrievability(14, iso(T0), T0 + 14 * DAY)).toBeCloseTo(0.9, 5)
    expect(retrievability(100, iso(T0), T0 + 100 * DAY)).toBeCloseTo(0.9, 5)
  })

  it('монотонно падает со временем', () => {
    const r7 = retrievability(14, iso(T0), T0 + 7 * DAY)
    const r14 = retrievability(14, iso(T0), T0 + 14 * DAY)
    const r60 = retrievability(14, iso(T0), T0 + 60 * DAY)
    expect(r7).toBeGreaterThan(r14)
    expect(r14).toBeGreaterThan(r60)
    expect(r60).toBeGreaterThan(0)
  })

  it('битая дата — fail-open в «свежий» (не ложный due)', () => {
    expect(retrievability(14, 'мусор', T0)).toBe(1)
    expect(isDue(14, 'мусор', T0)).toBe(false)
  })
})

describe('интервалы', () => {
  it('стартовый: слой 2 — 14 дней, правило из поправки — 7 (проверять чаще), майнер — вне FSRS', () => {
    expect(initialStability('llm:layer2:claude-sonnet-5')).toBe(14)
    expect(initialStability('llm:corrections:claude-sonnet-5')).toBe(7)
    expect(initialStability('miner:layer0')).toBe(null)
  })

  it('подтверждение растит интервал; «на грани забвения» — сильнее, чем «сразу же»', () => {
    const early = confirmStability(14, 0.98) // подтвердили почти сразу
    const late = confirmStability(14, 0.7) // подтвердили у порога забвения
    expect(early).toBeGreaterThan(14)
    expect(late).toBeGreaterThan(early)
    expect(confirmStability(300, 0.5)).toBe(365) // потолок — год
  })

  it('isDue: до истечения интервала — рано, после — пора', () => {
    expect(isDue(14, iso(T0), T0 + 10 * DAY)).toBe(false)
    expect(isDue(14, iso(T0), T0 + 15 * DAY)).toBe(true)
    expect(isDue(null, iso(T0), T0 + 999 * DAY)).toBe(false) // майнер никогда не due
  })
})

const fact = (statement: string): Fact => ({
  area: 'семантика',
  statement,
  positive: 4,
  total: 6,
  prevalence: 0.8,
  tier: 'привычка',
})

const freshStore = () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'symbiont-fsrs-')), 'p.db'))
  return { db, store: new FactStore(db) }
}

describe('FactStore × FSRS', () => {
  it('рождение LLM-факта — стартовый интервал; майнер — NULL', () => {
    const { db, store } = freshStore()
    store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0))
    store.assertAll([fact('кавычки — одинарные')], 'miner:layer0', iso(T0))
    const rows = store.active()
    expect(rows.find((r) => r.source.startsWith('llm:'))!.stability).toBe(14)
    expect(rows.find((r) => r.source.startsWith('miner:'))!.stability).toBe(null)
    db.close()
  })

  it('подтверждение того же вердикта растит интервал; просроченное — сильнее свежего', () => {
    const a = freshStore()
    a.store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0))
    a.store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0 + 1 * DAY))
    const soon = a.store.active()[0].stability!
    a.db.close()

    const b = freshStore()
    b.store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0))
    b.store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0 + 20 * DAY))
    const late = b.store.active()[0].stability!
    b.db.close()

    expect(soon).toBeGreaterThan(14)
    expect(late).toBeGreaterThan(soon)
  })

  it('вытеснение вердикта: новый факт начинает интервал заново', () => {
    const { db, store } = freshStore()
    store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0))
    store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0 + 20 * DAY)) // вырос
    store.assertAll([fact('ошибки — бросаются исключениями')], 'llm:layer2:m', iso(T0 + 30 * DAY)) // смена вердикта
    const active = store.active()
    expect(active.length).toBe(1)
    expect(active[0].statement).toBe('ошибки — бросаются исключениями')
    expect(active[0].stability).toBe(14)
    db.close()
  })

  it('dueForReview: просроченные LLM-факты, майнер не участвует', () => {
    const { db, store } = freshStore()
    store.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:m', iso(T0))
    store.assertAll([fact('хелперы — чистые функции')], 'llm:layer2:m', iso(T0 + 14 * DAY))
    store.assertAll([fact('кавычки — одинарные')], 'miner:layer0', iso(T0 - 300 * DAY))
    const due = store.dueForReview(T0 + 16 * DAY)
    expect(due.map((f) => f.statement)).toEqual(['ошибки — возвращаются значением'])
    db.close()
  })

  it('миграция старой базы: бэкфилл stability только LLM-фактам', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-fsrs-mig-'))
    const raw = openDb(join(dir, 'p.db'))
    raw.run(
      `CREATE TABLE fact_journal(
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, area TEXT NOT NULL,
        statement TEXT NOT NULL, tier TEXT NOT NULL, prevalence REAL NOT NULL,
        positive INTEGER NOT NULL, total INTEGER NOT NULL, source TEXT NOT NULL,
        asserted_at TEXT NOT NULL, seen_at TEXT NOT NULL, superseded_by INTEGER)`,
    )
    const ins = raw.query(
      `INSERT INTO fact_journal(key, area, statement, tier, prevalence, positive, total, source, asserted_at, seen_at, superseded_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
    )
    ins.run('a|x', 'a', 'x — y', 'привычка', 0.8, 4, 6, 'llm:layer2:m', iso(T0), iso(T0))
    ins.run('a|z', 'a', 'z — w', 'закон', 1, 50, 50, 'miner:layer0', iso(T0), iso(T0))
    const store = new FactStore(raw)
    const rows = store.active()
    expect(rows.find((r) => r.source.startsWith('llm:'))!.stability).toBe(14)
    expect(rows.find((r) => r.source.startsWith('miner:'))!.stability).toBe(null)
    raw.close()
  })
})

describe('подача due-фактов в /sym-learn', () => {
  it('промпт получает блок переподтверждения только при наличии due', () => {
    const samples = [{ file: 'a.ts', content: 'x' }]
    const withDue = buildPrompt(['закон 1'], samples, ['ошибки — возвращаются значением'])
    expect(withDue).toContain('пора переподтверждение')
    expect(withDue).toContain('- ошибки — возвращаются значением')
    const without = buildPrompt(['закон 1'], samples)
    expect(without).not.toContain('пора переподтверждение')
  })
})
