import { join } from 'node:path'
import { readStdinJson } from './stdin'
import { resolveDataRoot } from '../core/data-root'
import { handleStop, type StopInput } from './stop-core'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts)
if (isInternalCall()) process.exit(0)

const input = readStdinJson<StopInput>()
const dataRoot = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root
const out = handleStop(input, dataRoot)
if (out.hookSpecificOutput || out.decision) console.log(JSON.stringify(out))
