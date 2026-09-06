# RM-40 · V6 native-first implementation plan

Prepared: 6 September 2026. Status: **implementation plan; migration not executed by this document**.

## Milestone status

| Milestone | Status | Evidence |
| --- | --- | --- |
| 0 · Reconcile requirements and inventory the real deployment | ✅ Complete, 6 Sep 2026 | [Requirement ledger and live capability inventory](RM-40-v6-requirement-ledger.md); [ADR-0020](../docs/adr/0020-run-ming-on-the-native-hermes-runtime.md); [baseline](../docs/BASELINE.md); `npm run check` exit 0, 771 tests |
| 1 · Prove the native runtime before bot cutover | ✅ Complete on the CLI path, 6 Sep 2026 | [Milestone 1 native-runtime evidence](RM-40-v6-milestone-1-native-runtime-evidence.md). Real diff, independently verified test exit 0, 15 native tool calls. Two defects recorded. Native **Telegram** presentation remains untested by design |
| 2 · Prepare a reversible one-owner Telegram migration | ▶️ Next — repository work, no new authorization needed | — |
| 3–9 | Not started | — |


## TL;DR

Finish Real-Ming as **native Hermes + Ming-specific configuration/skills + the smallest useful Real-Ming extension**.

The [V6 architecture](../docs/architecture/real-ming-agent-diagram-v6.html) already states this direction. The [capability review](RM-40-hermes-native-capability-review.md) explains the native features and integration limits. This plan turns that target into ordered work and acceptance gates. It supersedes the old V5 activation sequence for future migration work; the [old runbook](RM-40-phase4-activation-runbook.md) remains a record of the deployed bridge and recovery setup.

**Start at milestone 0, then prove native Hermes before expanding integrations.** Do not restart OAuth or Tailscale enrollment merely because the design changed. Their last recorded authorization succeeded. Recheck health when implementation reaches the live system.

The deliverable is an agent Ming can use from Telegram and a private dashboard while Lenovo is off. Hermes owns native conversation, commands, tools, execution and responses. Ming's integrations add context, records and useful views when needed. Ordinary questions require no role ceremony, Work Item or mandatory JSON Turn Plan.

## 1. Starting evidence and scope

This is based on the repository and the **5 September 2026 recorded live audit**, not a new live audit on the preparation date.

| Area | Recorded state | Remaining proof/work |
| --- | --- | --- |
| Primary host | Malaysia West `real-ming-control-plane-my`, Standard_D2as_v5; private access through Tailscale | Reconfirm actual service/config revisions before migration |
| Hermes | v0.21.0, pinned commit `561b053f794a1781868bb032029d589c67708119`; Codex OAuth authorized | Native Telegram ownership and real coding acceptance |
| Production bot | Real-Ming Telegram transport → private Hermes API, the V5 bridge | Replace ownership deliberately; preserve native gateway behavior |
| Agent evidence | Real Hermes replies observed; smoke found formatting/progress and workflow gaps | Native commands, tools, actual edits/tests, recovery and complete user experience |
| Dashboard | Private Real-Ming dashboard reachable | Native Hermes dashboard evaluation, then selected CEO views with real data |
| Memory | Existing compiled-memory code and configured Obsidian destination | Native vault use; existing production CLI does not enable Knowledge Operations |
| Recovery | Singapore backup storage and a verified restored state snapshot | Post-migration backup/restore of the complete native and retained state |
| Rollback host | East Asia services stopped; VM retained | Final disposition only after new acceptance and recovery proof |
| Formal artifacts | V6 design target; older spec/ADR/test baseline | Explicit reconciliation before changed implementation |

The user has selected native Hermes. Reconciliation is engineering work to make the affected artifacts consistent with that choice. Ask Ming only for genuinely unresolved product choices, new access or actions outside existing authorization.

### Working rules for this migration

