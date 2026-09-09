# RM-40 native knowledge consolidation — bounded remediation review packet

**Overall status: READY FOR INDEPENDENT REMEDIATION REVIEW**

This is a controlled, local remediation record. It is not independent
acceptance, deployment evidence, provider verification, live acceptance, or
recurring-job authorization.

| Field | Value |
| --- | --- |
| Repository | `C:\Users\quekm\Desktop\projects\real-me` |
| Branch | `fix/rm40-native-knowledge-remediation` |
| Reviewed base | `669355afaebae0a65a85d9712c28328b49b9db7f` |
| Corrective implementation tip (before this evidence-only commit) | `265124a940bfd126ddb89934b3392a76b0ef3380` |
| Review date | 9 September 2026 (Asia/Kuala_Lumpur) |
| Scope | Confirmed RM-40 remediation items 1–12; Tasks 0–8 only |
| Explicitly deferred | Task 9 stale-code deletion and every live/outward-facing action |

The evidence packet is committed separately after the corrective tip. Use the
corrective tip above for the implementation diff and the branch tip for the
complete review artifact.

## Authority and review instructions

The exact reviewed history is the range:

~~~text
669355afaebae0a65a85d9712c28328b49b9db7f..265124a940bfd126ddb89934b3392a76b0ef3380
~~~

Read these documents with their stated authority order:

- [POST-RM-40 handoff](../agents/POST-RM-40-HANDOFF.md)
- [Task 0–8 native-first plan](../superpowers/plans/2026-09-09-native-knowledge-consolidation.md)
- [Native knowledge design specification](../superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md)
- [ADR-0022](../adr/0022-native-knowledge-consolidation-around-hermes.md)
- [Controlled acceptance snapshot](native-knowledge-consolidation-controlled-acceptance-2026-09-09.md) (historical; superseded by this packet)
- [Pinned-Hermes isolation evidence](native-knowledge-hermes-isolation-preflight-2026-09-09.md)
- [Module disposition inventory](../planning/RM-40-v6-module-disposition-inventory.md)

This packet does not authorize push, PR, merge, deployment, provider calls,
live credentials, service restart, systemd installation, cron creation or
activation, Telegram delivery, Obsidian synchronization, or Task 9 deletion.

## What was remediated

The branch preserves the native-first architecture:

- Hermes remains the sole reasoning, synthesis, Telegram, conversation,
  native-memory, session-history, skill, plugin and MCP runtime.
- Real-Ming remains a deterministic coordination and integration layer.
- Candidate capture is selective; ordinary conversations are not intercepted
  or swept.
- The registry stores bounded metadata and pointers, not a second memory
  engine.
- The generated Azure vault path is canonical. A future local Obsidian mirror
  is optional, one-way, activation-triggered and read-only; it is not a
  Tasks 0–8 dependency or a retrieval runtime dependency.
- The proposed native cron row remains inactive at
  `02:00 Asia/Kuala_Lumpur`; the existing operational reports are not
  replaced or duplicated.
- Successful consolidation is silent; failures/backlog are represented by
  the existing opaque health/report surface.

The remediation closes the reviewed defects: exact source-byte hashes,
transactional local forgetting and outbox creation, backup coverage, replay
before restore enablement, conditional tombstone-head creation, complete
retrieval dependencies and final fences, current publication fencing,
production MCP composition, real pinned-Hermes isolation, a functional
wrapper, bounded storage cleanup, and repository verification determinism.

## Exact focused local commits

All rows below are local commits. No row was pushed.

