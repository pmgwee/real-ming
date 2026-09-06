# RM-40 · V6 handoff — continue from milestone 5

Written 6 September 2026 at the end of a Claude Code session. Branch
`codex/rm-40-readiness`, baseline checkpoint HEAD `c65890e`, twelve commits
ahead of the previous checkpoint `16e8bc7`. The continuation below adds deliberately
uncommitted milestone 5–9 implementation/evidence; the last clean checkpoint
had `npm run check` exit 0. Current direct gates are recorded in the newest
milestone evidence files.

The latest controlled regression after the recovery addition is **69 Vitest
files, 813 passed and 2 intentionally skipped**, exit 0; typecheck, production
build, deployment preflight, audit and diff checks also exited 0. No live
provider, cron, Telegram-delivery or Obsidian action was performed by that
regression.

**Nothing is blocking. Continue at milestone 5's remainder.**

## Read these first, in this order

1. `AGENTS.md` — working agreement. Note the **"Where a document belongs"**
   section, which is new and enforced by a test.
2. `CONTEXT.md` — the glossary. Use its vocabulary exactly; the `_Avoid_` terms
   are not synonyms.
3. `docs/BASELINE.md` — design baseline is **Architecture Revision 6**; the
   deployed revision is stated separately and honestly.
4. `docs/adr/0020-run-ming-on-the-native-hermes-runtime.md` — the decision, and
   exactly which clauses of ADR-0019/0014/0018 it supersedes.
5. `docs/planning/RM-40-v6-native-first-implementation-plan.md` — **the
   authoritative sequence.** Its milestone-status table at the top is current.
6. `docs/planning/RM-40-v6-requirement-ledger.md` — every Revision 5 requirement
   with a keep/revise/defer/remove disposition.
7. `docs/planning/RM-40-v6-module-disposition-inventory.md` — measured
   line-by-line fate of `src/`, and the **deletion order**.
8. `docs/agents/notion-task-status-semantics.md` — read before touching any
   Notion status. Non-negotiable.
9. `docs/agents/LESSONS-LEARNED-build-alignment.md` plus the Build Alignment
   skill at `C:/Users/quekm/.codex/skills/build-alignment/SKILL.md` and its
   `references/checkpoints.md`.

Milestone evidence lives in `docs/evidence/RM-40-v6-milestone-{1,2,3,4,5,6,7,8,9}-*.md`.
Read the one for the milestone you are continuing.

## Where things actually stand

| Milestone | State |
| --- | --- |
| 0 · Reconcile requirements | ✅ Complete |
| 1 · Prove the native runtime | ✅ Complete (CLI path). Step 6 folded into milestone 3 |
| 2 · Reversible one-owner migration | ✅ Complete |
| 3 · Activate native Telegram | ✅ Transport live and core phone matrix user-observed accepted; staged progress, attachment handling and semantic recall are recorded |
| 4 · Roles and sources | ✅ Notion + Calendar. **GitHub/Vercel have no credential** |
| 5 · Task, schedule and action contracts | 🔄 **Extension live; scheduler composition implemented; live cron cutover pending** |
| 6 · Native memory, Obsidian, cited knowledge | 🔄 Native config/vault foundation and backup wiring implemented; live note/recall/restore acceptance pending |
| 7 · Private dashboard and CEO outcomes | 🔄 Native Hermes dashboard live-observed privately; authenticated Real-Ming comparison and CEO outcomes review pending |
| 8 · Complete acceptance scenarios | 🔄 Acceptance matrix and controlled regression assembled; live/user acceptance pending |
| 9 · Recovery, readiness, close the milestone | 🔄 Manifest-verified isolated restore and native-state backup coverage controlled-tested; live restore/restart and closeout pending |

### Live system

- Host `real-ming-control-plane-my` (Malaysia West), Tailscale `100.110.253.35`,
  SSH `azureuser@` with `~/.ssh/real_ming_southeastasia_ed25519`. No public SSH
  or dashboard port; keep it that way.
- Hermes v0.21.0, pinned `561b053f794a1781868bb032029d589c67708119`,
  `HERMES_HOME=/var/lib/hermes-real-ming`. **The native gateway owns Telegram**
  (`@MingCreativesBot`), 60 commands registered, Ming's allowlist loaded.
- Model default is now `gpt-5.6-sol` / `openai-codex`. Codex OAuth is healthy —
  **do not re-login.**
- Real-Ming runs image `real-ming:rev6-fb2756a` with
  `REAL_MING_TELEGRAM_OWNERSHIP=native-hermes-gateway`; it polls nothing.
- The Real-Ming extension is registered as MCP server `real-ming` (3 tools,
  enabled) from `/opt/real-ming-extension`.
- A read-only service-account check on 6 September found the native cron
  ticker healthy but **zero scheduled jobs**, and the protected release files
  do not yet contain the native-cron ownership/enablement flags. The fourth
  scheduled-report tool is therefore not exposed on the deployed image; the
  repository manifest and bridge are staged for a deliberate cutover.
