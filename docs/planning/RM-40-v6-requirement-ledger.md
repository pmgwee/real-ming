# RM-40 · V6 requirement ledger and live capability inventory

Milestone 0 output. Recorded 6 September 2026 against branch
`codex/rm-40-readiness`, working tree at commit `16e8bc7` plus this change set.

## TL;DR

Every Revision 5 requirement now carries an explicit **keep / revise / defer /
remove** disposition, a named runtime path, and an honest evidence state. The
conflicting baseline labels are resolved: **Architecture Revision 6 is the
design and specification baseline; Revision 5 is the recorded deployed
revision**, and both are enforced by `test/docs/baseline.test.ts`.

Nothing in this milestone changed a production service. The live inventory
below was read read-only over the existing private Tailscale path on
6 September 2026 at 03:14 UTC. No secret value was displayed or copied.

The single largest correction to the previous record: the Malaysia host's
native Hermes gateway currently has **only the `api_server` platform
connected**. There is no native Telegram platform, no MCP server, no cron job
and no enabled plugin. Native memory is enabled but has never been written.
Those subsystems are present and unconfigured — not missing.

## 1. Checkpoint statement

| Build-alignment field | This checkpoint |
| --- | --- |
| Stage | Architecture change during implementation, milestone 0 of the [V6 plan](RM-40-v6-native-first-implementation-plan.md) |
| Authorized scope | Repository reconciliation, read-only live inventory, and preparation of milestone 1 |
| Product contract | Ming, from Telegram and a private dashboard while Lenovo is off, gets a real Hermes agent that converses naturally, runs a genuine coding/tool loop, and links selected work into his existing apps. Unacceptable: role ceremony or a Work Item for ordinary chat; a coding claim without a diff and a test exit status |
| Evidence state of this milestone | Designed and controlled-tested only. Nothing here is production-wired, live-verified or user-accepted |
| Next demonstrable increment | Milestone 1: a real native Hermes session on the Malaysia host reads a disposable fixture repository, edits it, runs its test suite and reports the actual exit status. No Telegram involvement |

## 2. Live deployment inventory · 6 September 2026, 03:14 UTC

Read-only over Tailscale to `azureuser@100.110.253.35`
(`real-ming-control-plane-my`). Values of every secret-shaped key were replaced
with `<redacted>` before display.

### 2.1 Host and services

| Item | Observed |
| --- | --- |
| Host | `real-ming-control-plane-my`, Ubuntu 24.04.4 LTS, up 1 day 9 h |
| Reachability | Tailscale only; `real-ming-malaysia` node, ICMP and TCP/22 reachable; no public SSH or dashboard rule observed |
| `hermes.service` | active, enabled |
| `real-ming.service` | active, enabled |
| `real-ming-backup.timer` | active, enabled |
| `docker.service`, `tailscaled` | active, enabled |
| Container | `real-ming-control-plane` running image `real-ming:phase4-af75e3c`, up 8 h |
| Hermes | Agent v0.21.0 (2026.8.31), install dir `/opt/hermes-agent-561b053f`, install method git, Python 3.11.16, OpenAI SDK 2.24.0 |
| Pinned commit | `561b053f794a1781868bb032029d589c67708119` — matches the recorded pin |

### 2.2 Configuration owners (names only)

| Path | Keys present |
| --- | --- |
| `/etc/real-ming/hermes.env` | `API_SERVER_KEY` |
| `/etc/real-ming/release.env` | `REAL_MING_IMAGE`, `REAL_MING_HERMES_ENABLED`, `REAL_MING_HERMES_BASE_URL`, `REAL_MING_HERMES_MODEL`, `REAL_MING_HERMES_PROVIDER`, `REAL_MING_HERMES_REASONING`, `REAL_MING_HERMES_SESSIONS_PATH`, `REAL_MING_OBSIDIAN_DIRECTORY`, `REAL_MING_OBSIDIAN_ROOTS` |

