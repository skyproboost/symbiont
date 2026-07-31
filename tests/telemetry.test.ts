import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { ensureFeedLog, claimNode, markUsed } from '../src/hooks/node-brief'
import { FactStore } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { handleUserPrompt } from '../src/hooks/user-prompt-core'
import { buildStatusReport } from '../src/cli/reports'
import type { Fact } from '../src/miner/facts'

describe('markUsed — прокси использования подачи', () => {
  it('used=1 только у поданного и тронутого; чужой файл не искажает', () => {
    const db = openDb(':memory:')
    ensureFeedLog(db)
    claimNode(db, 's1', 'src/a.ts') // подан
    claimNode(db, 's1', 'src/b.ts') // подан, не тронут
    markUsed(db, 's1', 'src/a.ts') // тронут → использован
    markUsed(db, 's1', 'src/never-surfaced.ts') // не подавался → no-op
    const rows = db.query('SELECT file, used FROM jit_log ORDER BY file').all() as Array<{ file: string; used: number }>
    expect(rows).toEqual([
      { file: 'src/a.ts', used: 1 },
      { file: 'src/b.ts', used: 0 },
    ])
    db.close()
  })
  it('ensureFeedLog добавляет колонку used к старой схеме (миграция)', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE jit_log(session_id TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(session_id, file))')
    db.query('INSERT INTO jit_log(session_id,file) VALUES(?,?)').run('s', 'x')
    ensureFeedLog(db) // должен ALTER ADD used
    expect(() => db.query('SELECT used FROM jit_log').all()).not.toThrow()
    db.close()
  })
})

describe('интеграция: цикл подано → тронуто → утилизация в /sym-status', () => {
  const LAW: Fact = { area: 'стиль', statement: 'кавычки — одинарные', positive: 50, total: 50, prevalence: 1, tier: 'закон' }

  function world() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-tele-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-tele-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    new FactStore(db).assertAll([LAW], 'miner:layer0')
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL, in_deg INTEGER, out_deg INTEGER)')
    db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file,to_file))')
    db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.4, 2, 0)
    db.query('INSERT INTO graph_edges(from_file,to_file) VALUES(?,?)').run('src/api.ts', 'src/core.ts')
    db.close()
    mkdirSync(join(proj, 'src'), { recursive: true })
    return { proj, dataRoot, dataDir }
  }

  it('JIT подал core.ts → правка core.ts → утилизация 100%', () => {
    const { proj, dataRoot, dataDir } = world()
    // JIT подаёт срез по упоминанию core.ts
    handleUserPrompt({ prompt: 'посмотри core.ts', cwd: proj, session_id: 's1' }, dataRoot)
    // модель правит core.ts → PostToolUse помечает used
    writeFileSync(join(proj, 'src', 'core.ts'), "const x = 'ок'\n")
    handlePostTool({ cwd: proj, session_id: 's1', tool_name: 'Write', tool_input: { file_path: join(proj, 'src', 'core.ts') } }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const used = (db.query("SELECT COUNT(*) n FROM jit_log WHERE file='src/core.ts' AND used=1").get() as { n: number }).n
    db.close()
    expect(used).toBe(1)
    const report = buildStatusReport(dataDir)
    expect(report).toContain('окупаемость')
    expect(report).toMatch(/пригодилось 1 \(100%\)/)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('подано, но не тронуто → утилизация 0% (честный сигнал «знание не использовано»)', () => {
    const { proj, dataRoot, dataDir } = world()
    handleUserPrompt({ prompt: 'глянь core.ts', cwd: proj, session_id: 's2' }, dataRoot) // подан, не правим
    const report = buildStatusReport(dataDir)
    expect(report).toMatch(/пригодилось 0 \(0%\)/)
    rmrf(proj)
    rmrf(dataRoot)
  })
})
