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
import { ensureFeedLog, claimNode, nodeBrief, type GraphNode } from './node-brief'
import { toRelNode } from './post-tool-core'
import { outlineView, outlineTokens, heaviestTokens } from '../layer1/symbols'
import { shouldFeed } from '../gardener/utility'

/** Вид подачи в телеметрии окупаемости: он копит собственную статистику. */
export const PRE_READ_KIND = 'pre-read'

/**
 * Ниже этого размера канал молчит. Не порог экономии, а порог осмысленности:
 * на коротком файле подсказка «возьми кусок вместо целого» стоит дороже самого
 * целого. Число — та же граница, за которой оглавление вообще перестаёт
 * окупаться (около трёх экранов кода).
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
    if (content === null || content.length < MIN_FILE_CHARS) return {}

    // Подключение на запись, а не на чтение: подача сама по себе оставляет
    // следы — визит узла в очереди резюме, дедуп и счётчик окупаемости.
    const db = openDb(dbPath)
    try {
      // Самозаглушение: если на этом проекте подача до чтения не окупается,
      // канал приглушается сам и лишь изредка перепроверяет себя.
      if (!shouldFeed(db, PRE_READ_KIND)) return {}

      const sid = input.session_id ?? 'manual'
      const lines: string[] = []

      const node = db.query('SELECT file, in_deg, out_deg FROM graph_nodes WHERE file = ?').get(rel) as GraphNode | null

      const view = outlineView(db, rel, () => content, sha1)
      // Предложение делается только когда оно ВЫГОДНО: если оглавление стоит не
      // меньше самого файла, честнее промолчать, чем уговаривать на дорогой путь.
      const cost = outlineTokens(view.rows)
      const offer =
        view.fresh && view.rows.length > 0 && cost * 2 < view.wholeFileTokens
          ? renderOutlineOffer(rel, view.rows.length, view.wholeFileTokens, cost, heaviestTokens(view.rows))
          : ''

      // Нечего сказать — молчим: узла в графе нет и структуры нет
      if (!node && !offer) return {}

      // Дедуп общий с остальными каналами: сказанное здесь не повторится после
      // чтения, а зачёт пользы (файл потом тронут) достанется этому виду подачи.
      ensureFeedLog(db)
      if (!claimNode(db, sid, rel, PRE_READ_KIND)) return {}
      if (node) lines.push(`- ${nodeBrief(db, node)}`)
      if (offer) lines.push(offer)
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
