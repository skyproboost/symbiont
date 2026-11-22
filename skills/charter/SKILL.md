---
name: charter
description: Record in the owner's own words what the code cannot show — goals, prohibitions, constraints ("this service must never reach the network", "the legacy module is frozen on purpose"). What is said is checked against what is already derived; only the genuinely new is kept and delivered in every session. Called again, it shows what is recorded and extends it. Not for rules the code already shows.
allowed-tools: Bash(bun run "${CLAUDE_SKILL_DIR}/../../src/cli/charter.ts" *)
---

First show the owner what is already recorded (the command below prints it up front). If there already is a charter — ask what to add or change (existing entries are kept, and extended or updated by goal). If it is empty — ask for requirements, goals, constraints and priorities in their own words, freely (rambling or naive is fine). Then pass them in a single line:

```
bun run "${CLAUDE_SKILL_DIR}/../../src/cli/charter.ts" --data "${CLAUDE_PLUGIN_DATA}" "<owner requirements as plain text>"
```

Symbiont matches every requirement against what it already covers automatically (quality axes, domain playbooks, the derived constitution): anything that coincides in substance — even worded differently — is marked "already under the hood, no need to repeat", while unique strategic intent is recorded into the constitution (it outranks derived facts and is delivered in every session).

Show the output as is. This is not "initialisation" — the passport builds itself; this is a one-off conversation about the intent that cannot be derived.
