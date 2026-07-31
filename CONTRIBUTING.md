# Developing and releasing Symbiont

The repository is open for reading, not for outside patches: the license is
proprietary (see [LICENSE](LICENSE)). This document is the owner's working
instruction and an honest description of how the project holds its bar.

**Issues are welcome.** A bug found on someone else's project — another
language, another OS, another kind of material — is worth more than any patch:
the core is supposed to work with no hardcoding for a particular stack, and
every uncovered case is a test of that promise.

## Environment

| | |
|---|---|
| development | **Bun** — it alone runs `.ts` directly, so every script and test runs under it |
| distribution | **Node 22.13+** — the artifact's manifests call node; everyone running Claude Code has it |
| verification | both: the artifact is declared runtime-neutral, and that is proven by a run, not by a promise |

```bash
bun install
```

## Commands

```bash
bun test                                  # the whole battery
bun test tests/store.test.ts              # a single file
bun test --test-name-pattern "name"       # a single test by name

bun run scripts/bundle.ts                 # build the plugin/ artifact (dist + wasm + manifests)
bun run scripts/canary.ts                 # end-to-end smoke of every channel, from sources
bun run scripts/canary.ts --dist          # the same against the built form
bun run scripts/canary.ts --dist --node   # the same under the distribution runtime
bun run scripts/selflint.ts               # structural consistency and artifact freshness

bun run src/passport/cli.ts <path>        # build a passport for any project
bun run src/miner/cli.ts <path>           # layer 0 only (statistics)
```

There is deliberately no linter and no formatter: style is guarded by Symbiont's
own gate and by the tests. The project eats its own dog food — changes in this
repository are checked by the very plugin it builds.

## The release gate (mandatory in full)

The order isn't arbitrary: the build comes before the tests because the canary
checks the built form, and the self-lint catches a stale artifact.

```
1. bump the version in .claude-plugin/plugin.json   ← with an editor, not stream tools
2. bun run scripts/bundle.ts                         → artifact built, smoke passed under bun and node
3. git add plugin                                    → the artifact must reach people through git
4. bun test                                          → 0 fail
5. bun run scripts/canary.ts --dist                  → 8/8 under bun
6. bun run scripts/canary.ts --dist --node           → 8/8 under node
7. bun run scripts/selflint.ts                       → structure is consistent
8. commit together with the rebuilt plugin/
9. claude plugin tag . && git push --tags
```

**The `plugin/` artifact is committed.** The Claude Code marketplace understands
git sources only — it does not support release archives, so installation takes
the directory straight from the repository. Forget to rebuild before committing
and the self-lint goes red on the input-hash check, locally and in CI.

The tag is created by the platform's own command, which also verifies that the
version in `plugin.json` and the entry in `marketplace.json` haven't diverged:

```bash
claude plugin tag .
```

## What CI checks

| when | what |
|---|---|
| every push and PR | the whole gate on Linux and macOS: tests, build, both canaries, self-lint |
| daily, on schedule | the same plus installing the latest Claude Code — catches silent breakage from a platform update |

The schedule matters more than the pushes: a hook that stopped firing after a
platform update produces neither an error nor a trace — it simply goes quiet.
The sin is not the breakage, it's the silence.

## Discipline

- **Three failed fixes in a row — stop.** That's a signal of an architectural
  problem, not a reason for a fourth patch.
- **No "should work" without proof.** A claim of success only after a check that
  was actually run, with its output next to it.
- **While the root cause is still unknown — no temporary patches.**
- **Review comments are verified technically, not accepted out of politeness.**
  A wrong one is declined with an argument; a right one is applied after checking.
- **A new module is wired into existing channels**, not left as an isolated file:
  a feature nobody calls is dead code from day one.

## Invariants — breaking one is an architectural error

The full list lives in [CLAUDE.md](CLAUDE.md) and [CONCEPT.md](CONCEPT.md)
(both in Russian — they are the owner's working documents). In short:

- **zero hardcoding** — no specifics about a language or framework in the core;
  new specifics belong only in `src/passport/signals.ts` or in language packs;
- **crash-only** — the only stop is a crash, correctness lives in reconciliation
  at start-up;
- **fail-open and never silently** — a channel's failure must not break the
  owner's session, but must not be swallowed either: a heartbeat plus an honest
  line in the summary;
- **the fact journal is inviolable** — truth is append-only, facts are superseded
  rather than deleted;
- **the plugin does not react to itself** — its own LLM calls are marked
  `SYMBIONT_INTERNAL=1`, and every hook exits immediately when it sees the mark;
- **heavy work is detached only**, and **the plugin shows no windows** (Windows is
  first-class; a console never flashes).
