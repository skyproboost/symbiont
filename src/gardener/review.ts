/**
 * Очередь ревизии подачи: узлы, которые подаются часто и не пригождаются никогда.
 *
 * Тишина брифов (node-brief.ts) уже глушит такой узел сама — на пять сессий,
 * потом пробует снова. Но решение принималось молча: владелец видел в сводке
 * «подача адаптирована» по ВИДАМ знания и не видел, какие именно файлы система
 * считает пустой тратой окна. Очередь — витрина этих данных: файл, сколько раз
 * подан (без удержанных — они не подавались), сколько раз правлен и назван,
 * и молчит ли он сейчас. Ничего не решает, только показывает; данные те же,
 * что у тишины, поэтому разойтись с ней не может.
 *
 * Аналог review queue в duet («memories с высоким показом и низкой полезностью»),
 * применённый к узлам графа: у нас единица подачи — файл, а не запись памяти.
 */
import type { Database } from '../core/db'
import { t } from '../core/i18n'

/** Столько подач без единой пользы — уже не случайность. */
export const REVIEW_MIN_SHOWN = 5
const REVIEW_MAX = 5

export interface ReviewRow {
  file: string
  shown: number
  /** молчит ли бриф узла сейчас (brief_silence) */
  silenced: boolean
}

export function reviewQueue(db: Database, minShown = REVIEW_MIN_SHOWN): ReviewRow[] {
  try {
    const rows = db
      .query(
        `SELECT file, COUNT(*) shown FROM jit_log
         WHERE file NOT LIKE '#%' AND withheld=0
         GROUP BY file HAVING SUM(used)=0 AND SUM(cited)=0 AND COUNT(*)>=?
         ORDER BY shown DESC, file LIMIT ?`,
      )
      .all(minShown, REVIEW_MAX) as Array<{ file: string; shown: number }>
    if (rows.length === 0) return []
    let silenced = new Set<string>()
    try {
      silenced = new Set((db.query('SELECT file FROM brief_silence').all() as Array<{ file: string }>).map((r) => r.file))
    } catch {
      /* таблицы тишины ещё нет — никто не молчит */
    }
    return rows.map((r) => ({ file: r.file, shown: r.shown, silenced: silenced.has(r.file) }))
  } catch {
    return [] // старая схема без колонок — очереди нет
  }
}

export function renderReviewQueue(rows: ReviewRow[]): string[] {
  if (rows.length === 0) return []
  const L = [t(' Очередь ревизии подачи (подавалось часто, не пригодилось ни разу: ни правки, ни упоминания)', ' Feed review queue (surfaced often, never paid off: neither edited nor mentioned)')]
  for (const r of rows) {
    L.push(`   ${r.file.padEnd(40)}×${r.shown}${r.silenced ? t('  · сейчас молчит', '  · silenced now') : ''}`)
  }
  return L
}
