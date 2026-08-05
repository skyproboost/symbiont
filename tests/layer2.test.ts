import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSample, buildPrompt, parseRules, ruleToFact, runVerbalize } from '../src/layer2/verbalize'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { openDb } from '../src/core/db'

describe('parseRules (строгий fail-open парс)', () => {
  it('валидный массив с обвязкой — разбирается', () => {
    const text = 'Вот правила:\n[{"area":"ошибки","statement":"ошибки — возвращаются значением","evidence":["a.js","b.js","c.js"],"confidence":0.9}]\nконец'
    const rules = parseRules(text)
    expect(rules.length).toBe(1)
    expect(rules[0].statement).toContain('—')
  })

  it('мусор, не-массив, битый JSON — пустой список', () => {
    expect(parseRules('извините, не могу')).toEqual([])
    expect(parseRules('{"a":1}')).toEqual([])
    expect(parseRules('[{broken')).toEqual([])
  })

  it('правила без 3 подтверждений / слишком короткие / с кривой уверенностью отсеиваются', () => {
    const text = JSON.stringify([
      { area: 'x', statement: 'коротко', evidence: ['a', 'b', 'c'], confidence: 0.9 },
      { area: 'x', statement: 'мало подтверждений у правила', evidence: ['a'], confidence: 0.9 },
      { area: 'x', statement: 'кривая уверенность у правила', evidence: ['a', 'b', 'c'], confidence: 1.5 },
      { area: 'ок', statement: 'валидное правило достаточной длины', evidence: ['a', 'b', 'c'], confidence: 0.7 },
    ])
    const rules = parseRules(text)
    expect(rules.length).toBe(1)
    expect(rules[0].area).toBe('ок')
  })
})

describe('ruleToFact', () => {
  it('LLM-факт никогда не закон: высокая уверенность → привычка, prevalence < 0.95', () => {
    const f = ruleToFact({ area: 'x', statement: 'а — б', evidence: ['1', '2', '3'], confidence: 0.99 }, 6)
    expect(f.tier).toBe('привычка')
    expect(f.prevalence).toBeLessThan(0.95)
  })
  it('низкая уверенность → гипотеза', () => {
    const f = ruleToFact({ area: 'x', statement: 'а — б', evidence: ['1', '2', '3'], confidence: 0.5 }, 6)
    expect(f.tier).toBe('гипотеза')
  })
})

describe('runVerbalize с фейковым LLM', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-l2-proj-'))
  mkdirSync(join(proj, 'lib'), { recursive: true })
  writeFileSync(join(proj, 'lib', 'core.js'), "var e = require('./err');\nvar x = 1;\n".repeat(6))
  writeFileSync(join(proj, 'lib', 'err.js'), 'var E = { fail: 1 };\nmodule.exports = E;\n'.repeat(6))
  writeFileSync(join(proj, 'app.js'), "var core = require('./lib/core');\n")
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-l2-data-'))
  handleSessionStart({ cwd: proj, source: 'startup', session_id: 'l2' }, dataRoot)
  const dataDir = join(dataRoot, slugOf(proj))

  it('образец строится из топа графа, промпт содержит законы и файлы', () => {
    const samples = buildSample(proj, dataDir)
    expect(samples.length).toBeGreaterThan(0)
    const prompt = buildPrompt(['переменные — только var'], samples)
    expect(prompt).toContain('НЕ повторяй')
    expect(prompt).toContain('переменные — только var')
    expect(prompt).toContain('<document_content>')
    expect(prompt).toContain('JSON')
  })

  it('полный прогон: правила записаны в журнал с источником llm:layer2', () => {
    const fake = () => ({
      model: 'fake-sonnet',
      text: JSON.stringify([
        { area: 'ошибки', statement: 'ошибки — возвращаются кодом, не бросаются', evidence: ['lib/core.js', 'lib/err.js', 'app.js'], confidence: 0.85 },
      ]),
    })
    const r = runVerbalize(proj, dataDir, fake)
    expect(r.model).toBe('fake-sonnet')
    expect(r.rules.length).toBe(1)
    expect(r.journal.born).toBe(1)

    const db = openDb(join(dataDir, 'passport.db'))
    const row = db.query("SELECT * FROM fact_journal WHERE source LIKE 'llm:layer2%'").get() as any
    db.close()
    expect(row.statement).toContain('возвращаются кодом')
    expect(row.tier).toBe('привычка')
  })

  it('LLM вернул мусор — ноль фактов, журнал не тронут', () => {
    const before = (() => {
      const db = openDb(join(dataDir, 'passport.db'))
      const n = (db.query('SELECT COUNT(*) n FROM fact_journal').get() as { n: number }).n
      db.close()
      return n
    })()
    const r = runVerbalize(proj, dataDir, () => ({ model: 'fake', text: 'извините, вот эссе о коде…' }))
    expect(r.rules).toEqual([])
    const db = openDb(join(dataDir, 'passport.db'))
    const after = (db.query('SELECT COUNT(*) n FROM fact_journal').get() as { n: number }).n
    db.close()
    expect(after).toBe(before)
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
