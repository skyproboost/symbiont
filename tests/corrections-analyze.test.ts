import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { analyzeCorrections, buildCorrectionsPrompt } from '../src/gardener/corrections'
import { FactStore } from '../src/core/store'

describe('анализ поправок → правила-кандидаты', () => {
  function setup() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-corran-proj-'))
    writeFileSync(join(proj, 'fresh.js'), 'var oData = 1;\n') // «после» — на диске
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'symbiont-corran-db-')), 'p.db'))
    new FactStore(db) // создать fact_journal
    db.run(
      'CREATE TABLE corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, before_content TEXT NOT NULL, from_session TEXT NOT NULL, detected_at TEXT NOT NULL, analyzed INTEGER NOT NULL DEFAULT 0)',
    )
    db.query("INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES('fresh.js', 'var data = 1;', 's1', '2026-07-29')").run()
    return { proj, db }
  }

  it('промпт содержит «до» и «после»', () => {
    const p = buildCorrectionsPrompt([{ file: 'a.js', before: 'var data = 1;', after: 'var oData = 1;' }])
    expect(p).toContain('ассистент написал')
    expect(p).toContain('var data = 1;')
    expect(p).toContain('владелец исправил')
    expect(p).toContain('var oData = 1;')
  })

  it('правило рождается гипотезой, поправка потребляется', () => {
    const { proj, db } = setup()
    const fake = () => ({
      model: 'fake',
      text: JSON.stringify([
        { area: 'именование', statement: 'объекты в переменных получают префикс o (венгерская нотация)', evidence: ['fresh.js'], confidence: 0.7 },
      ]),
    })
    const r = analyzeCorrections(db, proj, fake)
    expect(r.analyzed).toBe(1)
    expect(r.born).toBe(1)

    const fact = db.query("SELECT * FROM fact_journal WHERE source LIKE 'llm:corrections%'").get() as any
    expect(fact.tier).toBe('гипотеза') // мало подтверждений — не привычка
    expect(fact.statement).toContain('префикс o')

    const pending = db.query('SELECT COUNT(*) n FROM corrections WHERE analyzed=0').get() as { n: number }
    expect(pending.n).toBe(0)

    // повторный анализ — пусто (идемпотентность)
    expect(analyzeCorrections(db, proj, fake).analyzed).toBe(0)
    db.close()
    rmrf(proj, { recursive: true, force: true })
  })

  it('модели недоступны → поправки НЕ потребляются (дожуём позже)', () => {
    const { proj, db } = setup()
    const r = analyzeCorrections(db, proj, () => null)
    expect(r.analyzed).toBe(0)
    const pending = db.query('SELECT COUNT(*) n FROM corrections WHERE analyzed=0').get() as { n: number }
    expect(pending.n).toBe(1)
    db.close()
    rmrf(proj, { recursive: true, force: true })
  })
})