`deploy/systemd/hermes.service` runs `hermes gateway run --external-supervisor
--quiet` bound to `127.0.0.1:8642` with `ReadWritePaths=/var/lib/hermes-real-ming`
only. **Coding workspaces outside that path are not writable by the service
account under systemd confinement** — milestone 1 must either place workspaces
inside the state directory or extend `ReadWritePaths` deliberately.

### 2.3 Native gateway state — the decisive finding

`gateway_state.json` at inspection:

```json
{"gateway_state":"running","active_agents":0,
 "platforms":{"api_server":{"state":"connected", ...}},
 "session_store":{"status":"ok"},
 "code_sha":"561b053f...","code_version":"0.21.0"}
```

`gateway:` in `config.yaml` is **empty**. The only connected platform is
`api_server`. This is the Revision 5 bridge exactly as designed: Real-Ming owns
Telegram polling, Hermes exposes an authenticated local API. It also means
**enabling the native Telegram platform is a configuration step on an already
running gateway**, not an install.

### 2.4 Native capability inventory

| Capability | Present | Enabled / configured | Notes |
| --- | --- | --- | --- |
| Messaging gateway (`hermes gateway`) | Yes | Partly — `api_server` only | `platform_toolsets` already declares `telegram: [hermes-telegram]` |
| Agent loop, tools, toolsets | Yes | Yes | `agent.max_turns: 500`, `reasoning_effort: medium` |
| Skills | Yes | Bundled set installed | 12 skill families incl. `note-taking/obsidian` and `research/llm-wiki` |
| Plugins | Yes | **None enabled** — all bundled entries show `not enabled` | |
| MCP | Yes | **No servers configured** | |
| Cron | Yes | **No scheduled jobs** | |
| Kanban | Yes | `kanban.db` initialised, `review_dispatch: true` | Durable SQLite board |
| Memory | Yes | `memory_enabled: true`, `user_profile_enabled: true` | `memories/` directory is **empty** — never written |
| Sessions / state | Yes | `state.db` 532 KB, WAL | `sessions/` directory empty; sessions live in `state.db` |
| Dashboard (`hermes dashboard`/`serve`) | Yes | Not evaluated | Milestone 7 |
| Provider auth | Yes | `openai-codex`: 1 OAuth credential, device_code | Codex OAuth intact; **no re-login required** |
| Response store / idempotency | Yes | `response_store.db`, `runs_idempotency.db` present | Native replay protection exists |

**Model configuration conflict.** `config.yaml` sets
`model.default: anthropic/claude-opus-4.6` with `base_url:
https://openrouter.ai/api/v1`, while the only pooled credential is
`openai-codex` OAuth and the Revision 5 bridge overrides model/provider
per session through `REAL_MING_HERMES_*`. A native gateway session started
today would therefore use a default the host is probably not authenticated
for. **Milestone 1 must set the native default explicitly through protected
configuration before any native Telegram traffic.** This is a new finding; it
was masked by the bridge always passing an override.

### 2.5 Retained Real-Ming state

`/var/lib/real-ming`: `state.sqlite` (4.5 MB + 4.1 MB WAL),
`notion-write-ledger.sqlite`, `hermes.sqlite` (bridge session mapping),
`state.sqlite.deployment-candidates.sqlite`,
`state.sqlite.deployment-promotions.sqlite`, `backups/`, `migration/`.
`obsidian/` exists and is **empty**, confirming the recorded Knowledge
Operations activation gap.

## 3. Baseline label resolution

Three labels were in conflict.