- Use the installed version's supported interfaces. A capability advertised upstream is not proof it is installed, enabled, authenticated or compatible here.
- Select native feature → configuration/skill → existing integration → custom extension → separate service. Document the unmet requirement before adding custom code.
- Preserve existing records and valid tests. Retire code only after proving its replacement and recovery path.
- Keep one owner per Telegram consumer, scheduled job, authoritative field and published vault output.
- Keep Azure as the primary home. A Lenovo worker is an optional process for laptop-local resources, not a prerequisite or required desktop application.
- Keep the approved private networking. Neither public SSH nor a public dashboard port is part of this plan.
- Preserve ordinary native tool use. A role skill expresses behavior; it does not implement access control. An optional Real-Ming tool cannot govern every other tool by itself.
- Reconcile prior source, approval, financial and academic constraints explicitly. Retain required restrictions using mechanisms tested on the actual execution path. Do not infer blanket enforcement from a hook name.
- Default tests stay isolated, with no provider traffic, quota or production data. Live checks require the repository's explicit live flag and supplied credentials.
- Record outcomes and tool/artifact evidence, not hidden reasoning or secrets. Provider tokens and the Codex OAuth session stay in protected stores.

## 2. Requirement coverage: what must not disappear during simplification

The IDs below are planning labels, not new GitHub ticket numbers. Milestone 0 maps them to the actual specification and scheduler-selected work. The table is a minimum coverage checklist; inventory the full existing specification before marking reconciliation complete.

| ID | Required outcome | First route to evaluate | Evidence needed |
| --- | --- | --- | --- |
| V6-CHAT | Native Telegram conversation, supported commands, progress, readable output and attachments | Native gateway/settings | Phone interaction and correlated native session; no task for ordinary chat |
| V6-CODE | Hermes develops a DuitSini feature and verifies it | Native tools, workspace and task primitives | Diff, executed tests, result and restart/continuation evidence |
| V6-ROLES | COO, CTO, CMO, Personal CFO and CAO perspectives | Ming skills and relevant context | Representative requests select useful behavior; ordinary chat remains natural |
| V6-TASKS | Existing Master Tasks meanings and review lifecycle | Native execution task linked to existing Notion integration | Exact status/field mapping, deduplication, read-back and CEO review distinction |
| V6-DAILY | Calendar reconciliation, morning brief, evening roll-up, DND and weekend rhythm | Native scheduling plus reusable reconciliation | Correct local times, one delivery, source timestamps, retry/restart behavior |
| V6-SOURCES | Personal, creative, academic, financial and entertainment sources | Available skills/CLIs/MCP, then retained adapters | Per-source authorization, real read, freshness, failure and any required write |
| V6-KNOWLEDGE | Persistent memory, cited Obsidian/Wiki knowledge and recall | Native memory, Obsidian and LLM Wiki skills | Real notes/citations/recall plus backup and publication ownership |
| V6-CURATED | Any retained stronger quarantine/versioned-publication/projection guarantees | Existing compiler/broker only for verified gaps | Explicit decision on each old guarantee, then end-to-end publication proof if retained |
| V6-CEO | Agent visibility plus useful cross-app outcomes/portfolio | Native dashboard, then dashboard extension | Actual running/completed/failed work; evidence links and current source state |
| V6-ACTIONS | Required exact-action approvals and source authority | Scoped operations plus tested native/plugin integration | Correct binding to the reviewed artifact; no effect on refusal/stale approval |
| V6-OPS | Always-on operation, continuity, costs, health, retention and recovery | Native facilities plus existing operations where useful | Laptop-off operation, restart, complete restore and budget/usage visibility |

Source coverage includes Notion Master Tasks and allowlisted pages; personal/career files and context; Google Calendar; GitHub repositories and Project Portfolio; Vercel; application databases; Agent Brain Project Evidence; personal/opportunity mail; academic tasks, Canvas, Microsoft 365 mail, Teams and approved course files; content workflows; DuitSini and authorized Money Manager/Moomoo exports; Financial Snapshots; and entertainment/application-mail digests. Record **keep / revise / explicitly defer / remove by decision** for every applicable original requirement. A successful Telegram greeting does not complete this coverage.

## 3. Milestone 0 — reconcile requirements and inventory the real deployment

**Status: ✅ complete, 6 September 2026.** Output recorded in the [requirement ledger](RM-40-v6-requirement-ledger.md): all eight steps done, baseline labels resolved to Architecture Revision 6, every Revision 5 requirement given a keep/revise/defer/remove disposition, and the live deployment/capability inventory read read-only without printing a secret.

**Owner:** engineering. **Output:** one reviewable V6 change set and an executable first milestone.

