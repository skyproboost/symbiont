---
name: charter
description: Put into words what the code cannot show — the goals, prohibitions and constraints of this project, in your own words, however naive. Symbiont checks what you say against what it has already derived from your edit history and the shape of the product — whatever it already knows is discarded as redundant, while what is genuinely unique ("this service must never reach the network", "the legacy module is frozen on purpose", "patient data matters more than speed") is recorded for good and delivered in every session. No onboarding interview is required — without this command the system still derives priorities from your work; the command exists for the rules your work does not reveal. Called again, it first shows what is already recorded — the old is kept and extended, never replaced.
---

First show the owner what is already recorded (the command below prints it up front). If there already is a charter — ask what to add or change (existing entries are kept, and extended or updated by goal). If it is empty — ask for requirements, goals, constraints and priorities in their own words, freely (rambling or naive is fine). Then pass them in a single line:

```
bun run "${CLAUDE_SKILL_DIR}/../../src/cli/charter.ts" --data "${CLAUDE_PLUGIN_DATA}" "<owner requirements as plain text>"
```

Symbiont matches every requirement against what it already covers automatically (quality axes, domain playbooks, the derived constitution): anything that coincides in substance — even worded differently — is marked "already under the hood, no need to repeat", while unique strategic intent is recorded into the constitution (it outranks derived facts and is delivered in every session).

Show the output as is. This is not "initialisation" — the passport builds itself; this is a one-off conversation about the intent that cannot be derived.