| Order | Full commit | Purpose |
| ---: | --- | --- |
| 1 | `373c9352213a8cfe910db8f3e56cf2f79faff64b` | Verify complete SHA-256 source-byte identities |
| 2 | `addff0939df91353a6ca24ce823f078e525e5b73` | Atomically persist local forgetting and its tombstone outbox |
| 3 | `9ba1f6e1cddcf01ad22aaeee9bb75b2ded1683ad` | Include the tombstone outbox in the backup path |
| 4 | `da4975d636e9fc82c4d67755b324a7f8c8222af8` | Reconcile newer independent tombstones during restore |
| 5 | `3e1c3acf668be2b65875e740b48cdc1b33c3d382` | Use absence semantics for Azure initial tombstone creation |
| 6 | `775075026bc3a4170442d8106b752670f37596c1` | Fence retrieval across all source dependencies |
| 7 | `031c99637135ef9e57cd898a5b6129c33b73c462` | Fence runner publication with authoritative epochs |
| 8 | `fd7e4e58ff322c60f67e67a1fceedf0436781d51` | Wire production knowledge MCP operations |
| 9 | `c73db047d0f07479bb4ee76b8e93b815c0b7f0c2` | Prove the pinned Hermes isolation boundary |
| 10 | `7c85a0a07137325be993ce4df095dba878917f41` | Execute the controlled consolidation wrapper |
| 11 | `08538a2a1ae520367ad7c68089a71c2859518e23` | Enforce generation budgets and retention |
| 12 | `d507e15fac0cebb1c62cabbc4a30f5b114f4c828` | Preserve the separate native-knowledge registry in backup |
| 13 | `8c05be2349b0c734ea4c9a4de96d86ce1c23fedd` | Fence tombstone transitions and replay ordering |
| 14 | `ec88cebb42316c69dff2e48e951667abb4f7c757` | Clean failed staging and protect in-progress generations |
| 15 | `d3ca7f28dd92a42f6b408ac4b3d3443f2e2a2cf0` | Take publication timestamps at the final fence |
| 16 | `2a86d3008a0c6a2cd76da4ae7f87cd90c6f5aa6f` | Harden controlled wrapper and exact evidence fixtures |
| 17 | `ab14c2df880c0329dda886c5984bef0218dca17b` | Preserve opaque tombstone ETags |
| 18 | `42b7a6c08242d3b859e594a9e91b55609c855b0b` | Fence mutated page bytes during retrieval |
| 19 | `007bbb932c766cf753e922d1c3075f963ff3696d` | Isolate the pinned probe from ambient providers |
| 20 | `a3cf326f6bb26cc51a9b8ff3aa7f6aa535c0f36f` | Exercise production capture through MCP composition |
| 21 | `4cb282d4614e2631c4a665b8d2473e440f6ac897` | Rebase knowledge generation paths after isolated restore |
| 22 | `4bf588076771078e5995084634a49addf4aaaee3` | Enforce the wrapper credential boundary |
| 23 | `bcdd81a277759097cba5177808fbceb79366b511` | Add the synthetic production-path acceptance test |
| 24 | `37914fbd9a09f00dfed6bb834ddb013874d087a9` | Align plan, ADR, handoff and historical evidence records |
| 25 | `b64bbcbfa864344d78bb98fc9270a1d9eda177fb` | Inventory native-knowledge configuration names safely |
| 26 | `265124a940bfd126ddb89934b3392a76b0ef3380` | Serialize the isolation suite for deterministic repository checks |

## Changed files and exact diff

The corrective range contains **35 files, 3,207 insertions and 285
deletions**:

~~~text
.env.example
docs/adr/0022-native-knowledge-consolidation-around-hermes.md
docs/agents/POST-RM-40-HANDOFF.md
docs/agents/RM-40-task0-8-review-packet-2026-09-09.md
docs/evidence/native-knowledge-consolidation-controlled-acceptance-2026-09-09.md
docs/evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md
docs/superpowers/plans/2026-09-09-native-knowledge-consolidation.md
docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md
hermes/scripts/run-native-knowledge-consolidation.py
hermes/scripts/verify-native-knowledge-isolation.py
src/config/control-plane-backup-cli.ts
src/config/native-knowledge-consolidation-cli.ts
src/config/real-ming-mcp-cli.ts
src/integration/real-ming-tools.ts
src/knowledge/native-consolidation/contracts.ts
src/knowledge/native-consolidation/evidence.ts
src/knowledge/native-consolidation/publication.ts
src/knowledge/native-consolidation/registry.ts
src/knowledge/native-consolidation/retrieval.ts
src/knowledge/native-consolidation/runner.ts
src/knowledge/native-consolidation/tombstones.ts
src/providers/azure-blob-tombstone-head-store.ts
src/runtime/control-plane-backup.ts
test/system/control-plane-backup.system.test.ts
test/system/native-knowledge-evidence.system.test.ts
test/system/native-knowledge-forgetting.system.test.ts
test/system/native-knowledge-isolation.system.test.ts
test/system/native-knowledge-live-acceptance.system.test.ts
test/system/native-knowledge-production-acceptance.system.test.ts
test/system/native-knowledge-publication.system.test.ts
test/system/native-knowledge-retrieval.system.test.ts
test/system/native-knowledge-runner.system.test.ts
test/system/native-knowledge-wrapper.system.test.ts
test/system/real-ming-mcp-composition.system.test.ts
vitest.config.ts
~~~

