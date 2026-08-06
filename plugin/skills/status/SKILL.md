---
name: status
description: What Symbiont already knows about this project and what it does without you — how many rules have been derived and how many are confirmed enough to have become law; the size of the link map; what the form gate caught; whether the delivery channels are alive; what the background work has been doing; which kinds of hint actually pay off here and which are muted as not worth their cost. It starts and recomputes nothing — it only shows what has already been counted, so it is fast and free. An argument can name a directory — then instead of the general overview you get a map of exactly that part of the project, with file roles and link counts (for example "/symbiont:status src/core"). The same argument switches the output language — "/symbiont:status lang en", and "/symbiont:status lang auto" hands it back to automatic detection.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/symbiont.js" *)
---

# Symbiont · state

!`node "${CLAUDE_SKILL_DIR}/../../dist/symbiont.js" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

How to read the output:

- **Passport and loop** — how many facts are alive, how many have matured into laws, what is ageing and awaiting a recheck. A fact lives: it is confirmed by work, fades without confirmation, and dies once belief in it is gone.
- **Graph** — nodes, links and the most influential modules of the project.
- **Channels and pulse** — whether all six delivery channels are working. A silent channel is visible here, instead of surfacing a week later.
- **Gardener (background)** — what the system did on its own since last time: deepened the passport, analysed your edits, computed drift and hotspot zones, swept from the map what no longer exists.
- **Feed payback** — which kinds of knowledge genuinely pay off in this project. What does not pay off is muted by the system itself and rechecked from time to time.

Nearby commands: `/symbiont:graph` — the interactive map in a browser, `/symbiont:health` — drift and whether the passport can be trusted.
