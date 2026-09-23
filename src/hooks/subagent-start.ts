import { join } from 'node:path'
import { readStdinJson } from './stdin'
import { emitHookOutput } from './emit'
import { resolveDataRoot } from '../core/data-root'
import { handleSubagentStart, type SubagentStartInput } from './subagent-start-core'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts)
if (isInternalCall()) process.exit(0)

const input = readStdinJson<SubagentStartInput>()
const dataRoot = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root
const out = handleSubagentStart(input, dataRoot)
if (out.hookSpecificOutput) emitHookOutput(out, 'SubagentStart', dataRoot, input.cwd)