1. [ ] Read `AGENTS.md`, `CONTEXT.md`, `docs/BASELINE.md`, `docs/agents/domain.md`, `docs/agents/issue-tracker.md` and the Notion status semantics before changing their contracts. Run `git status --short` and preserve unrelated edits. Confirm the active branch/work owner.
2. [ ] Run `npm run graph:status`, read the selected issue and comments, and reconcile live GitHub state. Do not choose or number a ticket from this plan's labels. If the existing graph cannot express the migration, prepare its concrete revision as part of the milestone review.
3. [ ] Compare V6 with the specification, glossary and ADRs, especially `0019-hermes-first-real-ming-composition.md`, `0014-use-one-private-telegram-front-door.md` and `0018-compile-knowledge-into-trust-domain-vaults.md`. Identify obsolete mandatory JSON, Real-Ming transport ownership, role-routing and native-memory restrictions.
4. [ ] Resolve the repository's conflicting baseline labels in a deliberate change: the root instructions retain Revision 3 wording while later artifacts reference Revision 5 and V6 is the selected target. Preserve historical diagrams. Update affected authoritative clauses and baseline checks together, rather than disabling the checks or merely changing a title.
5. [ ] Create the requirement-to-decision-to-runtime-to-evidence ledger. Map the full specification, including all sources, financial retention, academic restrictions and prior unresolved retention questions. Preserve still-valid component acceptance. Treat optional curated memory as a decision about additional guarantees; do not silently drop the old requirements.
6. [ ] Read the deployed service configuration and version identifiers without printing secret values. Record gateway owners, scheduler owners, dashboard bindings, state roots, backup coverage, toolsets, plugin/MCP configuration, service-account filesystem permissions and existing provider authentication health.
7. [ ] Build a capability disposition sheet from the pinned native source and actual configuration. For each requirement record native support, enabled state, access, scenario proof and any missing guarantee. Investigate unknown compatibility before choosing custom implementation.
8. [ ] Prepare the next milestone's exact scope, file changes, controlled checks, bounded live scenarios and rollback. Keep later milestones detailed as outcomes but revise implementation choices when this evidence changes them.

**Pass:** no unresolved ownership contradiction in the first implementation slice; retained/deferred requirements are explicit; the next task demonstrates a real native product interaction. **Stop condition:** a consequential requirement truly remains undecided, or required access cannot be obtained by engineering. Record that specific item in the CEO action file; continue independent work.

## 4. Milestone 1 — prove the native runtime before bot cutover

**Status: ✅ complete on the CLI path, 6 September 2026.** Evidence in [milestone 1 native-runtime evidence](RM-40-v6-milestone-1-native-runtime-evidence.md). Steps 1–5 and 7 are proven; step 6 (native Telegram command/presentation matrix) is deliberately deferred to the cutover milestone because it needs an authorized bot or a separate test bot. Two defects were found: one-shot mode never resumes a session and its resume flags discard `--in DIR`; and the host default model does not match the only available credential.

**Owner:** engineering. **Dependencies:** milestone 0. **Output:** a pinned, reproducible native baseline.

1. [ ] Inspect the installed Hermes help, gateway configuration, tool dependencies and supported plugin interfaces. Preserve the current working Codex OAuth profile; confirm model/provider through protected native configuration.
2. [ ] Prepare a separate local/staging profile and an isolated disposable coding repository. Do not run a second consumer with the production Telegram bot token. A separate test bot requires its own authorization; native CLI/runtime tests can proceed without taking over production Telegram.
3. [ ] Use Hermes itself to answer a question, read a fixture repository, make a small change, run a meaningful test and report the result. Capture the actual diff, tool results and exit status. Verify follow-up context and a failed command/tool result.
4. [ ] Enable and verify the required native toolsets, skill discovery, plugin/MCP loading and workspace behavior. Record unavailable features individually; do not equate all tools being listed with all integrations working.
5. [ ] Check `deploy/systemd/hermes.service`: its current writable scope is the Hermes state directory. If coding workspaces live elsewhere, grant the service account only the necessary workspace paths and verify real edits there. Preserve the rest of the service isolation.
6. [ ] Inspect native Telegram command, formatting, typing/progress, cancellation/session and attachment behavior for this version. Record a baseline test matrix using the commands actually advertised by that installation; do not invent slash commands.
7. [ ] Rehearse the same ordinary-chat and coding requests with the proposed Ming customization enabled. There must be no mandatory JSON answer envelope and no dependency on a Real-Ming record operation for simple chat.