- Native memory and the user profile are enabled, but `memory.write_approval`
  remains `false` pending Ming's live policy acceptance. The native state
  directory contains `state.db`, Kanban, cron executions, response/evidence/
  idempotency/project stores, `sessions/sessions.json` and `memories/USER.md`;
  the new backup helper whitelists and checkpoints these without copying
  auth/OAuth/config/cache/log material.
- The native dashboard still answers on loopback `127.0.0.1:9119` through a
  temporary process. The supervised `hermes-dashboard.service` is staged in
  this repository but is not installed/enabled on the host; the Real-Ming
  dashboard remains authenticated on `127.0.0.1:8787`.
- East Asia VM `real-ming-control-plane` is **Stopped (deallocated)** and
  retained for rollback. Do not delete it until milestone 9. Nothing to do in
  Tailscale; leave the device registered.
- Rollback copies on the host: `release.env.pre-rev6`,
  `real-ming.service.pre-rev6`, `config.yaml.pre-rev6`, `.env.pre-rev6`, and
  image `real-ming:phase4-af75e3c`.
- Pre-cutover backup generation `2026-09-06T04-01-39.054Z`.

## Do this next

### 1. Finish milestone 5 — scheduler ownership

The 07:30 brief and 21:30 roll-up are still Real-Ming's. Native cron has **zero
jobs**. The scheduler-ownership slice is now implemented in the repository but
not enabled on the host: the existing builders are split from delivery, native
cron has one authenticated MCP composition operation, scheduler rows carry
owner/run IDs plus replayable output artifacts, and Master Tasks writes carry a
durable source-version check. The next live slice is to stage and verify
exactly two native jobs plus one real Notion read-back, then switch ownership
deliberately. The implementation still splits two things that currently share
one name:

- **Composing** the brief — reconciling commitments, overdue Work Items, pending
  Approvals, incidents across four sources (`morning-brief.ts` 451 lines,
  `executive-roll-up.ts` 303). **Keep.** Hermes cannot invent this.
- **Scheduling and delivering** it — cron, DND 23:00–07:00, weekend rhythm,
  exception grouping, retry (`daily-operations-scheduler.ts` 501,
  `daily-schedule.ts` 123, `exception-notice-rhythm.ts` 343). **Native cron
  should own the trigger.**

Get it wrong in either direction and you either lose the brief's content or end
up with two schedulers firing it twice. Migrate with last-success/run IDs and an
explicit disable-then-enable order, exactly one owner per job, and verify
Asia/Kuala_Lumpur times and no duplicate delivery after a restart.

Also outstanding in milestone 5: live verification of the field/version
boundary, proving the native cron cutover and restart behavior on the Malaysia
host, and binding any newly retained exact-action operation to its immutable
artifact so a stale Approval has no effect. The existing Operations Gateway
approval engine already has controlled stale-target tests.

### 2. Then milestones 6 → 9 in dependency order

Follow the plan. Do not skip ahead; each milestone's pass criterion is written
there.

Milestone 6 now has a controlled foundation: the native memory policy fragment,
an absolute Hermes-owned Obsidian vault separate from the generated CEO
projection, and per-file native-vault/native-state backup coverage. Use
`docs/evidence/RM-40-v6-milestone-6-native-memory-evidence.md` for the live
configuration, note/recall, restart and restore checks. Do not call it complete
until those checks are performed on Malaysia.

Milestone 7 now has a controlled native-gateway dashboard boundary: the
Real-Ming view reports only Hermes reachability/model metadata in native mode;
native session and command details remain in Hermes. Use
`docs/evidence/RM-40-v6-milestone-7-dashboard-evidence.md` for the private
dashboard comparison and CEO-acceptance checks.

Milestone 8 now has an explicit acceptance matrix in
`docs/evidence/RM-40-v6-milestone-8-acceptance-evidence.md`; it records the
controlled evidence already available and keeps every phone/provider/dashboard
check that needs Ming in the CEO queue. Milestone 9 has a controlled restore
boundary in `src/runtime/control-plane-backup.ts`, with evidence in
`docs/evidence/RM-40-v6-milestone-9-recovery-evidence.md`. The backup helper
stages a closed list of native Hermes databases plus session/profile files; it
does not copy auth, OAuth, config, cache or log material. Neither milestone is
called live-verified or accepted until its external checks are performed.

## Rules that were established this session — keep them

### Delete stale code when its replacement is proven, not before and not all at the end

This came up explicitly and Ming agreed the approach. Neither extreme is right:

- **Deleting when you commit the replacement is too early.** At that moment the
  replacement is only *controlled-tested*. This session proved it: milestone 2
  passed five harness scenarios, and the production wiring was still broken
  because a `docker run --env` flag was missing. Deleting `src/telegram/` then
  would have removed the only working path.
- **Deleting everything at the end is too late.** One giant deletion commit is
  unreviewable, cannot carry ten different justifications, and meanwhile the
  stale code keeps costing test maintenance and misleading the next reader.