| Artifact | Was | Now |
| --- | --- | --- |
| `AGENTS.md` "Baseline" section | "Architecture Revision 3 … both v3 diagrams" — stale by two revisions, and the v3 diagrams no longer exist in `docs/architecture/` | Revision 6 design baseline, with the historical-label rule stated |
| `docs/BASELINE.md` | "Architecture Revision 5", V6 named only as a "latest design target" | Revision 6 is the design/specification baseline; Revision 5 is recorded as the deployed revision |
| `docs/architecture/real-ming-agent-diagram-v6.html` | No `real-ming-baseline` meta | Stamped `Real-Ming v1.1 · Architecture Revision 6` |
| `real-ming-phase3-tickets.json` `architectureDecision` | "Architecture Revision 5: Hermes-first … governed Real-Ming Telegram ingress" | Revision 6 wording; ticket count and structure unchanged |
| `test/docs/baseline.test.ts` | Enforced the Revision 5 label on the V5 diagram only | Enforces the Revision 6 label on `BASELINE.md`, the spec and the V6 diagram **and** preserves the Revision 5 label on the retained V5 diagram |

The rule going forward: **the baseline label tracks the authoritative design
revision of the specification set. The deployed revision is a separate,
explicitly stated row.** They are allowed to differ, and today they do. The
V5 diagram, its render and its recorded label are preserved as historical
evidence, not rewritten.

## 4. Requirement ledger

Disposition key: **Keep** unchanged · **Revise** under ADR-0020 · **Defer**
with an explicit trigger · **Remove** by decision.

Evidence key follows the lessons document: Designed · Implemented ·
Controlled-tested · Production-wired · Live-verified · User-accepted.

### 4.1 Conversation, transport and roles

| ID | Requirement (spec clause) | Disposition | Revision 6 runtime path | Evidence state | Next proof |
| --- | --- | --- | --- | --- | --- |
| V6-CHAT-1 | One private Telegram bot, CEO-allowlisted numeric identity only | **Keep** | Native gateway Telegram platform + allowlist config | Live-verified at R5 (bridge); **not wired** natively | Milestone 3 cutover |
| V6-CHAT-2 | Telegram is the primary command surface; dashboard shares identity/policy | **Keep** | Native gateway + native dashboard, private binding | Controlled-tested at R5 | Milestone 3 / 7 |
| V6-CHAT-3 | Real-Ming ingress owns Telegram polling | **Revise → Remove** | Native gateway is the sole consumer (ADR-0020) | R5 production-wired; superseded | Milestone 2 composition-mode split |
| V6-CHAT-4 | Mandatory JSON Turn Plan per turn | **Remove** | No turn envelope; structured args on real tool calls only | R5 controlled-tested; superseded | Milestone 2 harness proof: no envelope on ordinary chat |
| V6-CHAT-5 | Native presentation: typing, Telegram-safe formatting, progress, attachments, cancellation | **Keep (newly explicit)** | Native gateway rendering | **Failed** at R5 smoke, 5 Sep | Milestone 1 baseline matrix, milestone 3 phone matrix |
| V6-CHAT-6 | Only actionable work creates a Work Item; questions do not | **Keep** | Hermes decides; Real-Ming tool optional | Controlled-tested at R5 | Milestone 2 harness: zero Work Items for ordinary chat |
| V6-ROLE-1 | Five bounded Executive Roles, each reporting to the CEO; COO default router | **Keep** | Ming skill pack, one playbook per role | Controlled-tested at R5 | Milestone 4 role scenarios |
| V6-ROLE-2 | Explicit role addressing (`CTO: …`) selects the named role | **Revise** | Hermes interprets the prefix conversationally; legacy action parser retired | **Defect** at R5: prefix bypassed Hermes entirely | Milestone 2 harness: role-prefixed chat reaches the agent |
| V6-ROLE-3 | Role definitions are durable policy records with allowed Trust Domains and Standing Authority | **Revise** | Playbook expresses behaviour; enforcement moves to narrowed credentials and tested tool boundaries — a skill is not access control | Controlled-tested at R5 as records | Milestone 5 enforcement proof per affected path |
| V6-ROLE-4 | One Accountable Executive per Work Item; Collaborators cannot complete it | **Keep** | Retained Real-Ming lifecycle, reached as a tool | Controlled-tested | Milestone 5 |

### 4.2 Execution, work and sources

