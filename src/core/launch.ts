/** Shared entry point for both hosts. Keeps child jobs in their parent's host. */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { agentHost } from './host'

process.env.SYMBIONT_HOST = process.env.PLUGIN_ROOT || /[\\/]\.codex[\\/]/i.test(fileURLToPath(import.meta.url)) ? 'codex' : agentHost()
const event = process.argv[2]
const targets: Record<string, string> = {
  'session-start': 'hooks', 'user-prompt': 'hooks', 'pre-tool': 'hooks', 'post-tool': 'hooks',
  'post-tool-failure': 'hooks', stop: 'hooks', 'pre-compact': 'hooks', 'subagent-start': 'hooks', 'session-end': 'hooks',
  server: 'mcp', symbiont: 'cli', init: 'cli', charter: 'cli', constitution: 'cli', elevate: 'cli', lang: 'cli', export: 'cli', mute: 'cli',
}
if (!targets[event]) throw new Error(`Unknown Symbiont entry: ${event}`)
process.argv.splice(2, 1)
const here = dirname(fileURLToPath(import.meta.url))
const source = import.meta.url.endsWith('.ts')
const target = source ? join(here, '..', targets[event], `${event}.ts`) : join(here, `${event}.js`)
await import(pathToFileURL(target).href)
