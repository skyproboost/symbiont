/**
 * Садовник v0: дедуп почти-одинаковых LLM-фактов.
 * Разные модели (или повторные прогоны) формулируют одно правило разными
 * словами — близкие по SimHash активные факты сливаются вытеснением:
 * побеждает более свежий замер, история цела (Datomic). Никогда не молчит —
 * возвращает список слияний.
 */
import type { Database } from '../core/db'
import { simhash, hamming } from './simhash'

const THRESHOLD = 12 // из 64 бит; несвязанные тексты обычно дальше 24

export interface Merge {
  kept: string
  removed: string
}

export function dedupeLlmFacts(db: Database): Merge[] {
  const rows = db
    .query(
      "SELECT id, statement, area, seen_at FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' ORDER BY seen_at DESC, id DESC",
    )
    .all() as Array<{ id: number; statement: string; area: string; seen_at: string }>
  if (rows.length < 2) return []

  const hashes = rows.map((r) => simhash(`${r.area} ${r.statement}`))
  const gone = new Set<number>()
  const merges: Merge[] = []
  const supersede = db.query('UPDATE fact_journal SET superseded_by=? WHERE id=?')

  // rows отсортированы свежие→старые: свежий побеждает
  for (let i = 0; i < rows.length; i++) {
    if (gone.has(rows[i].id)) continue
    for (let j = i + 1; j < rows.length; j++) {
      if (gone.has(rows[j].id)) continue
      if (hamming(hashes[i], hashes[j]) <= THRESHOLD) {
        supersede.run(rows[i].id, rows[j].id)
        gone.add(rows[j].id)
        merges.push({ kept: rows[i].statement, removed: rows[j].statement })
      }
    }
  }
  return merges
}
