# RM-40 · V6 handoff — continue from milestone 5

Written 6 September 2026 at the end of a Claude Code session. Branch
`codex/rm-40-readiness`, HEAD `17d67c5`, nine commits ahead of the previous
checkpoint `16e8bc7`. Working tree clean, `npm run check` exit 0 (801 passed,
2 skipped), `npm audit --audit-level=high` exit 0.

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

Milestone evidence lives in `docs/evidence/RM-40-v6-milestone-{1,2,3,4,5}-*.md`.
Read the one for the milestone you are continuing.

## Where things actually stand

| Milestone | State |
| --- | --- |
| 0 · Reconcile requirements | ✅ Complete |
| 1 · Prove the native runtime | ✅ Complete (CLI path). Step 6 folded into milestone 3 |
| 2 · Reversible one-owner migration | ✅ Complete |
| 3 · Activate native Telegram | ✅ Transport live and mostly accepted. **3 phone rows untested** |
| 4 · Roles and sources | ✅ Notion + Calendar. **GitHub/Vercel have no credential** |
| 5 · Task, schedule and action contracts | 🔄 **Extension live; scheduler ownership not started** ← resume here |
| 6 · Native memory, Obsidian, cited knowledge | Not started |
| 7 · Private dashboard and CEO outcomes | Not started |
| 8 · Complete acceptance scenarios | Not started |
| 9 · Recovery, readiness, close the milestone | Not started |

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
jobs**. The work is to split two things that currently share one name:

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

Also outstanding in milestone 5: field-by-field write authority for Notion,
version-aware updates against Master Tasks, proving a record-sync failure is
reported honestly rather than swallowed, and binding retained exact-action
Approvals to their immutable artifact so a stale Approval has no effect.

### 2. Then milestones 6 → 9 in dependency order

Follow the plan. Do not skip ahead; each milestone's pass criterion is written
there.

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

1. **Trigger now met — do this early in your session:** milestone 3's phone
   matrix passed for conversation, commands, formatting and role playbooks, so
   `src/telegram/` (1,496), `src/hermes/` (1,183),
   `src/runtime/telegram-ingress.ts` (55),
   `src/operations/executive-role-router.ts` (52) and
   `src/operations/command-classifier.ts` (32) can go — **but first** confirm
   nothing still imports them in the native path, and keep the composition-mode
   default working. Roughly 2,800 lines in one reviewable commit.
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

1. **Three untested phone rows:** progress indication during multi-step work,
   attachment handling, and a real semantic follow-up. The checklist's
   placeholder text was sent verbatim, so these were never exercised.
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