| ID | Requirement | Disposition | Revision 6 runtime path | Evidence state | Next proof |
| --- | --- | --- | --- | --- | --- |
| V6-CODE-1 | Agent reads a repository, implements, tests, iterates (DuitSini tracer) | **Keep — never proven** | Native Hermes tools/workspace/terminal | **Not proven.** The only R5 coding test asserts `workspace.read` **denial** | **Milestone 1** — the next increment |
| V6-CODE-2 | Bounded task branch, draft PR, preview verification, Deployment Candidate, exact-commit Approval | **Keep** | Native git tooling + retained candidate/promotion records | Controlled-tested at R5; `deployment-candidates.sqlite` present | Milestone 8 |
| V6-CODE-3 | No direct production push or deploy-latest | **Keep** | Unchanged | Controlled-tested | — |
| V6-TASK-1 | Master Tasks is the canonical Notion source; six linked Work Views | **Keep** | Retained `notion-provider-adapter.ts` behind a native tool | Live-verified at R5 (cutover completed); version-aware write boundary controlled-tested in V6 | Milestone 5 live read-back after migration |
| V6-TASK-2 | Legacy status semantics: Pending=Captured, To Do=Planned, Issues=Waiting/Blocked, Pending to Review=Ready for CEO Review, Done=Completed | **Keep** | `docs/agents/notion-task-status-semantics.md` plus explicit field-authority map | Live-verified at R5; V6 authority/replay controls controlled-tested | Milestone 5 live field-by-field read-back |
| V6-TASK-3 | Native durable execution tasks | **New** | Native Kanban, linked to Work Items by stable ID | Present, unused | Milestone 5 |
| V6-DAILY-1 | 07:30 brief, 21:30 roll-up, DND 23:00–07:00, lighter weekends, Asia/Kuala_Lumpur | **Keep** | Native cron, one owner per job | V6 composition/replay boundary controlled-tested; **no native cron jobs exist** | Milestone 5 live cutover |
| V6-DAILY-2 | Google Calendar is the calendar Source of Record | **Keep** | Retained `calendar-reconciliation.ts` | Live-verified at R5 | Milestone 4 |
| V6-SRC-* | Notion, Calendar, GitHub, Vercel, Agent Brain, personal/opportunity mail, academic (M365/Teams/Canvas read-only, submission excluded), content workflow, career files, DuitSini, Moomoo/Money Manager exports | **Keep, per-source disposition required** | Native skill/CLI/MCP first, then retained adapters | Mixed; adapters controlled-tested at R5 | Milestone 4 — one row per source with authorization, real read, freshness, failure |
| V6-SRC-MOOMOO | Direct OpenD connectivity excluded in v1 | **Keep (exclusion)** | — | — | — |
| V6-FIN-1 | No Money Movement or brokerage trading capability exists | **Keep** | Unchanged; no grantable capability | Controlled-tested | Milestone 5 re-proof on the native path |
| V6-FIN-2 | Immutable dated Financial Snapshots; CFO validates, CTO builds, CEO approves | **Keep** | Retained `financial-snapshot.ts` (SQLite-backed) | Implemented + controlled-tested; **live workflow binding unproven** | Milestone 5 |
| V6-ACAD-1 | Submission, impersonation and unsupervised academic communication excluded | **Keep (exclusion)** | Narrow credentials, not a prompt rule | Controlled-tested | Milestone 5 enforcement proof |

### 4.3 Knowledge, memory and approvals

