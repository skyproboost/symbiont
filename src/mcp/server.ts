/**
 * MCP stdio-сервер паспорта: JSON-RPC, по одному сообщению на строку.
 * Живёт только пока жива сессия (спавнится Claude Code) — демонов нет.
 * cwd процесса = корень проекта (его выставляет Claude Code).
 */
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { handleMessage } from './handlers'
import { resolveDataRoot } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'

const dataDir = join(resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root, slugOf(process.cwd()))

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return // битая строка — молчим (fail-open)
  }
  try {
    const res = handleMessage(msg, dataDir)
    if (res) process.stdout.write(JSON.stringify(res) + '\n')
  } catch (e) {
    if (msg.id !== undefined) {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e) } }) + '\n',
      )
    }
  }
})
