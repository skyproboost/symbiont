---
name: lang
description: The language Symbiont speaks to you in — show it or change it. Called with no argument it tells you the language in force and what it rests on (your explicit choice, the language you write in, the comments in the code, the project docs, the system locale, or the default). Called with "ru" or "en" it fixes that language for this project and keeps it until you say otherwise; "auto" hands the decision back to observation. The default is Russian — what you get when nothing else has spoken. This changes only what the plugin says — the summary, command output, gate messages and the rules it derives; it changes nothing in your code. For example "/symbiont:lang en".
allowed-tools: Bash(bun run "${CLAUDE_SKILL_DIR}/../../src/cli/lang.ts" *)
---

# Symbiont · output language

!`bun run "${CLAUDE_SKILL_DIR}/../../src/cli/lang.ts" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What the argument does:

- *(nothing)* — show the language in force and the reason for it.
- `ru` / `en` — fix that language for this project. An explicit choice outranks every observation and is never overridden by one.
- `auto` — drop the choice and let observation decide again.

What this affects: everything the plugin says to you — the session summary, command output, gate messages, the wording of derived rules, and the language its own model calls answer in. It does not touch your code, and it is per project.

Russian is the default — the answer to "what to show when nothing is known yet". English is a full citizen: it wins whenever the observations point that way, and `/symbiont:lang en` pins it for good.
