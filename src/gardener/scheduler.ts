/**
 * Садовник — единый планировщик фоновых работ (CONCEPT §4.4, «исполнитель
 * решений петли»).
 *
 * Смена парадигмы: раньше гигиена, дрейф, пересборка и углубление паспорта были
 * КОМАНДАМИ — владелец должен был вспомнить, что их надо позвать. Команда,
 * которую надо помнить, — это налог на человека и провал автономности: система,
 * знающая, когда ей нужна работа, обязана делать её сама. Теперь всё это —
 * работы планировщика, которые просыпаются от хука, отрабатывают бюджет и
 * умирают (ноль демонов).
 *
 * Устройство — каталог данных, а не логика: работа объявляет свой триггер
 * (нужно ли её делать), стоимость (дешёвая детерминированная / дорогая LLM) и
 * кулдаун. Добавить работу = добавить запись, планировщик не меняется.
 *
 * Порядок исполнения не случаен: сначала дешёвые детерминированные (они чинят
 * фундамент и могут снять надобность в дорогих), потом LLM-работы под общий
 * бюджет времени. Дорогое — по триггеру (аксиома §3.7), никогда «на всём».
 */
import type { Database } from '../core/db'
import { t } from '../core/i18n'

export type WorkCost = 'cheap' | 'llm'

export interface WorkContext {
  db: Database
  projectRoot: string
  dataDir: string
  nowMs: number
}

export interface Work {
  id: string
  /** зачем работа существует — попадает в отчёт фона, читаемый человеком */
  title: string
  cost: WorkCost
  /** часы тишины после успешного прогона; 0 — можно каждый раз (дёшево) */
  cooldownH: number
  /** есть ли сырьё: работа без причины не бежит */
  due: (ctx: WorkContext) => boolean
  /**
   * Выполнить; вернуть краткую заметку или null, если делать оказалось нечего.
   * Promise допустим ради слоя 1 (tree-sitter WASM асинхронен по природе) —
   * остальные работы синхронны, как и весь код проекта.
   */
  run: (ctx: WorkContext) => string | null | Promise<string | null>
}

export interface WorkOutcome {
  id: string
  ok: boolean
  note: string
  ms: number
}

const META_TABLE = 'gardener_meta'

/**
 * Лестница повторов после провала: минуты, полчаса, два часа. Причина провала
 * фоновой работы почти всегда ВРЕМЕННАЯ — модель была недоступна, кончился
 * лимит, моргнула сеть, — и уходит сама. Раньше такой провал наказывался
 * четвертью кулдауна: у вербализации это восемнадцать часов, и владельцу
 * приходилось звать инициализацию руками, хотя система могла попробовать сама
 * через пять минут. Отвергнуто: повтор внутри того же процесса — он бы бился в
 * ту же стену (недоступность длится дольше одного прогона) и держал бы владельца
 * ожиданием; повтор здесь — по расписанию, следующим входом в работу.
 */
const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000]

/**
 * После стольких неудач подряд быстрые повторы прекращаются и работа
 * возвращается к обычному расписанию (кулдаун/4). Не «сдаёмся навсегда»:
 * бесконечные попытки жгли бы токены на сломанном окружении, а полный отказ
 * противоречил бы самолечению — поэтому лестница кончается, а расписание нет.
 */
export const MAX_FAST_RETRIES = RETRY_DELAYS_MS.length

export interface WorkMeta {
  at: string
  ok: boolean
  note: string
  /** сколько провалов подряд; 0 — последний прогон был удачным */
  attempts: number
  /** когда стоит попробовать снова (ISO); null — по обычному расписанию */
  nextAt: string | null
}

