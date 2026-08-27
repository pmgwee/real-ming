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
Repository: C:\Users\quekm\Desktop\projects\real-me Branch: docs/final-architecture-v1 Constraints: Do not merge main, reset working tree, discard existing changes, expose Sensitive Secrets, bypass human authority, or invoke Superpowers skills.
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
BASELINE Preserve Real-Ming v1.1 / Architecture Revision 3 across docs/BASELINE.md, the spec, and both v3 diagrams.
PARALLELISM Never parallelize implementation nodes that touch shared files or depend on each other. One implementer owns each ticket's final diff.
TERMINAL CONDITION Complete only when: all 44 tickets closed with evidence, OR no ready-for-agent node remains and every unfinished node is blocked solely by a documented CEO action; all tests, typecheck, build, migrations and security checks pass; the baseline is synchronized; every completed node is committed and pushed; a PR into main carries a complete CEO review packet; and main remains unmerged pending my approval.
Keep working across turns until demonstrably satisfied.
```

---

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
