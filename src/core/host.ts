/** Host choice belongs at the integration boundary, not in the passport or prompts. */
import { existsSync } from 'node:fs'
import { join, delimiter, basename } from 'node:path'

export type AgentHost = 'claude' | 'codex'

export function agentHost(env: Record<string, string | undefined> = process.env): AgentHost {
  if (env.SYMBIONT_HOST === 'codex' || env.SYMBIONT_HOST === 'claude') return env.SYMBIONT_HOST
  const root = env.PLUGIN_ROOT ?? env.CLAUDE_PLUGIN_ROOT ?? ''
  if (/[\\/]\.codex[\\/]/i.test(root)) return 'codex'
  if (/[\\/]\.claude[\\/]/i.test(root) || env.CLAUDECODE || env.CLAUDE_CODE_EXECPATH) return 'claude'
  return env.CODEX_THREAD_ID || env.CODEX_MANAGED_BY_NPM || env.CODEX_MANAGED_BY_BUN ? 'codex' : 'claude'
}

/** Explicit owner choice. Claude aliases are never tried in a Codex session. */
export function codexModels(env: Record<string, string | undefined> = process.env): string[] {
  return [env.SYMBIONT_CODEX_MODEL?.trim() || 'gpt-6-astra']
}

/** Shell-free launch, including npm installations whose PATH entry is codex.cmd. */
export function codexCommand(env: Record<string, string | undefined> = process.env): { command: string; args: string[] } {
  const explicit = env.SYMBIONT_CODEX_BIN ?? env.CODEX_EXEC_PATH
  if (explicit && /^codex(?:\.exe)?$/i.test(basename(explicit)) && existsSync(explicit)) return { command: explicit, args: [] }
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    const native = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex')
    if (existsSync(native)) return { command: native, args: [] }
    if (process.platform === 'win32') {
      const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
      const packaged = join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', target, 'bin', 'codex.exe')
      if (existsSync(packaged)) return { command: packaged, args: [] }
    }
    const js = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (existsSync(js)) return { command: process.execPath, args: [js] }
  }
  return { command: 'codex', args: [] }
}