The exact command and result were:

~~~text
git diff --stat 669355afaebae0a65a85d9712c28328b49b9db7..265124a940bfd126ddb89934b3392a76b0ef3380
35 files changed, 3207 insertions(+), 285 deletions(-)
~~~

## Remediation requirement mapping

| Remediation | Production path | Regression/acceptance coverage |
| --- | --- | --- |
| 1. Exact evidence hashes | `evidence.ts` recomputes exact UTF-8 bytes and requires `sha256:` plus 64 lowercase hex digits | `native-knowledge-evidence.system.test.ts`: fabricated, truncated and mismatched hashes |
| 2. Atomic forget/outbox | `registry.ts` SQLite transaction creates suppression and durable outbox; status transitions are validated | `native-knowledge-forgetting.system.test.ts`: atomic reopen, duplicate/stale/out-of-order transitions and crash boundary |
| 3. Backup coverage | `control-plane-backup.ts` discovers and snapshots the native registry/outbox automatically | `control-plane-backup.system.test.ts`: production forget → backup → restore outbox |
| 4. Restore non-resurrection | `tombstones.ts` keeps retrieval repair-locked, replays every newer head entry, and fails closed on gaps/unavailable state | forgetting suite and production-path acceptance |
| 5. Azure concurrency | `azure-blob-tombstone-head-store.ts` uses `If-None-Match: *` for v0 and opaque concrete ETags for updates | local HTTP/client-adapter creation, conflict, update and retry tests |
| 6. Retrieval completeness | `retrieval.ts` checks every page/path/source dependency, bytes, freshness and final fence | retrieval suite: dependency, tamper, mid-read and concurrent-fence cases |
| 7. Publication/runner fencing | `runner.ts` reads the source epoch, carries complete snapshots, and takes the final clock value before activation | runner/live acceptance: source mutation, forget, lease, epoch and stale-clock cases |
| 8. Production MCP composition | `real-ming-mcp-cli.ts` and `real-ming-tools.ts` expose only the approved retrieve/capture/forget paths | `real-ming-mcp-composition.system.test.ts` and production acceptance |
| 9. Real pinned isolation | `verify-native-knowledge-isolation.py` loads the exact pinned Git object and real pinned `AIAgent`; no fake registry proof | isolation suite: 10/10, including negative controls |
| 10. Executing wrapper | `run-native-knowledge-consolidation.py` launches the compiled production entry point and propagates failures | wrapper suite and production acceptance |
| 11. Limits/retention | publication cleanup enforces 128 pages, 128 KiB/page, 16 MiB snapshot, 64 MiB root and three retained generations | publication/runner boundary, active/protected/in-progress preservation |
| 12. Repository verification | portable interpreter discovery, deterministic single-fork test execution, safe env inventory and whitespace cleanup | full `npm run check`, audit, secrets and diff gates |

## NKC-01 through NKC-14 disposition

These are controlled dispositions only; they do not establish live behavior.