function ensureMeta(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS ${META_TABLE}(work TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT NOT NULL)`)
  // Миграция на месте: у старых баз колонок повторов нет, и их отсутствие не
  // повод терять историю прогонов
  const cols = (db.query(`PRAGMA table_info(${META_TABLE})`).all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('attempts')) db.run(`ALTER TABLE ${META_TABLE} ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`)
  if (!cols.includes('next_at')) {
    db.run(`ALTER TABLE ${META_TABLE} ADD COLUMN next_at TEXT`)
    // Провалы, записанные ДО появления лестницы, тоже заслуживают повтора:
    // иначе владелец, у которого работа упала вчера, ещё сутки ждал бы старого
    // правила «кулдаун/4» — то есть ровно того, от чего уходим. Срок ставится в
    // прошлое: первая же следующая сессия попробует снова.
    db.run(`UPDATE ${META_TABLE} SET attempts=1, next_at=at WHERE ok=0`)
  }
}

export function lastRun(db: Database, id: string): WorkMeta | null {
  try {
    ensureMeta(db)
    const row = db.query(`SELECT at, ok, note, attempts, next_at FROM ${META_TABLE} WHERE work=?`).get(id) as
      | { at: string; ok: number; note: string; attempts: number | null; next_at: string | null }
      | null
    if (!row) return null
    return { at: row.at, ok: row.ok === 1, note: row.note, attempts: row.attempts ?? 0, nextAt: row.next_at ?? null }
  } catch {
    return null
  }
}

/**
 * Заметка работы пишется на языке подачи ТОГО прогона — в отличие от фактов
 * журнала, которые хранятся по-русски и переводятся на последней миле. Разница
 * намеренная: заметка эфемерна (живёт до следующего прогона той же работы) и не
 * имеет ключа идентичности, поэтому образцы перевода на неё — цена без выгоды.
 * Смена языка догоняет заметки со следующим прогоном фона.
 */
export function recordRun(db: Database, id: string, ok: boolean, note: string, nowIso: string): void {
  try {
    ensureMeta(db)
    const prevAttempts = lastRun(db, id)?.attempts ?? 0
    const attempts = ok ? 0 : prevAttempts + 1
    // Успех гасит лестницу; провал назначает следующую попытку, пока ступени не
    // кончились. Дальше next_at пуст — работает обычное расписание.
    const delay = ok ? null : RETRY_DELAYS_MS[attempts - 1] ?? null
    const nextAt = delay === null ? null : new Date(Date.parse(nowIso) + delay).toISOString()
    db.query(
      `INSERT INTO ${META_TABLE}(work, at, ok, note, attempts, next_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(work) DO UPDATE SET at=excluded.at, ok=excluded.ok, note=excluded.note, attempts=excluded.attempts, next_at=excluded.next_at`,
    ).run(id, nowIso, ok ? 1 : 0, note.slice(0, 300), attempts, nextAt)
  } catch {
    /* мета — наблюдаемость, её потеря не отменяет работу */
  }
}

/**
 * Пора ли работе бежать. Назначенный повтор ПЕРЕБИВАЕТ кулдаун: временный сбой
 * не должен отправлять работу в многочасовую тишину. Если срок повтора ещё не
 * настал — молчим, даже когда кулдаун формально прошёл: бить в ту же стену
 * раньше времени значит жечь токены и время владельца впустую.
 */
export function cooldownPassed(db: Database, w: Work, nowMs: number): boolean {
  const last = lastRun(db, w.id)
  if (!last) return true
  if (last.nextAt !== null) {
    const due = Date.parse(last.nextAt)
    return Number.isFinite(due) ? nowMs >= due : true
  }
  if (w.cooldownH <= 0) return true
  const hours = (nowMs - Date.parse(last.at)) / 3_600_000
  if (!Number.isFinite(hours)) return true
  return hours >= (last.ok ? w.cooldownH : w.cooldownH / 4)
}

export interface RunReport {
  outcomes: WorkOutcome[]
  skipped: string[]
}

/**
 * Прогон очереди. budgetMs ограничивает ТОЛЬКО дорогие (LLM) работы: дешёвые
 * детерминированные обязаны отработать всегда — на них держится честность
 * паспорта, и стоят они миллисекунды.
 */
export interface RunOptions {
  /** потолок времени для дорогих работ */
  budgetMs?: number
  /**
   * Игнорировать кулдауны. Нужно ровно одному случаю — явной инициализации,
   * когда человек согласился ждать: фон намеренно растягивает дорогое во
   * времени, а init означает «сделай всё сразу».
   */
  ignoreCooldown?: boolean
}

export async function runWorks(works: Work[], ctx: WorkContext, options: RunOptions | number = {}): Promise<RunReport> {
  const opts: RunOptions = typeof options === 'number' ? { budgetMs: options } : options
  const budgetMs = opts.budgetMs ?? 240_000
  const report: RunReport = { outcomes: [], skipped: [] }
  // Бюджет меряется РЕАЛЬНЫМ временем прогона, а не ctx.nowMs: последнее —
  // логическое время для триггеров и кулдаунов, его подменяют в тестах и оно
  // может отстоять от «сейчас» на часы (тогда бюджет был бы исчерпан до старта).
  const started = Date.now()
  const elapsed = (): number => Date.now() - started

  const ordered = [...works].sort((a, b) => (a.cost === b.cost ? 0 : a.cost === 'cheap' ? -1 : 1))
  for (const w of ordered) {
    let due: boolean
    try {
      due = w.due(ctx) && (opts.ignoreCooldown === true || cooldownPassed(ctx.db, w, ctx.nowMs))
    } catch {
      due = false // работа не смогла даже оценить сырьё — не наша беда, идём дальше
    }
    if (!due) {
      report.skipped.push(w.id)
      continue
    }
    // >=, а не >: нулевой бюджет означает «дорогое не делать вовсе», иначе
    // на быстрой машине первая LLM-работа проскакивала бы при elapsed()==0
    if (w.cost === 'llm' && elapsed() >= budgetMs) {
      report.skipped.push(`${w.id} (бюджет)`)
      continue
    }
    const t0 = Date.now()
    try {
      const note = await w.run(ctx)
      const ms = Date.now() - t0
      if (note === null) {
        report.skipped.push(`${w.id} (нечего)`)
        continue
      }
      report.outcomes.push({ id: w.id, ok: true, note, ms })
      recordRun(ctx.db, w.id, true, note, new Date().toISOString())
    } catch (e) {
      const ms = Date.now() - t0
      const note = String(e).slice(0, 200)
      report.outcomes.push({ id: w.id, ok: false, note, ms })
      recordRun(ctx.db, w.id, false, note, new Date().toISOString())
      // Падение одной работы не отменяет остальные: живучесть важнее полноты
    }
  }
  return report
}

/**
 * Молчание фона — тоже событие, и худшее из возможных. renderBackground
 * показывает только то, что отработало: если отцепленный процесс вообще не
 * стартует (нет рантайма на машине, антивирус съел спавн, владелец выключил
 * автономию), сводка молчит — и это читается как «фону нечего делать», хотя
 * на деле он мёртв. Аксиома «никогда молча» применяется здесь к самому себе.
 *
 * Условие срабатывания намеренно узкое: паспорт уже не молод (иначе первая
 * сессия проекта, где фон ещё не успел отработать, получала бы ложную тревогу),
 * а следов работы нет дольше quietDays.
 */
export function renderGardenerSilence(db: Database, nowMs: number, quietDays = 7): string {
  try {
    const born = (db.query('SELECT MIN(asserted_at) AS at FROM fact_journal').get() as { at: string | null } | null)?.at
    if (!born) return '' // паспорта ещё нет — молчать не о чем
    const ageDays = (nowMs - Date.parse(born)) / 86_400_000
    if (!Number.isFinite(ageDays) || ageDays < quietDays) return ''

    ensureMeta(db)
    const last = (db.query(`SELECT MAX(at) AS at FROM ${META_TABLE}`).get() as { at: string | null } | null)?.at
    if (!last) {
      return t(
        '- ⚠ фоновое обслуживание ни разу не отрабатывало: паспорт не углубляется (проверьте рантайм и learn.json)',
        '- ⚠ background maintenance has never run: the passport is not deepening (check the runtime and learn.json)',
      )
    }
    const quiet = (nowMs - Date.parse(last)) / 86_400_000
    if (!Number.isFinite(quiet) || quiet < quietDays) return ''
    return t(
      `- ⚠ фоновое обслуживание молчит ${Math.round(quiet)}д: паспорт перестал углубляться (проверьте рантайм и learn.json)`,
      `- ⚠ background maintenance has been silent for ${Math.round(quiet)}d: the passport stopped deepening (check the runtime and learn.json)`,
    )
  } catch {
    return '' // нет таблиц — диагностировать нечего, а падать тут нельзя
  }
}

/**
 * Работы, чьи заметки показываются владельцу в стартовой сводке. Живёт здесь, а
 * не в каталоге работ: SessionStart — горячий путь, и тянуть в него works.ts
 * (а с ним WASM слоя 1 и LLM-инфраструктуру) ради списка строк недопустимо.
 */
export const REPORTED_WORKS = ['truth', 'repair', 'drift', 'verbalize', 'corrections', 'zsummary', 'cdigest', 'contract', 'material', 'composition', 'grounding']

/**
 * Строка для стартовой сводки: что фон сделал, пока владельца не было.
 * Заменяет собой команды-отчёты — знание приходит само, а не по запросу.
 */
export function renderBackground(db: Database, ids: string[], nowMs: number): string {
  const parts: string[] = []
  for (const id of ids) {
    const last = lastRun(db, id)
    if (!last || !last.note) continue
    const hours = (nowMs - Date.parse(last.at)) / 3_600_000
    if (!Number.isFinite(hours) || hours > 72) continue // старое не шумит
    // У провала называется не только причина, но и судьба: молчаливое «⚠ ошибка»
    // читается как «сломано навсегда, зови руками», хотя повтор уже назначен
    const fate = last.ok
      ? ''
      : last.nextAt !== null
        ? t(` — повтор назначен (попытка ${last.attempts + 1} из ${MAX_FAST_RETRIES + 1})`, ` — a retry is scheduled (attempt ${last.attempts + 1} of ${MAX_FAST_RETRIES + 1})`)
        : t(' — быстрые повторы исчерпаны, вернулось к обычному расписанию', ' — fast retries are spent, back on the normal schedule')
    parts.push(`${last.ok ? '' : '⚠ '}${last.note}${fate}`)
  }
  if (parts.length === 0) return ''
  // «Садовник» — наше внутреннее имя механизма, владельцу оно ничего не говорит:
  // строку читает человек, а не разработчик этого файла (замечание владельца)
  return `- ${t('фоновая работа', 'background work')}: ${parts.join(' · ')}`
}