| ID | Requirement | Disposition | Revision 6 runtime path | Evidence state | Next proof |
| --- | --- | --- | --- | --- | --- |
| V6-MEM-1 | Hermes native memory is bounded Hot Runtime Memory, writes require Approval | **Revise** | Native memory is first-class under the ADR-0020 memory policy | R5 policy; native memory enabled but **empty** | Milestone 6 |
| V6-KNOW-1 | Persistent cited knowledge, Obsidian-readable, survives restart | **Keep** | Native `note-taking/obsidian` + `research/llm-wiki` skills, absolute Azure vault path | **Not achieved.** `/var/lib/real-ming/obsidian` is empty; production CLI never enabled Knowledge Operations | Milestone 6 |
| V6-KNOW-2 | Candidate Envelope provenance, contradiction quarantine, atomic versioned publication, `index.md`, append-only `log.md`, linting | **Defer as optional stronger guarantee** | Retained compiler/broker/materializer, activated only for a path that needs it | Controlled-tested; **never production-wired** | Milestone 6 step 7 — explicit per-guarantee decision |
| V6-KNOW-3 | Trust-Domain roots + CEO Approved-Projection root; roles get scoped views | **Defer with the above** | Same | Controlled-tested | Milestone 6 |
| V6-KNOW-4 | Compiled Knowledge may never write a Source of Record or rewrite Agent Brain evidence | **Keep** | Unchanged | Controlled-tested | — |
| V6-APPR-1 | Exact, artifact-bound Approval; changed target invalidates it; scopes cannot be bundled | **Keep** | Retained approval records bound to immutable version | Controlled-tested | Milestone 5 — prove stale/denied approval has no effect on the native path |
| V6-APPR-2 | Sensitive Secrets never enter agent context, logs or Git | **Keep** | `npm run check` secret scan + protected stores | Controlled-tested and enforced in CI | — |
| V6-RET-1 | 30-day raw staging purge, 12-month superseded projections, indefinite snapshots/approvals/outcomes/audit | **Keep** | Retained retention policy | Controlled-tested | Milestone 9 |

### 4.4 Operations, dashboard and recovery

| ID | Requirement | Disposition | Revision 6 runtime path | Evidence state | Next proof |
| --- | --- | --- | --- | --- | --- |
| V6-CEO-1 | Authenticated private dashboard: overview, Work Views, Approvals, Outcome Reports, portfolio, GitHub/Git/Vercel, health, cost, scheduler, audit | **Keep, delivery revised** | Native dashboard first; add only the missing CEO cross-app views, preferring the extension SDK | R5 dashboard live-verified over the private tunnel | Milestone 7 |
| V6-CEO-2 | Dashboard is a read model, never a second work database | **Keep** | Unchanged | Controlled-tested | — |
| V6-OPS-1 | Always-on Azure operation while Lenovo is off; Lenovo worker optional | **Keep** | Unchanged | Live-verified | Milestone 8 laptop-off scenario |
| V6-OPS-2 | Private networking only; no public SSH or dashboard port | **Keep** | Unchanged; confirmed today | Live-verified 6 Sep | — |
| V6-OPS-3 | RM250 global monthly Metered Platform Cost cap; subscriptions stay in DuitSini | **Keep** | Retained cost policy | Controlled-tested | Milestone 9 |
| V6-OPS-4 | Scheduler Heartbeats, grouped exceptions, one notice on recovery | **Keep** | Native cron state + retained heartbeat monitor, one owner per job | Controlled-tested | Milestone 5 |
| V6-OPS-5 | Complete post-migration recovery: backup, restore, integrity, continuity | **Keep, scope widened** | Backup manifest must add native state (`state.db`, `kanban.db`, `memories/`, vault, `response_store.db`, `runs_idempotency.db`) | R5 restore live-verified; **native state not covered** | Milestone 9 |
| V6-OPS-6 | East Asia VM deallocated but retained for rollback | **Keep** | — | Services stopped; **deallocation outstanding** | Milestone 9 step 8 |

### 4.5 Testing contract

| ID | Requirement | Disposition | Note |
| --- | --- | --- | --- |
| V6-TEST-1 | Exactly two seams: Real-Ming System Harness and Provider Adapter Contract Harness | **Keep** | New Revision 6 behaviour is proven through these seams, not a third seam |
| V6-TEST-2 | No default test may use a credential, contact a provider, spend quota or touch production data | **Keep** | Enforced by `npm run check` |
| V6-TEST-3 | Live smoke tests are opt-in behind an explicit flag plus supplied credentials | **Keep** | Native/live evidence is recorded separately from harness evidence |
| V6-TEST-4 | Browser-level dashboard checks | **Keep** | Chromium must launch; a skip is a failure by design |

