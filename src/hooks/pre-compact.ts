import { join } from 'node:path'
import { readStdinJson } from './stdin'
import { resolveDataRoot } from '../core/data-root'
import { handlePreCompact, type PreCompactInput } from './pre-compact-core'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts)
if (isInternalCall()) process.exit(0)

const input = readStdinJson<PreCompactInput>()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
const out = handlePreCompact(input, res.root)
if (out.hookSpecificOutput) console.log(JSON.stringify(out))

// Оппортунистический харвест ПЕРЕД сжатием — тот же само-гейтованный детач, что и
// на SessionStart (кулдаун внутри не даёт бегать на каждом сжатии). Хук выходит
// мгновенно: полностью отрезанный stdio, Windows-safe (P1).
try {
  const { spawnAutoLearnDetached } = await import('./detach')
  spawnAutoLearnDetached(input.cwd ?? process.cwd(), res.root)
} catch {
  /* харвест — обогащение, не обязанность */
}
