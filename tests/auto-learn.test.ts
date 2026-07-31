import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { shouldAutoLearn, recordAutoLearn, lastAutoLearn } from '../src/gardener/auto-learn'
import { FactStore } from '../src/core/store'
import type { Fact } from '../src/miner/facts'

const T0 = Date.parse('2026-07-30T12:00:00Z')
const DAY = 86_400_000

const fact = (statement: string, source: string): [Fact[], string] => [
  [{ area: 'семантика', statement, positive: 4, total: 6, prevalence: 0.8, tier: 'привычка' }],
  source,
]

function freshWorld() {
  const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-auto-'))
  const db = openDb(join(dataDir, 'passport.db'))
  return { dataDir, db }
}

describe('shouldAutoLearn — триггеры сырья', () => {
  it('без сырья — не бегаем', () => {
    const { dataDir, db } = freshWorld()
    expect(shouldAutoLearn(db, dataDir, T0).run).toBe(false)
    db.close()
    rmrf(dataDir)
  })

  it('непроанализированная поправка владельца — главный триггер', () => {
    const { dataDir, db } = freshWorld()
    db.run(
      'CREATE TABLE corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, before_content TEXT, from_session TEXT, detected_at TEXT, analyzed INTEGER NOT NULL DEFAULT 0)',
    )
    db.query("INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES('a.ts','x','s1','2026-07-30')").run()
    const d = shouldAutoLearn(db, dataDir, T0)
    expect(d.run).toBe(true)
    expect(d.reason).toContain('поправок владельца: 1')
    db.close()
    rmrf(dataDir)
  })

  it('due-факт FSRS — триггер переподтверждения', () => {
    const { dataDir, db } = freshWorld()
    const store = new FactStore(db)
    store.assertAll(...fact('ошибки — возвращаются значением', 'llm:layer2:m'), new Date(T0 - 30 * DAY).toISOString())
    const d = shouldAutoLearn(db, dataDir, T0)
    expect(d.run).toBe(true)
    expect(d.reason).toContain('к перепроверке')
    db.close()
    rmrf(dataDir)
  })

  it('первичная вербализация: код есть, слой 2 не бегал', () => {
    const { dataDir, db } = freshWorld()
    new FactStore(db).assertAll(...fact('кавычки — одинарные', 'miner:layer0'))
    const d = shouldAutoLearn(db, dataDir, T0)
    expect(d.run).toBe(true)
    expect(d.reason).toContain('первичная')
    db.close()
    rmrf(dataDir)
  })

  it('кулдаун: успешный проход держит 72ч, провальный — 12ч', () => {
    const { dataDir, db } = freshWorld()
    new FactStore(db).assertAll(...fact('кавычки — одинарные', 'miner:layer0'))
    recordAutoLearn(db, true, 'ок', new Date(T0 - 24 * 3600_000).toISOString())
    expect(shouldAutoLearn(db, dataDir, T0).run).toBe(false) // 24ч < 72ч
    recordAutoLearn(db, false, 'модели недоступны', new Date(T0 - 24 * 3600_000).toISOString())
    expect(shouldAutoLearn(db, dataDir, T0).run).toBe(true) // 24ч > 12ч — ретрай
    db.close()
    rmrf(dataDir)
  })

  it('выключатель learn.json {"auto": false} останавливает петлю', () => {
    const { dataDir, db } = freshWorld()
    new FactStore(db).assertAll(...fact('кавычки — одинарные', 'miner:layer0'))
    writeFileSync(join(dataDir, 'learn.json'), '{"auto": false}')
    const d = shouldAutoLearn(db, dataDir, T0)
    expect(d.run).toBe(false)
    expect(d.reason).toContain('выключено')
    db.close()
    rmrf(dataDir)
  })

  it('мета читается назад (для /sym-status)', () => {
    const { db, dataDir } = freshWorld()
    recordAutoLearn(db, true, 'слой 2: +3 правил')
    expect(lastAutoLearn(db)?.note).toContain('+3 правил')
    db.close()
    rmrf(dataDir)
  })
})