**Pass:** actual Hermes edits/tests and native capability loading are proven; the candidate can preserve the native experience. A text saying “I can code” does not pass. Telegram-specific live evidence remains pending until an authorized bot/profile is used.

## 5. Milestone 2 — prepare a reversible one-owner Telegram migration

**Owner:** engineering. **Output:** a tested candidate and concrete cutover/rollback procedure.

1. [ ] Trace `src/config/control-plane-cli.ts` → `src/runtime/production-control-plane.ts` → `src/runtime/daily-operations-control-plane.ts`. Identify every place that polls Telegram, sends notifications, schedules work or requires the old Hermes coordinator.
2. [ ] Make retained Real-Ming data/operations usable without owning Telegram. The current daily composition unconditionally creates the front door, so stopping polling may require separating composition modes. Add only the modes needed by the chosen retained functionality.
3. [ ] Remove the mandatory path through `src/hermes/hermes-runtime-client.ts`, `src/hermes/hermes-turn-coordinator.ts` and the legacy action parser for the new native mode. Preserve historical/recovery compatibility where needed. Native commands must reach native dispatch directly.
4. [ ] If records need an extension, verify native tool/plugin interfaces first. Reuse existing contracts and storage through a narrow interface. A package under `integrations/hermes/` is a proposed location, not an already implemented plugin or an assumed SDK API. Choose its exact structure only after the versioned interface check.
5. [ ] Through the approved System Harness, prove the retained native-mode composition starts no Telegram poller, does not reinterpret role-prefixed chat and does not create Work Items for ordinary questions. Through the Provider Contract Harness, prove any retained write contract remains idempotent and preserves source errors.
6. [ ] Define ownership for notifications and scheduled deliveries separately from polling. Prefer native Hermes delivery; if a retained service needs to request delivery, make that explicit and deduplicated. Prevent duplicate briefings during cutover.
7. [ ] Prepare the candidate revision, pinned dependencies, build artifact, service/config changes and state migration manifest. Include backup and restore commands validated for these exact paths and versions. Do not reuse the old approved V5 image digest as evidence of approval for a new artifact.
8. [ ] Write cutover steps: capture checkpoint and in-flight work; stop old consumer; verify it stopped; preserve Telegram update/delivery state; start native consumer; verify one owner; run bounded smoke checks. Write reverse steps that stop native first and reconcile updates and writes before restoring the old consumer.

**Pass:** reviewed candidate and a recoverable state transition; no double consumer or duplicate job owner in the rehearsal. Apply existing authorization to the actual scope; seek a new decision only if the new artifact/action falls outside it.

## 6. Milestone 3 — activate native Telegram and accept the core experience

**Owner:** engineering for execution; Ming for phone experience acceptance. **Dependencies:** candidate and cutover gate above.

1. [ ] Take the pre-cutover backup and record its restore evidence. Preserve the old VM and existing data.
2. [ ] Apply the prepared ownership cutover on Malaysia. Configure the native gateway with the existing protected bot credential and Ming's allowed identity through the secret/configuration mechanism. Do not expose tokens in commands, screenshots, prompts or evidence.
3. [ ] Verify the old consumer is stopped, native service is healthy and no competing consumer remains. Correlate an allowed incoming update to the native session and reply without logging message contents unnecessarily.
4. [ ] Ask Ming to test the matrix below. Engineering observes transport/session/tool evidence and fixes any defect before expanding the rollout.
5. [ ] Restart the native service in the agreed test window. Confirm session continuity and no replayed replies/provider effects. Update the deployment/evidence ledger with the exact revision and configuration identifiers.

| Phone test | Expected result |
| --- | --- |
| “Hi, what can you help me with?” | Natural native reply; no Work Item or forced role |
| A short follow-up about the previous answer | Session context retained |
| Native help and selected advertised slash commands | Native command behavior preserved |
| Request a readable answer with bullets and a small code example | Telegram-safe formatting, spacing and code presentation |
| Bounded multi-step request | Typing/progress appropriate to native configuration; accurate final state |
| Supported interruption/cancellation | Real operation state matches the reported cancellation semantics |
| Supported file/photo input | Native handling works; unsupported types receive a clear response |
| “As CTO, explain this error” | Hermes interprets the perspective; no legacy hardcoded action bypass |
| Optional Real-Ming integration unavailable | Ordinary conversation still works; dependent operation reports the failure |

