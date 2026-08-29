# CEO Office

> **Everything that needs Ming personally lives here.** When agent work stops on a blocker, this folder is where the instructions are. Nowhere else.

Whenever `npm run graph:status` prints `BLOCKED ON YOU`, come here.

---

## 🚦 Current status

*As of 2026-08-29 · run `npm run graph:status` for live truth*

| | |
| --- | --- |
| Phase 3 tickets closed | **13 of 44** |
| Startable by an agent right now | **Nothing. RM-11 is the only unblocked ticket and it needs you.** |
| Waiting on you | **Approve `RM11-CUTOVER-3` and start Phase B — the commit point** |

**Phase A is done. 30 Work Items are in Master Tasks. Your five databases are still the daily system and are untouched.**

Verified against live Notion, not just the command's exit code: 30 pages, 30 unique source references, lifecycles 15 Captured / 10 Planned / 2 Waiting-Blocked / 3 Ready for CEO Review, and all six Workstream totals exact. The 4 archive-only records were correctly not imported.

**Phase B has not run.** That is the commit point: it turns your five familiar pages into linked views over Master Tasks, then renames and locks the originals as `ARCHIVED EVIDENCE`. Until then you can still stop — the legacy databases remain writable and the imports can be quarantined by their `notion-migration:` prefix.

`RM11-CUTOVER-1` went stale before it ran: four records were renamed from `To Do (Event/Work)` to `To Do` after you approved. Under the status semantics you confirmed, a domain suffix keeps the `To Do` meaning — so **not one of the 34 decisions changed**. I re-read the five sources read-only, re-bound the identical reconciliation to a fresh snapshot, and proved the decisions are byte-identical to the ones you approved. Your original RM-10 backup is untouched and remains your recovery evidence.

The one current approval sentence is in the
[Phase B packet](RM-11-phase-b-approval-packet.md).

