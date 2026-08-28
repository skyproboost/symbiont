/**
 * Метки владельца на фактах: «это правило вводит в заблуждение».
 *
 * Журнал фактов неприкосновенен, и вытеснение в нём делает только замер. Но у
 * владельца не было ни одного способа сказать «это правило здесь вредно» — ни
 * тогда, когда модель вывела привычку по шести случайным файлам, ни когда
 * измеренный закон формально верен, а по существу мешает (миграции, скрипты).
 * Единственный выход был — молча терпеть строку в каждой сводке и её поимки
 * гейтом.
 *
 * Метка — слой ПОВЕРХ журнала, а не правка журнала: отдельная таблица по ключу
 * факта (не по id — ключ переживает вытеснение, и переизмеренная версия того
 * же правила остаётся приглушённой, пока владелец не снимет метку сам). Факт
 * с меткой не подаётся ни в одну сводку и не судится гейтом, но история его
 * цела, и MCP показывает его с пометкой: приглушённое — не удалённое.
 *
 * Отвергнуто «понижать вес в бюджете сводки вместо исключения»: на малом
 * паспорте бюджет не режет ничего, и вредная строка оставалась бы в подаче
 * целиком. Владелец сказал «вводит в заблуждение» — значит, не подавать.
 *
 * Идея взята из feedback-ledger'а duet (helpful / misleading / superseded по
 * UUID показанного); здесь оставлена одна метка, потому что «полезно» уже
 * измеряется лифтом, а «вытеснено» делает замер.
 */
import type { Database } from '../core/db'
import { statement } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

export const MISLEADING = 'misleading'

export interface FactLabel {
  key: string
  label: string
  note: string
  at: string
}

export function ensureLabels(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS fact_labels(
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL
    )`,
  )
}

const hasTable = (db: Database): boolean => {
  try {
    return (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='fact_labels'").get() as { n: number }).n > 0
  } catch {
    return false
  }
}

/** Все метки; без таблицы — пусто (читатели на readonly-базе создать её не могут). */
export function readLabels(db: Database): FactLabel[] {
  if (!hasTable(db)) return []
  try {
    return db.query('SELECT key, label, note, at FROM fact_labels ORDER BY at DESC').all() as FactLabel[]
  } catch {
    return []
  }
}

/** Ключи фактов, приглушённых владельцем. */
export function mutedKeys(db: Database): Set<string> {
  return new Set(readLabels(db).filter((l) => l.label === MISLEADING).map((l) => l.key))
}

export function labelFact(db: Database, key: string, label: string, note: string, at: string): void {
  ensureLabels(db)
  db.query('INSERT INTO fact_labels(key, label, note, at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET label=excluded.label, note=excluded.note, at=excluded.at').run(
    key,
    label,
    note,
    at,
  )
}

/** true — метка была и снята. */
export function unlabelFact(db: Database, key: string): boolean {
  if (!hasTable(db)) return false
  return Number(db.query('DELETE FROM fact_labels WHERE key=?').run(key).changes) > 0
}

/**
 * Найти факт по слову владельца: точный ключ журнала либо подстрока
 * формулировки на любом из двух языков подачи. Регистр не важен.
 */
export function matchFacts<F extends { key: string; statement: string }>(facts: F[], phrase: string): F[] {
  const q = phrase.trim().toLowerCase()
  if (!q) return []
  const exact = facts.filter((f) => f.key.toLowerCase() === q)
  if (exact.length > 0) return exact
  return facts.filter((f) => f.statement.toLowerCase().includes(q) || statement(f.statement).toLowerCase().includes(q))
}
