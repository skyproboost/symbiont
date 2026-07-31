import { join } from 'node:path'
import { readStdinJson } from './stdin'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { handleSessionStart, type SessionStartInput } from './session-start-core'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts).
// Без этого проход из временного проекта плодил паспорта-призраки в данных владельца.
if (isInternalCall()) process.exit(0)

const input = readStdinJson<SessionStartInput>()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res) // идемпотентно: разово переносит паспорта из версионированных установок
const out = handleSessionStart(input, res.root)
if (out.hookSpecificOutput) console.log(JSON.stringify(out))

// Фоновое обслуживание — ОДИН детач-процесс (слой 1 всегда + LLM-петля по сырью,
// само-гейт внутри). Хук выходит мгновенно после выдачи сводки: не держим клиент
// (ресёрч P3 — SessionStart быстрым; P1 — полностью отрезанный stdio, Windows-safe).
try {
  const { spawnAutoLearnDetached } = await import('./detach')
  spawnAutoLearnDetached(input.cwd ?? process.cwd(), res.root)
} catch {
  /* обслуживание — обогащение, не обязанность */
}
