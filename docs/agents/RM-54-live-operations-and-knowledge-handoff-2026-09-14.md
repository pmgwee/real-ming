# Claude Code handoff — RM-54 live operations and native knowledge

**Purpose:** resume the exact work stopped by Codex on 2026-09-14. This is not
a new planning exercise. The live implementation and acceptance tests described
below have already happened; Claude Code must preserve them, finish the pending
backup and documentation work, verify the complete result, and close out RM-54.

## Branch to continue

- Repository: `C:\Users\quekm\Desktop\projects\real-me`
- Continue branch: `codex/live-operations-and-knowledge`
- Do **not** switch to `main` or the earlier
  `codex/role-scoped-native-knowledge-retrieval` branch.
- Deployed implementation commit: `c4ee6eb`
  (`feat(operations): capture governed work from native Hermes`)
- Branch base/merge checkpoint: `ef49bef`
- GitHub issue: `pmgwee/real-ming#54`,
  `Restore live operations and activate role-scoped native knowledge`
- Remote branch: `origin/codex/live-operations-and-knowledge`

If this handoff is read in the original working directory, preserve the working
tree exactly as found. If it is read in a clean Claude Code checkout, fetch and
switch to the remote branch above. Never clean, reset, or overwrite work merely
because the status differs from this time-stamped note; inspect the diff first.

## User authority and scope

The user explicitly authorized continuing this live rollout and said not to ask
for approval again. That authority covers the remaining work listed in this
handoff: finishing the protected-backup change, installing that backup script on
the already-scoped Real-Ming production host, running and verifying one protected
backup, completing the requested repository documentation, and performing
read-only final health checks. Do not repeat the same approval question.

This does not authorize unrelated production changes, merging a pull request,
deleting data, changing vendors, or broadening the rollout beyond RM-54.

## User-requested outcome

The user asked to make and truthfully document these capabilities as live for
the current Real-Ming Telegram agent:

1. Work Items and lifecycle.
2. Notion task coordination.
3. Role-scoped selective native wiki consolidation and retrieval through native
   Hermes plus the Obsidian-backed generated-note path.
4. Curated-knowledge guarantees, but only where production evidence supports
   them.
5. The README capability table and architecture diagram, plus the matching
   architecture HTML.
6. A runbook or live test record proving the Telegram agent path works.

The important terminology distinction is:

- **Role-scoped selective native knowledge** is now live and has production
  evidence. It includes governed generation/publication, role/domain-gated
  retrieval, restore-safe forgetting, native Hermes invocation, and a delivered
  Telegram acceptance run. Recurring consolidation remains disabled.
- The older **legacy six-root encrypted Curated Knowledge Vault + Projection
  Broker** is a different optional architecture. It still has no production
  caller as a whole. Do not relabel the entire legacy row `Live`.
- Prefer splitting the README capability into a live role-scoped selective-wiki
  row and a retained/partial legacy curated-vault row, or keep the legacy row
  partial with an explicit distinction.

## What is already implemented and pushed

Commit `c4ee6eb` adds:

- A governed `real_ming_capture_work_item` MCP tool.
- A `WorkItemCaptureClient` and authenticated loopback endpoint at
  `/internal/work-items/capture`.
- The existing `OperationsGateway.acknowledgeCeoAction` lifecycle path and
  `MasterTasksProjection`, rather than a second or bypass lifecycle.
- Native Hermes skill instructions that capture actionable work through the
  governed tool.
- The missing `trustDomain` propagation in the native-knowledge Hermes job.
- System-harness coverage for native capture, idempotency, lifecycle state, and
  Notion projection.

Before deployment, these gates passed by exit code:

- `npm run check`: 85 files, 964 passed, 2 skipped; typecheck, build, browser
  test, and deployment preflight passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: exit 0 (line-ending warnings only).

Those full-gate results predate the small pending backup-script change below, so
the complete gate must be run again before closeout.

## Exact production checkpoint

- Host: `azureuser@100.110.253.35`
- SSH identity: `%USERPROFILE%\.ssh\real_ming_southeastasia_ed25519`
- Host name: `real-ming-control-plane-my`
- Production repository: `/var/lib/hermes-real-ming/repos/real-ming`, detached
  at `c4ee6eb` at the checkpoint.
- Deployed image: `real-ming:v6-c4ee6eb`.
- Native Hermes: v0.21.0, pinned source `/opt/hermes-agent-561b053f`, commit
  `561b053f794a1781868bb032029d589c67708119`.
- Hermes home: `/var/lib/hermes-real-ming`.
- Real-Ming extension: `/opt/real-ming-extension`.
- Native-knowledge registry:
  `/var/lib/real-ming/native-knowledge.sqlite`.
- Generated/staging root:
  `/var/lib/hermes-real-ming/obsidian-vault/.real-ming`.

At the final completed health check, these services were active:

