---
name: init
description: A one-off deep pass — study the whole project now instead of letting knowledge mature over several sessions — rules, unwritten habits, link map, module roles, first health measurement. Calls the model; seconds to a few minutes. Use right after installing into a new project or when asked to "study the project". Safe to repeat; "re" forces a full recalculation. Not a routine refresh — to see what is already known use /symbiont:status.
allowed-tools: Bash(bun run "${CLAUDE_SKILL_DIR}/../../src/cli/init.ts" *)
---

# Symbiont · initialisation

!`bun run "${CLAUDE_SKILL_DIR}/../../src/cli/init.ts" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What just happened:

- **Passport** — conventions from statistics, a module graph with importance, a content graph of interlinking, a quality profile, priorities from the git history, a cascade of conditions by zone.
- **Project stage** — mature, growing or young. The working mode follows from it: on a mature project, follow the canon; on a young one there is no canon yet, and the bar is set straight away.
- **Deep pass** — the symbolic layer, the unwritten rules, the environment contract (what the code demands of the configuration), the roles of the most important nodes.

No further commands are needed: knowledge arrives in every session by itself, and the background gardener keeps extending the passport as work goes on — it analyses your edits, computes drift, describes the roles of opened files and repairs divergences.

If the owner asks "what do you know about the project now" — show `/symbiont:status`, and `/symbiont:graph` for the map.
