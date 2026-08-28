# CEO Office

> **Everything that needs Ming personally lives here.** When agent work stops on a blocker, this folder is where the instructions are. Nowhere else.

Whenever `npm run graph:status` prints `BLOCKED ON YOU`, come here.

---

## 🚦 Current status

*As of 2026-08-28 · run `npm run graph:status` for live truth*

| | |
| --- | --- |
| Phase 3 tickets closed | **9 of 44** |
| Startable by an agent right now | **2** |
| Waiting on you | **nothing** |

**Both gates are closed, so agent work is unblocked.** The scheduler names `RM-07 · Operate the private Telegram front door` as next.

---

## 🔀 Decisions awaiting you

**None open.** Anything needing a yes/no from you appears here with a recommendation — a pull request, a vendor choice, an architecture change. You should never have to discover one yourself.

*Settled:* [PR #46](https://github.com/pmgwee/real-ming/pull/46) merged into `main` on 2026-08-27 with your approval — the 7 closed tickets plus tooling and baseline.

> ⚠️ GitHub shares one number space between issues and pull requests. `#1` is the spec, `#2`–`#45` are the 44 tickets, and `#46` was the first **pull request** — it continues the same counter. A number alone does not tell you which kind it is.

---

## ✅ What needs you

**Nothing right now.** Both gates are closed:

| Gate | Closed | Outcome |
| --- | --- | --- |
| RM-06 · identities and secrets · [#7](https://github.com/pmgwee/real-ming/issues/7) | ✅ 28 Aug 2026 | 9/9 provisioned, TC-01 to TC-05 all pass. Control plane runs locally; always-on host deferred to RM-15. |
| RM-24 · DuitSini pilot update · [#25](https://github.com/pmgwee/real-ming/issues/25) | ✅ 28 Aug 2026 | Add OpenCode and CommandCode provider presets. Code change plus a Supabase migration, so two separate Approvals. |

Two things will come back to you mid-flight, both by design:

- **RM-09** needs one Notion page shared with the `Real-Ming` connection, so it has somewhere to create Master Tasks. About a minute; it will ask.
- **RM-11** needs a CEO-accepted status for every active item across your five legacy Notion task databases, plus Approval of the cutover plan before anything is mutated. That is a working session, not a rubber stamp.

The runbooks stay as the record of what was done: [Gate 1](GATE-1-provisioning-runbook.md) · [Gate 2](GATE-2-pilot-selection-runbook.md).

---

## ▶️ How to restart agent work

1. Finish a runbook above and close its GitHub issue.
2. Run `npm run graph:status` — it should now name a real next ticket.
3. Open [RESUME-PROMPT.md](RESUME-PROMPT.md), copy the whole block, paste it to Claude.

Nothing needs restarting or re-explaining. The scheduler reconciles against live GitHub, so a closed issue is all it takes.

---

## 📍 What happens after Gate 1

Closing RM-06 alone releases 31 tickets. The first seven are a **narrow sequential chain** — this is Tracer 1, the Daily Operations Loop:

```
RM-07, RM-09  →  RM-10, RM-12  →  RM-11 ⚠️  →  RM-13  →  RM-14  →  RM-15  →  RM-16 🎉
Telegram +       migration        needs YOU     07:30     evening   always-on  TRACER
Master Tasks     rehearsal        again         brief     roll-up   env        PROVEN
```

After RM-16 the graph fans out hard — 4, then 5, then 9 tickets per wave. **RM-16 is the milestone worth aiming for.**

⚠️ **RM-11 will need you mid-flight.** It requires a CEO-accepted status for every active item across your five real Notion task databases, plus Approval of the cutover plan *before* anything is mutated. That is a working session, not a rubber stamp.

---

## 🗂 What is in this folder

| File | What it is |
| --- | --- |
| [README.md](README.md) | This status board — start here |
| [RESUME-PROMPT.md](RESUME-PROMPT.md) | The prompt to paste to restart the graph loop |
| [GATE-1-provisioning-runbook.md](GATE-1-provisioning-runbook.md) | Step-by-step: create identities, store secrets, verify |
| [GATE-2-pilot-selection-runbook.md](GATE-2-pilot-selection-runbook.md) | Step-by-step: choose and capture the DuitSini pilot |
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
