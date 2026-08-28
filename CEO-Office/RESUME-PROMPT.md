# Resume the graph loop

> **Copy the block below and paste it to Claude.** Nothing needs re-explaining — the scheduler reads live GitHub state, so a closed issue is all it takes to release the next ticket.

## Before you paste

1. You closed at least one gate issue ([#7](https://github.com/pmgwee/real-ming/issues/7) or [#25](https://github.com/pmgwee/real-ming/issues/25)).
2. `npm run graph:status` names a real next ticket instead of `BLOCKED ON YOU`.

If it still says `BLOCKED ON YOU`, the gate issue is not closed on GitHub yet. Close it first.

---

## 📋 The prompt

```
/goal Complete Real-Ming Phase 3 implementation via deterministic graph-governed execution loop.
Repository: C:\Users\quekm\Desktop\projects\real-me Branch: feat/tracer-1-daily-operations (branched from main; do NOT reuse docs/final-architecture-v1, it is merged) Constraints: Do not merge main, reset working tree, discard existing changes, expose Sensitive Secrets, bypass human authority, or invoke Superpowers skills.
AUTHORITATIVE GRAPH Use real-ming-phase3-tickets.json (44 nodes + blocking edges) via `npm run graph:status`. Reconcile every iteration with live GitHub issues in pmgwee/real-ming; live GitHub state overrides stale local state. The scheduler chooses work; never pick tickets from memory or increment ticket numbers.
OUTER GRAPH LOOP Repeat until the terminal condition:
1. Run `npm run graph:status`.
2. Select the next unblocked ready-for-agent node.
3. Assign its GitHub issue to @me.
4. Read the issue, comments, docs/specs/real-ming-v1.1.md, CONTEXT.md, and relevant ADRs.
5. Implement only that node's acceptance criteria.
6. Red-to-green TDD via the Real-Ming System Harness and Provider Adapter Contract Harness only.
7. Run focused tests, npm run check, npm audit --audit-level=high, git diff --check.
8. Run independent Standards and Spec reviews against the previous commit.
9. Fix all hard blockers and confirmed correctness defects.
10. Commit only that ticket's work, push the branch, close the issue with evidence.
11. Recompute the graph and immediately start the next ready node.
Completion reports are checkpoints, not permission to stop. Do not stop after one ticket.
LIVE SYSTEMS From RM-07 onward the work touches real accounts (Telegram, Notion, Google Calendar, DuitSini, Vercel, Agent Brain). Ask me before any outward-facing or hard-to-reverse action: sending a message, mutating Notion, deploying, or restarting a service. Default tests must never contact a provider, spend quota, or use a credential.
BLOCKERS The moment you hit anything needing me, STOP and tell me plainly in your reply: what is blocked, which ticket, and what I must do. Then write or update a runbook in CEO-Office/ following the format of the existing ones, refresh CEO-Office/README.md status, and point me at it. Never bury a blocker in a summary.
DECISIONS Whenever you open a pull request or create anything else I must decide on, say so in your reply as its own line with the number, what it contains, and your recommendation. Add it to the Decisions table in CEO-Office/README.md. Never let a PR appear that I have to discover myself. Work on a branch named for the milestone, not on docs/final-architecture-v1, and open one PR per milestone rather than one growing PR.
BASELINE Preserve Real-Ming v1.1 / Architecture Revision 3 across docs/BASELINE.md, the spec, and both v3 diagrams.
PARALLELISM Never parallelize implementation nodes that touch shared files or depend on each other. One implementer owns each ticket's final diff.
TERMINAL CONDITION Complete only when: all 44 tickets closed with evidence, OR no ready-for-agent node remains and every unfinished node is blocked solely by a documented CEO action; all tests, typecheck, build, migrations and security checks pass; the baseline is synchronized; every completed node is committed and pushed; a PR into main carries a complete CEO review packet; and main remains unmerged pending my approval.
Keep working across turns until demonstrably satisfied.
```

---

## Using a different agent (Codex, or anything else)

`/goal` is a Claude Code slash command. It installs a stop condition that keeps the session working across turns. **Codex has no equivalent**, so it will read that line as ordinary text and is likely to stop after one ticket.

Use this version instead. It drops the slash command, points the agent at the files that carry the conventions, and states the continuation rule in words rather than relying on a hook.

```
Continue the Real-Ming Phase 3 implementation.

Repository: C:\Users\quekm\Desktop\projects\real-me
Branch: feat/tracer-1-daily-operations (branched from main; docs/final-architecture-v1 is merged and retired)

FIRST, read these in full before doing anything:
  AGENTS.md                     - how work is selected, definition of done, branching, blockers, secrets
  CEO-Office/README.md          - current status and anything waiting on the CEO
  CONTEXT.md                    - the domain vocabulary; use these terms exactly
  docs/specs/real-ming-v1.1.md  - the specification
  docs/BASELINE.md              - the artifacts that must stay in step

Then repeat this loop until the terminal condition holds:
  1. Run `npm run graph:status` and take the node it names. Never pick a ticket
     from memory and never increment a ticket number.
  2. Assign that GitHub issue to yourself.
  3. Read the issue, its comments, and the relevant ADRs under docs/adr/.
  4. Implement only that issue's acceptance criteria.
  5. Red-to-green TDD through the two approved harnesses only.
  6. Run `npm run check`, `npm audit --audit-level=high`, `git diff --check`.
     Verify by exit code, not by matching output text.
  7. Run independent Standards and Spec reviews against the previous commit.
     Reproduce any suspected defect with a failing test before fixing it.
  8. Commit only that ticket's work, push, and close the issue with evidence.
  9. Recompute the graph and immediately start the next node.

DO NOT STOP after one ticket. A completion report is a checkpoint, not permission
to stop. Keep going until `npm run graph:status` reports no ready-for-agent node.

If you become blocked on something only the CEO can do, stop and say so plainly in
your reply, write a runbook in CEO-Office/ following the existing format, refresh
CEO-Office/README.md, and point him at it. Never bury a blocker in a summary.

Ask before any outward-facing or hard-to-reverse action on a live account.

Do not merge into main without explicit approval.
```

Everything else the agent needs is committed: `AGENTS.md` carries the working agreement, `CEO-Office/` carries the runbook format, and `docs/BASELINE.md` carries the milestone branching plan. No convention lives only in a chat transcript.

## What changed from the first run

Two lines were added, both from what went wrong last time:

- **LIVE SYSTEMS** — the first seven tickets were pure local code. From RM-07 the work touches your real accounts, so outward-facing actions now require your go-ahead.
- **BLOCKERS** — last run a blocker was reported only inside a long final summary, and new docs appeared in `docs/` with no announcement. Blockers must now be stated plainly and documented here in `CEO-Office/`.

## Pre-authorizing to reduce interruptions

If constant confirmation would be annoying, append a line such as:

```
PRE-AUTHORIZED: Notion writes to the Real-Ming test workspace; Telegram messages to my own chat id; Vercel preview deployments. Still ask before: production promotion, database migration, production-data change, and any email send.
```

Only pre-authorize what you genuinely want unattended. Production promotion should always stay a live decision — that guardrail is the point of the system.
