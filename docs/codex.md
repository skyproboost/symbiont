# Claude Code and Codex

Symbiont keeps one TypeScript core and one source set of skills. `bun run scripts/bundle.ts` builds `plugin/` for Claude Code and `plugin-codex/symbiont/` for Codex. The Codex skill entrypoints are generated from the Claude originals; maintain `skills/`, not generated copies.

The Codex package uses `.codex-plugin/plugin.json`, `.mcp.json` and eight lifecycle channels in `hooks/hooks.json`. Codex 0.157.1 disables hooks for the newer root `plugin.json` format, while its legacy MCP loader does not expand plugin-root variables. The installer therefore resolves the MCP entrypoint to the stable local plugin source, retaining the session's project working directory.

After copying the built package to its personal marketplace source, run `bun run scripts/configure-codex-mcp.ts <plugin-root>` before the standard cachebuster and `codex plugin add symbiont@personal` steps. Run it again if the source moves. An optional second argument selects the plugin data root for a non-personal marketplace; the default is `$CODEX_HOME/plugins/data/symbiont-personal`. The build configures its own output automatically. Codex's standard cachebuster helper needs no modification.

Codex requires reviewing the exact installed hook definitions with `/hooks`; installation alone does not trust hooks. Start a new chat after installation. The `status` skill and MCP tools remain useful before hook trust is granted.

Host selection is carried into detached jobs. Claude retains its existing model families; Codex uses `gpt-6-astra` for Symbiont's own calls, with low reasoning effort for routine tasks and high for deep work. `SYMBIONT_CODEX_MODEL` is an explicit override; an unavailable model is reported, never silently replaced with a Claude model. Codex uses the signed-in local CLI, ephemeral sessions, no local environment tools and no approval grants. This changes neither the user's main chat model nor the application's model configuration.

The data root is resolved from `--data`, `PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA`, or the stable installed plugin path. Claude and Codex installations maintain separate passports; the adapter does not overwrite or merge the owner's existing Claude memory.

## Coverage and limits

On Windows, SessionStart and PreCompact leave a maintenance request in the project's plugin data directory. The passport MCP server for that working directory starts the worker independently of the hook. Requests survive a late or restarted MCP server. If the server is disabled, maintenance waits for its next start. Concurrent workers use a separate SQLite lock so maintenance does not hold a write transaction on the passport.

- Session start, user prompts, compaction, subagent start, successful edits, commit checks, stop and session end share the existing core.
- Multi-file `apply_patch` calls are expanded into per-file observations, including renames. Paths outside the current project are filtered by the existing core.
- Supported Codex JSONL rollout records are normalized for edit/check ordering, owner messages and assistant citations. Unknown records are ignored. Nested JavaScript code-mode tool batches and future transcript formats are not treated as complete evidence.
- Codex has no `PostToolUseFailure` event. This package omits it explicitly.
- Shell-based file reads do not become Claude `Read` events. The before-read outline interception is therefore not equivalent; Codex can obtain outlines, graph context and source ranges through the MCP tools and prompt-triggered delivery.
- Claude-specific feed-cost telemetry is not presented as a measured Codex cost.
- Skill `--check` / `--dry-run` asks for loading verification only and runs no plugin command.

Validate with `bun test`, `bun run scripts/canary.ts --dist --node`, and `bun run scripts/codex-canary.ts`. Check the installed package using Codex `skills/list`, `hooks/list` and MCP server status before claiming live startup integration.

To verify the installed copies instead of the build directory, pass `--plugin-root <absolute-installed-plugin-path>` to either canary. The Claude canary also needs `--node`. Its host is explicitly Claude even when launched from Codex; fixture background learning is disabled to avoid model calls during hook checks. Claude model-chain tests likewise select their host explicitly, while `host-compat.test.ts` checks both hosts.
