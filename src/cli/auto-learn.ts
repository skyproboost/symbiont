/**
 * Детач-исполнитель садовника: единственная точка входа фоновой работы.
 * Запускается отцепленным процессом из SessionStart/PreCompact (unref) — сессия
 * владельца не ждёт ни секунды. Что именно делать, решает планировщик по
 * триггерам и кулдаунам (src/gardener/scheduler.ts + works.ts), а не человек
 * командой: система, знающая, когда ей нужна работа, делает её сама.
 *
 * Итог виден в стартовой сводке следующей сессии (renderBackground) — знание
 * приходит само, а не по запросу.
 */
import { runtimeBlocker } from '../core/runtime'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { openDb } from '../core/db'
import { resolveDataRoot } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { runWorks } from '../gardener/scheduler'
import { WORKS } from '../gardener/works'
import { autoEnabled } from '../gardener/auto-learn'

const root = process.argv[2] ?? process.cwd()
const dataDir = join(resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root, slugOf(root))

// Предпосылки к окружению — до первой строки работы. Без этого команда уходила
// прямо в openDb и печатала стек ESM-загрузчика вместо объяснения (см. runtime.ts).
const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}
const dbPath = join(dataDir, 'passport.db')
if (!existsSync(dbPath)) process.exit(0)
if (!autoEnabled(dataDir)) process.exit(0) // выключатель владельца: learn.json {"auto": false}

const db = openDb(dbPath)
try {
  const report = await runWorks(WORKS, { db, projectRoot: root, dataDir, nowMs: Date.now() })
  for (const o of report.outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.id} · ${o.ms}мс · ${o.note}`)
} finally {
  db.close()
}
