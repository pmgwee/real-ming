# Native knowledge consolidation — CEO activation runbook

**Status:** controlled implementation complete for Tasks 0–8; **not deployed,
live-accepted, or scheduled**.

## TL;DR

Review the controlled artifact and local Task 0–8 commits, approve a deployment
with recurrence disabled, authorize one harmless live acceptance run, review its
evidence, and only then decide whether to enable one native Hermes cron row at
`02:00 Asia/Kuala_Lumpur`. Do not paste a token or secret into this file, a
prompt, Telegram, an issue, or the evidence bundle.

## Why this needs the CEO

The remaining steps create or change real Azure/Hermes state, read selected
source data, may write a source-backed note, can send Telegram output, and
change a recurring schedule. They require your account, your product judgment
and an explicit outward-facing approval. The implementation cannot safely infer
those approvals or handle your credentials.

## Refer to these artifacts first

1. [Controlled acceptance evidence](../docs/evidence/native-knowledge-consolidation-controlled-acceptance-2026-09-09.md)
2. [Task 0–8 implementation plan](../docs/superpowers/plans/2026-09-09-native-knowledge-consolidation.md)
3. [Reviewed design spec](../docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md)
4. [ADR-0022](../docs/adr/0022-native-knowledge-consolidation-around-hermes.md)
5. [Module disposition inventory](../docs/planning/RM-40-v6-module-disposition-inventory.md)

## Approved first-slice boundary

| Area | Approved value |
| --- | --- |
| Runtime owner | Native Hermes remains the sole reasoning, synthesis, Telegram and native-memory runtime |
| Capture | Explicit decisions/corrections and deliberately selected project/research artifacts only; no ordinary-turn sweep |
| Freshness | Decisions until superseded/forgotten; project artifacts 90 days; research artifacts 30 days; calendar/task/mail claims excluded |
| Canonical paths | `${OBSIDIAN_VAULT_PATH}/.real-ming/generated` and `${OBSIDIAN_VAULT_PATH}/.real-ming/staging` |
| Vault authority | Azure-hosted vault is canonical; a future local Obsidian mirror is optional, one-way, activation-triggered, read-only, never upstream or a runtime dependency |
| Forgetting | Supported-path suppression with an independent protected tombstone head; arbitrary direct filesystem reads are outside the guarantee |
| Notifications | Silent success; deduplicated failure/backlog health through the existing operational report/dashboard |
| Proposed schedule | `02:00 Asia/Kuala_Lumpur` in an inactive manifest only; no cron row is currently authorized |

## Prerequisites

- [ ] Read the controlled evidence and verify the exact local Task 0–8 commit
      SHAs supplied by the worker.
- [ ] Confirm the repository gates are green: `npm run check`,
      `npm audit --audit-level=high`, and `git diff --check` (each exit code 0).
- [ ] Confirm the Malaysia West host, private networking, native Hermes pinned
      commit and existing Telegram gateway are healthy.
- [ ] Have the named Hermes auth profile available in the protected credential
      store. Do not copy its value into chat or this runbook.
- [ ] Confirm the protected Singapore Blob backup destination and the
      independent tombstone-head object are available to the dedicated job
      identity.
- [ ] Decide the harmless source-backed fixture/decision to use for the one
      live run. Do not use a secret, sensitive record, calendar/task/mail claim,
      or an irreversible provider action.

## 1. Review and approve the deployment artifact

1. Record the exact image/digest, repository revision, native Hermes commit,
   generated/staging paths, limits, MCP include set and rollback target from the
   evidence packet.
2. Verify the effective job callable set is exactly:
   `real_ming_knowledge_list_candidates`,
   `real_ming_read_knowledge_source`,
   `real_ming_stage_knowledge_generation`, and
   `real_ming_wiki_retrieve`. No activation operation is exposed to the job.
3. Approve **deployment with recurring execution disabled**. This approval
   does not authorize a live run, Telegram delivery, or cron creation.
4. The operator deploys the reviewed artifact on Malaysia West using private
   access only. The dedicated service identity must have writable access only to
   the staging/job-session roots and the deterministic local activation path;
   native memory/profile/configuration, credentials, skills/plugins, cron state
   and unrelated paths stay unavailable.
5. Verify the service revision, `skip_memory=True`, exact effective MCP list,
   disabled cron state, no duplicate report owner and no public SSH/dashboard
   listener. If any control differs, stop and roll back before a live run.

## 2. Authorize one harmless live acceptance run

After reviewing step 1 evidence, explicitly authorize one one-shot run. The
operator then:

1. Admits one deliberate, source-backed decision or project/research artifact
   within the approved freshness window.
2. Runs the wrapper once with the named Hermes auth profile. The wrapper must
   return success only after registry state, the immutable manifest, the active
   pointer and supported retrieval read-back agree. It must not send a separate
   completion message.
