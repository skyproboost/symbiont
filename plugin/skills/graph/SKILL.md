---
name: graph
description: An interactive map of the project in your browser — a graph of modules you can look at and touch. It builds one self-contained HTML file and opens it straight away — nodes drag with the mouse, size shows how much the project depends on a module, glow shows what was touched recently, colour shows the part of the project, and a click opens the file's role together with both sides of its links; there is search, zoom and a layout freeze. An argument can name a directory — then only that part of the project is drawn, which on a large repository reads far better than a whole map (for example "/symbiont:graph src/core"). The file makes no external request and contains no line of source code — only paths, links and already derived roles — so it opens offline and discloses nothing. Use it when someone wants to SEE the structure of the project, find its main modules, or understand what is connected to what.
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
