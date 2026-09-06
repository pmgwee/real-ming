# RM-40 · Module-by-module disposition of `src/` under Architecture Revision 6

Measured 6 September 2026 against `fb2756a`. **34,889 lines of TypeScript across
16 modules.** Every line count below is `wc -l`, not an estimate.

## Correction to what I told the CEO

In conversation I said "most of `src/` does not survive V6." **That was wrong,
and the measurement contradicts it.** The transport and bridge layer that
native Hermes genuinely replaces is about **10%** of the code. Roughly two
thirds of `src/` is domain logic, durable records, provider adapters and tests
that Hermes has no equivalent for and that Revision 6 keeps unchanged.

The honest summary is the opposite of what I said: **V6 deletes a thin, very
visible layer and keeps the substance.**

| Disposition | Lines | Share |
| --- | ---: | ---: |
| **Keep** — fills a gap native Hermes cannot | 23,398 | 67% |
| **Retire after the cutover proves the replacement** | 3,478 | 10% |
| **Evaluate at milestones 6–7** — may go, may stay | 5,405 | 15% |
| **Archive** — one-off migrations that already ran | 2,608 | 7% |

## Retire — 3,478 lines, 10%

Native Hermes replaces these outright. They stay in the tree until the cutover
proves the replacement works, then they go in one reviewable deletion.

| Path | Lines | Replaced by |
| --- | ---: | --- |
| `src/telegram/` | 1,496 | Native gateway. Includes the legacy action parser that caused the 5 September `CTO:` bypass |
| `src/hermes/` | 1,183 | Nothing. This is the *bridge* to Hermes — the runtime client, turn coordinator and session store. When Hermes owns the conversation there is nothing left to bridge |
| `src/providers/telegram-provider-adapter.ts` | 660 | Native transport. Retires after milestone 5, not milestone 3 — it still delivers the 07:30 brief until native cron takes over |
| `src/runtime/telegram-ingress.ts` | 55 | Native gateway |
| `src/operations/executive-role-router.ts` | 52 | Ming role playbooks; Hermes interprets the perspective |
| `src/operations/command-classifier.ts` | 32 | Hermes decides what a message is |

Plus the poller wiring already made optional inside
`daily-operations-control-plane.ts` and `production-control-plane.ts` — those
files survive, shrunken.

## Keep — 23,398 lines, 67%

Hermes has no idea about any of this. It is the reason Real-Ming exists at all
under Revision 6.

| Path | Lines | The gap it fills |
| --- | ---: | --- |
| `src/operations/operations-state.ts` | 3,510 | The durable SQLite record: Work Items, Approvals, audit, health, ledgers. The backbone |
| `src/testing/` | 4,373 | The two approved seams. How anything here gets proven |
| `src/providers/` (minus Telegram, minus migration readers) | 3,932 | Notion, Calendar, GitHub, Git, Vercel, DuitSini, M365, Canvas, Gmail, Key Vault, Blob — with contract behaviour: idempotent writes, provenance, `as of`, retry classification, secret-safe errors |
| `src/portfolio/` | 1,580 | Project Portfolio, Deployment Candidate, Deployment Promotion. "Exact commit, checks passed, preview verified" is a Real-Ming concept |
| `src/operations/operations-gateway.ts` | 817 | The validated entry point. Under V6 it becomes the tool surface rather than the chat surface — reshaped, not deleted |
| `src/operations/` financial set | 826 | Snapshot immutability, reconciliation, Record Change vs Money Movement |
| `src/config/` (credentials, preflight, secrets) | 753 | Credential resolution, deployment preflight, the secret inventory |
| `src/operations/contracts.ts` | 471 | The shared vocabulary every module agrees on |
| `src/operations/` domain coordinators | 936 | Academic, career, content workflow, evidence enablement |
| `src/operations/metered-cost.ts` | 364 | The RM250 cap, and keeping subscriptions out of metered analytics |
| `src/evidence/` | 340 | Evidence Broker — role-scoped cited Agent Brain access |
| `src/calendar/` | 244 | Calendar reconciliation rules. Hermes can *read* a calendar; it does not know how to reconcile one against commitments |
| `src/master-tasks/` | 229 | Master Tasks projection |
| `src/operations/` policy, lifecycle, retention, secret guard | 492 | Artifact-bound Approval, lifecycle guards, retention classes, Sensitive Secret detection |
| `src/runtime/` backup, credentials, preflight, smoke | 531 | Recovery and startup safety |

The single most valuable file is `src/providers/notion-provider-adapter.ts`
(1,044 lines). It encodes that `Pending` means Captured and `Pending to Review`
means Ready for CEO Review rather than Completed, and its write ledger stops a
retry creating a duplicate page. No native feature knows the CEO's status
vocabulary.

## Evaluate at milestones 6–7 — 5,405 lines, 15%

Genuinely undecided. Deciding now would be guessing.

| Path | Lines | The question |
| --- | ---: | --- |
| `src/knowledge/` | 3,659 | CEO decision 2. Native Obsidian + LLM Wiki cover the default case. These 3,659 lines buy versioned atomic publication, contradiction quarantine, provenance validation and scoped cross-domain projection — none of it ever production-wired. Decide against observed gaps in milestone 6 |
| `src/dashboard/` | 1,119 | Milestone 7. The native dashboard plus a small extension tab may be enough |
| `src/workers/` | 627 | The Lenovo private worker. Native delegation and terminal may cover it |

## Archive — 2,608 lines, 7%

These ran once, succeeded, and will not run again. They are history, not
maintenance: the Master Tasks cutover completed in RM-11.

| Path | Lines |
| --- | ---: |
| `src/migration/` | 1,583 |
| `src/config/notion-master-tasks-cutover-cli.ts` | 357 |
| `src/providers/notion-cutover-workspace.ts` | 337 |
| `src/providers/notion-legacy-task-reader.ts` | 166 |
| `src/config/notion-task-migration-rehearsal-cli.ts` | 77 |
| `src/config/notion-master-tasks-cli.ts` | 87 |

Recommendation: leave them until Revision 6 is accepted, then remove in a
separate commit. Git preserves them; the tree does not need to.

## The one that needs a real decision, not a rule

The daily brief and roll-up are **two different things wearing one name**:

| Part | Lines | Under V6 |
| --- | ---: | --- |
| *Composing* the brief — reconciling commitments, overdue Work Items, pending Approvals, incidents, Proposed Commitments | `morning-brief.ts` 451 + `executive-roll-up.ts` 303 | **Keep.** This is domain logic across four sources. Hermes cannot invent it |
| *Scheduling and delivering* it — cron, DND windows, weekend rhythm, exception grouping, retry | `daily-operations-scheduler.ts` 501 + `daily-schedule.ts` 123 + `exception-notice-rhythm.ts` 343 | **Native cron takes the trigger.** The composer becomes a tool the scheduled job calls |

Splitting those is milestone 5's real work. Getting it wrong in either direction
either loses the brief's content or leaves two schedulers firing it twice.

## Deletion order, once the cutover proves the replacement

1. After milestone 3 passes the phone matrix: `src/telegram/`, `src/hermes/`,
   `telegram-ingress.ts`, the role router and command classifier.
2. After milestone 5 moves the schedule: `telegram-provider-adapter.ts`.
3. After milestone 6's decision: `src/knowledge/`, or keep it and wire it.
4. After milestone 7's comparison: `src/dashboard/`, or keep a thin read model
   behind an extension tab.
5. After Revision 6 acceptance: the archive set.

Nothing is deleted before its replacement is proven live. That ordering is the
whole reason the Revision 5 code still runs today.