**Pass:** usable native Telegram interaction and verified real tool execution. This is the first usable product milestone; it does not yet establish every personalized integration.

## 7. Milestone 4 — configure Ming's roles and connect sources

**Owner:** engineering; Ming only for provider consent or unresolved source choices.

1. [ ] Create a version-controlled, secret-free Ming configuration/skill pack using native conventions. Include identity/preferences, concise readable response style, project references and COO/CTO/CMO/Personal CFO/CAO playbooks. Avoid a global prompt that forces every response through all five roles or a fixed planning template.
2. [ ] Preserve native skills and tool discovery. A Ming skill should add the needed context or convention and refer to native capabilities, rather than copying a large upstream skill that will drift.
3. [ ] Start with Notion, Calendar and GitHub. Evaluate the bundled skills/CLIs and configured MCP options against the existing working adapters. Reuse existing access where compatible; an integration token and hosted MCP OAuth are different authentication paths.
4. [ ] For each source, record authoritative object IDs, permitted read/write operations, freshness/as-of metadata and error behavior. Verify a real authorized read and compare it with the source. Configure only the requested resources.
5. [ ] Verify Vercel integration compatibility separately. A catalog entry alone is insufficient. If the native MCP path fails, evaluate the existing scoped adapter or CLI/API before building another connector.
6. [ ] Complete the remaining source inventory from section 2: Agent Brain, portfolio/application data, personal/career files, mail, academic systems, creative workflows and financial exports. Prove each required connector or record the exact missing access/implementation and its owner.
7. [ ] Exercise representative role scenarios using current relevant data. CTO and CMO may use different views of Ming Creatives; Entertainment has no dedicated executive. Five role perspectives, five Trust Domains and source-provider count are different concepts.
8. [ ] Test a stale source, unavailable provider and conflicting facts. Hermes should identify source/date and uncertainty. A live read does not automatically become durable memory.
9. [ ] Test required writes only against an authorized target with a known recovery path. Read back the result and retain operation IDs. Do not turn a read-only provider connection test into an unsolicited message, calendar invitation or production deployment.

**Pass:** each required source has a disposition and evidence; roles improve answers without replacing native reasoning. Missing credentials are listed separately from missing connectors or mappings.

## 8. Milestone 5 — add only the missing task, schedule and action contracts

**Owner:** engineering. **Dependencies:** native baseline and capability fit evidence.

1. [ ] Evaluate native Kanban execution and native cron against the retained requirements. Decide field-by-field authority before wiring synchronization. Notion Master Tasks remains the business commitment record where that contract is retained; native execution state is a linked operational record.
2. [ ] Read `docs/agents/notion-task-status-semantics.md` before migration. Preserve Pending = Captured/backlog, To Do = Planned, Issues = Waiting/Blocked, Pending to Review = Ready for CEO Review, Done = Completed. Unknown statuses require explicit resolution; review-ready is not completed.
3. [ ] Implement the smallest link/sync operation needed: stable native-task/Work-Item/Notion IDs, version-aware updates, replay protection and visible failures. Avoid a second planner. Hermes chooses whether substantial work benefits from a record and performs the coding/research loop itself.
4. [ ] Reuse `src/providers/notion-provider-adapter.ts`, `src/calendar/calendar-reconciliation.ts` and existing lifecycle/storage contracts when they satisfy the requirement. Access them through the chosen extension interface rather than reimplementing their semantics in prompts.
5. [ ] Assign one scheduler per brief, roll-up, reconciliation, retention and knowledge job. Migrate jobs with last-success/run IDs and explicit disable/enable order. Verify Asia/Kuala_Lumpur times, 07:30 brief, 21:30 roll-up, DND, weekend rhythm, grouped errors, retry and no duplicate delivery after restart.
6. [ ] For retained exact-action approvals, bind the operation to its immutable artifact/version and prove stale/denied approvals have no effect. Native hooks differ in enforcement and failure behavior; test the affected path, including nested tools where applicable. Narrow credentials or leave the particular effect unavailable if the contract cannot be enforced.
7. [ ] Keep financial analysis/export snapshots separate from money movement and brokerage trading. Keep academic assistance separate from submission under the retained rules. Preserve required durable financial records; the current `financial-snapshot.ts` is SQLite-backed, but that alone does not prove the live workflow is bound.
8. [ ] Prove record sync failure is reported honestly and recoverable. Useful local coding may complete while the promised Notion record is pending; do not claim full cross-app completion until the record is read back.

