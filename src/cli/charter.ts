/**
 * CLI /sym-charter: приёмник требований владельца.
 * Требования — из аргументов (свободный текст). Сопоставляет с уже покрытым,
 * уникальное фиксирует в конституцию (побеждает выведенное).
 */
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
mkdirSync(dataDir, { recursive: true })

// Показать уже зафиксированную волю (что владелец заполнял раньше)
const existing = readConstitution(dataDir)
if (existing) {
  console.log('Symbiont · устав · уже зафиксировано ранее:\n')
  console.log(renderConstitution(existing))
  console.log('')
} else {
  console.log('Symbiont · устав · ранее ничего не фиксировалось (авто-конституция всё равно выводится сама).\n')
}

// требования — всё после имени скрипта, склеенное; или из stdin
const requirements = stripDataFlag(process.argv.slice(2)).join(' ').trim()
if (!requirements) {
  console.log('Добавить/изменить — передай требования текстом. Пример: /symbiont:charter «важнее всего приватность пациентов; не трогать прод-оплаты; топ-1 по качеству разборов». Существующее сохранится (дополнится/обновится по цели).')
  process.exit(0)
}

console.log('Symbiont · устав · сопоставление требований с уже покрытым…')
const r = runCharter(root, dataDir, requirements, (prompt) => callClaudeDetailed(prompt, { intent: 'deep', dataDir }).result)
console.log(renderCharter(r))

const pairs = verdictsToPairs(r.verdicts)
if (pairs.length > 0) {
  const c = upsertConstitution(dataDir, pairs)
  console.log(`\nЗафиксировано в конституцию: ${pairs.length} (всего пар: ${c.pairs.length}). Подаётся в каждую сессию.`)
}
