/**
 * Самоотчёт о поданном: поданный файл, названный в тексте ответа модели, —
 * третий сигнал окупаемости (после правки и лифта), из того же транскрипта.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { assistantText, citedKeys, markCited, citedStats } from '../src/gardener/cited'
import { ensureFeedLog, claimNode } from '../src/hooks/node-brief'
import { buildStatusReport } from '../src/cli/reports'
import { slugOf } from '../src/hooks/session-start-core'
import { FactStore } from '../src/core/store'

const say = (text: string): string => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const tool = (name: string, input: Record<string, unknown>): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })
const user = (text: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })

describe('текст ассистента и упоминания', () => {
  it('берётся только текст ассистента; вызовы инструментов и реплики владельца — нет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-cited-'))
    const p = join(dir, 't.jsonl')
    writeFileSync(p, [user('посмотри src/a.ts'), tool('Read', { file_path: '/p/src/b.ts' }), say('Правка нужна в src/c.ts'), '{broken'].join('\n'))
    const text = assistantText(p)
    expect(text).toContain('src/c.ts')
    expect(text).not.toContain('src/a.ts')
    expect(text).not.toContain('src/b.ts')
    expect(assistantText(join(dir, 'nope.jsonl'))).toBe('')
    rmrf(dir)
  })

  it('путь целиком считается; имя файла — только если оно единственное среди поданных', () => {
    const surfaced = ['src/core/index.ts', 'src/cli/index.ts', 'src/gardener/utility.ts']
    expect(citedKeys(surfaced, 'смотри src/core/index.ts и utility.ts')).toEqual(['src/core/index.ts', 'src/gardener/utility.ts'])
    expect(citedKeys(surfaced, 'в index.ts есть баг')).toEqual([]) // два index.ts — имя ничего не доказывает
    expect(citedKeys(surfaced, '')).toEqual([])
  })
})

describe('отметка в jit_log', () => {
  it('cited=1 только у поданного и названного; повтор идемпотентен; удержанные тоже считаются', () => {
    process.env.SYMBIONT_HOLDOUT = '0'
    const db = openDb(':memory:')
    ensureFeedLog(db)
    claimNode(db, 's1', 'src/a.ts')
    claimNode(db, 's1', 'src/b.ts')
    db.query("INSERT INTO jit_log(session_id, file, kind, withheld) VALUES('s1','src/w.ts','graph',1)").run()
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-cited-'))
    const p = join(dir, 't.jsonl')
    writeFileSync(p, [say('Проблема в src/a.ts, а src/w.ts я бы не трогал')].join('\n'))
    expect(markCited(db, 's1', p)).toBe(2)
    expect(markCited(db, 's1', p)).toBe(0)
    const rows = db.query('SELECT file, cited FROM jit_log ORDER BY file').all() as Array<{ file: string; cited: number }>
    expect(rows).toEqual([
      { file: 'src/a.ts', cited: 1 },
      { file: 'src/b.ts', cited: 0 },
      { file: 'src/w.ts', cited: 1 },
    ])
    // Статистика: лифт молчит, пока удержаний мало
    const s = citedStats(db)!
    expect(s.surfaced).toBe(2)
    expect(s.cited).toBe(1)
    expect(s.lift).toBeNull()
    db.close()
    rmrf(dir)
  })

  it('лифт: доля названных среди поданных минус среди удержанных', () => {
    const db = openDb(':memory:')
    ensureFeedLog(db)
    const ins = db.query('INSERT INTO jit_log(session_id, file, kind, withheld, cited) VALUES(?,?,?,?,?)')
    for (let i = 0; i < 10; i++) ins.run('s', `src/s${i}.ts`, 'graph', 0, i < 6 ? 1 : 0) // 60% названо
    for (let i = 0; i < 10; i++) ins.run('s', `src/w${i}.ts`, 'graph', 1, i < 2 ? 1 : 0) // 20% и без нас
    expect(citedStats(db)!.lift).toBe(40)
    db.close()
  })

  it('упоминание рвёт серию тишины брифа: узел, названный в прошлой сессии, подаётся снова', () => {
    process.env.SYMBIONT_HOLDOUT = '0'
    const db = openDb(':memory:')
    ensureFeedLog(db)
    db.run('CREATE TABLE sessions(session_id TEXT PRIMARY KEY, started_at TEXT NOT NULL)')
    for (const [sid, at] of [['s1', '2026-08-01'], ['s2', '2026-08-02'], ['s3', '2026-08-03'], ['s4', '2026-08-04']]) {
      db.query('INSERT INTO sessions(session_id, started_at) VALUES(?,?)').run(sid, at)
    }
    for (const sid of ['s1', 's2', 's3']) claimNode(db, sid, 'src/hub.ts')
    expect(claimNode(db, 's4', 'src/hub.ts')).toBe(false) // три подачи без пользы — молчание
    db.run('DELETE FROM brief_silence')
    db.query("UPDATE jit_log SET cited=1 WHERE session_id='s2' AND file='src/hub.ts'").run()
    expect(claimNode(db, 's4', 'src/hub.ts')).toBe(true) // названный владельцу — польза, серия порвана
    db.close()
  })

  it('/sym-status показывает названное рядом с пригодившимся', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-cited-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-cited-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    new FactStore(db) // схема журнала — отчёт начинается с него
    ensureFeedLog(db)
    db.query("INSERT INTO jit_log(session_id, file, kind, withheld, used, cited) VALUES('s','src/a.ts','graph',0,0,1)").run()
    db.query("INSERT INTO jit_log(session_id, file, kind, withheld, used, cited) VALUES('s','src/b.ts','graph',0,1,0)").run()
    db.close()
    const report = buildStatusReport(dataDir)
    expect(report).toContain('подано файлов 2')
    expect(report).toContain('названо в ответах 1')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
