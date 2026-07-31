/**
 * Адаптивный вектор моделей: какой моделью Symbiont делает СВОИ LLM-вызовы
 * (вербализация, elevate, суждения садовника), без пиннинга версий и хардкода
 * под подписку.
 *
 * Три развязанные заботы (раньше — в одной плоской захардкоженной цепочке ID):
 *
 * 1. Ранг семейств по классу мощности — единственное зашитое знание о платформе
 *    Claude. Малая стабильная таблица (как signals.ts для направлений), не
 *    разбросанные версии-ID. Незнакомое будущее семейство не теряется: явно
 *    заданный `models`-оверрайд и алиасы это допускают.
 * 2. Версия НЕ пиннится. CLI резолвит алиас семейства в ПОСЛЕДНЮЮ версию
 *    ('opus' → opus-5.1 сам, когда выйдет) — «всегда актуально» бесплатно и без
 *    правок кода. Полные ID (claude-opus-5) — только как явный оверрайд.
 * 3. Доступность (подписка/скоуп аккаунта) — выучивается из РЕАЛЬНЫХ вызовов
 *    (наполнение — побочный продукт, не отдельный пробер): 404/403 = нет доступа
 *    → семейство уходит в хвост вектора, чтобы не жечь первую попытку впустую;
 *    успех → возвращается вперёд. Смена подписки самолечится. Кэш — читаемый
 *    JSON в dataDir (fail-open, переживает всё, чинится удалением файла).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { t } from './i18n'
import { join } from 'node:path'

export type Intent = 'deep' | 'routine'

/**
 * Приоритет семейств по интенту (АЛИАСЫ, не версии). deep — качество вперёд
 * (сильнейшее первым); routine — цена вперёд (дешёвое первым, эскалация вверх).
 * haiku в deep стоит последним рубежом: лучше ответ слабой модели, чем отказ
 * (слоистая деградация — аксиома живучести).
 */
export const FAMILY_PRIORITY: Record<Intent, string[]> = {
  deep: ['fable', 'opus', 'sonnet', 'haiku'],
  routine: ['haiku', 'sonnet', 'opus', 'fable'],
}

export type AvailStatus = 'alive' | 'dead' | 'limited' | 'unknown'

export interface ModelAvail {
  alias: string
  status: AvailStatus
  /** резолвнутый CLI полный ID последнего успешного вызова (наблюдаемость) */
  resolvedId: string | null
  checkedAt: string
  note: string
  /** до какого момента лимит исчерпан (ISO); null — состояние не про лимит */
  until?: string | null
}

/** api_error_status, однозначно означающие «нет модели/нет доступа» (не транзиент). */
const UNAVAILABLE_STATUSES = new Set([401, 403, 404])
/** За пределами окна свежести статус считается устаревшим → снова «unknown» (пробуем). */
const FRESH_DAYS = 14

/**
 * Исчерпанный лимит подписки — третье состояние, и его отсутствие было дырой.
 * 429 попадал в «транзиент»: статус оставался прежним, семейство сохраняло место
 * в голове вектора — и КАЖДЫЙ следующий проход снова начинал с него, снова
 * получал отказ, снова платил процессом. У владельца это наблюдалось живьём
 * (fable: «транзиент: api=429» при статусе «не пробована»).
 *
 * Лимит — не смерть (403/404 «доступа нет вообще») и не транзиент (сеть моргнула):
 * он гарантированно держится какое-то время и гарантированно проходит. Поэтому
 * отдельный статус со сроком: до срока семейство уходит в хвост, после — снова
 * пробуется само. Кулдаун по умолчанию скромный: цена ошибки — один спавн
 * процесса, а слишком долгое отлучение стоило бы качества глубоких проходов.
 */