3. Records the run ID, generation ID, source reference, support disposition,
   freshness, file/manifest hashes and exit code without recording source prose
   or credentials.

## 3. Verify native retrieval and forgetting

1. Start a fresh native Hermes session and ask for the harmless note through
   `wiki_retrieve`. Confirm a bounded cited result and normal Hermes Telegram
   formatting/progress/commands.
2. Issue an explicit “forget this wiki knowledge” request for the fixture.
   Confirm local `suppressed`, then independent-head read-back and
   `restore_safe` (or `head_sync_pending` with retrieval still suppressed).
3. Confirm the supported reader refuses the forgotten claim, derived pages and
   stale generations; do not claim `MEMORY.md`, native sessions, authoritative
   providers or already-delivered Telegram text were erased.

## 4. Verify noninterference, failure and dashboard health

1. While the optional run is active, ask an ordinary Telegram question and
   perform one legitimate native Hermes memory update. Confirm no prohibited
   native-memory/configuration/provider write and no dropped turn.
2. Force a bounded source or registry failure. Confirm a nonzero recorded run,
   one deduplicated failure/backlog health item and continued ordinary chat.
3. Retry within the same wall-clock/retry budget. Confirm no duplicate page,
   generation or delivery.
4. Review the private Hermes/Real-Ming dashboard surfaces. Health must be
   opaque run/generation/tombstone/backlog/repair data; no source prose,
   secrets, prompt or hidden reasoning may appear.
5. Record the measured p95 first-progress and completion times against the
   20/20 baseline/paired sample thresholds in the evidence packet.

## 5. Verify restart, reconciliation and restore

1. Restart/reconcile the deployed candidate only under a separate restart
   approval. Confirm the active pointer, run IDs and retrieval result are
   unchanged and no work is replayed.
2. Restore the backup into an isolated destination with provider writes,
   Telegram delivery and schedules disabled.
3. Read the independent tombstone head before enabling wiki retrieval. Replay
   newer entries and verify every pending local tombstone is covered. If head
   completeness cannot be established, leave retrieval disabled as
   `needs-repair`.
4. Confirm authored Obsidian notes, native Hermes memory and credentials are
   not overwritten or included in the generated knowledge bundle.

## 6. Decide whether to enable recurrence

Only after the live evidence is reviewed may you separately approve one native
Hermes cron row:

- schedule: `02:00 Asia/Kuala_Lumpur`;
- delivery: local/native Hermes policy, silent on success;
- job: the exact reviewed wrapper and four-call MCP allowlist;
- ownership: one native row, no Real-Ming scheduler duplicate;
- rollback: pause the row and point retrieval to the last verified generation
  or disable it with `needs-repair`.

Verify the first scheduled run, last-success/run IDs, local time, failure health
and no duplicate after restart. A future local Obsidian mirror needs a separate
post-live-acceptance transport/deployment approval and remains read-only.

## Expected results

| Check | Pass condition |
| --- | --- |
| Isolation | Pinned commit, `skip_memory=True`, exact four callable names, no fallback, separated auth and OS denials |
| Capture | Ordinary conversation produces no candidate; deliberate candidate is bounded and idempotent |
| Evidence | Support and freshness are explicit; a matching hash alone cannot publish an unsupported claim |
| Publication | Immutable files are verified first; one SQLite active pointer is the only eligibility event |
| Forget | Supported retrieval suppresses the subject; independent-head coverage distinguishes `restore_safe` from `head_sync_pending` |
| Continuity | A then unrelated B remains retrievable; forgetting A leaves B available |
| Failure | Optional-job failure is visible and retryable while ordinary native chat continues |
| Restore | Older backup cannot resurrect a tombstone; uncertain head coverage leaves retrieval disabled |
| Recurrence | Exactly one native row at 02:00 KL, only after a separate enable decision |

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Any extra/missing MCP callable or unsupported control | Stop; mark the candidate ineligible. Do not widen permissions or fall back to the default toolset. |
| `head_sync_pending` or unknown head completeness | Keep supported retrieval suppressed; repair the independent head and read back the exact tombstone before retrying. |
| Manifest/hash/path mismatch | Leave the prior generation active or mark `needs-repair`; quarantine the candidate and do not report success. |
| Native chat slows or fails thresholds | Pause the optional job, preserve native Hermes settings, record measurements and investigate resource limits. |
| Duplicate scheduled report or consolidation | Pause the new row, identify both owners, reconcile run IDs, then resume only after one-owner proof. |
| Local Obsidian differs from Azure | Treat it as a projection mismatch; Azure remains canonical and local edits never sync upstream. |

## CEO sign-off record

- [ ] Controlled artifact reviewed.
- [ ] Deployment with recurrence disabled approved.
- [ ] One harmless live acceptance run approved.
- [ ] Live evidence reviewed and accepted.
- [ ] Recurring native cron row separately approved (optional).
- [ ] Local mirror separately approved (optional, post-live only).
