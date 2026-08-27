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

## 🔍 Also awaiting your decision

[PR #46](https://github.com/pmgwee/real-ming/pull/46) into `main` carries the full review packet for the seven closed tickets. It is **unmerged** and stays that way until you approve it. Reviewing it is not required to continue the loop.