**Pass:** correct cross-app semantics and one owner per job/field, with native conversation and execution unchanged by the extension.

## 9. Milestone 6 — activate native memory, Obsidian and cited knowledge

**Owner:** engineering; Ming chooses any new device sync destination.

1. [ ] Configure native persistent memory and session search under the reconciled V6 policy. Do not silently retain the old blanket rule that disables native memory. Define what belongs in preferences, conversation state, source records and derived knowledge.
2. [ ] Configure the bundled Obsidian and LLM Wiki skills and an absolute Azure vault path writable by the Hermes service account. Confirm the installed version's required configuration names and file conventions.
3. [ ] Use a small authorized source to create a real note, source citation, index entry and wikilink. Ask a follow-up that retrieves it. Verify the files, source pointer and answer rather than relying on a claimed save.
4. [ ] Establish one writer per output path. If the existing Real-Ming materializer remains, keep its generated projection output separate from native editable notes, or enforce an explicit ownership rule. Do not let a subsequent generated export overwrite native notes.
5. [ ] Verify knowledge remains after restart and can be opened in Obsidian. The prior configured but empty `/var/lib/real-ming/obsidian` directory is not evidence of a usable vault.
6. [ ] Back up the native vault and memory stores. If Ming wants Lenovo/mobile synchronization, present the concrete destination, scope and sync behavior; keep Azure operation independent of that choice. Until chosen, prove Azure vault operation and document desktop viewing as pending.
7. [ ] Evaluate every retained stronger curated-memory guarantee against the native Wiki workflow. If versioned atomic publication, quarantine, provenance validation or scoped cross-domain projections remain required, reuse the existing compiler/broker/materializer for those gaps.
8. [ ] For any retained custom pipeline, wire its real production caller. Inspect `src/knowledge/knowledge-operations.ts`, compiler/vault/projection/materializer modules and `src/config/control-plane-cli.ts`. Prove source → candidate → validation/quarantine → actual Hermes compilation → versioned publish → projection → materialization → Hermes retrieval, including failure and restart.

**Pass:** persistent native knowledge is demonstrably useful and backed up. Additional curated guarantees either have their own passing evidence or an explicit approved disposition. Native Wiki skills alone are not proof of transactional publication or access control.

## 10. Milestone 7 — finish the private dashboard and CEO outcomes

**Owner:** engineering; Ming reviews usefulness. Native dashboard inspection can proceed alongside source setup after the native baseline is stable.

1. [ ] Run the supported native Hermes dashboard privately on Malaysia. Confirm authentication, loopback/private binding and Tailscale access from an authorized device. Preserve the existing private console while evaluating coverage.
2. [ ] Demonstrate actual session/task/tool status, completed and failed work, available operational metadata and recovery visibility. State which events the installed version exposes; do not fabricate progress from a timer.
3. [ ] Compare the native view with Ming's required CEO view: cross-project portfolio, Master Tasks, review-ready outcomes, evidence, provider freshness/health, schedules and cost/usage. Add only missing views, first evaluating the native dashboard extension SDK.
4. [ ] Reuse `src/dashboard/dashboard-read-model.ts` and existing records where useful. Keep `dashboard-server.ts`/`dashboard-page.ts` as a separate service only if a concrete requirement needs it. An extension tab with a small authenticated backend may be sufficient.
5. [ ] Design event ingestion around actual hook semantics. Observational or droppable stream events are not a complete audit log. Use durable native/retained records and reconciliation to recover state after missed events; attach correlation IDs and deduplicate.
6. [ ] Verify outcomes for daily operations, a MicroSaaS coding candidate, and the financial/academic/content/career/project perspectives required by the spec. Show test/artifact/source links and distinguish proposed, running, blocked, ready-for-review and accepted states.
7. [ ] Check that UI payloads and logs exclude credentials and hidden reasoning. Show tool names, concise progress, results and evidence needed to understand the work.

**Pass:** Ming can see real agent work and review cross-app outcomes privately. A static fixture or a healthy HTTP endpoint alone does not pass.

## 11. Milestone 8 — run the complete acceptance scenarios

