---
name: graph
description: An interactive map of the project — builds one self-contained offline HTML file and opens it in the browser — modules are draggable nodes, size shows how much depends on a module, colour shows the part of the project, a click shows the file's role and links. An argument names a directory to draw only that part. Use when someone wants to SEE the structure. Not for numbers — those are in /symbiont:status and /symbiont:health.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/symbiont.js" *)
---

# Symbiont · interactive map

!`node "${CLAUDE_SKILL_DIR}/../../dist/symbiont.js" --data "${CLAUDE_PLUGIN_DATA}" graph $ARGUMENTS`

The map opens in a browser by itself; the file path is printed as well, in case there is nothing to open it with (WSL, ssh, headless). What is in there:

- **Node size** — how important the module is in the graph: the larger it is, the more of the project depends on it.
- **Glow** — heat: this file was worked on recently. It cools down between sessions.
- **Colour** — the zone of the project; clusters become visible to the eye without any clustering.
- **Click on a node** — pins it: its role (if the background has already derived one), its importance, what depends on it and what it depends on.
- **Search** — highlights matching files and dims the rest.

The map is built from projections that are already computed and rebuilds nothing. Node roles appear as work goes on: the background gardener derives them for the files that were actually opened.
