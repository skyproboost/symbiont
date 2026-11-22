---
name: health
description: The state of the project and the honesty of the passport — how well derived rules hold right now, drift against earlier measurements, the files bug-fixes keep returning to (refactoring candidates chosen by data), and whether the passport still serves things no longer on disk. Use for "what is wrong", "where is the mess", "what should be refactored", "can the passport be trusted". Not a ranked plan — that is /symbiont:elevate.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/symbiont.js" *)
---

# Symbiont · health and drift

!`node "${CLAUDE_SKILL_DIR}/../../dist/symbiont.js" --data "${CLAUDE_PLUGIN_DATA}" health`

How to read the output:

- **Health now** — how well conventions are followed, the state of the content graph (orphans, broken links), link density. This is a snapshot, not a verdict.
- **Trend (drift)** — the important part. Drift is the *derivative* of the passport: only deterioration above a threshold is shown. Stable or better, and the section stays silent. Agent-written code degrades monotonically, and the only way to notice is to compare the project with its yesterday self.
- **Hotspot zones** — fix frequency × size. Not "big files" and not "frequently edited files", but the intersection: where fixes land again and again and where there is a lot of code. Those are the refactoring candidates, chosen by data rather than by instinct.
- **Self-image** — whether the map lies: whether the passport serves nodes, roles or lessons for files that are already gone. An honest passport answers in one line, "only living things are served".

Healing needs no commands: the background gardener sweeps dead entries from the projections and schedules a rebuild on its own. This command shows, it does not fix.