**Owner:** engineering produces evidence; Ming accepts the experience.

1. [ ] Repeat the native Telegram matrix with all selected extensions enabled. Compare with milestone 1 to catch lost commands, rendering, memory or tool access.
2. [ ] Run the DuitSini feature scenario: Hermes reads the repository, clarifies scope, creates/uses a clean workspace, implements, executes tests, handles a failure and reports the resulting diff/artifact. Verify linked records where promised. PR publication, preview or production release follows the actual authorized scope and reviewed artifact.
3. [ ] Run a daily operations cycle using actual authorized Notion/Calendar sources. Verify source freshness, task meanings, schedule ownership and output once. Exercise failed provider recovery without duplicate writes/deliveries.
4. [ ] Run the role/source cases in the coverage ledger, including Personal CFO export analysis without money movement, CAO study support within the retained submission boundary, CMO content work and personal/career assistance.
5. [ ] Verify memory retrieval and any retained custom publication/projection path from Telegram. Check citations against sources, not just their visual presence.
6. [ ] Observe the same jobs in the private dashboard. The final answer, native task state, cross-app record and CEO view must agree or clearly show a pending integration failure.
7. [ ] Run a bounded task while Lenovo is off. Verify Azure execution and Telegram delivery; laptop-only tools must be identified as unavailable rather than claimed available.
8. [ ] Record latency to first visible activity and completion for simple and substantial requests. Agree practical targets from observed native behavior and Ming's feedback; do not invent a guarantee that the selected model/provider cannot meet.

For every result save: requirement/scenario, candidate revision, environment, native session/task correlation, relevant artifact or provider read-back, check exit status, timestamp, outcome and limitation. Do not store secret-bearing raw transcripts.

**Pass:** all mandatory requirements have live evidence and Ming has reviewed the relevant experience. Deferred work has an explicit decision and is not counted as complete.

## 12. Milestone 9 — prove recovery, reconcile readiness and close the milestone

1. [ ] Inventory all durable state after migration: native sessions/memory, Kanban and cron state, vault files, selected plugin mappings, retained Real-Ming SQLite stores, approvals/audit/financial records and configuration needed for recovery.
2. [ ] Extend the backup manifest and existing backup implementation where necessary. Inspect `src/runtime/control-plane-backup.ts`, `src/runtime/sqlite-state-backup.ts`, `deploy/backup-control-plane.sh` and backup service/timer. A V5 backup containing only the old stores is insufficient for new native state.
3. [ ] Restore a post-migration backup to an isolated destination with messaging/schedules/provider writes disabled. Verify database integrity, records, native continuity, notes and evidence. Document whether credentials are restored through protected mechanisms or require reauthorization; keep secrets out of the evidence bundle.
4. [ ] Test restart/recovery and reconcile in-flight tasks, delivery/update state and provider operation IDs. Preserve records created after cutover when rehearsing rollback. Merely restarting the old VM can lose or duplicate intervening work.
5. [ ] Verify cost/usage visibility, configured budget behavior, integration health and retained retention contracts. Distinguish subscription usage from measured cash spending; do not present inferred subscription token use as an exact bill.
6. [ ] Complete required engineering checks and independent Standards/Spec review for each implementation milestone. Follow repository branch/PR boundaries and reproduce suspected implementation defects through the approved seams.
7. [ ] Update the spec/ADRs, requirement ledger, readiness report, baseline, CEO index and action file to the actual candidate and evidence. Link still-open items explicitly. Recompute the live issue graph; close readiness only when its reconciled acceptance is satisfied.
8. [ ] After acceptance and restore proof, complete the previously approved East Asia deallocation if it remains outstanding and within the approved scope. Retain the VM for rollback; do not delete it. Record the actual result.

**Pass:** accepted native personal-agent workflows, complete recoverable state and accurate readiness records. Ticket closure follows evidence; it does not substitute for it.

## 13. Verification commands and file guidance

Run from the repository root. These are existing commands; this plan does not claim they have all passed for a future implementation.

```powershell
git status --short
git rev-parse HEAD
npm run graph:status
npm run secrets:preflight
```

`graph:status` reads live GitHub state and needs authentication/network. Secret preflight must report names only. Follow the selected issue and its comments before modifying implementation.

Focused existing regression checks, selected according to the milestone:

