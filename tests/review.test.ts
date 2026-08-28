/**
 * Очередь ревизии подачи: узлы, поданные часто и не пригодившиеся никогда —
 * ни правкой, ни упоминанием. Витрина тех же данных, что у тишины брифов.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { ensureFeedLog } from '../src/hooks/node-brief'
import { reviewQueue, renderReviewQueue, REVIEW_MIN_SHOWN } from '../src/gardener/review'
import { buildStatusReport } from '../src/cli/reports'
import { slugOf } from '../src/hooks/session-start-core'
import { FactStore } from '../src/core/store'

function fill(db: ReturnType<typeof openDb>): void {
  ensureFeedLog(db)
  const ins = db.query('INSERT INTO jit_log(session_id, file, kind, withheld, used, cited) VALUES(?,?,?,?,?,?)')
  for (let i = 0; i < REVIEW_MIN_SHOWN; i++) ins.run(`s${i}`, 'src/dead.ts', 'graph', 0, 0, 0) // впустую
  for (let i = 0; i < REVIEW_MIN_SHOWN; i++) ins.run(`s${i}`, 'src/named.ts', 'graph', 0, 0, i === 0 ? 1 : 0) // один раз названо
  for (let i = 0; i < REVIEW_MIN_SHOWN; i++) ins.run(`s${i}`, 'src/edited.ts', 'graph', 0, i === 2 ? 1 : 0, 0) // один раз правлено
  for (let i = 0; i < REVIEW_MIN_SHOWN - 1; i++) ins.run(`s${i}`, 'src/young.ts', 'graph', 0, 0, 0) // мало подач
  for (let i = 0; i < REVIEW_MIN_SHOWN; i++) ins.run(`s${i}`, 'src/held.ts', 'graph', 1, 0, 0) // удержано — не подавалось
  for (let i = 0; i < REVIEW_MIN_SHOWN; i++) ins.run(`s${i}`, '#lesson:src', 'lesson', 0, 0, 0) // синтетический ключ
}

describe('очередь ревизии', () => {
  it('в очереди только поданное часто и без единой пользы; тишина помечается', () => {
    const db = openDb(':memory:')
    fill(db)
    expect(reviewQueue(db)).toEqual([{ file: 'src/dead.ts', shown: REVIEW_MIN_SHOWN, silenced: false }])
    db.run('CREATE TABLE brief_silence(file TEXT PRIMARY KEY, since_ordinal INTEGER NOT NULL)')
    db.query("INSERT INTO brief_silence VALUES('src/dead.ts', 3)").run()
    expect(reviewQueue(db)[0].silenced).toBe(true)
    const lines = renderReviewQueue(reviewQueue(db))
    expect(lines[0]).toContain('Очередь ревизии')
    expect(lines[1]).toContain('src/dead.ts')
    expect(lines[1]).toContain(`×${REVIEW_MIN_SHOWN}`)
    expect(lines[1]).toContain('молчит')
    expect(renderReviewQueue([])).toEqual([])
    db.close()
  })

  it('старая схема без колонок — очереди нет, а не исключение', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE jit_log(session_id TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(session_id, file))')
    expect(reviewQueue(db)).toEqual([])
    db.close()
  })

  it('/sym-status показывает очередь', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-review-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-review-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    new FactStore(db) // схема журнала — отчёт начинается с него
    fill(db)
    db.close()
    const report = buildStatusReport(dataDir)
    expect(report).toContain('Очередь ревизии подачи')
    expect(report).toContain('src/dead.ts')
    expect(report).not.toContain('src/named.ts')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
