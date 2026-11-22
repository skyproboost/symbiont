---
name: init
description: A one-off deep pass — study the whole project now instead of letting knowledge mature over several sessions — rules, unwritten habits, link map, module roles, first health measurement. Calls the model; seconds to a few minutes. Use right after installing into a new project or when asked to "study the project". Safe to repeat; "re" forces a full recalculation. Not a routine refresh — to see what is already known use /symbiont:status.
---

Resolve <plugin-root> two directories above this SKILL.md. Use PLUGIN_DATA (or CLAUDE_PLUGIN_DATA) when available; otherwise omit --data and let the CLI resolve its installed data root. Replace <user-arguments> with only the arguments supplied by the user, quoting each for the actual shell. Use the available shell tool; in PowerShell invoke node with &. For --check / --dry-run or a request to verify loading only: describe this skill and check its local entrypoint; do not run any command.


# Symbiont · initialisation

Run the following command with the current shell tool, then interpret its output:

```text
node "<plugin-root>/dist/launch.js" init  --data "<plugin-data>" <user-arguments>
```

What just happened:

- **Passport** — conventions from statistics, a module graph with importance, a content graph of interlinking, a quality profile, priorities from the git history, a cascade of conditions by zone.
- **Project stage** — mature, growing or young. The working mode follows from it: on a mature project, follow the canon; on a young one there is no canon yet, and the bar is set straight away.
- **Deep pass** — the symbolic layer, the unwritten rules, the environment contract (what the code demands of the configuration), the roles of the most important nodes.

No further commands are needed: knowledge arrives in every session by itself, and the background gardener keeps extending the passport as work goes on — it analyses your edits, computes drift, describes the roles of opened files and repairs divergences.

If the owner asks "what do you know about the project now" — show `/symbiont:status`, and `/symbiont:graph` for the map.
