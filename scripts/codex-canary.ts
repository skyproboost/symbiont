import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { slugOf } from '../src/hooks/slug'
import { openDb } from '../src/core/db'

const base = mkdtempSync(join(tmpdir(), 'symbiont-codex-canary-'))
const project = join(base, 'project'), data = join(base, 'data')
const pluginFlag = process.argv.indexOf('--plugin-root')
if (pluginFlag !== -1 && !process.argv[pluginFlag + 1]) throw new Error('--plugin-root requires an installed plugin path')
const plugin = pluginFlag === -1
  ? resolve(import.meta.dirname, '..', 'plugin-codex', 'symbiont')
  : resolve(process.argv[pluginFlag + 1])
mkdirSync(project, { recursive: true })
const dataDir = join(data, slugOf(project))
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'learn.json'), JSON.stringify({ auto: false }))
const legacy = 'function f(_oX) {\n\tvar sName = _oX.n;\n\treturn sName;\n}\n'
for (let i = 0; i < 8; i++) writeFileSync(join(project, `m${i}.js`), legacy.repeat(12))
const hook = (name: string, extra: object = {}) => {
  const r = spawnSync('node', [join(plugin, 'dist/launch.js'), name, '--data', data], {
    input: JSON.stringify({ cwd: project, session_id: 'codex-canary', ...extra }),
    encoding: 'utf8', timeout: 30_000, windowsHide: true, cwd: project,
    env: { ...process.env, SYMBIONT_HOST: 'codex', PLUGIN_ROOT: plugin, PLUGIN_DATA: data, SYMBIONT_LANG: 'ru' },
  })
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`)
  return r.stdout.trim() ? JSON.parse(r.stdout.trim()) : {}
}
try {
  const start = hook('session-start', { source: 'startup' })
  if (!start.hookSpecificOutput?.additionalContext?.includes('Symbiont')) throw new Error('Startup passport was not delivered')
  console.log('PASS Codex SessionStart: project passport delivered')
  if (process.platform === 'win32') {
    const pending = () => readdirSync(dataDir).some(name => name.endsWith('.pending'))
    if (!pending()) throw new Error('SessionStart did not leave work for the late MCP server')
    const server = spawn('node', [join(plugin, 'dist/launch.js'), 'server', '--data', data], {
      cwd: project, env: { ...process.env, SYMBIONT_HOST: 'codex' }, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
    })
    const closed = once(server, 'close')
    try {
      const until = Date.now() + 10_000
      while (pending() && server.exitCode === null && Date.now() < until) await delay(50)
      if (pending() || server.exitCode !== null) throw new Error('MCP worker did not claim maintenance')
    } finally {
      server.stdin.end()
      const guard = setTimeout(() => server.kill(), 5000)
      try { await closed } finally { clearTimeout(guard) }
    }
    hook('pre-compact', { trigger: 'auto' })
    if (!pending()) throw new Error('PreCompact did not queue maintenance after MCP shutdown')
    console.log('PASS Codex maintenance: late MCP claimed startup work, PreCompact queued the next pass')
  }
  hook('post-tool', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: m0.js\n@@\n-a\n+b\n*** Update File: m1.js\n@@\n-a\n+b\n*** End Patch' } })
  const db = openDb(join(dataDir, 'passport.db'))
  const edits = db.query('SELECT file FROM session_edits WHERE session_id=? ORDER BY file').all('codex-canary') as { file: string }[]
  db.close()
  if (edits.map(x => x.file).join(',') !== 'm0.js,m1.js') throw new Error(`Missing multi-file edit observations: ${JSON.stringify(edits)}`)
  console.log('PASS Codex apply_patch: both files attributed to session')
  const stop = hook('stop')
  if (stop.hookSpecificOutput) throw new Error('Claude-specific Stop output leaked into Codex')
  console.log('PASS Codex Stop: compatible JSON output')
  hook('session-end', { reason: 'other' })
  console.log('PASS Codex SessionEnd')
} finally {
  if (!resolve(base).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary directory')
  rmSync(base, { recursive: true, force: true })
}
