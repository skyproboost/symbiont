/**
 * SubagentStart-канал: свежий сабагент (не форк) стартует с чистым окном —
 * паспорт обязан прийти срезом (законы + карта), а не полной сводкой.
 * Проверяется состав, порядок секций по типу агента, бюджет и fail-open.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { FactStore } from '../src/core/store'
import { handleSubagentStart, SUBAGENT_CHAR_BUDGET } from '../src/hooks/subagent-start-core'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-sub-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-sub-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(proj, 'README.md'), 'x\n')
  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.6, 12, 0)
  db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/api.ts', 0.3, 4, 2)
  new FactStore(db).assertAll(
    [{ area: 'форматирование', statement: 'кавычки — одинарные', positive: 97, total: 100, prevalence: 0.97, tier: 'закон' }],
    'miner:layer0',
  )
  db.close()
  return { proj, dataRoot }
}

describe('SubagentStart — срез паспорта', () => {
  it('срез содержит карту модулей и законы, укладывается в бюджет', () => {
    const { proj, dataRoot } = makeWorld()
    const out = handleSubagentStart({ cwd: proj, session_id: 's1', agent_type: 'Explore' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('src/core.ts')
    expect(ctx).toContain('кавычки — одинарные')
    expect(ctx.length).toBeLessThanOrEqual(SUBAGENT_CHAR_BUDGET + 1)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('планировщику законы идут раньше карты, разведчику — карта раньше законов', () => {
    const { proj, dataRoot } = makeWorld()
    const planner = handleSubagentStart({ cwd: proj, agent_type: 'Plan' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(planner.indexOf('кавычки')).toBeLessThan(planner.indexOf('src/core.ts'))
    const explorer = handleSubagentStart({ cwd: proj, agent_type: 'Explore' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(explorer.indexOf('src/core.ts')).toBeLessThan(explorer.indexOf('кавычки'))
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('переполненный бюджет режется по границе строки, а не посреди слова', () => {
    const { proj, dataRoot } = makeWorld()
    const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'))
    // Роли (z1) — то, что в жизни и выталкивает срез за бюджет
    db.run('CREATE TABLE IF NOT EXISTS node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)')
    const ins = db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)')
    const role = db.query("INSERT INTO node_summary(file,z1,content_hash,model,created_at) VALUES(?,?,'h','m','2026-01-01')")
    for (let i = 0; i < 8; i++) {
      ins.run(`src/module-${i}.ts`, 0.9 - i * 0.01, 9, 1)
      role.run(`src/module-${i}.ts`, `роль модуля ${i}: ${'длинное описание того, что он делает и зачем нужен '.repeat(6)}`)
    }
    db.close()
    const ctx = handleSubagentStart({ cwd: proj, agent_type: 'Explore' }, dataRoot).hookSpecificOutput?.additionalContext ?? ''
    expect(ctx.length).toBeLessThanOrEqual(SUBAGENT_CHAR_BUDGET + 2)
    expect(ctx.endsWith('\n…')).toBe(true)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('нет паспорта → молчание, не ошибка (fail-open)', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-sub-empty-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-sub-empty-data-'))
    const out = handleSubagentStart({ cwd: proj, agent_type: 'Explore' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('пульс канала оставлен (самодиагностика видит жизнь)', () => {
    const { proj, dataRoot } = makeWorld()
    handleSubagentStart({ cwd: proj, agent_type: 'Explore' }, dataRoot)
    const beatPath = join(dataRoot, slugOf(proj), 'heartbeat-subagentstart.json')
    expect(require('node:fs').existsSync(beatPath)).toBe(true)
    rmrf(proj)
    rmrf(dataRoot)
  })
})