const LIMIT_STATUSES = new Set([429])
const LIMIT_COOLDOWN_MS = 60 * 60_000
/** Тексты, которыми лимит объявляется словами, когда кода статуса нет. */
const LIMIT_WORDS = /(usage|rate)[\s-]?limit|limit reached|quota|too many requests|out of credit/i

/**
 * Подсказка о времени сброса из текста ответа («resets at 3pm», «resets 15:00»).
 * Даёт честное «вернётся к 15:00» вместо «через час». Ничего не распознали —
 * null, и решение принимает кулдаун: догадка о времени хуже отсутствия догадки.
 */
export function parseResetHint(text: string, nowMs: number): string | null {
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const minute = m[2] ? parseInt(m[2], 10) : 0
  const meridiem = m[3]?.toLowerCase()
  if (hour > 23 || minute > 59) return null
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  const at = new Date(nowMs)
  at.setHours(hour, minute, 0, 0)
  // Названное время уже прошло — значит речь о завтрашнем: срок в прошлом
  // означал бы «лимита нет», то есть ровно противоположное сказанному
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1)
  return at.toISOString()
}

const AVAIL_FILE = 'model-availability.json'

/** Чтение кэша доступности; любая порча → пустой кэш (fail-open, аксиома). */
export function readAvailability(dataDir: string): Record<string, ModelAvail> {
  try {
    const p = join(dataDir, AVAIL_FILE)
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return raw && typeof raw === 'object' ? (raw as Record<string, ModelAvail>) : {}
  } catch {
    return {}
  }
}

function writeAvailability(dataDir: string, data: Record<string, ModelAvail>): void {
  try {
    writeFileSync(join(dataDir, AVAIL_FILE), JSON.stringify(data, null, 2), 'utf8')
  } catch {
    /* кэш — ускоритель, не истина: не смогли записать → работаем без него */
  }
}

export interface OutcomeInput {
  ok: boolean
  resolvedId: string | null
  apiErrorStatus: number | null
  note: string
  now: string
}

/**
 * Классификация исхода одной пробы в статус доступности. Успех → alive.
 * 404/403/401 → dead (нет доступа/подписки). 429 или прямые слова о лимите →
 * limited со сроком возврата. Прочие ошибки (500/сеть) — транзиент: прошлый
 * статус НЕ рушим (иначе сетевой сбой «убил» бы доступное семейство), лишь
 * освежаем отметку.
 */
export function classify(prev: ModelAvail | undefined, out: OutcomeInput): ModelAvail {
  const base: ModelAvail = prev ?? { alias: '', status: 'unknown', resolvedId: null, checkedAt: out.now, note: '', until: null }
  if (out.ok) {
    return { ...base, status: 'alive', resolvedId: out.resolvedId ?? base.resolvedId, checkedAt: out.now, note: out.note, until: null }
  }
  if (out.apiErrorStatus != null && UNAVAILABLE_STATUSES.has(out.apiErrorStatus)) {
    return { ...base, status: 'dead', checkedAt: out.now, note: `api=${out.apiErrorStatus} ${out.note}`.trim(), until: null }
  }
  const limited = (out.apiErrorStatus != null && LIMIT_STATUSES.has(out.apiErrorStatus)) || LIMIT_WORDS.test(out.note)
  if (limited) {
    const nowMs = Date.parse(out.now)
    const until = parseResetHint(out.note, nowMs) ?? new Date(nowMs + LIMIT_COOLDOWN_MS).toISOString()
    return { ...base, status: 'limited', checkedAt: out.now, note: `лимит: ${out.note}`.trim(), until }
  }
  // транзиент: статус прежний, отметка свежая
  return { ...base, checkedAt: out.now, note: `транзиент: ${out.note}`.trim(), until: base.until ?? null }
}

/** Запись исхода вызова модели в кэш (побочный продукт реальной работы). */
export function recordOutcome(dataDir: string, alias: string, out: OutcomeInput): void {
  const data = readAvailability(dataDir)
  const next = classify(data[alias], out)
  next.alias = alias
  data[alias] = next
  writeAvailability(dataDir, data)
}

