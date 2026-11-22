/**
 * Улики правила слоя 2: сверенные цитаты, на которых оно принято.
 *
 * Раньше улика жила одно мгновение: цитата сверялась с файлом при разборе
 * ответа и выбрасывалась, в журнал уходило только число файлов. Правило
 * теряло связь с тем, на чём стоит: исчезни эти файлы — ничто этого не видело,
 * и правило о давно удалённом каталоге подавалось как действующее.
 *
 * Привязка — к записи факта (id), а не к ключу: ключ наследуется новой
 * формулировкой при вытеснении, и та получила бы чужие улики.
 *
 * Чем улики НЕ являются. Уцелевшие цитаты не подтверждают правило: конвенцию
 * ломают в других файлах, и освежать правило по трём нетронутым строкам значило
 * бы прятать его от смысловой перепроверки. Ушедшие цитаты его не отзывают:
 * файл могли переименовать, ветку — переключить, а отзыв в журнале необратим.
 * Поэтому здесь только запись и счёт: что с правилом делать, решает показ
 * (gardener/stale.ts) и будущий протокол перепроверки, а не этот модуль.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../core/db'
import { canonText } from './canon'

export interface Quote {
  file: string
  quote: string
}

/** Правило принимается по уликам минимум из стольких разных файлов (см. parseQuotedRules). */
export const MIN_EVIDENCE = 3

/** Файл крупнее не читается ради сверки — как и везде, гигантов не жуём. */
const MAX_FILE_BYTES = 1_000_000

function ensure(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS fact_evidence(fact_id INTEGER NOT NULL, file TEXT NOT NULL, quote TEXT NOT NULL, PRIMARY KEY(fact_id, file))')
}

/** Записать улики факта; свежий набор заменяет прежний — подтверждение приносит свежие цитаты. */
export function recordEvidence(db: Database, factId: number, quotes: Quote[]): void {
  try {
    ensure(db)
    db.query('DELETE FROM fact_evidence WHERE fact_id=?').run(factId)
    const add = db.query('INSERT OR REPLACE INTO fact_evidence(fact_id, file, quote) VALUES(?,?,?)')
    for (const q of quotes) add.run(factId, q.file, q.quote)
  } catch {
    // Улики — уточнение показа: без них правило живёт как прежде
  }
}

export interface EvidenceCount {
  /** сколько файлов-улик записано */
  recorded: number
  /** в скольких из них цитата всё ещё на месте */
  standing: number
}

/** Сколько улик факта записано и сколько из них стоит; у правила, рождённого до хранения улик, — ноль записанных. */
export function evidenceOf(db: Database, projectRoot: string, factId: number): EvidenceCount {
  let rows: Quote[]
  try {
    rows = db.query('SELECT file, quote FROM fact_evidence WHERE fact_id=?').all(factId) as Quote[]
  } catch {
    return { recorded: 0, standing: 0 } // таблицы нет — улик ещё не писали
  }
  let standing = 0
  for (const row of rows) {
    try {
      const path = join(projectRoot, row.file)
      if (statSync(path).size > MAX_FILE_BYTES) continue
      if (canonText(readFileSync(path, 'utf8')).includes(canonText(row.quote))) standing++
    } catch {
      /* файла нет — улика ушла */
    }
  }
  return { recorded: rows.length, standing }
}
