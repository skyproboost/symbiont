/** Run after copying a Codex package to its stable local installation source. */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configureCodexMcp } from './codex-package'

const target = process.argv[2]
if (!target) throw new Error('Usage: bun run scripts/configure-codex-mcp.ts <plugin-root> [plugin-data-root]')
const root = resolve(target)
if (!existsSync(join(root, 'dist', 'launch.js'))) throw new Error('Symbiont bundle is missing')
const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'))
if (manifest.name !== 'symbiont') throw new Error('Target is not a Symbiont Codex package')
configureCodexMcp(root, process.argv[3])
console.log(`Configured Symbiont MCP entrypoint: ${root}`)
