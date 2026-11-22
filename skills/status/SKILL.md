---
name: status
description: What Symbiont already knows about this project — derived rules and laws, the link map, gate catches, channel health, background work, which hints pay off. Shows only what is already counted, so it is fast and free — the one to reach for first. An argument names a directory to map just that part. Not an audit — for what to improve use /symbiont:elevate, for how well rules hold use /symbiont:health.
allowed-tools: Bash(bun run "${CLAUDE_SKILL_DIR}/../../src/cli/symbiont.ts" *)
---

# Symbiont · state

!`bun run "${CLAUDE_SKILL_DIR}/../../src/cli/symbiont.ts" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

How to read the output:

- **Passport and loop** — how many facts are alive, how many have matured into laws, what is ageing and awaiting a recheck. A fact lives: it is confirmed by work, fades without confirmation, and dies once belief in it is gone.
- **Graph** — nodes, links and the most influential modules of the project.
- **Channels and pulse** — whether all six delivery channels are working. A silent channel is visible here, instead of surfacing a week later.
- **Gardener (background)** — what the system did on its own since last time: deepened the passport, analysed your edits, computed drift and hotspot zones, swept from the map what no longer exists.
- **Feed payback** — which kinds of knowledge genuinely pay off in this project. What does not pay off is muted by the system itself and rechecked from time to time.

Nearby commands: `/symbiont:graph` — the interactive map in a browser, `/symbiont:health` — drift and whether the passport can be trusted.
