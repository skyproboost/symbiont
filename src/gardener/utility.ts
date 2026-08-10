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
 * Три защиты от вырождения, все обязательны:
 * 1) сглаживание Лапласа — вид не хоронится по двум неудачам (малая выборка
 *    иначе даёт 0% и приговор навсегда);
 * 2) детерминированное исследование — заглушённый вид периодически получает
 *    шанс. Без этого система замерзает в первой случайной оценке и никогда не
 *    узнает, что проект изменился (ε-greedy, только без случайности: счётчик
 *    подач воспроизводим и отлаживается глазами);
 * 3) затухание улик — счётчики экспоненциально стареют (полураспад месяц),
 *    и это снимает две болезни разом. Поглощающее состояние: без затухания
 *    вид, заглушённый по нерепрезентативной неделе, оставался бы мёртвым,
 *    пока разведка не выиграет много раз ПОДРЯД против всей накопленной
 *    истории. Инерция ветерана: у вида с сотнями подач свежая перемена
 *    проекта тонула бы в древних счётчиках. С затуханием выборка сама
 *    возвращается ниже MIN_SAMPLE («мнения нет — подаём»), а вес наблюдения
 *    определяется его свежестью. Это дисконтированный бандит (семейство
 *    discounted Thompson sampling), но БЕЗ случайности выбора: сэмплинг из
 *    Beta-постериора отвергнут по той же причине, что и ε-greedy со
 *    случайностью, — решение о подаче обязано воспроизводиться и
 *    отлаживаться глазами. Затухание складывается в счётчики ПРИ ЗАПИСИ
 *    (forward decay, как у тепла узлов): фоновых пересчётов нет.
 */
import type { Database } from '../core/db'
import { t } from '../core/i18n'

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
/**
 * Полураспад улик окупаемости: месяц. Короче полураспада тепла (3 дня) на
 * порядок нельзя — окупаемость меряется редкими событиями (подача → правка),
 * и недельная память не набирала бы MIN_SAMPLE никогда; длиннее квартала —
 * возвращается инерция ветерана. Месяц даёт вечный mute длиной ~1.5–2 месяца
 * даже без единой удачной разведки: surfaced сам падает ниже MIN_SAMPLE.
 */
export const UTILITY_HALF_LIFE_MS = 30 * 24 * 3600_000
/**
 * Затухание складывается в счётчики не чаще раза в час: на масштабе одной
 * сессии множитель неотличим от единицы, а целочисленные счётчики остаются
 * целыми — их можно читать глазами и сверять с журналом подач.
 */
const FOLD_MIN_AGE_MS = 3600_000

export function ensureUtilityTable(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS feed_utility(kind TEXT PRIMARY KEY, surfaced INTEGER NOT NULL, used INTEGER NOT NULL)')
  // attempts — попытки подать, включая заглушённые. Без отдельного счётчика
  // разведка нежизнеспособна: у заглушённого вида surfaced замирает ровно на
  // том значении, при котором его в последний раз пропустили, и условие
  // «каждая N-я» становится вечно истинным — вид не глушится вообще.
  const cols = (db.query('PRAGMA table_info(feed_utility)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('attempts')) db.run('ALTER TABLE feed_utility ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0')
  // decayed_at — отметка последнего сложения затухания (не последней подачи!):
  // счётчики стареют от неё, и складывать можно идемпотентно в любом канале.
  if (!cols.includes('decayed_at')) db.run('ALTER TABLE feed_utility ADD COLUMN decayed_at TEXT')
}

/**
 * Сложить затухание в счётчики вида по возрасту отметки decayed_at.
 * Оба счётчика умножаются на ОДИН множитель, поэтому чистое затухание не
 * меняет долю пользы — оно возвращает вид к молодости (surfaced ↓ к
 * MIN_SAMPLE) и снижает вес старых наблюдений против свежих. Вызывается из
 * всех точек записи и из решения о подаче: заглушённый вид не пишется, но
 * решение о нём принимается — старение обязано дойти и туда.
 */
function foldDecay(db: Database, kind: FeedKind, nowMs: number): void {
  const row = db.query('SELECT surfaced, used, decayed_at FROM feed_utility WHERE kind=?').get(kind) as
    | { surfaced: number; used: number; decayed_at: string | null }
    | null
  if (!row) return
  if (row.decayed_at === null) {
    // Строка из-до-миграции: возраст неизвестен — считаем свежей, не гадаем
    db.query('UPDATE feed_utility SET decayed_at=? WHERE kind=?').run(new Date(nowMs).toISOString(), kind)
    return
  }
  const age = nowMs - Date.parse(row.decayed_at)
  if (!Number.isFinite(age) || age < FOLD_MIN_AGE_MS) return
  const k = Math.pow(0.5, age / UTILITY_HALF_LIFE_MS)
  db.query('UPDATE feed_utility SET surfaced=?, used=?, decayed_at=? WHERE kind=?').run(
    row.surfaced * k,
    row.used * k,
    new Date(nowMs).toISOString(),
    kind,
  )
}

/** Зафиксировать факт подачи вида (вызывается, когда блок реально ушёл в контекст). */
export function noteSurfaced(db: Database, kind: FeedKind, nowMs = Date.now()): void {
  try {
    ensureUtilityTable(db)
    foldDecay(db, kind, nowMs)
    db.query(
      'INSERT INTO feed_utility(kind, surfaced, used, decayed_at) VALUES(?,1,0,?) ON CONFLICT(kind) DO UPDATE SET surfaced=surfaced+1',
    ).run(kind, new Date(nowMs).toISOString())
  } catch {
    /* учёт полезности — обогащение, подача важнее своей статистики */
  }
}

/** Зафиксировать пользу: поданное этим видом знание было использовано. */
export function noteUsed(db: Database, kind: FeedKind, nowMs = Date.now()): void {
  try {
    ensureUtilityTable(db)
    foldDecay(db, kind, nowMs)
    db.query(
      'INSERT INTO feed_utility(kind, surfaced, used, decayed_at) VALUES(?,1,1,?) ON CONFLICT(kind) DO UPDATE SET used=used+1',
    ).run(kind, new Date(nowMs).toISOString())
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
 * EXPLORE_EVERY-ю подачу, чтобы система могла заметить перемену; и любой
 * приговор стареет — затухание счётчиков само возвращает вид к «молодости»,
 * если проект долго жил без его подач.
 */
export function shouldFeed(db: Database, kind: FeedKind, nowMs = Date.now()): boolean {
  try {
    ensureUtilityTable(db)
    // Затухание обязано дойти и до заглушённого вида: его не подают (записей
    // нет), но решение о нём принимается здесь — здесь счётчики и стареют.
    foldDecay(db, kind, nowMs)
  } catch {
    /* старение — обогащение решения; свежесть счётчиков не критична */
  }
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
    // Счётчики после сложения затухания дробные — наружу целые (это оценка веса улик, не журнал событий)
    .map((r) => `${r.kind} ${Math.round(r.score * 100)}% (${Math.round(r.used)}/${Math.round(r.surfaced)})`)
  return shown.length > 0 ? `${t('окупаемость подачи', 'feed payback')}: ${shown.join(' · ')}` : ''
}
