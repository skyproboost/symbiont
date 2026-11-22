---
name: export
description: Write the derived passport into AGENTS.md as one marked generated section, so other agent tools (Codex, Cursor, Copilot) see the same laws, style and key-module map. The only way Symbiont ever writes into the repository, always by this explicit command; calling it again regenerates the section. The argument "dry" previews without writing. Pointless for Claude Code itself — it already gets the passport live.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/export.js" *)
---

# Symbiont · export the passport to AGENTS.md

!`node "${CLAUDE_SKILL_DIR}/../../dist/export.js" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What the argument does:

- *(nothing)* — write (or refresh) the generated section in `AGENTS.md` at the project root.
- `dry` — print the section that would be written, without touching the file.

What gets exported: the measured laws with their real prevalence numbers, the prevailing style habits (marked as inferred where they came from the model rather than a measurement), and the key modules of the import graph with their derived roles. Everything between the `BEGIN SYMBIONT PASSPORT` / `END SYMBIONT PASSPORT` markers belongs to the generator; hand edits inside will be overwritten on the next export, while the rest of the file is never modified.
