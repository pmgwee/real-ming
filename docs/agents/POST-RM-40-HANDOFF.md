# Post-RM-40 handoff

For a fresh Codex or Claude Code session picking up Real-Ming after the RM-40
milestone closed on 8 September 2026. The repository and live GitHub state are
authoritative; this file orients you, it does not replace them.

## Where the work happens

**Work directly on `main`.** RM-40 is closed and there is no active milestone
branch. `codex/rm-40-readiness` still exists but is fully merged and retired —
do not commit to it. Cut a new branch only if the CEO asks for one.

## What Real-Ming is

A private personal-operations layer on top of **Hermes Agent**. Hermes is the
agent runtime; Real-Ming adds integrations, governance and evidence. It is not
a second agent runtime, and capabilities that exist natively in Hermes must not
be reimplemented here — several earlier Real-Ming components were deleted on
exactly those grounds.

Read [`README.md`](../../README.md) first. It is written from repository
evidence and labels every capability as live, tested, partial or planned.

## Architecture Revision 6, in one paragraph

Native Hermes owns the Telegram gateway, conversation, tools and execution.
Real-Ming is an additive extension reached **as a tool**, exposing nine bounded
MCP tools for work items, calendar, mail and scheduled reports. Ordinary chat
needs no Work Item, no role ceremony and no structured turn plan. The decision
is [ADR-0020](../adr/0020-run-ming-on-the-native-hermes-runtime.md).

Two labels must never be conflated. The **design baseline** is Revision 6. The
**deployed revision** is stated separately in [`docs/BASELINE.md`](../BASELINE.md)
and is allowed to lag. A test fails the build if any artifact drifts.

## What is complete

Nine milestones, 44 of 44 tickets. `npm run graph:status` selects no next node.
RM-40 ([#41](https://github.com/pmgwee/real-ming/issues/41)) closed with five
native-experience criteria added and evidenced.

Live and proven: one Telegram consumer (the native gateway), two native cron
jobs delivering to Telegram, calendar read and event creation, mail search /
read / draft across several mailboxes with explicit routing, a real coding round
trip from a single Telegram message, native memory surviving restart, an
Obsidian vault the agent writes to, and verified backup and restore into an
isolated destination.

Per-milestone status and evidence links are in
[the implementation plan](../planning/RM-40-v6-native-first-implementation-plan.md).

## What is deliberately NOT true

State these honestly; overstating them is the drift this milestone existed to
correct.

- **No runtime event or hook enforcement exists.** There is no hook wiring in
  this repository. The determinism that exists comes from build-time guards and
  from tool capability being *absent* rather than forbidden — the mail tools
  cannot send because no send tool exists.
- **Curated-knowledge guarantees are built and controlled-tested but not wired
  to a production caller.** Revision 6 makes them optional.
- **No CI.** Checks run locally through `npm run check`.
- **Single operator.** Multi-user access control is not implemented.

## Working agreement

[`AGENTS.md`](../../AGENTS.md) is binding. The parts that catch people out:

- **Never choose a ticket from memory.** `npm run graph:status` decides.
- **Two approved test seams only** — the Real-Ming System Harness and the
  Provider Adapter Contract Harness. Do not add a third and do not test
  internals. Red-to-green through those seams.
- **Verify by exit code**, not by pattern-matching output. `npm run check`,
  `npm audit --audit-level=high`, `git diff --check`.
- **Secrets are read by name, never by literal.** Values live only in an ignored
  `.env` or the secret store. A test scans every tracked file for
  credential-shaped material.
- **Default tests never contact a provider**, spend quota, use a credential, or
  touch production data.
- **Ask before anything outward-facing or hard to reverse** — sending, posting,
  deploying, restarting a service, mutating a Source of Record.
- **CEO blockers go in `CEO-Office/` with a runbook**, and are stated plainly in
  the reply. Never buried in a summary.

## Two failure modes this project has actually hit

Both cost real time. Recognise them.

**Verifying against the wrong process.** A deployment was declared good after
running the binary outside the systemd sandbox that actually runs it.
`ProtectSystem=strict` gives each unit its own mount namespace, so a path can be
writable on disk and read-only to the service. Verify inside the namespace
(`nsenter -t <MainPID> -m`), and prefer `systemctl show -p <Property>` over
reading the unit file.

**Assuming instead of measuring.** Several confident claims here turned out
false on inspection: that a workspace install was incomplete when it was
correctly hoisted; that a rebuild was triggered by file mtimes when the code
always rebuilds; that a "Kanban-only" surface could be exposed by path when
every route returns the same SPA shell. Check the thing before describing it.

## Where documents belong

`CEO-Office/` is a queue for what needs Ming's own hand — a manual action, an
approval, a credential, a decision. Everything else goes to `docs/evidence/`,
`docs/planning/`, `docs/architecture/`, `docs/adr/`, `docs/agents/` or
`docs/specs/`. A milestone report is not CEO-facing merely because Ming may read
it; the test is whether it asks him to *do* something.

## Open items, none gating

- [pmgwee/DuitSini#17](https://github.com/pmgwee/DuitSini/pull/17) — merge or
  reject.
- Third-party Hermes skills, deferred by CEO decision until the rest was done.
- The CEO's Agent Brain Obsidian vault holds tens of thousands of generated
  files against a handful of authored ones, so Obsidian re-indexes it on every
  generation. The durable fix is writing generations into a dot-prefixed folder
  that Obsidian ignores; whether that path is configurable is unverified.

## Orientation commands

```bash
npm run graph:status    # what work exists, if any
npm run check           # typecheck, tests, build, deployment preflight
npm run secrets:preflight   # reports variable names only, never values
```