- `real-ming.service`
- `hermes.service`
- `hermes-dashboard.service`

Loopback listeners 8642, 8787, and 9119 were present. `hermes mcp test
real-ming` discovered 17 tools. Eight Ming skills were installed: CAO, CMO,
COO, CTO, knowledge-capture, knowledge-consolidation, personal-CFO, and
real-ming.

Exactly two normal recurring Hermes jobs remained after acceptance testing:
Real-Ming Morning Brief and Executive Roll-Up. Temporary acceptance jobs were
removed. Do not enable recurring knowledge consolidation merely to make the
documentation sound more complete.

## Live acceptance evidence already obtained

### Work Item lifecycle and Notion

Native Hermes invoked `real_ming_capture_work_item` in production.

- Work Item ID: `8d78fde1-45b3-4377-b89b-dd04d38636cc`
- Intent: `[Live acceptance #54] Verify native Hermes Work Item and Notion projection`
- State: `Captured`
- Notion category: `Pending`
- Role/workstream: `CTO` / `MicroSaaS`
- Idempotency key: `rm54-live-work-item-notion-v1`
- Replay returned the same Work Item ID with `deduplicated: true`.
- Notion version count for the item: 1.
- Notion page reference: `3db89b83-bac5-81b6-8b28-df768d840c9e`.

The capture call waited for the actual Notion provider projection. A failed
projection would have failed the call, so this is production-write evidence,
not only a local queue assertion.

### Selective native knowledge

- Initial generation:
  `native-knowledge-generation-27494686-f4a7-4aa9-80a8-5ff846c09b09`
- Current active generation:
  `native-knowledge-generation-cb09e3ed-3e95-46ec-ac4a-4592cd762115`
- Live citation: `issue:54/live-acceptance-live`
- Trust Domain: `Ming Creatives`
- Native Hermes retrieved the live citation through the production MCP surface.
- A `Personal CFO` request for `Ming Creatives` was refused as unauthorized.
- Forget subject: `rm54-live-acceptance-alpha`.
- Forget result: suppression epoch 1, tombstone-head epoch 1,
  `restore-safe`.
- The independent Azure tombstone head was read and written through managed
  identity.
- Retrieval continuity succeeded after forgetting the alpha subject.
- Registry state at the checkpoint: publication epoch 2, tombstone epoch 1,
  tombstone-head epoch 1, repair state `healthy`.
- The pinned Hermes one-shot wrapper completed successfully twice using only
  the four-operation allowlist: list candidates, read source, stage generation,
  and wiki retrieve.

The first fixture attempt failed safely because its content hash lacked the
required `sha256:` prefix. Nothing was activated. Its registry was retained at
`/var/lib/real-ming/native-knowledge.failed-rm54.sqlite` as failure evidence;
do not present it as an outage or delete it during this ticket.

### Telegram delivery

The scheduled native Hermes acceptance job completed and its delivery ledger
recorded `delivered` with no error.

- Job ID: `c6473873c347`
- Execution ID: `e5216e8376bd44d4bf690421508cd7f1`
- Completion time: 2026-09-14 12:40 Malaysia time.

The temporary job was removed afterward. This proves the production Telegram
delivery path; do not send another acceptance message unless a new defect makes
it necessary.

## Incident observed and recovered during rollout

Before the final deployment, `real-ming.service` was restart-looping with
`unable to open database file` while Hermes/Telegram remained healthy. The
service was stopped, its mounted SQLite state passed integrity checks, and it
was restarted successfully. The final check showed `NRestarts=0` and all three
services active. The exact underlying stale/open-state cause was not proven, so
do not overstate a root cause in documentation.

Rollback assets retained on the host:

- `/opt/real-ming-extension.pre-rm54`
- image `real-ming:v6-9ef3fac`
- `/var/lib/hermes-real-ming/config.yaml.pre-rm54`
- `/var/lib/real-ming/native-knowledge.failed-rm54.sqlite`

## Exact stopped point: backup hardening

Codex stopped after adding, but before fully verifying and committing, this
small protected-backup change:

- `deploy/backup-control-plane.sh` passes
  `REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH=/var/lib/real-ming/native-knowledge.sqlite`
  into the backup container.
- `test/system/control-plane-runtime.system.test.ts` asserts that production
  composition includes the live registry.
- The test was first run red before the script was patched.
- The targeted green run passed at handoff: 1 passed, 33 skipped, exit 0.
- The updated backup script has **not** yet been installed on production.
- The post-activation protected backup and manifest verification remain undone.

When this handoff is committed, these two files may already be part of the same
checkpoint commit. Verify with `git status` and `git log`; do not redo the red
phase or discard the patch.

## Required continuation, in order

1. Read `AGENTS.md`, this file, `CONTEXT.md`, `docs/BASELINE.md`,
   `docs/specs/real-ming-v1.1.md`,
   `docs/agents/notion-task-status-semantics.md`, and issue #54 with comments.