| Requirement | Result | Code/test evidence and boundary |
| --- | --- | --- |
| NKC-01 | **Pass (controlled)** | Explicit/marked capture only; ordinary turns are not swept. Evidence, MCP composition and production-path tests. |
| NKC-02 | **Pass (controlled)** | Bounded secret-safe metadata, exact identity and idempotent admission; registry/evidence/runner tests. |
| NKC-03 | **Pass (controlled)** | Exact source-byte identity, semantic support and freshness at publication/retrieval; a hash is not truth. |
| NKC-04 | **Pass (controlled)** | Hermes owns synthesis/native memory; isolation and failed-job chat tests prove optional failure leaves native chat available. |
| NKC-05 | **Pass (controlled)** | One lease and one SQLite active-generation pointer; activation is the sole publication event. |
| NKC-06 | **Pass (controlled)** | Immutable files are durable and verified before pointer commit; orphan/tamper recovery fails closed. |
| NKC-07 | **Pass on supported path (controlled)** | Forgetting suppresses intake, retrieval, derivatives and final-commit races; arbitrary direct filesystem reads remain outside the guarantee. |
| NKC-08 | **Pass (controlled)** | Independent head, durable outbox and restore replay/repair lock prevent an older backup from resurrecting known forgotten content. |
| NKC-09 | **Pass (controlled)** | Registry, path, manifest, dependency, tombstone and freshness failures return no generated content. |
| NKC-10 | **Pass (controlled)** | Exact pinned `skip_memory=True`, enabled toolset, four-name MCP include, auth separation and OS containment; no fallback. |
| NKC-11 | **Pass (controlled guardrails)** | Candidate/source/page/tool/model/wall/retry/storage limits and ordinary-chat failure isolation are tested; production load is not claimed. |
| NKC-12 | **Pass (controlled)** | Opaque health exposes run/generation/tombstone/backlog/repair/isolation status without source prose or native-memory content. |
| NKC-13 | **Deferred by explicit scope** | Task 9 deletion is not authorized until replacement passes live verification and rollback closes; superseded documents are retained/relabelled. |
| NKC-14 | **Pass (controlled)** | Complete snapshots carry forward valid pages: A then B retains both; forgetting A leaves B available. |

## Task 0 isolation evidence

The controlled probe used the real pinned Hermes source object:

| Control | Observed local result |
| --- | --- |
| Required Hermes commit | `561b053f794a1781868bb032029d589c67708119` |
| Source mode | `exact-git-commit-object` |
| Actual composition | Pinned `AIAgent` constructor/forwarding path exercised |
| Memory | `skip_memory=True`; native memory disabled for the job |
| Enabled toolset | `["real-ming"]` |
| Effective MCP set | Exactly `real_ming_knowledge_list_candidates`, `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation`, `real_ming_wiki_retrieve` |
| Unrelated callables | Work-item, scheduler, calendar and mail operations absent/rejected |
| Authentication | Offline local deterministic model stub; no credential values and networking disabled |
| OS containment | Only disposable staging/job-session roots writable; native memory/config, skills/plugins, cron, credentials and unrelated paths denied |
| Negative controls | Missing flag/include, extra/default toolset, missing auth separation and escape scenarios return exit `78` |

The focused isolation command and result:

~~~text
$env:REAL_MING_PYTHON = Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\venv\Scripts\python.exe'
& 'C:\Users\quekm\Desktop\projects\real-me\node_modules\.bin\vitest.cmd' run test/system/native-knowledge-isolation.system.test.ts --pool=forks --maxWorkers=1
Test Files  1 passed (1)
Tests       10 passed (10)
exit code: 0
~~~

The installed interactive Hermes checkout reports
`runtimeHead=a7198a8855ad98681114ff5138eb01fe132a62e7`, not the approved
`561b053f794a1781868bb032029d589c67708119`. The probe deliberately reads the
exact pinned Git object and therefore does not prove that the installed
interactive executable or an Azure deployment runs that pin. A deployment
artifact must reproduce the probe against its own exact checkout.

## Production-path controlled acceptance

The test
`test/system/native-knowledge-production-acceptance.system.test.ts` uses the
production MCP composition, the functional wrapper, synthetic exact-byte
sources, local registry/backup adapters and no provider:

~~~text
& 'C:\Users\quekm\Desktop\projects\real-me\node_modules\.bin\vitest.cmd' run test/system/native-knowledge-production-acceptance.system.test.ts --pool=forks --maxWorkers=1
Test Files  1 passed (1)
Tests       1 passed (1)
exit code: 0
~~~

It proves the observable sequence: exact source registration and hash
verification; isolated wrapper execution; current source epoch; immutable
staging/activation; cited MCP retrieval; production forget with atomic outbox;
retrieval fencing; automatic outbox backup; old-backup restore with newer
independent tombstone replay before retrieval enablement; non-resurrection
after restore/restart; storage/retention bounds; and absence of provider,
network, Telegram, native-memory, cron, systemd or Obsidian-mirror activity.

