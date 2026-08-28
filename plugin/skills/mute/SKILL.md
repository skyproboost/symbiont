---
name: mute
description: Tell Symbiont that a derived rule is misleading here — it stops being delivered in the summary and enforced by the gate, while its history stays intact. Use it when a rule in the passport is technically true but harmful in practice (a habit inferred from six random files, a law mined from legacy scripts), or when the owner says a delivered rule is wrong. Called with a phrase from the rule (or its journal key) it mutes exactly one rule and asks to refine if several match; "list" shows what is muted; "undo <phrase or key>" brings a rule back. Nothing is deleted — the journal is append-only and the muted rule remains visible in passport_conventions with a mark. For example "/symbiont:mute деструктуризация — в тестах она нужна" or "/symbiont:mute list".
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../../dist/mute.js" *)
---

# Symbiont · mute a misleading rule

!`node "${CLAUDE_SKILL_DIR}/../../dist/mute.js" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

What the argument does:

- `<phrase>` — mute the single rule whose wording (in either language) or journal key contains the phrase. Text after ` — ` is kept as the owner's note (why). Several matches → the list is shown and nothing is muted; refine the phrase or pass the key.
- `list` (or nothing) — what is muted, since when, with the undo command for each.
- `undo <phrase or key>` — remove the label; the rule is delivered again from the next session start.

What this affects: the session summary, the subagent slice, the export to AGENTS.md and the form gate all stop seeing the rule. The journal keeps every measurement, `passport_conventions` shows the rule with a "muted by the owner" mark, and the summary carries one line with the count so nothing disappears silently. The label is per rule key, so a re-measured version of the same rule stays muted until the owner lifts it.

Show the output as is.
