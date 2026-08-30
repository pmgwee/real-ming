# CEO Office

> **Everything that needs Ming personally lives here.** When agent work stops on a blocker, this folder is where the instructions are. Nowhere else.

Whenever `npm run graph:status` prints `BLOCKED ON YOU`, come here.

---

## 🚦 Current status

*As of 2026-08-31 · run `npm run graph:status` for live truth*

| | |
| --- | --- |
| Phase 3 tickets closed | **16 of 44** |
| Startable by an agent right now | **RM-15 (#16)** — in progress, no CEO action needed |
| Waiting on you | **One optional item: the Azure budget alert** |

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

**RM-15 is now agent work.** Built and pushed: credential resolution
(`src/runtime/credential-resolver.ts`, environment first so the vault stays
optional and day 31 is a redeploy), the Key Vault reader via the VM's managed
identity (`src/providers/azure-key-vault-reader.ts`), the durable Telegram
ingress cursor, the two-loop supervisor, and the Google access-token exchange.

Remaining: the production composition root, the deployment artefacts
(container, systemd unit, state on the managed disk, daily backup), and the
opt-in live smoke test.

⚠️ **A scoping finding that belongs in the RM-15 close-out.** No production
composition root exists yet; only `src/config/notion-master-tasks-cutover-cli.ts`
wires real adapters, and it uses refusing `ControlledWorker` / `EffectVerifier`
/ `QuestionResponder` implementations. The control plane follows that pattern,
because the Lenovo private worker is **RM-21**, which is blocked by RM-16. So
capture, review, approvals, the brief, the roll-up and Telegram all work, but
the deployed service cannot yet *execute* a Work Item autonomously. That will be
stated plainly when #16 closes rather than left to look complete.

--- | --- |
| Phase 3 tickets closed | **16 of 44** |
| Startable by an agent right now | **Nothing — RM-15 needs your host choice** |
| Waiting on you | **Azure: budget alert, VM, Key Vault, ten secrets** |

**RM-11 through RM-14 are complete.** Master Tasks is your single writable task system, Google Calendar is the calendar Source of Record, the 07:30 Morning Brief and 21:30 Executive Roll-Up are built, and do-not-disturb, weekend rhythm and error grouping all work.

**RM-15 is the first ticket that needs money and a vendor, so it stops here.** Gate 1 let you defer this and said "by RM-15 at the latest". This is RM-15.

Everything that does not depend on the answer is already built and pushed — the scheduler runs the 07:00 held-notice sweep, the 07:30 brief and the 21:30 roll-up, each claiming its slot durably so a restart cannot double-send. Three of the five acceptance criteria are met. The other two cannot be, because there is nowhere for a timer to live.

**You chose Azure.** Follow [RM-15 — Put Real-Ming on Azure](RM-15-azure-deployment-runbook.md): five steps, and **Step 1 is the budget alert** because your $200 expires in 30 days and then bills your card silently. Steps 2–5 are yours because they spend money and hold credentials; Step 6 is mine.

⚠️ **Unbinding the card on day 31 stops Real-Ming, not just the billing.** The runbook now names that plainly and gives you three honest answers — keep paying (about **RM450-540/month as built**, or about RM50 if resized to a `B1s`, which is all this workload ever needed), migrate to GCP on the RM1,318 you already hold, or accept it only runs when the Lenovo is awake. Your plan is to migrate to Fly.io, Railway, ReadyServer or Hostinger at that point, so the deployment is built portable: a container image, environment variables as the only secret interface, and a tested backup that *is* the migration. ⚠️ When you subscribe, buy a **VPS** plan — shared hosting cannot run a long-lived process or hold SQLite.

That runbook also records why a VM rather than an Azure agent PaaS, and where Azure AI Foundry genuinely does belong later: Real-Ming makes **no model calls at all**, its Executive Roles are governance roles rather than hosted agents, and its append-only guarantees rest on 15 SQLite triggers that want a real local disk.

--- | --- |
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

*Settled:* `RM11-CUTOVER-1` approved 29 Aug 2026, then invalidated the same day by source drift before any write.

*Settled:* [PR #46](https://github.com/pmgwee/real-ming/pull/46) merged into `main` on 2026-08-27 with your approval — the 7 closed tickets plus tooling and baseline.

> ⚠️ GitHub shares one number space between issues and pull requests. `#1` is the spec, `#2`–`#45` are the 44 tickets, and `#46` was the first **pull request** — it continues the same counter. A number alone does not tell you which kind it is.

---

## ✅ What needs you

**Nothing is blocking agent work.** The only item left for you is the Azure
budget alert described in the status board above, and RM-15 proceeds without it.

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

✅ **Tracer 1 is one ticket from proven.** RM-07 through RM-14 are closed, RM-15 is in progress with Azure provisioned, and RM-16 proves the loop end to end.

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
