<div align="center">

# 🧬 Symbiont

### The plugin that learns your project — and stays with it

**Claude Code stops being a guest in your codebase. Symbiont reads your code and its history, derives the project's own rules and hands them to the model at the moment they matter. It never asks you anything — it observes.**

![version](https://img.shields.io/badge/version-0.110-6e56cf) ![tests](https://img.shields.io/badge/tests-852-2ea043) ![channels](https://img.shields.io/badge/channels-9%2F9-2ea043) ![output](https://img.shields.io/badge/output-EN%20%2F%20RU-6e56cf) ![runtime](https://img.shields.io/badge/runtime-Node%2022.13%2B%20%7C%20Bun-000) ![license](https://img.shields.io/badge/license-proprietary-lightgrey)

<br/>

*“A symbiont: lives with the project · adapts to its host · unique to each one”*

</div>

<br/>

## The difference in one example

The same request in two sessions. Watch not how politely the model answers, but **where the knowledge came from**.

<table>
<tr>
<td width="50%" valign="top">

**A normal session**

> — Add error handling to `payments/refund.ts`

The model opens the file. Then a neighbouring one, to see how it's done here. Then three more, looking for a shared helper. It writes `try/catch` with `console.error`, because that's what most files look like.

But in this project logging `catch` blocks were cleaned out a year ago, errors have their own channel, and `refund.ts` was touched eleven times in six months — every time to fix something.

You know that. The model doesn't.

</td>
<td width="50%" valign="top">

**A session with Symbiont**

> — Add error handling to `payments/refund.ts`

Before the first line of the answer, the context already held:

```
payments/refund.ts · in:9 out:4
role: refund of a payment, the single charge point
depended on by: checkout.ts, ledger.ts
changed together with: ledger.test.ts (7 times)

area payments — fragile (11 fix commits)
law: no empty catch blocks — 457 of 468
```

The answer follows the project's canon on the first try. Files opened: **zero**.

</td>
</tr>
</table>

The difference isn't that the model got smarter. It's that it stopped guessing.

<br/>

---

## What it does while you work

All of this happens on its own — no commands, no configuration.

**It watches the context for you.** Knowledge arrives where the work is, instead of being dumped at the start: open a file and its role and links arrive; don't open it and nothing arrives and nothing is spent. Every kind of hint keeps a record of "surfaced → actually used", and whatever doesn't pay off on your project is dimmed automatically, then re-checked later in case it became useful.

**It offers the cheap path before the expensive one.** A big file is about to be read: Symbiont already knows its role, who depends on it, and — because the structure was parsed in the background — every function and class in it with exact line boundaries. So before the read it says what it knows and what each route costs: the outline is around 150 tokens, the whole file thousands. It blocks nothing and decides nothing — the offer is there, and the model takes it or doesn't.

**It survives conversation compaction.** When Claude Code compacts the history, knowledge about the project usually goes with it — and the model starts guessing again. Symbiont re-injects the passport right after compaction, and just before it, saves what the session earned.

**It keeps the work in focus.** Towards the end of a turn it checks whether the work has sprawled: edits reaching beyond what was asked, checks disappearing from the diff, an unrequested refactor starting. All computed from the link map and the diff — without a single token. And it says so as a fact, not a veto: you may well have widened the task on purpose.

**It won't let protection be weakened silently.** If a change removes validation, authentication, a permission check or security headers, that is said out loud right then — not at review a week later.

**It picks the model for your subscription.** For its own analysis Symbiont keeps a queue of models and pins no versions: when a newer one ships, it takes it. If a model isn't available to you or its limit is spent, it moves to the back of the queue and returns when the limit resets. You never see this and configure nothing.

**It knows what's expensive and what's free.** Rules, the link map, checks and hints are computed on your machine, offline, at no cost. It calls a model only when it's warranted — in the background and on your command.

<br/>

---

## What you get

|  | |
|:--|:--|
| **Your project's rules — with numbers** | Not "write carefully", but "quotes — single — 182 of 182". Rules are derived from your code, not from general ideas about good code. |
| **A map of connections** | Who imports whom, what depends on what, which files always change together. Works for JS/TS, Python, PHP, Go, Java, Kotlin, C#, Rust, Ruby, C/C++, Dart, Lua. |
| **A warning about fragile places** | "This area was repaired eleven times" — before the edit, not after. |
| **Protection from silent breakage** | If a change removes validation, authentication or a permission check, it is said out loud. |
| **Knowledge exactly when needed** | Open a file — its role and links arrive. Don't open it — nothing arrives and nothing is spent. |
| **One function instead of a whole file** | The structure of your code is indexed, so a single symbol can be pulled out by name — hundreds of tokens instead of tens of thousands. If the file changed after indexing, it refuses rather than hand back the wrong lines. |

<br/>

---

## What it looks like

**The project map.** `/symbiont:graph` builds it into a single HTML file and opens it in your browser: drag nodes with the mouse, size means how important a module is, glow means recent work, colour means the part of the project, a click reveals a file's role and both sides of its links. Below is a project of 1300 files.

<div align="center">
  <img src="docs/graph-map.svg" alt="Project map: modules, links, importance and areas" width="960">
</div>

<br/>

**An `/symbiont:elevate` review.** A ranked list of what's worth improving. Here is one finding from a real run on this very repository (shortened):

```yaml
axis:        data integrity
observation: a fact's identity is computed as statement.split('—')[0] —
             split strictly on an em dash. Statistics produce the dash from
             constants in the code and always match, but rules inferred by a
             model arrive as text: a hyphen instead of a dash yields a key
             equal to the whole string. The same thought reworded then fails
             to supersede the old record and creates a second one — which
             cannot be cleaned up, the journal is append-only.
proposal:    split on /\s[—–-]\s/ in the single place where the key is
             computed, plus a one-off backfill of existing rows
impact:      superseding works regardless of which character the model
             produced; a rule's history stops splitting in two
cost:        low · risk: medium · confidence: 72%
refutation:  if layer 2 already normalises punctuation before writing, there
             is no hole — only a guard against regression
```

The refutation is part of the output: a proposal that doesn't survive it never reaches you.

<br/>

---

## Installation

### One requirement, worth checking first

| | |
|---|---|
| **Runtime** | Node **22.13+**, or Bun — any version |
| **Check** | `node --version` |
| **Why** | the passport lives in SQLite, and these are the two runtimes that ship SQLite built in |

This is newer than Claude Code's own requirement, so a machine that runs Claude Code happily can still be short of it.

**If `node --version` says less than 22.13**, either install a current Node (`nvm install 22` · `winget install OpenJS.NodeJS.LTS` · `brew install node`), or point Claude Code at a newer one you already have — `~/.claude/settings.json`:

```json
{ "env": { "PATH": "/path/to/node-22/bin:${PATH}" } }
```

On an unsupported runtime nothing half-runs. Every command answers in one line — what is on the machine, what is required, and that nothing was touched — and `/symbiont:status` prints the runtime it sees, so there is nothing to guess at.

```bash
# 1. Add the marketplace
claude plugin marketplace add skyproboost/symbiont

# 2. Install the plugin
claude plugin install symbiont

# 3. Restart Claude Code
```

That's it. The passport builds itself when a session first starts — from seconds to a couple of minutes depending on project size. After that it keeps itself up to date in the background and needs no attention.

Want the whole project analysed at once — `/symbiont:init`. It's optional: without it everything matures on its own, just slower.

<br/>

---

## Updating

```bash
# 1. Pull the latest version from the repository
claude plugin marketplace update symbiont-market

# 2. Update the plugin
claude plugin update symbiont

# 3. Restart Claude Code — the update doesn't apply without it
```

**What happens to everything it learned.** Nothing — it stays. Rules, the link map, file roles and history live outside the plugin, in your data directory. An update replaces code only: the passport continues from where it was and doesn't need rebuilding.

To check which version is installed — `claude plugin list`.

<br/>

---

## Commands

There are deliberately few: a command you have to remember is a tax on the human. Everything essential works without them.

| Command | What for |
|:--|:--|
| `/symbiont:status` | What the system already knows about the project and does without you: how many rules were derived, what the gate caught, what the background work has been doing, which hints pay off here. Computes nothing — only shows.<br/>*Takes a directory: `/symbiont:status src/core` shows the map of that part. The same way switches the language: `/symbiont:status lang ru`* |
| `/symbiont:graph` | The project map in your browser, and you can touch it: drag nodes, size means a module's importance, colour means the part of the project, a click opens a file's role and both sides of its links. One file, works offline, holds no code.<br/>*Takes a directory: `/symbiont:graph src/core` draws only that part — on a large project it reads far better* |
| `/symbiont:health` | Three answers: are the rules being followed right now, where is everything drifting compared to earlier snapshots, and where do repairs keep landing — the files bug fixes return to again and again. The last one gives refactoring candidates chosen by data, not by feeling |
| `/symbiont:init` | Analyse the project at once instead of waiting for it to mature in the background. Seconds to a few minutes. Run it after installing, or when you want "learn everything here".<br/>*Safe to run again: nothing is duplicated or redone — only what's missing is filled in. `/symbiont:init re` forces a full recount* |
| `/symbiont:charter` | Say in words what the code can't show: "never touch production payments", "this module is frozen on purpose", "privacy outweighs speed". What the system already knows is discarded as redundant; what's genuinely yours arrives in every session |
| `/symbiont:elevate` | A review of "what's worth improving and in what order" — architecture, reliability, performance, security, data, accessibility, usability. Every proposal goes through an adversarial self-check. Changes nothing — it's a map of options.<br/>*The one expensive command: it thinks for a while. Takes a strictness threshold: `/symbiont:elevate 85` keeps only confident findings* |

<br/>

---

## Worth knowing

**Your data stays on your machine.** The passport, the journal and every projection live in your data directory. Symbiont has no server, no account, no telemetry and no third-party services of its own — it never opens a connection by itself.

**Where code does go.** The deterministic half — mining, the link map, gates, roles, search — runs fully offline and needs no network at all. The model passes (unwritten rules, file roles, `/symbiont:elevate`) run through *your* Claude Code and send representative code samples along with the prompt, to exactly the place your ordinary conversations already go. No separate channel and no other recipient.

**What travels with a shared session.** The passport summary is injected into the session, so it is part of the transcript. `/feedback`, `/bug`, `/share` and the "can Anthropic look at your session?" prompt carry it along — including whatever you recorded with `/symbiont:charter`. That is prose, and secret redaction does not cover prose. Worth knowing before you answer Yes on a sensitive project.

**It speaks your language.** English or Russian — Symbiont works it out from how you write to the model and from the comments in your code. To switch by hand: `/symbiont:status lang ru` (back to automatic — `lang auto`).

**The standing cost is a couple of thousand characters.** The expensive part (analysis by a model) is triggered, not constant; everything else — statistics and the link map — runs offline and for free.

**It's not a linter and not a replacement for review.** The plugin watches form and makes sure a change doesn't weaken protection silently. The correctness of your logic is on you.

<br/>

---

<div align="center">

Development and internals — [CONTRIBUTING.md](CONTRIBUTING.md) · License — [LICENSE](LICENSE)

</div>
