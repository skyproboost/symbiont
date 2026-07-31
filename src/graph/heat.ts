/**
 * «Тепло» узлов графа (influence maps из геймдева, CONCEPT §4.1): недавно
 * тронутый файл излучает релевантность, тепло остывает между сессиями.
 *
 * Механика распада — FORWARD DECAY (Firefox frecency, «ноль демонов»): не
 * пересчитываем фоном, а нормализуем одним делением ПРИ ЧТЕНИИ по возрасту
 * отметки. Хранение: node_heat(file, heat, updated_at) — при касании узла
 * heat = decay(old) + 1.0 (бамп поверх остывшего). Тепло входит вторым тиром
 * сида персонализированного PageRank (×10 недавно тронутым — канон aider,
 * «×10 упомянутым» переосмыслено как «×10 горячим»): подача учитывает не только
 * упомянутое в промпте, но и контекст недавней работы (непрерывность сессии).
 * Задел под слой дрейфа: горячее + распад = hotspot (частота×свежесть).
 */
import type { Database } from '../core/db'

/** Полураспад тепла: за это время тепло падает вдвое. 3 суток — остывает между сессиями, переживает паузы в часах. */
export const HEAT_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000

/** Forward decay: тепло в момент now по отметке ts. Возраст назад/битьё → как есть/0. */
export function decayHeat(heat: number, ageMs: number, halfLifeMs = HEAT_HALF_LIFE_MS): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return heat
  return heat * Math.pow(0.5, ageMs / halfLifeMs)
}

export interface HeatRow {
  file: string
  heat: number
  updated_at: string
}

export function ensureHeatTable(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS node_heat(file TEXT PRIMARY KEY, heat REAL NOT NULL, updated_at TEXT NOT NULL)')
}

/** Бамп тепла при касании узла: остудить прежнее по возрасту + 1.0. Идемпотентно по (file). */
export function bumpHeat(db: Database, file: string, nowIso: string): void {
  ensureHeatTable(db)
  const row = db.query('SELECT heat, updated_at FROM node_heat WHERE file=?').get(file) as { heat: number; updated_at: string } | null
  const decayed = row ? decayHeat(row.heat, Date.parse(nowIso) - Date.parse(row.updated_at)) : 0
  db.query(
    'INSERT INTO node_heat(file, heat, updated_at) VALUES(?,?,?) ON CONFLICT(file) DO UPDATE SET heat=excluded.heat, updated_at=excluded.updated_at',
  ).run(file, decayed + 1.0, nowIso)
}

/** Текущее (остывшее) тепло всех узлов на момент nowMs — карта file→heat. */
export function effectiveHeat(rows: HeatRow[], nowMs: number, halfLifeMs = HEAT_HALF_LIFE_MS): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const h = decayHeat(r.heat, nowMs - Date.parse(r.updated_at), halfLifeMs)
    if (h > 0) out.set(r.file, h)
  }
  return out
}

/** Горячие файлы выше порога (по убыванию тепла), максимум max — кандидаты во второй тир сида PPR. */
export function hotFiles(heat: Map<string, number>, threshold: number, max: number): string[] {
  return [...heat.entries()]
    .filter((pair) => pair[1] >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map((pair) => pair[0])
}

/** Чтение сырых строк тепла (для effectiveHeat); нет таблицы → пусто (fail-open). */
export function readHeatRows(db: Database): HeatRow[] {
  try {
    const has = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='node_heat'").get() as { n: number }).n > 0
    if (!has) return []
    return db.query('SELECT file, heat, updated_at FROM node_heat').all() as HeatRow[]
  } catch {
    return []
  }
}
