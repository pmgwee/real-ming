# CEO Office

> **Everything that needs Ming personally lives here.** When agent work stops on a blocker, this folder is where the instructions are. Nowhere else.

Whenever `npm run graph:status` prints `BLOCKED ON YOU`, come here.

---

## 🚦 Current status

*As of 2026-08-27 · run `npm run graph:status` for live truth*

| | |
| --- | --- |
| Phase 3 tickets closed | **7 of 44** |
| Startable by an agent right now | **0** |
| Waiting on you | **2 gates** |

**Agent work is fully stopped.** Every one of the 37 remaining tickets traces back to the two gates below. Nothing else can start until at least one is closed.

---

## 🔀 Decisions awaiting you

| Decision | What it is | Recommendation |
| --- | --- | --- |
| Merge [PR #46](https://github.com/pmgwee/real-ming/pull/46) into `main` | The 7 closed tickets plus tooling and baseline — 17 commits, 65 files. Full review packet in the PR body. `MERGEABLE`, no conflicts. | **Merge it before restarting the loop.** See [Branching](#-branching-why-to-merge-before-restarting) below. |

> ⚠️ GitHub shares one number space between issues and pull requests. `#1` is the spec, `#2`–`#45` are the 44 tickets, and `#46` is the first **pull request** — it continues the same counter. A number alone does not tell you which kind it is.

---

## ✅ What needs you

| Priority | Gate | Unblocks | Runbook | Time |
| --- | --- | --- | --- | --- |
| **1 — do this first** | RM-06 · provision identities and secrets · [#7](https://github.com/pmgwee/real-ming/issues/7) | **36 tickets** | [GATE-1-provisioning-runbook.md](GATE-1-provisioning-runbook.md) | ~45 min |
| 2 — can wait | RM-24 · choose the DuitSini pilot update · [#25](https://github.com/pmgwee/real-ming/issues/25) | 5 tickets | [GATE-2-pilot-selection-runbook.md](GATE-2-pilot-selection-runbook.md) | ~20 min thinking |

**Gate 1 is the whole bottleneck.** Gate 2 blocks only the DuitSini promotion chain and is not needed until late — you can leave it until the rest is built.

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

## 🌿 Branching: why to merge before restarting

The branch `docs/final-architecture-v1` started as a documentation branch and became the implementation branch. That is now a misnomer, and leaving one long-lived branch open has a cost:

**If PR #46 stays open while the loop continues**, every new ticket lands on the same branch and the same PR. By RM-40 it would be a 44-ticket, 100-plus-file pull request that cannot be meaningfully reviewed. That defeats the review discipline this whole system is built around.

**Recommended instead — one PR per milestone:**

| # | Branch | Contents | Review checkpoint |
| --- | --- | --- | --- |
| 1 | `docs/final-architecture-v1` → merge now | RM-01…RM-05, RM-08, RM-41 + tooling | ✅ ready, [PR #46](https://github.com/pmgwee/real-ming/pull/46) |
| 2 | `feat/tracer-1-daily-operations` | RM-07 … RM-16 | Tracer 1 proven |
| 3 | `feat/context-and-portfolio` | RM-17 … RM-23, RM-42 | Context Vault + portfolio live |
| 4 | `feat/microsaas-loop` | RM-25 … RM-28, RM-34 | DuitSini promotion proven |
| 5 | `feat/domain-loops` | remainder → RM-40 | Full v1.1 readiness |

Each merge is a natural point for you to review an increment you can actually hold in your head — the same principle as reviewing an Outcome Report instead of raw agent activity.

**Order of operations:** merge #46 → clear Gate 1 → restart the loop on a new branch.

Merging is entirely your call; nothing breaks if you leave it open. But the review burden compounds.

> 💡 **No CI is configured.** `npm run check` currently runs only on my machine, so PR #46 carries my word rather than a green tick. Say *"add CI"* and I will add a GitHub Actions workflow that runs typecheck, tests, build, and audit on every push, so future PRs verify themselves.