## RED → GREEN evidence

The following is the remediation-session regression ledger. Each RED was
observed against the pre-fix parent of the corresponding focused commit; each
GREEN is reproduced from the final corrective tip. The RED entries describe the
defect-triggering assertion, not a weakened or synthetic pass.

| Defect | RED test and observed failure | GREEN command/result | Fix |
| --- | --- | --- | --- |
| Exact hash accepted a fabricated digest | `rejects a fabricated but syntactically valid sha256 claim`; pre-fix prefix-only validation accepted the fabricated value (expected failure) | `native-knowledge-evidence.system.test.ts` within affected run: 11 files/72 tests pass, exit 0 | `373c935` |
| Forget/outbox not atomic | `atomically creates the local suppression and durable outbox, and survives reopen`; pre-fix production operation did not create a durable paired record (expected failure) | Forgetting suite passes in affected run; production acceptance passes 1/1 | `addff09` |
| Backup omitted outbox | `automatically snapshots the production tombstone outbox and restores it`; pre-fix backup had no production-created outbox file (expected failure) | Backup suite: 8/8, exit 0; production acceptance 1/1 | `9ba1f6e`, `d507e15` |
| Restore did not replay newer head | `replays newer independent tombstones before reopening a restored registry`; pre-fix restored registry could reopen without applying the newer entry (expected failure) | Forgetting/production acceptance restore cases pass; exit 0 | `da4975d`, `8c05be2`, `4cb282d` |
| Azure v0 used overwrite condition | `uses a conditional Azure Blob head without returning credential material`; pre-fix request used `If-Match: *` for missing v0 (expected failure) | Azure adapter creation/conflict/update tests pass in forgetting suite | `3e1c3ac`, `ab14c2d` |
| Retrieval checked only first dependency/one fence | `suppresses a page when any source dependency...` and `fails closed when a concurrent tombstone/publication fence changes`; pre-fix forgotten secondary dependencies/races could return content | Retrieval suite: 7/7, exit 0 | `7750750`, `42b7a6c` |
| Runner used epoch 0/stale timestamp | `takes the publication timestamp at the final boundary...` and `fences publication when source state changes...`; pre-fix stale epoch/clock could activate | Runner suite passes; live acceptance 6/6, exit 0 | `031c996`, `d3ca7f2` |
| Production MCP omitted knowledge context/forget | `exposes production knowledge staging, retrieval and supported forgetting`; pre-fix composition lacked the production knowledge context | Composition suite and production acceptance pass, exit 0 | `fd7e4e5`, `a3cf326` |
| Isolation proof used a fake registry/Windows-only path | Pinned isolation run initially failed on Linux path discovery and the ambient credential fixture returned `authentication-not-separated` (expected failure) | Real pinned isolation suite: 10/10, exit 0; negative cases remain 78 | `c73db04`, `007bbb9`, `4bf5880` |
| Wrapper only preflighted | `executes the approved production composition and activates a generation`; pre-fix wrapper returned after checks without running consolidation (expected failure) | Wrapper suite and production acceptance pass, exit 0 | `7c85a0a` |
| Budget/retention cleanup unsafe | One-byte-over, exact-limit, active/protected/in-progress retention cases failed before the bounded cleanup path | Publication/runner cases pass in 72-test affected run | `08538a2`, `ec88ceb` |
| Repository check nondeterministic / config inventory incomplete | Pre-fix full check: worker exited unexpectedly (82/83 files; 926 passed, 2 skipped); tracer secret preflight flagged the new state-path variable as undocumented | Final `npm run check`: 83/83, 937 passed, 2 skipped; secrets preflight exit 0 | `b64bbcb`, `265124a` |

## Mandatory final verification

All commands below were run from the corrective tip
`265124a940bfd126ddb89934b3392a76b0ef3380`. Commands that start Vitest use
one fork because the pinned-Hermes probe launches real local subprocesses; no
assertion is skipped or weakened.