**RM-12 is complete** ([#13](https://github.com/pmgwee/real-ming/issues/13)) — Google Calendar is now the calendar Source of Record, and one commitment reconciles onto a Work Item. It was independent of RM-11, and RM-13 needed both, so it is done and waiting. **Every remaining ticket is now behind RM-11.**

---

## 🔀 Decisions awaiting you

| Decision | What it contains | Recommendation | Status |
| --- | --- | --- | --- |
| Run Phase B | Approve `RM11-CUTOVER-3`, which binds the unchanged Digest 2 and source snapshot plus the completed Phase A report; then create five linked views, prove edit round-trips, and rename and lock the five originals read-only. | **Approve and execute** — Version 3 restores an unambiguous exact-Approval boundary without changing any reviewed decision. | Awaiting the exact sentence below |

*Settled:* `RM11-CUTOVER-1` approved 29 Aug 2026, then invalidated the same day by source drift before any write.

*Settled:* [PR #46](https://github.com/pmgwee/real-ming/pull/46) merged into `main` on 2026-08-27 with your approval — the 7 closed tickets plus tooling and baseline.

> ⚠️ GitHub shares one number space between issues and pull requests. `#1` is the spec, `#2`–`#45` are the 44 tickets, and `#46` was the first **pull request** — it continues the same counter. A number alone does not tell you which kind it is.

---

## ✅ What needs you

**One action:** paste this exact sentence. It approves the immutable Phase B
continuation and authorizes the irreversible commit point:

> I approve RM11-CUTOVER-3 bound to RM11-DIGEST-2, digest SHA-256 f6d31c8d318cdefb7f488df68f50be64829f99dc6b38369f1450f7bd721a17b6, source snapshot SHA-256 c66d697d04a7da1f0be61e2827e250a84cca47f1c10329f985757dda05546325, and completed Phase A report SHA-256 a148737ae4d6e61761570d5726130898d9c580a361bb070cf3dffaad725f2f7f. Execute only the documented Phase B continuation and stop on any drift.

Phase B will lock and retire the five legacy databases. No Phase B mutation
runs until that sentence is received.

Also worth knowing before any future Phase B, because it changes what you can do with three records: the 3 `Pending to Review` items arrive carrying a **migration Outcome Report** that states the effect Real-Ming performed was the migration itself, not the original work. That is what makes them completable at all — without it they could only ever be cancelled or rejected. The [runbook](RM-11-reconciliation-and-cutover-runbook.md) explains what you are confirming when you complete one.

Both initial gates remain closed:

| Gate | Closed | Outcome |
| --- | --- | --- |
| RM-06 · identities and secrets · [#7](https://github.com/pmgwee/real-ming/issues/7) | ✅ 28 Aug 2026 | 9/9 provisioned, TC-01 to TC-05 all pass. Control plane runs locally; always-on host deferred to RM-15. |
| RM-24 · DuitSini pilot update · [#25](https://github.com/pmgwee/real-ming/issues/25) | ✅ 28 Aug 2026 | Add OpenCode and CommandCode provider presets. Code change plus a Supabase migration, so two separate Approvals. |

The RM-11 reconciliation working session is complete: all 34 dispositions were
accepted and Phase A was verified. Only the separate Phase B commit-point
Approval above remains.

The runbooks stay as the record of what was done: [Gate 1](GATE-1-provisioning-runbook.md) · [Gate 2](GATE-2-pilot-selection-runbook.md).

---

## ▶️ How to restart agent work

1. Run `npm run graph:status` and confirm it names a ticket rather than `BLOCKED ON YOU`.
2. Open [RESUME-PROMPT.md](RESUME-PROMPT.md) and copy the block that matches your agent.

Nothing needs restarting or re-explaining. The scheduler reconciles against live GitHub, so a closed issue is all it takes.

> 💡 **Using Codex or another agent?** Codex has its own `/goal` (0.128.0 or later), so the rotation works in both directions — `RESUME-PROMPT.md` carries a prompt for each. Run `/goal` first in the receiving session: resume the Goal if one exists, and paste the full prompt only if none does. An agent with no Goal command reads the block as ordinary text and is likely to stop after one ticket. The conventions themselves live in `AGENTS.md`, which agents read by convention, so they do not depend on which tool you use.

---

## 📍 What happens after Gate 1

Closing RM-06 alone releases 31 tickets. The first seven are a **narrow sequential chain** — this is Tracer 1, the Daily Operations Loop:

```
RM-07, RM-09  →  RM-10, RM-12  →  RM-11 ⚠️  →  RM-13  →  RM-14  →  RM-15  →  RM-16 🎉
Telegram +       migration        needs YOU     07:30     evening   always-on  TRACER
Master Tasks     rehearsal        again         brief     roll-up   env        PROVEN
```

After RM-16 the graph fans out hard — 4, then 5, then 9 tickets per wave. **RM-16 is the milestone worth aiming for.**

⚠️ **RM-11 is currently at its Phase B commit point.** The reconciliation and
Phase A import are complete; `RM11-CUTOVER-3` awaits your exact Approval before
the five legacy writers are retired.

---

## 🗂 What is in this folder

| File | What it is |
| --- | --- |
| [README.md](README.md) | This status board — start here |
| [RESUME-PROMPT.md](RESUME-PROMPT.md) | The prompt to paste to restart the graph loop |
| [GATE-1-provisioning-runbook.md](GATE-1-provisioning-runbook.md) | Step-by-step: create identities, store secrets, verify |
| [GATE-2-pilot-selection-runbook.md](GATE-2-pilot-selection-runbook.md) | Step-by-step: choose and capture the DuitSini pilot |
| [RM-09-master-tasks-provisioning-runbook.md](RM-09-master-tasks-provisioning-runbook.md) | One-minute Notion parent-page share required to create Master Tasks |
| [RM-10-share-legacy-task-sources.md](RM-10-share-legacy-task-sources.md) | Share the five legacy task databases for the read-only migration rehearsal |
| [RM-11-reconciliation-and-cutover-runbook.md](RM-11-reconciliation-and-cutover-runbook.md) | Review all 34 migration dispositions and approve the exact cutover separately |
| [RM-11-cutover-approval-packet.md](RM-11-cutover-approval-packet.md) | Historical Version 2 Phase A packet and approval evidence; do not reuse |
| [RM-11-phase-b-approval-packet.md](RM-11-phase-b-approval-packet.md) | Current exact Phase B continuation, evidence bindings, commit point, and approval sentence |
| [CREDENTIAL-INVENTORY.md](CREDENTIAL-INVENTORY.md) | All ten credentials: owner, purpose, environment, revocation — **no values** |

---

## 🌿 Branching plan — one PR per milestone

One long-lived branch would grow into a 44-ticket, 100-plus-file pull request nobody can meaningfully review, defeating the review discipline this system exists to enforce. So each milestone gets its own branch and its own PR.

| # | Branch | Contents | Review checkpoint | Status |
| --- | --- | --- | --- | --- |
| 1 | `docs/final-architecture-v1` | RM-01…RM-05, RM-08, RM-41 + tooling | foundation | ✅ **merged** |
| 2 | `feat/tracer-1-daily-operations` | RM-07 … RM-16 | Tracer 1 proven | ⬅️ **next** |
| 3 | `feat/context-and-portfolio` | RM-17 … RM-23, RM-42 | Context Vault + portfolio live | waiting |
| 4 | `feat/microsaas-loop` | RM-25 … RM-28, RM-34 | DuitSini promotion proven | waiting |
| 5 | `feat/domain-loops` | remainder → RM-40 | Full v1.1 readiness | waiting |

Each merge is a point where you review an increment you can actually hold in your head — the same principle as reviewing an Outcome Report instead of raw agent activity.

`main` now holds the merged foundation. Milestone 2 branches from it.

> 💡 **No CI is configured.** `npm run check` currently runs only on my machine, so PR #46 carries my word rather than a green tick. Say *"add CI"* and I will add a GitHub Actions workflow that runs typecheck, tests, build, and audit on every push, so future PRs verify themselves.
