/**
 * Полезность подачи: система учится на себе и глушит то, что здесь не работает.
 *
 * Проблема, которую это закрывает. Каналы подают несколько ВИДОВ знания — срез
 * графа, связанные по задаче, уроки зоны, доменный плейбук, эффективные условия
 * зоны, роли стола. На одном проекте бесценны уроки, на другом — плейбуки, а
 * уроки не трогают ни разу. Раньше лились все одинаково: часть окна уходила в
 * знание, которое на ЭТОМ проекте не окупается (болезнь, на которой умер
 * claude-mem: 95% сессий память не запрошена, но налог платился всегда).
 *
 * Решение — та же петля обучения, что у фактов, только предмет обучения не
 * проект, а САМА ПОДАЧА: каждый вид копит статистику «подано → потом реально
 * тронуто» (детерминированный прокси, не LLM-судья) и получает оценку. Плохо
 * работающий вид перестаёт занимать окно; хорошо работающий остаётся.
 *
 * Две защиты от вырождения, обе обязательны:
 * 1) сглаживание Лапласа — вид не хоронится по двум неудачам (малая выборка
 *    иначе даёт 0% и приговор навсегда);
 * 2) детерминированное исследование — заглушённый вид периодически получает
 *    шанс. Без этого система замерзает в первой случайной оценке и никогда не
 *    узнает, что проект изменился (ε-greedy, только без случайности: счётчик
 *    подач воспроизводим и отлаживается глазами).
 */
import type { Database } from '../core/db'

/** Виды подачи. Строки, а не enum: новый вид добавляется в канале, не здесь. */
export type FeedKind = string

export interface Utility {
  kind: FeedKind
  surfaced: number
  used: number
  /** сглажённая доля пользы, 0..1 */
  score: number
}

/** Ниже этого вид считается не окупающимся на этом проекте. */
const MUTE_SCORE = 0.15
/** Пока подач меньше — судить рано, подаём всё. */
const MIN_SAMPLE = 12
/** Каждая N-я подача заглушённого вида — разведка боем. */
const EXPLORE_EVERY = 10

export function ensureUtilityTable(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS feed_utility(kind TEXT PRIMARY KEY, surfaced INTEGER NOT NULL, used INTEGER NOT NULL)')
  // attempts — попытки подать, включая заглушённые. Без отдельного счётчика
  // разведка нежизнеспособна: у заглушённого вида surfaced замирает ровно на
  // том значении, при котором его в последний раз пропустили, и условие
  // «каждая N-я» становится вечно истинным — вид не глушится вообще.
  const cols = (db.query('PRAGMA table_info(feed_utility)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('attempts')) db.run('ALTER TABLE feed_utility ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0')
}

/** Зафиксировать факт подачи вида (вызывается, когда блок реально ушёл в контекст). */
export function noteSurfaced(db: Database, kind: FeedKind): void {
  try {
    ensureUtilityTable(db)
    db.query(
      'INSERT INTO feed_utility(kind, surfaced, used) VALUES(?,1,0) ON CONFLICT(kind) DO UPDATE SET surfaced=surfaced+1',
    ).run(kind)
  } catch {
    /* учёт полезности — обогащение, подача важнее своей статистики */
  }
}

/** Зафиксировать пользу: поданное этим видом знание было использовано. */
export function noteUsed(db: Database, kind: FeedKind): void {
  try {
    ensureUtilityTable(db)
    db.query(
      'INSERT INTO feed_utility(kind, surfaced, used) VALUES(?,1,1) ON CONFLICT(kind) DO UPDATE SET used=used+1',
    ).run(kind)
  } catch {
    /* см. выше */
  }
}

/**
 * Оценка вида. Сглаживание Лапласа (used+1)/(surfaced+2): новый вид стартует с
 * 0.5 — «неизвестно», а не «бесполезно», и не глушится до накопления выборки.
 */
export function utilityOf(db: Database, kind: FeedKind): Utility {
  try {
    ensureUtilityTable(db)
    const row = db.query('SELECT surfaced, used FROM feed_utility WHERE kind=?').get(kind) as
      | { surfaced: number; used: number }
      | null
    const surfaced = row?.surfaced ?? 0
    const used = row?.used ?? 0
    return { kind, surfaced, used, score: (used + 1) / (surfaced + 2) }
  } catch {
    return { kind, surfaced: 0, used: 0, score: 0.5 }
  }
}

/**
 * Подавать ли вид сейчас. Молодой вид подаётся всегда (нет выборки — нет
 * приговора); окупающийся подаётся; заглушённый выходит на разведку каждую
 * EXPLORE_EVERY-ю подачу, чтобы система могла заметить перемену.
 */
export function shouldFeed(db: Database, kind: FeedKind): boolean {
  const u = utilityOf(db, kind)
  if (u.surfaced < MIN_SAMPLE) return true
  if (u.score >= MUTE_SCORE) return true
  // Вид заглушён: считаем попытку и пропускаем каждую EXPLORE_EVERY-ю —
  // проект мог измениться, и знание, вчера бесполезное, сегодня окупится.
  let attempts = 0
  try {
    ensureUtilityTable(db)
    db.query('UPDATE feed_utility SET attempts = attempts + 1 WHERE kind=?').run(kind)
    attempts = (db.query('SELECT attempts FROM feed_utility WHERE kind=?').get(kind) as { attempts: number } | null)?.attempts ?? 0
  } catch {
    return true // не смогли посчитать попытку — подаём (молчание дороже лишней строки)
  }
  return attempts % EXPLORE_EVERY === 0
}

/** Все виды по убыванию полезности — для бюджета подачи и наблюдаемости. */
export function rankKinds(db: Database): Utility[] {
  try {
    ensureUtilityTable(db)
    const rows = db.query('SELECT kind, surfaced, used FROM feed_utility').all() as Array<{ kind: string; surfaced: number; used: number }>
    return rows
      .map((r) => ({ kind: r.kind, surfaced: r.surfaced, used: r.used, score: (r.used + 1) / (r.surfaced + 2) }))
      .sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

/**
 * Виды, которые система заглушила сама. Владелец обязан это видеть: «никогда
 * молча» распространяется и на решения плагина о себе — иначе исчезнувшее
 * знание выглядит поломкой.
 */
export function mutedKinds(db: Database): Utility[] {
  return rankKinds(db).filter((u) => u.surfaced >= MIN_SAMPLE && u.score < MUTE_SCORE)
}

/** Строка наблюдаемости: во что окно вкладывается и что окупается. */
export function renderUtility(rows: Utility[]): string {
  if (rows.length === 0) return ''
  const shown = rows
    .filter((r) => r.surfaced > 0)
    .slice(0, 6)
    .map((r) => `${r.kind} ${Math.round(r.score * 100)}% (${r.used}/${r.surfaced})`)
  return shown.length > 0 ? `окупаемость подачи: ${shown.join(' · ')}` : ''
}
