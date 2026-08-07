/**
 * CLI /sym-charter: приёмник требований владельца.
 * Требования — из аргументов (свободный текст). Сопоставляет с уже покрытым,
 * уникальное фиксирует в конституцию (побеждает выведенное).
 */
import { runtimeBlocker } from '../core/runtime'
import { t, initLang } from '../core/i18n'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { runCharter, verdictsToPairs, renderCharter } from '../elevate/charter'
import { upsertConstitution, readConstitution, renderConstitution } from '../core/constitution'
import { callClaudeDetailed } from '../layer2/llm'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
// Язык подачи — до первой отрисованной строки (см. core/i18n.ts).
initLang(dataDir, root)

// Предпосылки к окружению — до первой строки работы. Без этого команда уходила
// прямо в openDb и печатала стек ESM-загрузчика вместо объяснения (см. runtime.ts).
const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}
mkdirSync(dataDir, { recursive: true })

// Показать уже зафиксированную волю (что владелец заполнял раньше)
const existing = readConstitution(dataDir)
if (existing) {
  console.log(t('Symbiont · устав · уже зафиксировано ранее:\n', 'Symbiont · charter · already recorded earlier:\n'))
  console.log(renderConstitution(existing))
  console.log('')
} else {
  console.log(
    t(
      'Symbiont · устав · ранее ничего не фиксировалось (авто-конституция всё равно выводится сама).\n',
      'Symbiont · charter · nothing was recorded before (the automatic constitution is derived anyway).\n',
    ),
  )
}

// требования — всё после имени скрипта, склеенное; или из stdin
const requirements = stripDataFlag(process.argv.slice(2)).join(' ').trim()
if (!requirements) {
  console.log(
    t(
      'Добавить/изменить — передай требования текстом. Пример: /symbiont:charter «важнее всего приватность пациентов; не трогать прод-оплаты; топ-1 по качеству разборов». Существующее сохранится (дополнится/обновится по цели).',
      'To add or change it, pass your requirements as text. For example: /symbiont:charter “patient privacy matters most; never touch production payments; be best in class at parsing quality”. What is already recorded is kept and extended.',
    ),
  )
  process.exit(0)
}

console.log(t('Symbiont · устав · сопоставление требований с уже покрытым…', 'Symbiont · charter · matching your requirements against what is already covered…'))
const r = runCharter(root, dataDir, requirements, (prompt) => callClaudeDetailed(prompt, { intent: 'deep', dataDir }).result)
console.log(renderCharter(r))

const pairs = verdictsToPairs(r.verdicts)
if (pairs.length > 0) {
  const c = upsertConstitution(dataDir, pairs)
  console.log(
    t(
      `\nЗафиксировано в конституцию: ${pairs.length} (всего пар: ${c.pairs.length}). Подаётся в каждую сессию.`,
      `\nRecorded into the constitution: ${pairs.length} (pairs in total: ${c.pairs.length}). Delivered to every session.`,
    ),
  )
}
