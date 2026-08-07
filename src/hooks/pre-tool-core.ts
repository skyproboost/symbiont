/**
 * PreToolUse-канал: то, что уже известно о файле, приходит ДО его чтения.
 *
 * Зачем отдельный канал, когда есть PostToolUse. Разница в одном — в моменте.
 * PostToolUse рассказывает о файле, который модель уже прочитала, то есть уже
 * заплатила за него полным содержимым; знание приходит верное, но к решению,
 * которое уже принято. Здесь то же самое знание приходит, пока решение ещё
 * принимается, и потому может его изменить: роль файла, кто от него зависит,
 * что исторически правится вместе с ним, и — главное — что структура файла уже
 * разобрана, а значит нужный кусок можно взять за сотни токенов вместо десятков
 * тысяч (см. layer1/symbols.ts).
 *
 * Чего канал НЕ делает — не блокирует. Соблазн велик: запретить чтение и тем
 * заставить пойти дешёвым путём. Отвергнуто. Во-первых, запрет обязывает нас
 * быть правыми, а мы можем ошибаться — индекс отстаёт от диска, оглавления для
 * языка может не быть, и цена ошибки тогда ложится на владельца отказом в
 * простой операции. Во-вторых, это ровно та ошибка, на которой видно чужой опыт:
 * у claude-mem гейт чтения блокирующий, и его же трекер полон жалоб на
 * заблокированную работу. Дешёвый путь предлагается, а выбирает модель.
 *
 * Молчание по умолчанию, fail-open, дедуп общий с остальными каналами подачи:
 * файл, о котором сказано здесь, не будет повторён после чтения.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../core/i18n'
import { openDb } from '../core/db'
import { sha1 } from '../core/salsa'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { ensureFeedLog, claimNode, outlineKey, OUTLINE_KIND } from './node-brief'
import { touchFeed } from './touch-feed'
import { toRelNode } from './post-tool-core'
import { outlineView, outlineTokens, heaviestTokens } from '../layer1/symbols'
import { shouldFeed } from '../gardener/utility'

/** Вид подачи в телеметрии окупаемости: он копит собственную статистику. */
export const PRE_READ_KIND = 'pre-read'

// Предложение структуры — ОТДЕЛЬНЫЙ вид подачи (ключи в node-brief.ts): вопрос
// «окупается ли названная вслух дешёвая альтернатива» независим от вопроса
// «окупаются ли связи узла», и слитые в один счётчик они не отвечают ни на один.
// Мера пользы та же, что у всей подачи, — файл потом тронут. Прямее было бы
// считать вызовы passport_outline, но их делает MCP-процесс, который о сессии
// ничего не знает; общий прокси хотя бы сравним с остальными видами.

/**
 * Ниже этого размера не предлагается СТРУКТУРА (связи и условия зоны приходят
 * всё равно). Не порог экономии, а порог осмысленности: на коротком файле
 * подсказка «возьми кусок вместо целого» стоит дороже самого целого.
 */
export const MIN_FILE_CHARS = 4_000

export interface PreToolInput {
  cwd?: string
  session_id?: string
  tool_name?: string
  tool_input?: { file_path?: string; notebook_path?: string }
}

export interface PreToolOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse'
    additionalContext: string
  }
}

/**
 * Строка о структуре: что она снята, сколько в ней символов и во что обойдётся
 * каждый путь. Цена названа вслух намеренно — выбор между «взять кусок» и
 * «прочитать целиком» модель делает сама, и делать его вслепую ей не из чего.
 */
export function renderOutlineOffer(file: string, symbols: number, wholeTokens: number, outlineCost: number, heaviest: number): string {
  return t(
    `- структура уже разобрана: ${symbols} символов · файл целиком ≈${wholeTokens}t, оглавление ≈${outlineCost}t, самый большой символ ≈${heaviest}t — passport_outline("${file}"), затем passport_unfold(file, symbol)`,
    `- structure already parsed: ${symbols} symbols · whole file ≈${wholeTokens}t, outline ≈${outlineCost}t, largest symbol ≈${heaviest}t — passport_outline("${file}"), then passport_unfold(file, symbol)`,
  )
}

export function handlePreTool(input: PreToolInput, dataRoot: string): PreToolOutput {
  try {
    if (input.tool_name !== 'Read') return {}
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path
    if (!filePath) return {}

    const cwd = input.cwd ?? process.cwd()
    const dataDir = join(dataRoot, slugOf(cwd))
    beat(dataDir, 'PreToolUse')
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}

    const rel = toRelNode(cwd, filePath)
    if (!rel) return {}

    let content: string | null = null
    try {
      content = readFileSync(join(cwd, rel), 'utf8')
    } catch {
      content = null // файла нет — читать нечего, и советовать нечего
    }
    if (content === null) return {}

    // Подключение на запись, а не на чтение: подача сама по себе оставляет
    // следы — визит узла в очереди резюме, дедуп и счётчик окупаемости.
    const db = openDb(dbPath)
    try {
      // Самозаглушение: если на этом проекте подача до чтения не окупается,
      // канал приглушается сам и лишь изредка перепроверяет себя.
      if (!shouldFeed(db, PRE_READ_KIND)) return {}

      const sid = input.session_id ?? 'manual'
      // Дар по касанию — тот же код, что и у PostToolUse (touch-feed.ts), просто
      // раньше по времени. Матчер PostToolUse больше не зовётся на Read именно
      // поэтому: два процесса на одно чтение стоили вдвое, а говорили одно.
      const lines = touchFeed(db, sid, rel, PRE_READ_KIND)

      // Предложение структуры — только на файлах, где оно вообще способно
      // окупиться. Порог касается ТОЛЬКО его: связи и условия зоны нужны и на
      // коротком файле, а вот «возьми кусок вместо целого» на нём — нелепость.
      const view = content.length >= MIN_FILE_CHARS ? outlineView(db, rel, () => content, sha1) : null
      const cost = view ? outlineTokens(view.rows) : 0
      const offer =
        view && view.fresh && view.rows.length > 0 && cost * 2 < view.wholeFileTokens
          ? renderOutlineOffer(rel, view.rows.length, view.wholeFileTokens, cost, heaviestTokens(view.rows))
          : ''
      // Предложение подаётся один раз за сессию и своим ключом, иначе повторное
      // чтение того же файла молчало бы о структуре только потому, что о связях
      // уже говорили. Вид подачи тоже СВОЙ: под общим ключом одна подача
      // считалась бы двумя показами при одном зачёте пользы, и предложение
      // структуры выглядело бы вдвое бесполезнее, чем оно есть.
      if (offer) {
        ensureFeedLog(db) // touchFeed создаёт журнал лишь когда узел есть в графе
        if (claimNode(db, sid, outlineKey(rel), OUTLINE_KIND)) lines.push(offer)
      }

      if (lines.length === 0) return {}

      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: t(
            `Symbiont · до чтения ${rel} (ничего не блокируется — это то, что уже известно):\n${lines.join('\n')}`,
            `Symbiont · before reading ${rel} (nothing is blocked — this is what is already known):\n${lines.join('\n')}`,
          ),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open: канал подачи не вправе мешать чтению
  }
}
