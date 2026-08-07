/**
 * Язык подачи: показать или сменить.
 *
 * Почему отдельная команда, а не режим /symbiont:status. Раньше это был
 * аргумент обзора — `/symbiont:status lang en`. Спрятанный там, он не находился:
 * человек, которому плагин отвечает не на том языке, ищет команду про ЯЗЫК, а не
 * читает описание команды про состояние паспорта. Скилл называет себя сам, и
 * платформа показывает его в списке рядом с остальными.
 *
 * Без аргумента команда ПОКАЗЫВАЕТ, а не переключает: вопрос «на каком языке
 * плагин со мной говорит и почему» задаётся чаще, чем смена, и отвечать на него
 * переключением было бы грубо.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { runtimeBlocker } from '../core/runtime'
import { initLang, chooseLang, readState, sourceLabel, lang as currentLang, t, type Lang } from '../core/i18n'

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const arg = stripDataFlag(process.argv.slice(2)).join(' ').trim().toLowerCase()
initLang(dataDir, root)

// Предпосылки к окружению — до первой строки работы (см. core/runtime.ts)
const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}

/** Как назван язык — принимается и по-русски, и по-английски, и сокращением. */
function parse(input: string): { kind: 'show' } | { kind: 'auto' } | { kind: 'set'; lang: Lang } | { kind: 'unknown' } {
  if (!input) return { kind: 'show' }
  if (/^(auto|авто)$/.test(input)) return { kind: 'auto' }
  if (/^(ru|rus|russian|рус\w*)$/.test(input)) return { kind: 'set', lang: 'ru' }
  if (/^(en|eng|english|англ\w*)$/.test(input)) return { kind: 'set', lang: 'en' }
  return { kind: 'unknown' }
}

const verdict = parse(arg)

if (verdict.kind === 'unknown') {
  console.log(
    t(
      `Symbiont: «${arg}» — не язык. Ожидается ru, en или auto (без аргумента — показать текущий).`,
      `Symbiont: "${arg}" is not a language. Expected ru, en or auto (no argument — show the current one).`,
    ),
  )
  process.exit(0)
}

if (verdict.kind === 'show') {
  // Паспорт для показа не нужен: язык живёт своим файлом и известен всегда
  const state = existsSync(dataDir) ? readState(dataDir) : null
  const source = state?.source ?? 'default'
  console.log(
    t(
      `Symbiont: язык подачи — ${currentLang()} (основание: ${sourceLabel(source)}).`,
      `Symbiont: output language is ${currentLang()} (reason: ${sourceLabel(source)}).`,
    ),
  )
  console.log(
    source === 'choice'
      ? t('  Выбран вами и не будет переопределён наблюдением. Вернуть автоопределение: /symbiont:lang auto', '  Chosen by you and never overridden by observation. Back to automatic: /symbiont:lang auto')
      : t('  Определён наблюдением. Закрепить: /symbiont:lang ru или /symbiont:lang en', '  Decided by observation. Pin it: /symbiont:lang ru or /symbiont:lang en'),
  )
  process.exit(0)
}

const choice = verdict.kind === 'auto' ? null : verdict.lang
const after = chooseLang(dataDir, choice)
console.log(
  choice === null
    ? t(
        `Symbiont: язык подачи снова определяется сам — сейчас ${after.lang} (${sourceLabel(after.source)}).`,
        `Symbiont: the language is decided by observation again — currently ${after.lang} (${sourceLabel(after.source)}).`,
      )
    : t(
        `Symbiont: язык подачи — ${after.lang}. Держится, пока не смените. Вернуть автоопределение: /symbiont:lang auto`,
        `Symbiont: output language is now ${after.lang}. It holds until you change it. Back to automatic: /symbiont:lang auto`,
      ),
)
