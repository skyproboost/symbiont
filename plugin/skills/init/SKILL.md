---
name: init
description: A one-off deep pass over the project — "study everything here at once". Normally Symbiont gets to know a project gradually, over several sessions of background work; this command does all the expensive work immediately — it reads the code, the edit history and the settings, derives the project's rules and its unwritten habits, builds the map of links between files, describes the roles of key modules and takes the first health measurement. It takes from seconds to a few minutes depending on the size of the project, and it calls the model. When to use it — right after installing the plugin into a new project, or when asked to "study the project", "get to know the codebase", "initialise". Calling it again is safe and spoils nothing — data is not duplicated, expensive work already done is not redone, only what is missing is filled in, so it is fine to run whenever you are unsure that everything has been covered. The argument "re" forces a full recalculation from scratch. The command is optional — without it the same thing matures on its own, just more slowly.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/init.js" *)
---

# Symbiont · initialisation

!`node "${CLAUDE_SKILL_DIR}/../../dist/init.js" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What just happened:

- **Passport** — conventions from statistics, a module graph with importance, a content graph of interlinking, a quality profile, priorities from the git history, a cascade of conditions by zone.
- **Project stage** — mature, growing or young. The working mode follows from it: on a mature project, follow the canon; on a young one there is no canon yet, and the bar is set straight away.
- **Deep pass** — the symbolic layer, the unwritten rules, the environment contract (what the code demands of the configuration), the roles of the most important nodes.

No further commands are needed: knowledge arrives in every session by itself, and the background gardener keeps extending the passport as work goes on — it analyses your edits, computes drift, describes the roles of opened files and repairs divergences.

If the owner asks "what do you know about the project now" — show `/symbiont:status`, and `/symbiont:graph` for the map.