## 5. Requirements that changed meaning — read this before writing code

Four Revision 5 statements are now **wrong** and will mislead an implementer
who reads only the spec:

1. Real-Ming does **not** own the Telegram poller in Revision 6.
2. There is **no** mandatory JSON Turn Plan.
3. Role prefixes are **not** parsed by a legacy action parser.
4. Native memory is **not** restricted to a tiny Approval-gated cache.

The affected spec clauses have been revised in place and the delta is recorded
in the specification's "Architecture Revision 6 composition delta" subsection
and in [ADR-0020](../adr/0020-run-ming-on-the-native-hermes-runtime.md).

## 6. Ticket-graph reconciliation

`npm run graph:status` on 6 September 2026 reports **43 completed, 1
ready-for-agent**, selecting **RM-40 (#41) "Prove full Real-Ming v1.1
readiness"**. That is the correct node; it is the only unblocked work.

Its acceptance criteria on GitHub are written for the Revision 5 composition:
they require harness, knowledge, adapter and browser evidence but contain **no
criterion for native Telegram ownership, native presentation, a real coding
loop, or native memory/knowledge**. Passing them as written would repeat
exactly the failure the lessons document describes.

Proposed revision to #41's acceptance criteria — **CEO decision 1**, not yet
posted:

- Retain all six existing criteria as the controlled-test and privacy floor.
- Add: the native Hermes gateway is the single Telegram consumer for the bot,
  proven by a stopped old consumer and a correlated native session.
- Add: a real coding scenario produces a diff, an executed test command and its
  actual exit status, captured as evidence.
- Add: ordinary conversation produces a native reply with **zero** new Work
  Items and no role-selection ceremony.
- Add: native memory or vault content survives a service restart and is
  retrievable in a later session.
- Add: a post-migration backup restores native state to an isolated
  destination with messaging, schedules and provider writes disabled.

No GitHub issue was edited or commented on during milestone 0.

## 7. Milestone 1 scope, prepared

**Goal:** prove the native Hermes runtime performs a real bounded tool loop on
the Malaysia host, before any Telegram change.

| Item | Decision |
| --- | --- |
| Where | Malaysia host, existing `HERMES_HOME=/var/lib/hermes-real-ming` (holds the Codex OAuth credential — no re-login) |
| Workspace | A disposable fixture repository under the Hermes state directory, so the systemd `ReadWritePaths` confinement is respected without widening it |
| Telegram | **Untouched.** No second consumer, no bot token used |
| Model | Must be passed explicitly, because the config default points at OpenRouter while the only credential is `openai-codex` (finding 2.4) |
| Pass | A real diff, a real test command, its real exit status, and a follow-up turn that retains context |
| Fail | Any answer asserting capability without an artifact |
| Rollback | Delete the fixture directory; no service, config or production state is modified |

## 8. Open items for the CEO

1. **Decision 1 — RM-40 (#41) acceptance criteria.** Section 6 proposes adding
   five native-experience criteria. Recommendation: approve, and let me post
   the revision as an issue comment before milestone 3.
2. **Decision 2 — optional curated-knowledge guarantees.** V6-KNOW-2/3 are
   currently deferred. If versioned atomic publication, contradiction
   quarantine or access-controlled cross-domain projection still matter, the
   existing compiler must be wired to a real caller in milestone 6.
   Recommendation: defer until native Obsidian/Wiki knowledge is proven useful,
   then decide against observed gaps rather than in advance.
3. **Decision 3 — Telegram cutover window.** Milestone 3 stops the Real-Ming
   consumer and starts the native gateway on the same bot. Not requested yet;
   it will be requested with a concrete candidate, checks, expected effects and
   rollback.

No blocker prevents milestone 1. Access, credentials and authorization for it
are already in place.
