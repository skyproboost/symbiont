---
name: mute
description: Tell Symbiont that a derived rule is misleading here — it stops being delivered and enforced, while its history stays intact. Takes a phrase from the rule or its key; "list" shows what is muted, "undo &lt;phrase or key&gt;" brings a rule back. Use when the owner says a delivered rule is wrong or harmful in practice. Not for a rule that is merely out of date — deriving it again fixes that.
---

Resolve <plugin-root> two directories above this SKILL.md. Use PLUGIN_DATA (or CLAUDE_PLUGIN_DATA) when available; otherwise omit --data and let the CLI resolve its installed data root. Replace <user-arguments> with only the arguments supplied by the user, quoting each for the actual shell. Use the available shell tool; in PowerShell invoke node with &. For --check / --dry-run or a request to verify loading only: describe this skill and check its local entrypoint; do not run any command.


# Symbiont · mute a misleading rule

Run the following command with the current shell tool, then interpret its output:

```text
node "<plugin-root>/dist/launch.js" mute  --data "<plugin-data>" <user-arguments>
```

What the argument does:

- `<phrase>` — mute the single rule whose wording (in either language) or journal key contains the phrase. Text after ` — ` is kept as the owner's note (why). Several matches → the list is shown and nothing is muted; refine the phrase or pass the key.
- `list` (or nothing) — what is muted, since when, with the undo command for each.
- `undo <phrase or key>` — remove the label; the rule is delivered again from the next session start.

What this affects: the session summary, the subagent slice, the export to AGENTS.md and the form gate all stop seeing the rule. The journal keeps every measurement, `passport_conventions` shows the rule with a "muted by the owner" mark, and the summary carries one line with the count so nothing disappears silently. The label is per rule key, so a re-measured version of the same rule stays muted until the owner lifts it.

Show the output as is.
