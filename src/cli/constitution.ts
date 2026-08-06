/**
 * CLI конституции: show / set.
 * set принимает JSON-массив пар [{"goal","constraint"}] — идемпотентное дообогащение.
 */
import { runtimeBlocker } from '../core/runtime'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { readConstitution, upsertConstitution, renderConstitution } from '../core/constitution'

const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(process.cwd()))

// Предпосылки к окружению — до первой строки работы. Без этого команда уходила
// прямо в openDb и печатала стек ESM-загрузчика вместо объяснения (см. runtime.ts).
const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}
mkdirSync(dataDir, { recursive: true })

const cmd = process.argv[2]
if (cmd === 'set') {
  const raw = process.argv[3] ?? ''
  let pairs: unknown
  try {
    pairs = JSON.parse(raw)
  } catch {
    console.log('Ошибка: ожидается JSON-массив пар [{"goal":"…","constraint":"…"}]')
    process.exit(1)
  }
  const c = upsertConstitution(dataDir, Array.isArray(pairs) ? pairs : [])
  console.log(`Конституция сохранена: ${c.pairs.length} пар(ы). Подаётся в каждую сессию этого проекта.`)
  console.log(renderConstitution(c))
} else {
  const c = readConstitution(dataDir)
  // Ручной конституции может не быть — и это норма: приоритеты, ценности и
  // ограничения выводятся из git-истории сами. Команда нужна лишь для воли,
  // которую из кода не видно.
  console.log(
    c
      ? renderConstitution(c)
      : 'Ручная конституция не задана — и не обязана быть: приоритеты, ценности и ограничения Symbiont выводит из истории работы сам.\nДописать волю, которой в коде не видно: /symbiont:charter',
  )
}
