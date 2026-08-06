---
name: health
description: The state of the project and the honesty of the passport itself. It shows three things — how well the derived rules are being followed right now (and, in texts, orphans and broken links); where things are heading relative to earlier measurements (a rule held at 100% and is now 96%, so the project is drifting away from its own norm); and where fixes keep landing — the files bug-fixes return to again and again, ranked by fix frequency × size. That last one is a list of refactoring candidates chosen by data rather than by feel. Plus a self-check — whether the passport still serves things that are no longer on disk. Use it when someone asks "what is wrong", "where is the mess", "what should be refactored" or "can the passport be trusted".
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
