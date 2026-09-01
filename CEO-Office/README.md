# CEO Office

> **Everything that needs Ming personally lives here.** When agent work stops on a blocker, this folder is where the instructions are. Nowhere else.

Whenever `npm run graph:status` prints `BLOCKED ON YOU`, come here.

---

## 🚦 Current status

*As of 2026-09-02 · run `npm run graph:status` for live truth*

| | |
| --- | --- |
| Phase 3 tickets closed | **25 of 44** *(RM-23 closed; RM-25 next)* |
| Startable by an agent right now | **RM-25 (#26)** — Show DuitSini GitHub and Git lineage |
| Waiting on you | Optional: the Azure budget alert and the Tracer 1 milestone PR review. |

**RM-11 through RM-14 are complete and closed.** Master Tasks is your single
writable task system, Google Calendar is the calendar Source of Record, and the
07:30 Morning Brief, 21:30 Executive Roll-Up, do-not-disturb, weekend rhythm and
error grouping all work.

**Azure is fully provisioned.** You did every step that needed you:

| | |
| --- | --- |
| Virtual machine | `real-ming-control-plane` — D2as_v5, 2 vCPU, 8 GiB, Ubuntu 24.04, East Asia Zone 1 |
| Disk | 128 GiB Premium SSD, expanded, 122 GiB free |
| SSH | key proven, rule restricted from `Any` to your own address |
| Managed identity | system-assigned, On |
| Key Vault | `real-ming-vault`, East Asia, **Azure RBAC** model, purge protection disabled, 7-day retention |
| Role assignments | Key Vault Secrets **User** to the VM, Secrets **Officer** to you — both scoped to the vault, not the subscription |
| Secrets | **10 of 10** loaded and Enabled |

⚠️ **Still outstanding, and only you can do it: the budget alert.**
Cost Management → Budgets → Add → subscription scope → RM250 → alerts at 50/80/100%
to your email. It is the only thing that tells you when the $200 credit stops
absorbing the bill. It does not block RM-15.

### What the independent reviews found

The Standards and Spec reviews AGENTS.md requires had not been run on the
deployment work. Both were run against the previous commit and found **two
blocking defects**, each now fixed with a test that fails without the fix.

| | Defect | Consequence had it shipped |
| --- | --- | --- |
| Spec | An ordinary question threw instead of refusing, and the poll failure count was discarded | One question such as "what is on my plate today" silenced Telegram for about a day, while the dashboard reported healthy throughout |
| Standards | The nightly backup stops the service, and nothing in the chain had a timeout | A stalled upload at 03:15 left the always-on service stopped indefinitely, with no alert |

Three further gates proved nothing and now gate what they claim: the container
smoke step ran without `--live` and passed whatever the image contained; the
deployment script would have halted at its first command because Chromium is
absent on a fresh Ubuntu Server image; and a secret-leak assertion could not
fail by construction.

✅ **RM-15 is closed. Real-Ming runs on its own machine.** Proven on 31 August
by an instruction sent from a phone at 08:32 UTC, seven minutes after the
Lenovo was shut, which produced Work Item `34e56f2e` at 08:32:49Z. The service
is enabled so it survives a reboot; the local backup timer runs nightly at
19:27 UTC.

Access is over Tailscale now rather than a firewall rule pinned to one address,
so moving between home, a café and tethering no longer breaks it, and port 22
no longer answers the public internet at all.

⚠️ **Two limits worth knowing.** The deployed service cannot yet *execute* a
Work Item autonomously — the controlled Lenovo private-worker protocol is
**RM-21**, but the deployed Azure process still has no live Lenovo transport or
worker adapter. Until that separately activated connection exists, capture,
review, approvals, the brief and the roll-up work, while Local-Only execution
still gets an honest "not yet". Durable state has no off-host copy: 33 Work
Items in one file on one machine. Pull a copy down before day 31.

| RM-11 cutover evidence | Result |
| --- | --- |
| Legacy databases renamed `ARCHIVED EVIDENCE` and locked | **5 of 5** |
| Linked views over Master Tasks, familiar names kept | **5** |
| Sample edits proven to reach the canonical Work Item, then restored | **5** |
| Master Tasks | 30 pages, 30 unique source references, writable |
| Writable task systems | **exactly one** |

Your five task pages still look and work the way they did — they are now views over one database. The originals are locked read-only evidence; nothing was deleted and nothing synchronizes back.

Phase B failed once before this, at the linked-view step, and retired nothing. The all-or-nothing guard held: all five databases stayed writable until the fix landed.

---

## 🔀 Decisions awaiting you

| Decision | What it contains | Recommendation | Status |
| --- | --- | --- | --- |
| Where Real-Ming runs | A genuinely always-on host with a persistent disk and a secret store. Must not be serverless: state is SQLite and the Telegram front door is a long-lived process. | **Settled: Azure**, East Asia (Southeast Asia refused every small size for this subscription). Chosen for the résumé value on the one cloud you have not used, with the credit difference largely illusory since both expire. | ✅ Decided |
| Prepare RM-15 candidate | Rebuilt from `5016918` after two blocking defects were found in the earlier candidate. | Approved and executed 31 Aug. | ✅ Done |
| Activate RM-15 candidate | Started image `sha256:0ed353723aa4…`; Telegram proven from a phone with the Lenovo shut. | Approved and executed 31 Aug. | ✅ Done |
| Off-host backup | An Azure Storage account and a narrowly scoped role assignment, so the 33 Work Items survive losing the VM. | **Not yet.** Local backup meets every acceptance criterion, and a storage account is Azure-specific against your day-31 plan. Worth revisiting before teardown. | ⏳ Open |
| Select RM-17 Personal Context item | One bounded file or allowlisted Notion page plus source metadata for the first Candidate Envelope. | Approved `personal-context/working-preferences.md` snapshot for COO daily planning. | ✅ Done in RM-17 |
| Open Tracer 1 milestone PR | Reviewable `feat/tracer-1-daily-operations` increment containing RM-07…RM-16. | **Open a PR for review; do not merge to `main` without separate approval.** | ⏳ Waiting on CEO |

*Settled:* `RM11-CUTOVER-1` approved 29 Aug 2026, then invalidated the same day by source drift before any write.

*Settled:* [PR #46](https://github.com/pmgwee/real-ming/pull/46) merged into `main` on 2026-08-27 with your approval — the 7 closed tickets plus tooling and baseline.

> ⚠️ GitHub shares one number space between issues and pull requests. `#1` is the spec, `#2`–`#45` are the 44 tickets, and `#46` was the first **pull request** — it continues the same counter. A number alone does not tell you which kind it is.

---

## ✅ What needs you

**RM-16 is complete and locally proven.** RM-15 remains closed and live from
the reviewed `5016918` candidate. The RM-16 tracer is a controlled system
harness proof; it required no deployment, Telegram message, or Notion mutation.

**RM-21 is complete in the controlled harness.** It adds the five-capability
heartbeat, safe offline queue, bounded jobs, execution-token lease fencing,
redacted evidence, reconnect/retry handling, and a production verifier seam.
The deployed Azure service still supplies neither a live Lenovo transport nor a
worker adapter, so it remains refusal-only for Local-Only execution until that
separate connection and activation are approved. A green controlled tracer is
not live worker execution.

**RM-22 is complete.** Provider observations are durable, secret-safe and
idempotent, with explicit healthy/stale/unavailable/missing-permission/
rate-limited/unsupported/invalid-data states. Identical events group without
erasing distinct failures; retry attempts are bounded and classified; provider
recovery is linked to the affected Work Item, observation identity and audit
evidence, with one governed recovery notice. The authenticated dashboard now
renders provider-observation history separately from binary control-plane
health, and the Notion, Google Calendar and Telegram provider edges use the
same coordinator.

**RM-23 is complete.** The scheduler inventory now records provider, cadence,
criticality, accountable executive, heartbeat, success, next run, duration,
failure streak, evidence, and durable attempt-numbered failure history. Critical
misses and failures notify on the first occurrence; routine jobs notify after
two consecutive failures. Cold starts, crashed claims, stale current runs, and
timed-out runners are detected without permitting late side effects to race a
retry. Repeated notices group and recover once, while the dashboard and
Executive Roll-Up retain noncritical scheduler history. Future Vercel, GitHub
Actions, application-scheduler, and Knowledge Compiler jobs can register through
the inventory extension point.

**RM-17’s CEO selection is recorded and the bounded Personal Context ingestion
boundary is implemented and proven in the controlled harness.** The eventual
encrypted staging payload is Git-ignored, role-scoped to the COO, and remains
separate from Compiled Knowledge, Hot Runtime Memory, and every Source of
Record. See the [RM-17 runbook](RM-17-personal-context-selection-runbook.md)
for the exact metadata and evidence.

`RM11-CUTOVER-3` was approved and executed on 29 Aug 2026: 30 pages imported,
all five legacy databases retired to read-only evidence, exactly one writable
task system remaining. Nothing about RM-11 is outstanding.

Worth keeping, because it changes what you can do with three records: the 3
`Pending to Review` items carry a **migration Outcome Report** stating the
effect Real-Ming performed was the migration itself, not the original work.
That is what makes them completable at all -- without it they could only ever
be cancelled or rejected. The [runbook](RM-11-reconciliation-and-cutover-runbook.md)
explains what you are confirming when you complete one.

Both initial gates remain closed:

| Gate | Closed | Outcome |
| --- | --- | --- |
| RM-06 · identities and secrets · [#7](https://github.com/pmgwee/real-ming/issues/7) | ✅ 28 Aug 2026 | 9/9 provisioned, TC-01 to TC-05 all pass. Control plane runs locally; always-on host deferred to RM-15. |
| RM-24 · DuitSini pilot update · [#25](https://github.com/pmgwee/real-ming/issues/25) | ✅ 28 Aug 2026 | Add OpenCode and CommandCode provider presets. Code change plus a Supabase migration, so two separate Approvals. |

The RM-11 reconciliation working session is complete: all 34 dispositions were
accepted, Phase A was verified, and Phase B executed successfully.

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

✅ **Tracer 1 is proven.** RM-07 through RM-16 are closed. RM-16 proves the governed loop end to end with controlled workers while recording the RM-21 production-execution boundary.

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
| [RM-17-personal-context-selection-runbook.md](RM-17-personal-context-selection-runbook.md) | CEO-only choice of the first bounded Personal Context item |

---

## 🌿 Branching plan — one PR per milestone

One long-lived branch would grow into a 44-ticket, 100-plus-file pull request nobody can meaningfully review, defeating the review discipline this system exists to enforce. So each milestone gets its own branch and its own PR.

| # | Branch | Contents | Review checkpoint | Status |
| --- | --- | --- | --- | --- |
| 1 | `docs/final-architecture-v1` | RM-01…RM-05, RM-08, RM-41 + tooling | foundation | ✅ **merged** |
| 2 | `feat/tracer-1-daily-operations` | RM-07 … RM-16 | Tracer 1 proven | ✅ **ready for review** |
| 3 | `feat/context-and-portfolio` | RM-17 … RM-23, RM-42 | Context Vault + portfolio live | next |
| 4 | `feat/microsaas-loop` | RM-25 … RM-28, RM-34 | DuitSini promotion proven | waiting |
| 5 | `feat/domain-loops` | remainder → RM-40 | Full v1.1 readiness | waiting |

Each merge is a point where you review an increment you can actually hold in your head — the same principle as reviewing an Outcome Report instead of raw agent activity.

`main` now holds the merged foundation. Milestone 2 branches from it.

> 💡 **No CI is configured.** `npm run check` currently runs only on my machine, so PR #46 carries my word rather than a green tick. Say *"add CI"* and I will add a GitHub Actions workflow that runs typecheck, tests, build, and audit on every push, so future PRs verify themselves.