| # | Exact command | Exit | Concise result |
| ---: | --- | ---: | --- |
| 1 | `node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js ci` | 0 | 50 packages installed; 51 audited; 0 vulnerabilities |
| 2 | `node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run typecheck` | 0 | `tsc --noEmit` |
| 3 | `node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run build` | 0 | `tsc -p tsconfig.build.json` |
| 4 | Vitest affected set (11 files, `--pool=forks --maxWorkers=1`) | 0 | 11 files / 72 passed |
| 5 | Vitest production-path acceptance | 0 | 1 file / 1 passed |
| 6 | Vitest real pinned-Hermes isolation | 0 | 1 file / 10 passed |
| 7 | Vitest `test/system/control-plane-backup.system.test.ts` | 0 | 1 file / 8 passed |
| 8 | `node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run check` | 0 | 83 files / 937 passed / 2 skipped; build and deployment preflight passed |
| 9 | `node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js audit --audit-level=high` | 0 | found 0 vulnerabilities |
| 10 | `node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run secrets:preflight` | 0 | 10/9 supplied; names/status only; no value printed/transmitted |
| 11 | `node dist/config/control-plane-deployment-preflight-cli.js` | 0 | Control-plane deployment preflight passed |
| 12 | `git diff --check 669355afaebae0a65a85d9712c28328b49b9db7..265124a940bfd126ddb89934b3392a76b0ef3380` | 0 | no whitespace output |
| 13 | `git status --short` | 0 | no tracked modifications; pre-existing untracked `.claude/`, old review bundle and Python cache preserved |
| 14 | `git log --oneline --decorate 669355afaebae0a65a85d9712c28328b49b9db7..265124a940bfd126ddb89934b3392a76b0ef3380` | 0 | 26 focused commits listed above |
| 15 | `git diff --stat 669355afaebae0a65a85d9712c28328b49b9db7..265124a940bfd126ddb89934b3392a76b0ef3380` | 0 | 35 files, 3,207 insertions, 285 deletions |

The two full-suite skips are the deliberately closed live-provider tests:
`RM-07 live Telegram read smoke` and `RM-12 live Google Calendar read
smoke`. Browser dashboard tests ran in the full check; no browser
prerequisite is being silently treated as a pass.

## Unresolved defects, environment prerequisites and CEO/live actions

No locally provable remediation defect remains red.

The following are intentionally unresolved live boundaries:

1. **Pinned deployment artifact:** the installed interactive Hermes head
   `a7198a8855ad98681114ff5138eb01fe132a62e7` differs from the required
   pinned source object. A deployment artifact must be built from
   `561b053f794a1781868bb032029d589c67708119` and rerun the hard gate.
   This is a deployment/live prerequisite, not a controlled-test failure.
2. **Live provider and Azure verification:** no provider request, Azure
   deployment, protected-head append, or production credential mount occurred.
3. **Live Hermes/Telegram acceptance:** fresh-session retrieval, explicit
   forgetting, concurrent native learning, restart/reconcile, dashboard review
   and responsiveness measurements remain in the activation runbook.
4. **Recurring schedule:** the `02:00 Asia/Kuala_Lumpur` row is an inactive
   manifest entry only. Enabling it requires a separate decision after a
   harmless one-shot.
5. **Optional local mirror:** the Azure vault remains canonical. A future
   one-way, read-only Obsidian mirror needs a separate post-live plan and is
   not a runtime dependency.
6. **Task 9 cleanup:** stale implementation code is retained until the
   replacement is live-verified and the rollback window is closed. Historical
   documents are retained and relabelled; no superseded document was deleted.

## Prohibited actions confirmation

During this remediation no push, pull request, merge, deployment, provider
call, live credential access/mount, service restart, cron creation or
activation, systemd installation/activation, Telegram delivery, Obsidian
synchronization, production-state mutation, or Task 9 deletion occurred.
Local tests used synthetic data and fake/local adapters. The secret preflight
reported variable names/status only and emitted no credential value.

**Final status: READY FOR INDEPENDENT REMEDIATION REVIEW**

This status means only that the corrective local artifact and mandatory local
verification are ready for another agent to inspect. It does not authorize or
claim independent acceptance, deployment readiness, production acceptance,
live acceptance, provider verification, or recurring-job activation.
