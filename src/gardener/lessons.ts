/**
 * Компаундинг уроков (CONCEPT §4.4): «каждая единица работы делает следующие
 * легче». Урок — привязанный к ЗОНЕ вывод из работы, который всплывает JIT, когда
 * модель снова касается этой зоны («здесь владелец уже исправлял X»).
 *
 * Источник урока — поправка владельца (модель написала → человек исправил): самый
 * высокосигнальный, СТАБИЛЬНО доступный сигнал (парсинг транскрипта концепт
 * запрещает — «официально нестабилен»). Глобальный факт из поправки теряет
 * файл-якорь (факты statement-keyed); урок его СОХРАНЯЕТ и делает подачу локальной.
 *
 * Чистые функции над таблицей lessons; дедуп (zone, statement) — повторная
 * поправка освежает урок, а не плодит копию (аксиома против дублей памяти).
 */
import type { Database } from '../core/db'

export interface Lesson {
  zone: string
  statement: string
  source: string
  created_at: string
}

/** Зона файла — его каталог (специфичнее, чем верхний уровень). Корневой файл → «(корень)». */
export function zoneOf(file: string): string {
  const norm = file.replaceAll('\\', '/')
  const i = norm.lastIndexOf('/')
  return i === -1 ? '(корень)' : norm.slice(0, i)
}

export function ensureLessons(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS lessons(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone TEXT NOT NULL,
      statement TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(zone, statement)
    )`,
  )
}

/** Запись урока; повтор (zone+statement) освежает отметку/источник, не дублирует. */
export function recordLesson(db: Database, zone: string, statement: string, source: string, now: string): void {
  ensureLessons(db)
  db.query(
    'INSERT INTO lessons(zone, statement, source, created_at) VALUES(?,?,?,?) ON CONFLICT(zone, statement) DO UPDATE SET created_at=excluded.created_at, source=excluded.source',
  ).run(zone, statement, source, now)
}

/** Уроки для набора зон (новые первыми), максимум limit — для JIT-подачи по касанию зоны. */
export function lessonsForZones(db: Database, zones: string[], limit: number): Lesson[] {
  if (zones.length === 0) return []
  const has = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='lessons'").get() as { n: number }).n > 0
  if (!has) return []
  const uniq = [...new Set(zones)]
  const placeholders = uniq.map(() => '?').join(',')
  return db
    .query(`SELECT zone, statement, source, created_at FROM lessons WHERE zone IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`)
    .all(...uniq, limit) as Lesson[]
}

export function countLessons(db: Database): number {
  try {
    const has = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='lessons'").get() as { n: number }).n > 0
    return has ? (db.query('SELECT COUNT(*) n FROM lessons').get() as { n: number }).n : 0
  } catch {
    return 0
  }
}
