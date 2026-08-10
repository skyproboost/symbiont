import { join } from 'node:path'
import { readStdinJson } from './stdin'
import { resolveDataRoot } from '../core/data-root'
import { handlePostToolFailure, type PostToolFailureInput } from './post-tool-failure-core'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts)
if (isInternalCall()) process.exit(0)

const input = readStdinJson<PostToolFailureInput>()
const dataRoot = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root
const out = handlePostToolFailure(input, dataRoot)
if (out.hookSpecificOutput) console.log(JSON.stringify(out))
