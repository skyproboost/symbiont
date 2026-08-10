---
name: export
description: Write the derived project passport into AGENTS.md, so every other agent tool the owner uses (Codex, Cursor, Copilot and anything else that reads the AGENTS.md standard) sees the same measured laws, prevailing style and key-module map that Symbiont delivers to Claude Code sessions live. The knowledge is written as one clearly marked generated section — everything outside the markers is left untouched, and calling the command again regenerates the section with fresh numbers instead of duplicating it. Inside Claude Code nothing changes — the live channels keep delivering, this command exists purely as a bridge to other tools, and it is the only way Symbiont ever writes into your repository — always by this explicit command, never silently from a hook. The argument "dry" previews the section without touching the file (for example "/symbiont:export dry").
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/export.js" *)
---

# Symbiont · export the passport to AGENTS.md

!`node "${CLAUDE_SKILL_DIR}/../../dist/export.js" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What the argument does:

- *(nothing)* — write (or refresh) the generated section in `AGENTS.md` at the project root.
- `dry` — print the section that would be written, without touching the file.

What gets exported: the measured laws with their real prevalence numbers, the prevailing style habits (marked as inferred where they came from the model rather than a measurement), and the key modules of the import graph with their derived roles. Everything between the `BEGIN SYMBIONT PASSPORT` / `END SYMBIONT PASSPORT` markers belongs to the generator; hand edits inside will be overwritten on the next export, while the rest of the file is never modified.
