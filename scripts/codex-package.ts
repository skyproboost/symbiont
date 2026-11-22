/** Common code and hooks, packaged with host-specific discovery metadata. */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

/** Codex 0.157 legacy MCP does not interpolate plugin-root variables. Resolve at install time. */
export function configureCodexMcp(pluginRoot: string, dataRoot?: string): void {
  const root = resolve(pluginRoot)
  const data = resolve(dataRoot ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'plugins', 'data', 'symbiont-personal'))
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { passport: {
    command: 'node', args: [join(root, 'dist', 'launch.js'), 'server', '--data', data], env: { SYMBIONT_HOST: 'codex' },
  } } }, null, 2) + '\n')
}

export function addCodexPackage(root: string, claudeOut: string): void {
  const out = join(root, 'plugin-codex', 'symbiont')
  if (resolve(out) !== join(resolve(root), 'plugin-codex', 'symbiont')) throw new Error('Unexpected generated package path')
  rmSync(out, { recursive: true, force: true })
  cpSync(claudeOut, out, { recursive: true })
  const identity = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
  mkdirSync(join(out, '.codex-plugin'), { recursive: true })
  writeFileSync(join(out, '.codex-plugin/plugin.json'), JSON.stringify({
    name: identity.name, version: `${identity.version}+codex.compat1`, description: identity.description,
    author: identity.author, skills: './skills/', mcpServers: './.mcp.json',
    interface: { displayName: 'Symbiont', shortDescription: 'Project passport, conventions and code graph', longDescription: identity.description, developerName: 'skyproboost', category: 'Productivity', capabilities: ['Read', 'Write'], defaultPrompt: ['Show what Symbiont knows about this project.'] },
  }, null, 2) + '\n')
  rmSync(join(out, 'plugin.json'), { force: true })
  configureCodexMcp(out)
  // Codex package uses its own manifest. The Claude artifact is unchanged.
  const hooks = JSON.parse(readFileSync(join(out, 'hooks/hooks.json'), 'utf8'))
  delete hooks.hooks.PostToolUseFailure // Codex has no equivalent event; do not invent one.
  for (const [event, groups] of Object.entries(hooks.hooks) as [string, any[]][]) {
    for (const group of groups) {
      if (event === 'PostToolUse') group.matcher += '|apply_patch'
      for (const hook of group.hooks) {
        const target = hook.args.find((a: string) => /\/dist\/[^/]+\.js$/.test(a)).match(/\/([^/]+)\.js$/)[1]
        hook.command = `node "\${CLAUDE_PLUGIN_ROOT}/dist/launch.js" ${target} --data "\${CLAUDE_PLUGIN_DATA}"`
        delete hook.args
        if (['PreCompact', 'SessionEnd', 'Stop'].includes(event)) delete hook.additionalContextLimit
        else hook.additionalContextLimit = 5000
        if (event === 'SessionEnd') hook.timeout = 3
        // Codex does not implement Claude's optional `if`; the core checks commits itself.
        delete hook.if
      }
    }
  }
  // Without conditional hooks, deduplicate identical commit handlers.
  for (const groups of Object.values(hooks.hooks) as any[][]) for (const group of groups) {
    group.hooks = [...new Map(group.hooks.map((h: any) => [JSON.stringify(h), h])).values()]
  }
  writeFileSync(join(out, 'hooks/hooks.json'), JSON.stringify(hooks, null, 2) + '\n')
  // Claude keeps its dynamic !`command` entrypoints. Codex gets equivalent explicit instructions.
  const sourceSkills = join(claudeOut, 'skills')
  for (const skill of readdirSync(sourceSkills)) {
    const dest = join(out, 'skills', skill)
    cpSync(join(sourceSkills, skill), dest, { recursive: true })
    const file = join(dest, 'SKILL.md')
    let text = readFileSync(file, 'utf8').replace(/^allowed-tools:.*\r?\n/gm, '')
    text = text.replace(/!`([^`]+)`/g, (_match, cmd) => `Run the following command with the current shell tool, then interpret its output:\n\n\`\`\`text\n${cmd}\n\`\`\``)
    text = text.replace(/\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/dist\/([\w-]+)\.js/g, (_m, entry) => `<plugin-root>/dist/launch.js" ${entry} "`)
    // Paths are resolved from this installed skill, never from a stale source checkout.
    text = text.replaceAll('""', '').replaceAll('${CLAUDE_PLUGIN_DATA}', '<plugin-data>').replaceAll('$ARGUMENTS', '<user-arguments>')
    const fmEnd = text.indexOf('\n---', 4) + 4
    text = text.slice(0, fmEnd) + '\n\nResolve <plugin-root> two directories above this SKILL.md. Use PLUGIN_DATA (or CLAUDE_PLUGIN_DATA) when available; otherwise omit --data and let the CLI resolve its installed data root. Replace <user-arguments> with only the arguments supplied by the user, quoting each for the actual shell. Use the available shell tool; in PowerShell invoke node with &. For --check / --dry-run or a request to verify loading only: describe this skill and check its local entrypoint; do not run any command.\n' + text.slice(fmEnd)
    writeFileSync(file, text)
  }
}
