---
name: lang
description: Show or change the language Symbiont speaks in. With no argument it reports the language in force and what it rests on; "ru" or "en" fixes it for this project, "auto" hands the decision back to observation. Changes only what the plugin says — summary, command output, gate messages, derived rules — never the code or its comments.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/lang.js" *)
---

# Symbiont · output language

!`node "${CLAUDE_SKILL_DIR}/../../dist/lang.js" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What the argument does:

- *(nothing)* — show the language in force and the reason for it.
- `ru` / `en` — fix that language for this project. An explicit choice outranks every observation and is never overridden by one.
- `auto` — drop the choice and let observation decide again.

What this affects: everything the plugin says to you — the session summary, command output, gate messages, the wording of derived rules, and the language its own model calls answer in. It does not touch your code, and it is per project.

Russian is the default — the answer to "what to show when nothing is known yet". English is a full citizen: it wins whenever the observations point that way, and `/symbiont:lang en` pins it for good.
