/**
 * Выход хука — единственная дверь, через которую текст Symbiont попадает к модели.
 *
 * Платформа меряет каждое текстовое поле вывода хука отдельно и держит жёсткий
 * лимит в 10 000 символов без какой-либо настройки: поле длиннее целиком
 * заменяется путём к файлу и превью первых 2 000 символов, а прочитать файл
 * модель никто не просит. Так 141 сводка SessionStart на labreadai-v2 (9.8–11.8
 * тыс. символов) доехала до модели одним заголовком паспорта: бюджет держал
 * только сам паспорт, а устав, рамка, «Состояние» и «Вход в работу»
 * приклеивались к нему сверху. Снаружи это не было видно ничем — ни ошибки, ни
 * пометки, модель просто работала без законов и карты модулей.
 *
 * Здесь последний рубеж для всех каналов разом: поле длиннее бюджета режется
 * НАМИ, по границе строки и с честной пометкой, — в окне остаётся начало на
 * 9.5 тыс. символов, а не превью на 2. Бюджет ниже лимита с запасом: пометка
 * тоже занимает место, а как платформа считает символы вне базовой плоскости
 * Юникода, документация не говорит. Срабатывание рубежа — дефект канала, а не
 * режим работы, поэтому оно записывается и называется следующей сводкой.
 *
 * Отвергнуто «поднять лимит» — поднимать нечего; и «резать молча» — ровно то,
 * от чего здесь чинили.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { slugOf } from './slug'
import { t } from '../core/i18n'

/** Лимит платформы на одно текстовое поле вывода хука (hooks: «capped at 10,000 characters»). */
export const PLATFORM_TEXT_LIMIT = 10_000

/** Наш бюджет на поле: лимит минус запас. Сборка сводки обязана укладываться сама, рубеж — страховка. */
export const HOOK_TEXT_BUDGET = 9_500

/**
 * Поля вывода, текст которых уходит модели или владельцу. Режутся только они:
 * рекурсивный обход всех строк задел бы и поля-данные (`updatedInput` несёт
 * содержимое файла, и обрезанным оно стало бы порчей, а не подачей).
 */
const TEXT_FIELDS = new Set(['additionalContext', 'systemMessage', 'reason', 'permissionDecisionReason', 'initialUserMessage'])

/** Файл записи срабатываний рубежа в каталоге данных проекта. */
const OVERFLOW_FILE = 'hook-overflow.json'

/** Сколько дней срабатывание рубежа называется в сводке. */
const OVERFLOW_SHOWN_DAYS = 7

/**
 * Уложить текст в бюджет: срез по последней границе строки, пометка — внутри
 * бюджета. Короткий текст возвращается как есть.
 */
export function capText(text: string, budget: number = HOOK_TEXT_BUDGET): string {
  if (text.length <= budget) return text
  const note = `\n…${t(
    `обрезано Symbiont: ${text.length} символов при лимите платформы ${PLATFORM_TEXT_LIMIT} — показано начало`,
    `truncated by Symbiont: ${text.length} characters against the platform limit of ${PLATFORM_TEXT_LIMIT} — the beginning is shown`,
  )}`
  const room = Math.max(0, budget - note.length)
  const cut = text.lastIndexOf('\n', room)
  // Граница строки — если она не съедает больше половины места; иначе режем по символу
  return `${text.slice(0, cut > room / 2 ? cut : room)}${note}`
}

export interface Overflow {
  field: string
  length: number
}

/** Уложить все текстовые поля вывода в бюджет; вернуть копию и список переполнений. Чистая функция. */
export function capHookOutput<T>(out: T, budget: number = HOOK_TEXT_BUDGET): { out: T; overflows: Overflow[] } {
  const overflows: Overflow[] = []
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v === null || typeof v !== 'object') return v
    const copy: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (TEXT_FIELDS.has(k) && typeof x === 'string' && x.length > budget) {
        overflows.push({ field: k, length: x.length })
        copy[k] = capText(x, budget)
      } else {
        copy[k] = walk(x)
      }
    }
    return copy
  }
  return { out: walk(out) as T, overflows }
}

interface OverflowRecord {
  at: string
  length: number
  count: number
}

/** Записать срабатывание рубежа: канал → когда, самое длинное поле, сколько раз. Никогда не бросает. */
export function recordOverflow(dataDir: string, channel: string, overflows: Overflow[], now: Date = new Date()): void {
  try {
    let all: Record<string, OverflowRecord> = {}
    try {
      all = JSON.parse(readFileSync(join(dataDir, OVERFLOW_FILE), 'utf8')) as Record<string, OverflowRecord>
    } catch {
      /* записей ещё нет — начинаем с пустой */
    }
    const prev = all[channel]
    all[channel] = {
      at: now.toISOString(),
      length: Math.max(...overflows.map((o) => o.length)),
      count: (prev?.count ?? 0) + 1,
    }
    writeFileSync(join(dataDir, OVERFLOW_FILE), JSON.stringify(all), 'utf8')
  } catch {
    /* запись — диагностика; сам вывод уже уложен в лимит, модель его получит */
  }
}

/** Строка блока «Состояние» о недавних срабатываниях рубежа; пустая — если их не было. */
export function renderOverflow(dataDir: string, nowMs: number = Date.now()): string {
  let all: Record<string, OverflowRecord>
  try {
    all = JSON.parse(readFileSync(join(dataDir, OVERFLOW_FILE), 'utf8')) as Record<string, OverflowRecord>
  } catch {
    return ''
  }
  const recent = Object.entries(all)
    .filter((e) => nowMs - Date.parse(e[1].at) < OVERFLOW_SHOWN_DAYS * 86_400_000)
    .sort((a, b) => b[1].length - a[1].length)
  if (recent.length === 0) return ''
  const named = recent.map((e) => `${e[0]} (${e[1].length} ×${e[1].count})`).join(', ')
  return t(
    `- ⚠ текст длиннее лимита платформы (${PLATFORM_TEXT_LIMIT} символов) за ${OVERFLOW_SHOWN_DAYS} дней: ${named} — Symbiont обрезал его сам, модель видела начало; это дефект плагина, а не проекта`,
    `- ⚠ text longer than the platform limit (${PLATFORM_TEXT_LIMIT} characters) in the last ${OVERFLOW_SHOWN_DAYS} days: ${named} — Symbiont cut it itself and the model saw the beginning; this is a plugin defect, not a project one`,
  )
}

/**
 * Отдать вывод хука платформе: текстовые поля — в бюджете, переполнение —
 * записано. Единственный допустимый способ печати вывода в точках входа
 * (сторожит тест, берущий список входов у сборщика).
 */
export function emitHookOutput(out: object, channel: string, dataRoot: string, cwd: string | undefined): void {
  const { out: capped, overflows } = capHookOutput(out)
  if (overflows.length > 0) recordOverflow(join(dataRoot, slugOf(cwd ?? process.cwd())), channel, overflows)
  console.log(JSON.stringify(capped))
}
