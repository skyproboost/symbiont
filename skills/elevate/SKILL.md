---
name: elevate
description: A deep review of what is worth improving in this project and in what order — the one expensive command, and it thinks for a while. It looks at the product as a whole and returns a ranked list of concrete improvements along the axes that actually apply to it — architecture, reliability, performance, security, data, accessibility, findability, usability, up to doubts about the concept itself. Every proposal rests on two things at once — recognised industry standards and this project's own conventions — and goes through an adversarial self-check where the doubtful is cut. It changes nothing and fixes nothing; it is a map of opportunities, and the decision is always yours. The argument sets how strict the filter is, 70 by default (for example "/symbiont:elevate 85" keeps only confident findings).
allowed-tools: Bash(bun run "${CLAUDE_SKILL_DIR}/../../src/cli/elevate.ts" *)
---

This is an explicit expensive pass (one headless LLM call, usually 1–3 minutes, longer on a large project). Symbiont takes the project passport (artifact composition, active axes, profile, constitution, graph) + the built-in rubric of quality axes (grounded in ISO 25010, Core Web Vitals, WCAG, OWASP, DAMA, Nielsen, E-E-A-T) + the principles learned from what usually goes wrong (no noise, ranking by impact, drawn from the project's own conventions, adversarial checking) → and returns a ranked list of elevation proposals.

The argument is the confidence threshold (70 by default): `/symbiont:elevate 80` is stricter and yields fewer findings. The `--ground` flag additionally grounds the proposals in proven external approaches (web research) and synthesises them with the project's own internals (dependencies, scripts, env keys by name); it costs more, needs the internet, and degrades gracefully when offline.

The audit remembers the owner's decisions. `reject N reason…` records that proposal N of the last run was rejected and why; `accept N` records that it is done; `decisions` shows what has been recorded. A rejected argument will not return in the next audit without new grounds, and an accepted one will not be proposed again. Without this record the audit is memoryless and repeats what was already dismissed on every run. The Russian keywords `отклонить` / `принять` / `решения` are accepted as well.

Show the result to the user as is, in a code block. Apply nothing — this is a map of opportunities, and the decision belongs to the owner. If there are no findings, that is a respectable result (the project is healthy along the axes considered), not an empty one. When the owner says that a proposal is wrong or already done, record it with the command rather than only answering in chat — otherwise it will come back.

!`bun run "${CLAUDE_SKILL_DIR}/../../src/cli/elevate.ts" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`
