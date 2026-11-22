/**
 * PostToolUseFailure-канал: знание приходит в момент, когда правка НЕ прошла.
 *
 * Почему это отдельный момент подачи. Упавший Edit — в подавляющем большинстве
 * «якорь не найден»: файл на диске разошёлся с тем, что модель о нём помнит
 * (строки уехали после чужой правки, форматирования, отката). Штатная реакция
 * модели — перечитать файл целиком и заплатить тысячи токенов за то, что
 * структура слоя 1 уже знает: где какой символ и почём его взять. Канал
 * подаёт ровно это — свежее оглавление как дешёвый путь восстановления — в
 * единственный момент, когда оно решает проблему, а не лежит рядом.
 *
 * Свежесть обязательна: оглавление сверяется хэшем содержимого (outlineView),
 * несвежее не предлагается — совет «сверься со структурой» по устаревшей
 * структуре был бы вторым обманом подряд. Fail-open, ничего не блокирует,
 * дедуп на сессию по файлу своим ключом.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { t, initLang } from '../core/i18n'
import { openDb } from '../core/db'
import { sha1 } from '../core/salsa'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { ensureFeedLog, claimNode } from './node-brief'
import { toRelNode } from './rel-node'
import { isSecretCarrier } from '../env/config-graph'
import { outlineView, outlineTokens, heaviestTokens } from '../layer1/symbols'
import { shouldFeed } from '../gardener/utility'

/** Вид подачи в телеметрии окупаемости: свой счётчик, своя судьба. */
export const EDIT_FAIL_KIND = 'edit-fail'

export interface PostToolFailureInput {
  cwd?: string
  session_id?: string
  tool_name?: string
  tool_input?: { file_path?: string; notebook_path?: string }
}

/**
 * Каким событием платформа принесла отказ. Имя в ответе обязано совпадать с
 * событием вызова — иначе платформа ответ отбрасывает.
 */
export type FailureEvent = 'PostToolUseFailure' | 'PostToolUse'

export interface PostToolFailureOutput {
  hookSpecificOutput?: {
    hookEventName: FailureEvent
    additionalContext: string
  }
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Правка отклонена, хотя событие — PostToolUse.
 *
 * Снято пробой входа хука (Claude Code 2.1.322, 22.11.2026): отказ проверки
 * инструмента («String to replace not found», «File has not been read yet»)
 * приходит событием PostToolUse со СТРОКОЙ `Error: …` в `tool_response`;
 * состоявшаяся правка несёт там объект. Документация обещает для таких отказов
 * молчание всех хуков, PostToolUseFailure — только для упавшего исполнения:
 * главный случай канала («якорь не найден») до него не доходил никогда.
 *
 * Признак узкий намеренно — строка И префикс. Чужая платформа (apply_patch у
 * Codex) отвечает на успешную правку текстом, а вызов без `tool_response`
 * (старая версия, ручной запуск) об исходе не говорит ничего; оба случая —
 * правка, как прежде. После слова — двоеточие, пробел или конец: текст успеха
 * вправе начинаться с имени файла (`Error.ts updated`). Вторая форма — обёртка
 * `<tool_use_error>`, которой тот же отказ записан в транскрипте.
 */
export function isRejectedWrite(toolResponse: unknown): boolean {
  return typeof toolResponse === 'string' && /^\s*(Error(?::|\s|$)|<tool_use_error>)/.test(toolResponse)
}

export function handlePostToolFailure(input: PostToolFailureInput, dataRoot: string, event: FailureEvent = 'PostToolUseFailure'): PostToolFailureOutput {
  try {
    if (!WRITE_TOOLS.has(input.tool_name ?? '')) return {}
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path
    if (!filePath) return {}

    const cwd = input.cwd ?? process.cwd()
    const dataDir = join(dataRoot, slugOf(cwd))
    // Язык подачи — до первой отрисованной строки: без этого канал говорит на
    // умолчании процесса, а не на языке владельца (см. core/i18n.ts).
    initLang(dataDir, cwd)
    // Пульс — того события, которым платформа действительно пришла: пульс
    // отвечает на вопрос «жив ли зарегистрированный канал», а не «какая ветка
    // кода отработала»
    beat(dataDir, event)
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}

    const rel = toRelNode(cwd, filePath)
    if (!rel) return {}
    // «Не открывается ни одним проходом» — значит и этим: ниже файл читается
    // целиком. Проверка стоит здесь, а не у вызывающего: сюда приходят двумя путями
    if (isSecretCarrier(rel)) return {}

    let content: string | null = null
    try {
      content = readFileSync(join(cwd, rel), 'utf8')
    } catch {
      content = null // файла нет — правка упала не из-за уехавших строк, советовать нечего
    }
    if (content === null) return {}

    const db = openDb(dbPath)
    try {
      if (!shouldFeed(db, EDIT_FAIL_KIND)) return {}
      const sid = input.session_id ?? 'manual'
      const view = outlineView(db, rel, () => content, sha1)
      if (!view || !view.fresh || view.rows.length === 0) return {}

      ensureFeedLog(db)
      // Свой ключ дедупа: две упавшие правки одного файла за сессию — одна подача
      if (!claimNode(db, sid, `#editfail:${rel}`, EDIT_FAIL_KIND)) return {}

      const cost = outlineTokens(view.rows)
      return {
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: t(
            `Symbiont · правка ${rel} не прошла — обычная причина: файл на диске разошёлся с тем, что о нём помнится. Структура файла уже разобрана и СВЕЖА (сверено хэшем): ${view.rows.length} символов · оглавление ≈${cost}t, самый большой символ ≈${heaviestTokens(view.rows)}t против файла целиком ≈${view.wholeFileTokens}t — passport_outline("${rel}"), затем passport_unfold(file, symbol) дешевле полного перечитывания.`,
            `Symbiont · the edit of ${rel} failed — the usual cause: the file on disk diverged from what is remembered about it. Its structure is already parsed and FRESH (hash-verified): ${view.rows.length} symbols · outline ≈${cost}t, largest symbol ≈${heaviestTokens(view.rows)}t versus the whole file ≈${view.wholeFileTokens}t — passport_outline("${rel}"), then passport_unfold(file, symbol) is cheaper than re-reading it all.`,
          ),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open: канал не вправе усугублять и без того упавшую правку
  }
}
