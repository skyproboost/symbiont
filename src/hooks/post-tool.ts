import { join } from 'node:path'
import { readStdinJson } from './stdin'
import { resolveDataRoot } from '../core/data-root'
import { handlePostTool, type PostToolInput } from './post-tool-core'
import { isInternalCall } from '../core/internal'

// Собственный вложенный вызов плагина — не наш клиент: молчим (см. internal.ts)
if (isInternalCall()) process.exit(0)

const input = readStdinJson<PostToolInput>()
const dataRoot = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root
const out = handlePostTool(input, dataRoot)
if (out.hookSpecificOutput) console.log(JSON.stringify(out))
