# Milestone 8 — the coding round trip, accepted

**Date:** 8 September 2026, 00:22–00:38 MYT
**Driven from:** Telegram, one message
**Result:** [pmgwee/DuitSini#17](https://github.com/pmgwee/DuitSini/pull/17),
open and mergeable

## What was asked

The two DuitSini test failures recorded on 7 September were never defects. The
agent had already identified them correctly and refused to weaken them: both
assert Windows behaviour and were being run on Linux. `codexAuthPaths` couples
path joining and case-folded deduplication to the host platform, and a CLI test
expects `claude.cmd` where Linux yields `claude`.

Resolving them and accepting the coding round trip were therefore the same
task, so the work was given to the agent rather than done by hand. A fix
applied from a developer's machine would have made the tests pass and proved
nothing about the milestone.

## What it did

Clone → reproduce → failing test → implement → green → typecheck → build →
independent review → commit → push → pull request, from one Telegram message.

| Step | Outcome |
| --- | --- |
| Clone `pmgwee/DuitSini` | Succeeded on the host checkout |
| Baseline on untouched tree | Reproduced exactly three failures |
| Red tests first | Parameterised the tests to demand both Windows and Linux behaviour before touching production code |
| Implementation | Platform injected, `process.platform` as the default |
| Typecheck | **Caught its own regression**, fixed, re-ran |
| Full suite | 110 passed, 4 opt-in live tests skipped |
| Production build | Passed |
| Independent review | Passed on the second run — see below |
| Push and PR | `c6e7ce915bb9`, 5 files, +68/−16 |

## Verified independently

Read back from the GitHub API rather than taken from the agent's report:

```
title      fix: make platform-specific tests portable
state      open | draft false | merged false
head       fix/platform-aware-cli-tests -> main
sha        c6e7ce915bb9
files      5 | +68 / -16
mergeable  true | state clean
```

The five files are the five that were asked for. Nothing else was touched: no
dependency, no lockfile, no generated artifact.

## The change itself

Production behaviour is unchanged, because the injected platform defaults to
the host:

```ts
export function codexAuthPaths(
  home = homedir(),
  codexHome = process.env.CODEX_HOME,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const pathApi = platform === "win32" ? win32 : posix;
```

Swapping `join` for `posix.join` / `win32.join` is the part that makes the test
meaningful. Without it the separators would still follow the host, so injecting
`"win32"` on Linux would produce half-Windows paths and the assertion would
prove nothing. The same pattern was applied to `ClaudeCliRenewalManager`,
including Windows `dirname` semantics.

The `.env` fix ignores only `ENOENT` and rethrows everything else, so a
genuinely broken `.env` still fails loudly rather than being swallowed.

No assertion was weakened. Both platforms are now asserted where previously
only the host's behaviour could be.

## Three things it did that were not asked

**It wrote the failing tests first.** "I'll first parameterise the tests to
demand both Windows and Linux behavior, then implement only enough platform
injection and ENOENT handling to satisfy them." Red-to-green, unprompted.

**Typecheck caught a regression it had introduced** — another function in the
same module still used the host `dirname` — and it restored that import rather
than widening the injected path API. Green tests and a broken build would
otherwise have shipped.

**It caught its own bad review.** The first delegated reviewer inspected the
stale `workspaces/duitsini` checkout from the earlier tracer and returned a
block. Rather than accept the verdict or quietly ignore it, the agent
identified that the reviewer had read the wrong path and re-ran against the
real clone. That is the same class of error made earlier in this milestone when
a deployment was verified outside the systemd sandbox that runs it.

It also declined to fold the pre-existing Next.js, Sharp, PostCSS and NanoID
audit findings into a narrowly scoped fix, and reported them explicitly instead
of silently skipping them.

## Boundaries it respected

- Stopped before pushing and asked for approval of the **exact commit**
- Live provider smoke tests stayed opt-in and were not run
- No dependency, lockfile, application feature, production data or deployment
  was changed

## Standing state

Milestone 8's engineering item and its user acceptance both close here. The
pull request is open for Ming to merge or reject; the milestone does not depend
on which he chooses, only on the round trip being demonstrated.