```powershell
npx vitest run test/system/hermes-runtime.system.test.ts test/system/hermes-turn-coordinator.system.test.ts test/system/telegram-front-door.system.test.ts
npx vitest run test/system/knowledge-operations.system.test.ts test/system/obsidian-materializer.system.test.ts test/system/control-plane-backup.system.test.ts
npx vitest run test/docs/baseline.test.ts
```

Some of these tests describe the old bridge. Reconcile changed requirements and assertions explicitly; their current pass does not prove native migration. Add new behavior coverage through the existing System Harness and Provider Adapter Contract Harness, not a third production-test seam. Keep the upstream/native smoke evidence separate.

Required completion checks for implementation milestones:

```powershell
npm run check
npm audit --audit-level=high
git diff --check
```

Check exit codes. The browser checks require installed Chromium and must not be silently skipped. The audit needs network. A check blocked by the environment is reported as blocked, not passed. Use version-verified Hermes commands and a reviewed deployment manifest for live operations; this plan deliberately does not invent SDK calls or ready-to-run secret-bearing service commands.

## 14. CEO-only actions and handoff

No new CEO blocker is established by writing this plan. Engineering starts with milestone 0. Keep [phase-4-ceo-action.md](phase-4-ceo-action.md) updated as actual blockers are discovered.

| Action | When genuinely needed | What engineering supplies first |
| --- | --- | --- |
| Codex OAuth or Tailscale login | Only if health checks establish expired/missing authorization | Current device/link flow and exact reason; prior authorization is already recorded |
| Provider consent/access | Required native integration cannot use existing authorized access | Provider's actual consent entry point, account/resource scope and a names-only check |
| Resolve retained optional guarantees | An old requirement conflicts with the selected simplified behavior and the latest decision does not settle it | Concrete requirement delta, native fit evidence and recommended disposition |
| Review a new production action outside existing approval | Exact candidate/scope is not covered | Ready candidate, diff, checks, expected effect and rollback |
| Choose Obsidian device synchronization | Azure vault works and multi-device access is desired | Destination/options, included data and tested sync procedure |
| Phone/dashboard acceptance | The candidate's engineering checks pass | Short test prompts, expected outcomes, URLs and any known limitation |

Do not ask Ming to repeat setup because a component was never implemented. Do not ask for secrets in chat. An unavailable source requires a precise provider/account action, rather than the generic instruction “configure integrations.”

## 15. Troubleshooting during implementation

| Symptom | Check first | Corrective direction |
| --- | --- | --- |
| Telegram conflicts, split or duplicated replies | All polling/webhook owners and delivery ledgers | Restore one owner and reconcile update state before retrying |
| No typing, poor rendering or commands intercepted | Native gateway configuration and whether the old front door still handles updates | Prove native delivery/dispatch; avoid another custom formatting wrapper |
| “I can code” but no changed files/tests | Actual native tool calls, enabled toolsets and workspace permissions | Bind real execution and verify artifacts; text is insufficient |
| Workspace permission denied | Service user and systemd `ReadWritePaths` | Grant only the selected workspace path and retest |
| Provider appears in catalog but fails | Client compatibility, native dependency, resource scope and actual authentication method | Repair configuration or choose a proven existing integration |
| Duplicate daily briefs | Native cron and retained scheduler ownership | Disable the old job deliberately and migrate run IDs |
| Dashboard shows stale work | Hook delivery guarantees and durable state reconciliation | Recover from authoritative state rather than treating event streams as complete |
| Obsidian folder exists but is empty | Actual writer, vault path, production caller and source generation | Prove native note creation or wire the retained pipeline |
| New tasks disappear after restore | Backup manifest misses native/plugin stores | Include new state and repeat isolated restore proof |
| All controlled tests pass but user experience fails | Real entry point, installed version and phone scenarios | Fix the composition/acceptance gap and retain valid component evidence |

## Completion record

Keep one row per milestone with **designed / implemented / controlled-tested / production-wired / live-verified / user-accepted**, plus candidate revision, evidence links, owner and remaining action. At creation of this plan, its milestones are planned; existing historical evidence applies only to its stated scope.

The immediate next work is **milestone 0 reconciliation followed by milestone 1's real native agent demonstration**. Telegram usability comes first; native dashboard setup can then progress alongside personalization, with cross-app CEO views added only where required.