**The rule: delete per item, when that item's replacement is live-verified and
its rollback window has closed.** One focused commit each, citing the evidence
that made it safe.

The intermediate step that makes this safe is already in place: put the old path
behind a switch defaulting to old behaviour, flip it, prove it live, let it
soak, then delete. `REAL_MING_TELEGRAM_OWNERSHIP` is exactly that switch.

**Deletion order** (from the module inventory):

1. **Native transport is live, but the whole-path deletion trigger is not met.**
   The import-graph check still finds the legacy Telegram/Hermes modules in the
   rollback/default composition, shared Telegram contracts used by retained
   notifications, and the role router used by Master Tasks/calendar/knowledge.
   Do not delete those files yet. First split the shared contracts and remove
   fallback imports in one reviewable follow-up after live scheduler,
   memory and dashboard proof; then delete only the item whose replacement and
   rollback window are verified. This preserves the working default path while
   the native deployment is still partially accepted.
2. After milestone 5 moves the schedule: `providers/telegram-provider-adapter.ts`
   (660).
3. After milestone 6's decision: `src/knowledge/` (3,659), or wire it.
4. After milestone 7's comparison: `src/dashboard/` (1,119).
5. After Revision 6 acceptance: the migration one-offs (2,608) —
   `src/migration/`, the Notion cutover CLIs and legacy readers.

**Documents are the opposite case.** Never delete a superseded document —
relabel it with scope and date. Stale code that nothing calls does nothing; a
stale document misleads the moment it is read. `docs/evidence/` exists so
historical evidence keeps its value without pretending to be current. The
baseline test enforces that the Revision 5 diagram keeps its original label.

### Where a document belongs

`CEO-Office/` is a **queue, not an archive** — only what needs Ming's own hand.
Everything else was moved out this session and a test asserts both halves.

| Put it here | For |
| --- | --- |
| `CEO-Office/` | Runbooks Ming performs, approval packets, credential inventory, the action checklist, the status board |
| `docs/evidence/` | Milestone outcomes, reports, test and audit evidence |
| `docs/planning/` | Implementation plans, ledgers, disposition inventories |
| `docs/architecture/` | Diagrams and architecture/capability reviews |
| `docs/adr/` | Decision records |
| `docs/agents/` | Agent guidance, lessons, handoffs, resume prompts |

The test: is the document asking Ming to *do* something?

### Evidence discipline

Use the separate states — designed, implemented, controlled-tested,
production-wired, live-verified, user-accepted — and never let one stand for
another. Two failures this session came from exactly that gap, and both are
recorded rather than hidden:

- Five green harness tests did not catch a missing `docker run --env` flag.
  There is now a preflight check that scans the composition root for every
  `REAL_MING_*` name it reads and fails the build unless each reaches the
  container or is listed as deliberately undeployed **with a reason**.
- A `timeout=0` Telegram probe returned clean and I wrongly reported no external
  consumer. Only a long-poll `getUpdates` contests the lock. The wrong
  conclusion is left in the evidence document on purpose.

Do not claim a milestone complete on mocked tests. Verify by **exit code**.

## Open items for Ming — none blocking

1. **The core Telegram phone rows are now user-observed.** Ming exercised
   screenshot attachment handling, semantic recall (including after the
   controlled Hermes restart), and staged progress/tool activity during a real
   multi-step request; see
   `docs/evidence/RM-40-v6-telegram-memory-acceptance-2026-09-06.md`. Broader
   V6 coding, dashboard, scheduler and recovery scenarios remain.
2. **GitHub and Vercel read tokens** — neither `real-ming-github-read-token` nor
   `real-ming-vercel-read-token` exists in Key Vault, so Repository Center and
   deployment lineage run against empty strings. Values go straight into Key
   Vault, never into chat.
3. **RM-40 (#41) acceptance criteria** — the open GitHub issue is Revision 5
   shaped. Proposed additional criteria are in the requirement ledger §6.
   **Nothing has been posted to GitHub.** Needs Ming's yes.
4. **Optional curated-knowledge guarantees** — `src/knowledge/` is deferred, not
   removed. Decide in milestone 6 against observed gaps.
5. **A read-only Notion integration**, if Ming wants the agent to browse notes.
   The current token grants write, which is why it was not installed.

## Known trade-off carried forward

Letting the extension read the operations database required a shared group
(`real-ming-data`, `/var/lib/real-ming` at `2770`). That also lets the agent
reach the SQLite file directly with its `file` and `terminal` tools, bypassing
the lifecycle guards the tools enforce. SQLite WAL needs write access even for
readers, so a read-only grant was not available. The real fix is a separate read
projection; it is **not** built. Do not describe this as solved.

## Verification commands

```powershell
git status --short
npm run graph:status
npm run check
npm audit --audit-level=high
git diff --check
```

`npm run check` runs a real browser test and fails rather than skips when
Chromium cannot launch. Install the browser instead of weakening the test.