2. Confirm branch/status/log and inspect the entire diff against `ef49bef`.
3. Re-run the focused backup test if the checkout or patch differs from this
   handoff; the recorded checkpoint command is:

   ```powershell
   npx vitest run test/system/control-plane-runtime.system.test.ts -t "includes the live native-knowledge registry"
   ```

4. Finish the requested truthful documentation:

   - Update `README.md` capability statuses and Mermaid architecture.
   - Show 8 Ming skills and 17 Real-Ming MCP tools.
   - Show native Hermes governed Work Item capture flowing through lifecycle to
     Notion Master Tasks.
   - Show role/domain-gated native knowledge, generated Obsidian wiki state,
     the native registry, and independent Azure tombstone head.
   - Mark Work Items/lifecycle, Notion task coordination, and role-scoped
     selective wiki consolidation `Live`.
   - Keep recurring consolidation explicitly disabled.
   - Do not mark the whole legacy six-root Curated Knowledge Vault live.
   - Update
     `docs/architecture/real-ming-agent-diagram-v7-cleanup.html`; remove stale
     `no production caller` / `controlled-tested only` claims from the selective
     native path while retaining them where they still describe the legacy
     optional vault.
   - Add an RM-54 live-test/evidence record under `docs/evidence/`, using the IDs
     in this handoff and recording expected versus observed results.
   - Update `CEO-Office/README.md` and any activation runbook status that still
     describes this completed rollout as waiting, without turning evidence into
     a CEO action item.

5. Preserve the Real-Ming v1.1 Architecture Revision 6 design baseline. The
   deployed revision is separate and may be described separately.
6. Run `npm run check`, `npm audit --audit-level=high`, and `git diff --check`;
   require successful exit codes.
7. Obtain independent Standards and Spec reviews against the fixed ticket base
   `ef49bef`. Reproduce any suspected correctness defect with a failing approved-
   seam test before changing implementation.
8. Commit and push only RM-54 work to
   `origin/codex/live-operations-and-knowledge`.
9. Install the committed `deploy/backup-control-plane.sh` on the scoped host in
   an LF-safe way. Confirm the backup systemd unit's actual script path before
   replacing it. Run one protected backup and verify by manifest/content listing
   that the native-knowledge registry and required generated/tombstone material
   are recoverable. Do not print secrets.
10. Reconfirm the three services, three loopback listeners, MCP tool count 17,
    current active knowledge generation, and exactly two normal recurring jobs.
11. Add the final evidence and commit/push it. Comment issue #54 with commits,
    gate exit codes, live evidence, and review verdicts. Open the milestone pull
    request if none exists, but do not merge without explicit merge authority.
    Close #54 only when every acceptance criterion and the protected-backup
    follow-up are evidenced.

## Completion criteria

RM-54 is complete only when:

- the backup change is green, installed, executed, and its recoverability is
  evidenced;
- README and HTML architecture tell the same truthful live/legacy story;
- live evidence exists under `docs/evidence/`;
- all repository gates pass after the final diff;
- Standards and Spec reviews have no unresolved correctness defect;
- all ticket changes are committed and pushed on the named branch;
- production remains healthy with two normal recurring jobs and no temporary
  acceptance job; and
- issue #54 contains the evidence-backed closeout.

## Copy/paste prompt for Claude Code

```text
Continue the stopped Real-Ming RM-54 rollout from the exact checkpoint in docs/agents/RM-54-live-operations-and-knowledge-handoff-2026-09-14.md.

Repository: C:\Users\quekm\Desktop\projects\real-me
Branch: codex/live-operations-and-knowledge
Issue: pmgwee/real-ming#54

This is a continuation, not a new plan. Read AGENTS.md and the handoff in full, then verify git status, git log, the complete ef49bef..HEAD diff, and the live issue comments. Preserve every existing change. The deployed implementation is c4ee6eb. Start at the handoff's “Exact stopped point: backup hardening”: record the targeted green test, finish the protected native-knowledge backup, complete the README capability table and Mermaid architecture, update the matching architecture HTML, add the production live-test evidence, synchronize the status board/runbook, run all gates, obtain independent Standards and Spec reviews, push the final RM-54 commits, perform the already-authorized scoped backup deployment and read-only production verification, and close out issue #54 with evidence.

Use the handoff's exact live IDs and truth distinction. Work Items/lifecycle, Notion coordination, and role-scoped selective native wiki consolidation are live. Recurring consolidation is disabled. The older six-root encrypted Curated Knowledge Vault remains a separate retained/partial optional architecture and must not be falsely labelled live. Preserve Architecture Revision 6. Do not ask again for approval already granted for the scoped RM-54 continuation, but do not expand that authority, merge a pull request, delete data, expose secrets, or make unrelated production changes.
```
