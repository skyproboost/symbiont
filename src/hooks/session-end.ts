/**
 * SessionEnd — best-effort финализатор (бюджет платформы 1.5с):
 * одна UPDATE-запись «сессия попрощалась». Корректность от него не зависит —
 * непопрощавшиеся сессии закроет реконсиляция на следующем старте.
 */
import { existsSync } from 'node:fs'
import { initLang } from '../core/i18n'
import { join } from 'node:path'
import { openDb } from '../core/db'
import { readStdinJson } from './stdin'
import { resolveDataRoot } from '../core/data-root'
import { SessionLog } from '../core/sessions'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts)
if (isInternalCall()) process.exit(0)

try {
  const input = readStdinJson<{ cwd?: string; session_id?: string; reason?: string }>()
  const cwd = input.cwd ?? process.cwd()
  const dataDir = join(resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root, slugOf(cwd))
  // Язык подачи — до первой отрисованной строки (см. core/i18n.ts).
  initLang(dataDir, cwd)
  beat(dataDir, 'SessionEnd', { reason: input.reason ?? null })
  const dbPath = join(dataDir, 'passport.db')
  if (input.session_id && existsSync(dbPath)) {
    const db = openDb(dbPath)
    new SessionLog(db).close(input.session_id, input.reason ?? 'session-end')
    db.close()
  }
} catch {
  /* fail-open: прощание — оптимизация, не обязанность */
}
