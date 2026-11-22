---
name: export
description: Write the derived passport into AGENTS.md as one marked generated section, so other agent tools (Codex, Cursor, Copilot) see the same laws, style and key-module map. The only way Symbiont ever writes into the repository, always by this explicit command; calling it again regenerates the section. The argument "dry" previews without writing. Pointless for Claude Code itself — it already gets the passport live.
---

Resolve <plugin-root> two directories above this SKILL.md. Use PLUGIN_DATA (or CLAUDE_PLUGIN_DATA) when available; otherwise omit --data and let the CLI resolve its installed data root. Replace <user-arguments> with only the arguments supplied by the user, quoting each for the actual shell. Use the available shell tool; in PowerShell invoke node with &. For --check / --dry-run or a request to verify loading only: describe this skill and check its local entrypoint; do not run any command.


# Symbiont · export the passport to AGENTS.md

Run the following command with the current shell tool, then interpret its output:

```text
node "<plugin-root>/dist/launch.js" export  --data "<plugin-data>" <user-arguments>
```

What the argument does:

- *(nothing)* — write (or refresh) the generated section in `AGENTS.md` at the project root.
- `dry` — print the section that would be written, without touching the file.

What gets exported: the measured laws with their real prevalence numbers, the prevailing style habits (marked as inferred where they came from the model rather than a measurement), and the key modules of the import graph with their derived roles. Everything between the `BEGIN SYMBIONT PASSPORT` / `END SYMBIONT PASSPORT` markers belongs to the generator; hand edits inside will be overwritten on the next export, while the rest of the file is never modified.