const freshStatus = (a: ModelAvail | undefined, now: number): AvailStatus => {
  if (!a) return 'unknown'
  const age = now - Date.parse(a.checkedAt)
  if (!Number.isFinite(age) || age > FRESH_DAYS * 86_400_000) return 'unknown'
  // Срок лимита вышел — семейство снова кандидат: самолечение без вмешательства
  if (a.status === 'limited') {
    const until = a.until ? Date.parse(a.until) : NaN
    if (!Number.isFinite(until) || until <= now) return 'unknown'
  }
  return a.status
}

/**
 * Порядок семейств для интента с учётом выученной доступности. Приоритет
 * интента — ПЕРВИЧЕН и определяет предпочтение (deep: сильнейшее первым;
 * routine: дешёвое первым). Доступность лишь отодвигает в хвост ПОДТВЕРЖДЁННО
 * мёртвое (404/403 — гарантированная трата первой попытки); «неизвестное» (ещё
 * не пробованное) НЕ теряет позицию — иначе для deep подтверждённый haiku
 * обгонял бы неизвестную fable, что убивает качество. Мёртвое остаётся в хвосте
 * (не выброшено): вдруг подписку вернули → самолечение. Всегда непусто.
 * `nowMs` — для тестируемости (в проде из Date.now в llm.ts, где это допустимо).
 */
export function resolveVector(intent: Intent, avail: Record<string, ModelAvail>, nowMs: number): string[] {
  const base = FAMILY_PRIORITY[intent]
  // Хвост упорядочен по надежде: исчерпанный лимит вернётся сам, «доступа нет»
  // не вернётся до смены подписки — значит limited пробуем раньше dead.
  const penalty = (alias: string): number => {
    const s = freshStatus(avail[alias], nowMs)
    return s === 'dead' ? 2 : s === 'limited' ? 1 : 0
  }
  return base
    .map((alias, i) => ({ alias, i, rank: penalty(alias) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.alias)
}

// ── Сеть: один общий признак вместо личного открытия у каждой работы ─────────

const NET_FILE = 'network-state.json'
/**
 * Обрыв сети опознаётся по тексту ошибки. Список узкий намеренно: сюда попадает
 * только то, что НЕ может быть ответом сервера — резолв имени, отказ в
 * соединении, оборванный сокет. Таймаут и 5xx сюда не входят: это уже разговор
 * с сервером, а значит сеть есть.
 */
const NETWORK_WORDS = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENETDOWN|EHOSTUNREACH|getaddrinfo|fetch failed|socket hang up|network is unreachable|connection error/i

/**
 * Кулдаун короткий: сеть возвращается сама и без предупреждения, а цена ошибки
 * несимметрична. Лишние пять минут молчания фон навёрстывает следующим заходом;
 * лишние двадцать спавнов процессов в туннеле метро владелец видит батареей.
 */
const OFFLINE_COOLDOWN_MS = 5 * 60_000

export const looksLikeNetworkFailure = (note: string): boolean => NETWORK_WORDS.test(note)

/**
 * До какого момента сеть считается недоступной (мс) или null.
 *
 * Зачем общий признак. Каждая LLM-работа узнавала об обрыве сама: заход фона —
 * это до пяти работ × до четырёх семейств вектора, то есть два десятка спавнов
 * `claude`, каждый со своим таймаутом, и все с одним ответом «сети нет».
 * Признак делает открытие однократным: первая же работа его ставит, остальные
 * читают файл. Это не кэш ответа модели — это отметка о состоянии МАШИНЫ.
 */
export function networkDownUntil(dataDir: string, nowMs: number): number | null {
  try {
    const p = join(dataDir, NET_FILE)
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { until?: string }
    const until = raw?.until ? Date.parse(raw.until) : NaN
    return Number.isFinite(until) && until > nowMs ? until : null
  } catch {
    return null // порча файла = признака нет; молчание безопасно, попробуем сеть
  }
}

/** Отметить обрыв сети (короткий кулдаун). */
export function markNetworkDown(dataDir: string, note: string, nowMs: number): void {
  try {
    writeFileSync(
      join(dataDir, NET_FILE),
      JSON.stringify({ until: new Date(nowMs + OFFLINE_COOLDOWN_MS).toISOString(), note: note.slice(0, 200), at: new Date(nowMs).toISOString() }, null, 2),
      'utf8',
    )
  } catch {
    /* признак — ускоритель, не истина: не записался → работаем как раньше */
  }
}

/** Сеть ответила — признак снимается немедленно, а не по истечении срока. */
export function clearNetworkDown(dataDir: string): void {
  try {
    const p = join(dataDir, NET_FILE)
    if (existsSync(p)) writeFileSync(p, JSON.stringify({ until: null, at: new Date().toISOString() }, null, 2), 'utf8')
  } catch {
    /* см. выше */
  }
}

/** Строка для обзора состояния: состояние вектора моделей по данным кэша. */
export function renderAvailability(avail: Record<string, ModelAvail>, nowMs: number): string[] {
  const glyph: Record<AvailStatus, string> = {
    alive: t('✓ доступна', '✓ available'),
    dead: t('✗ нет доступа', '✗ no access'),
    limited: t('⏳ лимит исчерпан', '⏳ limit reached'),
    unknown: t('· не пробована', '· not tried'),
  }
  const lines: string[] = []
  for (const intent of ['deep', 'routine'] as Intent[]) {
    const vec = resolveVector(intent, avail, nowMs)
    lines.push(`${intent}: ${vec.join(' → ')}`)
  }
  const known = Object.values(avail)
  if (known.length > 0) {
    // Семейства, до которых очередь не дошла, — не «недоступны»: вектор
    // останавливается на первой ответившей модели, и это экономия, а не сбой
    const untried = ['fable', 'opus', 'sonnet', 'haiku'].filter((a) => !(a in avail))
    if (untried.length > 0) lines.push(`  ${untried.join(', ')}: ${t('очередь до них не дошла (вектор останавливается на первой ответившей)', 'the queue never reached them (the vector stops at the first model that answers)')}`)
    for (const a of known.sort((x, y) => x.alias.localeCompare(y.alias))) {
      const s = freshStatus(a, nowMs)
      // Возраст записи обязателен: резолв алиаса в конкретную версию меняется
      // со временем, и старое значение без даты читается как сегодняшнее (живой
      // вопрос владельца: «почему opus 4.8, если последний 5» — версия была
      // верной на момент проверки, а выглядела текущей).
      const ageH = Math.round((nowMs - Date.parse(a.checkedAt)) / 3_600_000)
      const when = !Number.isFinite(ageH) ? '' : ageH < 1 ? t(', проверено только что', ', checked just now') : ageH < 48 ? t(`, проверено ${ageH}ч назад`, `, checked ${ageH}h ago`) : t(`, проверено ${Math.round(ageH / 24)}д назад`, `, checked ${Math.round(ageH / 24)}d ago`)
      // Срок возврата — не украшение: без него «лимит исчерпан» читается как
      // поломка, хотя это временное состояние, которое пройдёт само
      const back = s === 'limited' && a.until ? `${t(' — вернётся к ', ' — back at ')}${new Date(a.until).toLocaleTimeString(t('ru-RU', 'en-GB'), { hour: '2-digit', minute: '2-digit' })}` : ''
      lines.push(`  ${a.alias}: ${glyph[s]}${back}${a.resolvedId ? ` (${a.resolvedId}${when})` : ''}${s === 'unknown' && a.status !== 'unknown' ? t(' — устарело, перепроверится', ' — stale, will be rechecked') : ''}`)
    }
  }
  return lines
}
