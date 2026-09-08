# Native knowledge consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The completion record below is authoritative for the controlled implementation; the checkboxes are retained as execution traceability.

**Goal:** Add a selective, source-backed Obsidian/LLM-Wiki maintenance path around native Hermes without intercepting ordinary turns or changing native Hermes memory, Telegram, skills, tools, plugins, MCP, cron ownership, or session behavior.

**Architecture:** Hermes remains the only reasoning and synthesis runtime. A native cron trigger invokes a job-scoped Hermes `AIAgent` with explicit memory-off and toolset controls; Hermes writes an immutable candidate generation to an agent-owned staging root. A minimal Real-Ming registry admits candidates, verifies bounded provenance, serializes leases/publication/forgetting, and exposes the supported `wiki_retrieve` path. SQLite is the sole active-generation authority; the filesystem is prepared and verified before the SQLite pointer transaction, and an independent protected tombstone head is required during restore.

**Tech Stack:** Node.js 24+ and TypeScript ESM, built-in `node:sqlite`, existing Real-Ming System Harness and Provider Adapter Contract Harness, native Hermes v0.21.0 pinned at `561b053f794a1781868bb032029d589c67708119`, native LLM-Wiki/Obsidian skills, native cron, and the existing protected Azure Blob backup store.

**Spec:** `docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md` and `docs/adr/0022-native-knowledge-consolidation-around-hermes.md`

## Global Constraints

- The design baseline remains **Real-Ming v1.1 · Architecture Revision 6**; Hermes owns Telegram, conversation, native memory/profile, session history, tools, skills, plugins, MCP, cron, Kanban and the final answer.
- Candidate admission is selective: explicit save, deliberately marked decision/correction, or deliberately selected source-backed project/research artifact. No universal conversation hook, gateway wrapper, full-session sweep, or native-memory-deletion interception.
- The registry stores bounded metadata and pointers only. It is not a second conversation archive, vector store, compiler, authorization engine, or copy of `MEMORY.md`/`USER.md`.
- Default tests use only the two approved seams: `src/testing/real-ming-system-harness.ts` and `src/testing/provider-adapter-contract-harness.ts`. They never contact a provider, spend quota, use a credential, or touch production data.
- Verify every command by exit code: `npm run check`, `npm audit --audit-level=high`, and `git diff --check`. Do not infer success from model prose or log text.
- Secrets remain in ignored `.env`/secret storage. Plans, tests, manifests, logs and prompts contain variable names and opaque identifiers only.
- Ordinary native Hermes chat remains available if the registry, consolidation job, provider, or projection is unavailable. Wiki retrieval fails closed; native memory and session history continue independently.
- Local implementation and focused commits for Tasks 0–8 are authorized by the 9 September 2026 CEO decision. Push, deployment, cron activation, configuration mutation, provider mutation and live acceptance remain unauthorized. Task 9 deletion remains separately gated by live replacement verification.
- Superseded documents are relabeled with scope/date and retained. Stale code is deleted only after its replacement has passed live verification, one focused deletion commit at a time, following `docs/planning/RM-40-v6-module-disposition-inventory.md`.

---

## Status and hard decisions resolved by this plan

This plan was approved for bounded local implementation on 9 September 2026
after the personal-agent review. Tasks 0–8 are now implemented and
controlled-tested; this does not claim a production caller, live acceptance or
an active cron row. Task 9 remains outside the approval. The four review
findings are resolved as follows:

1. **Publication ordering.** Markdown files and SQLite do not share a
   transaction. The writer flushes and verifies a unique temporary generation,
   renames it to a unique immutable generation directory, and flushes its
   parent. `activate_generation` then revalidates the manifest, path, source
   epoch, tombstone epoch and lease token and commits the single SQLite
   `active_generation_id`/publication epoch transaction. Only that pointer
   transaction makes the already-installed directory eligible to
   `wiki_retrieve`. A crash before the pointer commit leaves an orphan that is
   quarantined while the previous pointer remains active; a crash after the
   pointer commit is reconciled by manifest read-back before the run is marked
   successful.
2. **Actual job isolation.** The native cron row is a script-only trigger. Its
   wrapper starts the pinned Hermes `AIAgent` with the exact supported
   per-invocation `skip_memory=True` control and the pinned MCP `tools.include`
   set exactly to `real_ming_knowledge_list_candidates`,
   `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation`
   and `real_ming_wiki_retrieve`; activation remains a local deterministic
   operation. The wrapper runs in a dedicated Hermes home/work directory under
   OS permissions that make the main Hermes home, `MEMORY.md`, `USER.md`,
   profile/configuration, skills/plugins, cron store, credentials and unrelated
   paths non-writable. The pinned-runtime preflight is a hard gate: it must
   prove the constructor/CLI flags, effective callable set, denied unrelated
   operations and OS denials on the exact pinned source before any production
   implementation or activation. It rejects any missing flag,
   allowlist-resolution error, extra callable, or fallback to the full default
   toolset; there is no permissive alternative in this slice. A named
   session/profile alone is never evidence of isolation.
3. **Restore safety.** A local forget first creates durable local suppression;
   it is `head_sync_pending` until an independent, append-only
   `tombstone-head` object in the existing protected Azure Blob backup store
   accepts the entry and a read-back verifies its monotonic epoch and identity.
    A forget is not acknowledged as `restore_safe` before that read-back.
   Restore reads and verifies the head before enabling the wiki reader, replays
   every head entry newer than the restored snapshot, and requires the remote
   head to cover the snapshot's highest local tombstone epoch and any pending
   outbox entries. A readable but incomplete head, a pending local entry, or an
   unknown completeness state keeps retrieval disabled with `needs-repair`.
   An old generation or old registry backup can therefore never silently
   resurrect a known forgotten claim; a forget that occurred after the last
   backup and never reached the independent head is explicitly outside the
   recoverable guarantee and fails closed.
4. **Continuity, limits and rollout.** Each generation is a complete active
   snapshot that carries forward still-valid pages; the plan tests A then B,
   forgets only A, and bounds pages, bytes, storage, model/tool calls, retries
   and total wall time with concrete values. Native-chat noninterference uses
   paired p95 thresholds. Rollout is reviewed artifact → deployment with
   recurrence disabled → authorized one-shot → evidence review → separate
   approval to enable one recurring row.

## Proposed first-slice defaults (not yet activation approval)

| Decision | Proposed first slice | Boundary |
| --- | --- | --- |
| Candidate kinds | Explicit decisions/corrections and deliberately selected project/research artifacts | No ordinary-turn sweep; no calendar, task, mail, GitHub, Vercel or provider dumps |
| Source classes | Bounded user statement, project artifact, or research artifact with a stable reference and excerpt | A missing source route or freshness policy is quarantined |
| Freshness | Decisions remain usable until superseded/forgotten; project artifacts 90 days; research artifacts 30 days | Windows are versioned configuration; live-source profiles require a later decision |
| Generated path | `${OBSIDIAN_VAULT_PATH}/.real-ming/generated`; staging at `${OBSIDIAN_VAULT_PATH}/.real-ming/staging` | Azure is canonical. A future local Obsidian mirror is optional, one-way, activation-triggered and read-only; it is not a Tasks 0–8 dependency |
| Registry | Existing Real-Ming SQLite state plus minimal consolidation tables | No full payloads, native memory copy, search index, or second memory engine |
| Schedule | One native cron job at `02:00` daily, `Asia/Kuala_Lumpur`, delivery `local`/silent | Exact time and production activation require a separate approval |
| Run limits | One lease; 12 candidates; 64 KiB candidate envelope; 256 KiB source/2 MiB run; 1 model call; 48 MCP/tool calls; 10-minute total wall budget with two retries sharing it | Later tuning is a versioned, reviewed configuration change |
| Snapshot/storage limits | 128 pages; 128 KiB/page; 16 MiB active snapshot; 64 MiB generated root; three retained generations | Never evict the active generation; leave the run queued/unactivated on overflow |
| Chat responsiveness | 20 baseline and 20 paired short-turn samples; p95 first progress ≤ baseline + 2 s and ≤5 s absolute; p95 completion ≤125% baseline; zero dropped/failed paired turns | Record measured values; fail the run/acceptance if any threshold is missed |
| Notifications | Silent success; deduplicated failure/backlog health in the next operational report | Immediate Telegram interruption requires a separate decision |

## Requirement-to-task map

| Requirement | Meaning | Implemented/proven by |
| --- | --- | --- |
| NKC-01 | Ordinary turns are not intercepted or swept | Tasks 1, 2, 8 |
| NKC-02 | Explicit/marked candidates are bounded, secret-safe and idempotent | Tasks 1–2, 8 |
| NKC-03 | Source support and freshness are checked at publish and retrieve; hash is not truth | Tasks 2, 5, 8 |
| NKC-04 | Hermes owns synthesis and native memory is untouched | Tasks 0, 6, 8 |
| NKC-05 | One deterministic publication authority and one active generation | Tasks 1, 3, 8 |
| NKC-06 | Filesystem/SQLite crash protocol is recoverable | Tasks 3, 8 |
| NKC-07 | Explicit forget suppresses intake, retrieval, derivatives and in-flight publication | Task 4, 8 |
| NKC-08 | Restore cannot resurrect claims from an older backup | Task 4, 8 |
| NKC-09 | Supported retrieval fails closed on registry/path/manifest/freshness failure | Task 5, 8 |
| NKC-10 | Native cron has actual job-local memory/tool/filesystem isolation | Tasks 0, 6, 8 |
| NKC-11 | Resource limits and failure isolation preserve ordinary chat | Tasks 6–8 |
| NKC-12 | Dashboard reports run, generation, tombstone and repair health | Task 7, 8 |
| NKC-13 | Stale code/doc cleanup follows live-verification gates | Task 9 |
| NKC-14 | Successive complete snapshots retain valid prior knowledge while forgetting suppresses only its dependencies | Tasks 3, 5, 8 |

## Implemented file map and ownership

Create the following focused units; do not grow `knowledge-operations.ts` into
another orchestration monolith:

| Path | Responsibility |
| --- | --- |
| `src/knowledge/native-consolidation/contracts.ts` | Candidate, source, freshness, lease, tombstone, manifest, run and reader result types |
| `src/knowledge/native-consolidation/registry.ts` | Minimal SQLite metadata, idempotent admission, lease fencing, active pointer and append-only status transitions |
| `src/knowledge/native-consolidation/evidence.ts` | Source routing, excerpt/hash identity checks, support disposition and retrieval-time freshness |
| `src/knowledge/native-consolidation/publication.ts` | Immutable generation staging, fsync/rename protocol, path/symlink checks and `activate_generation` |
| `src/knowledge/native-consolidation/tombstones.ts` | Forget normalization, derivative dependencies, local suppression and independent-head reconciliation |
| `src/knowledge/native-consolidation/retrieval.ts` | Supported active-generation reader with fail-closed checks and bounded cited results |
| `src/knowledge/native-consolidation/runner.ts` | One bounded consolidation run: claim → evidence → Hermes synthesis boundary → activation/reconcile |
| `src/providers/azure-blob-tombstone-head-store.ts` | Conditional read/append of the independent protected tombstone head; no credential literals |
| `hermes/scripts/run-native-knowledge-consolidation.py` | Native cron wrapper that proves the pinned Hermes invocation flags and launches the isolated `AIAgent` |
| `hermes/skills/ming/knowledge-capture/SKILL.md` | Explicit-save and marked-signal guidance; no universal hook claims |
| `hermes/skills/ming/knowledge-consolidation/SKILL.md` | Source reading, claim labels, citation and `wiki_retrieve` workflow for the job |
| `src/config/native-knowledge-cron-manifest.ts` | Reviewable, secret-free cron definition and proposed limits; no activation side effect |
| `test/system/native-knowledge-registry.system.test.ts` | Registry, leases, idempotency and publication pointer scenarios |
| `test/system/native-knowledge-publication.system.test.ts` | File/SQLite ordering, path safety and crash failpoints |
| `test/system/native-knowledge-forgetting.system.test.ts` | Forget races, derivatives, restore and tombstone-head states |
| `test/system/native-knowledge-retrieval.system.test.ts` | Reader, freshness, fail-closed and cited-output scenarios |
| `test/system/native-knowledge-isolation.system.test.ts` | Pinned Hermes flags, prohibited writes, resource limits and concurrent native learning |
| `test/system/native-knowledge-live-acceptance.system.test.ts` | Controlled acceptance matrix using the two approved harness seams only |

Modify only after the new unit has a failing test: `src/operations/operations-state.ts` (additive metadata tables), `src/integration/real-ming-tools.ts` (MCP operations), `src/runtime/control-plane-backup.ts` and `src/config/control-plane-restore-cli.ts` (tombstone checkpoint/reconcile), `src/dashboard/dashboard-read-model.ts` (health), `src/testing/real-ming-system-harness.ts` (injected seams), and the affected V6 documentation/evidence. Do not make the legacy `KnowledgeVault`/`KnowledgeCompiler` the new reader by accident.

---

### Task 0: Pin the Hermes isolation mechanism before writing production code

**Status:** ✅ implemented and controlled-tested locally; no live provider or
production launch. Evidence: [Task 0 preflight](../../evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md).

**Files:**

- Create: `hermes/scripts/verify-native-knowledge-isolation.py`
- Create: `docs/evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md` after the probe passes
- Test: `test/system/native-knowledge-isolation.system.test.ts` (initial failing compatibility case)

**Interfaces:**

- Consumes: pinned Hermes checkout/version, a disposable profile, temporary staging/source roots, and the existing `real-ming` MCP registration.
- Produces: `IsolationProbeResult { hermesCommit, skipMemory, enabledToolsets, effectiveMcpTools, deniedMcpTools, authMode, writableRoots, deniedTargets, fallbackDetected, eligible }`; nonzero exit when `eligible` is false.

- [ ] **Step 1: Write the failing compatibility test.** Construct a disposable job configuration that requires `skip_memory=True`, the pinned file toolset, and a `real-ming` MCP server `tools.include` set exactly to `real_ming_knowledge_list_candidates`, `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation` and `real_ming_wiki_retrieve`. Do not treat an `enabled_toolsets` value such as `real-ming` as an operation filter; if the pinned runtime requires an additional MCP toolset identifier, it must still resolve to this exact callable set. Assert that a missing constructor/CLI flag, an unsupported include filter, an effective callable outside that four-name set, or a resolved full default toolset returns `eligible: false`. The test uses a fake/local model boundary, disabled networking and no credentials.

```ts
expect(probe({
  requiredCommit: "561b053f794a1781868bb032029d589c67708119",
  requiredSkipMemory: true,
  requiredMcpTools: [
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
  ],
}).eligible).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `npm run test -- test/system/native-knowledge-isolation.system.test.ts`

Expected: FAIL because the probe does not yet exist.

- [ ] **Step 3: Implement the read-only pinned-runtime probe.** Resolve the installed Hermes source and exact commit, inspect the pinned `AIAgent` constructor/CLI surface and MCP `tools.include` implementation, launch a disposable agent with `skip_memory=True`, and record the effective callable list rather than trusting requested values. Require set equality with the four permitted operation names. Invoke each permitted operation against a fake adapter, assert that every existing work-item, scheduler, calendar and mail operation is absent/rejected, and verify mutation sentinels remain untouched. Refuse to continue if the effective list is missing, widened, resolved through a fallback, or cannot be enforced at the server capability boundary. Exercise write attempts against `MEMORY.md`, `USER.md`, profile/configuration, skill/plugin/cron paths and an unrelated path; only the staging root and job session directory may change. Verify `hermes --version` and the commit without reading credential values.

- [ ] **Step 4: Prove OS-level containment and authentication separation.** Run the probe under the dedicated service/user or transient unit with `ProtectSystem=strict` (or the pinned host's equivalent), explicit writable staging/session paths, read-only source/skill paths, and inaccessible native-memory/config paths. Include traversal and symlink attempts. The offline probe uses a fake/local model boundary with networking disabled and no credential files. Document the later live rule: only a named Hermes auth profile may be mounted read-only for the dedicated job identity; the wrapper must not inherit the interactive service environment or Telegram, Notion, Calendar, mail, GitHub or Vercel credentials. A named session/profile without these checks is an ineligible result.

- [ ] **Step 5: Run the focused test and verify it passes.**

Run: `npm run test -- test/system/native-knowledge-isolation.system.test.ts`

Expected: PASS for the controlled fake and the pinned-runtime probe; no provider calls or credential values appear.

- [x] **Step 6: Record evidence and commit under the approved local implementation scope.** Record the pinned source paths/line numbers, effective flags, exact effective MCP callable set, denied-operation results, authentication mode (fake/local only for this task), denied-write results and exit codes in `docs/evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md`. Do not activate a cron row if this evidence is absent or if the effective list is not exactly the four permitted operations.

```bash
git add hermes/scripts/verify-native-knowledge-isolation.py test/system/native-knowledge-isolation.system.test.ts docs/evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md
git commit -m "test(knowledge): prove pinned Hermes job isolation"
```

---

### Task 1: Define the minimal registry and lease/fingerprint contract

**Status:** ✅ implemented and controlled-tested locally; SQLite stores bounded
metadata and pointers only.

**Files:**

- Create: `src/knowledge/native-consolidation/contracts.ts`
- Create: `src/knowledge/native-consolidation/registry.ts`
- Modify: `src/operations/operations-state.ts` (additive tables/triggers only)
- Modify: `src/testing/real-ming-system-harness.ts` (inject registry state path)
- Test: `test/system/native-knowledge-registry.system.test.ts`

**Interfaces:**

- `admitCandidate(candidate: NativeKnowledgeCandidate): AdmissionResult`
- `claimRun(input: { readonly operatingDate: string; readonly limit: number }): LeaseClaimResult`
- `recordStagedGeneration(input: StagedGeneration): void`
- `activateGeneration(input: ActivationRequest): ActivationResult`
- `activeGeneration(): ActiveGeneration | undefined`
- `appendLocalTombstone(input: ForgetRequest): TombstoneRecord`
- `runHealth(): NativeKnowledgeRunHealth`

- [ ] **Step 1: Write failing tests for schema and idempotency.** Cover one accepted candidate, rejection of an empty/oversized/secret-bearing envelope, duplicate fingerprint returning the existing candidate, one live lease, expired lease fencing, append-only status changes, and no full content in SQLite.

```ts
const first = registry.admitCandidate(candidateFixture());
const replay = registry.admitCandidate(candidateFixture());
expect(first).toMatchObject({ kind: "accepted" });
expect(replay).toEqual({ kind: "duplicate", candidateId: first.candidateId });
expect(registry.claimRun({ operatingDate: "2026-09-09", limit: 12 }).kind).toBe("claimed");
expect(registry.claimRun({ operatingDate: "2026-09-09", limit: 12 }).kind).toBe("busy");
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `npm run test -- test/system/native-knowledge-registry.system.test.ts`

Expected: FAIL because the new registry types and operations are absent.

- [ ] **Step 3: Add additive SQLite metadata.** Create tables for candidates, runs/leases, generations, publication state, and tombstones with append-only triggers. Store candidate pointers, bounded hashes, source metadata, dispositions, status, dependencies, epoch and failure code; never store the candidate prose or native memory files. Use `BEGIN IMMEDIATE` for lease/epoch transitions and compare the lease token and epoch in every conditional update.

- [ ] **Step 4: Implement admission and lease fencing.** Normalize source references, enforce byte/candidate limits and `detectSensitiveFields`, hash the bounded envelope, use a unique fingerprint, reject a second live lease, and return explicit `duplicate`, `busy`, `denied`, or `accepted` results. An expired worker gets `fenced`, not a successful no-op.

- [ ] **Step 5: Run the focused test and verify it passes.**

Run: `npm run test -- test/system/native-knowledge-registry.system.test.ts`

Expected: PASS with the registry containing metadata only.

- [ ] **Step 6: Commit the independently reviewable registry slice.**

```bash
git add src/knowledge/native-consolidation/contracts.ts src/knowledge/native-consolidation/registry.ts src/operations/operations-state.ts src/testing/real-ming-system-harness.ts test/system/native-knowledge-registry.system.test.ts
git commit -m "feat(knowledge): add bounded consolidation registry"
```

---

### Task 2: Add deliberate capture and source-support/freshness validation

**Status:** ✅ implemented and controlled-tested locally; native Hermes memory
and ordinary conversations remain outside the capture path.

**Files:**

- Create: `src/knowledge/native-consolidation/evidence.ts`
- Create: `hermes/skills/ming/knowledge-capture/SKILL.md`
- Create: `hermes/skills/ming/knowledge-consolidation/SKILL.md`
- Modify: `src/integration/real-ming-tools.ts` (candidate admission operation)
- Test: `test/system/native-knowledge-registry.system.test.ts`, `test/system/native-knowledge-retrieval.system.test.ts`

**Interfaces:**

- `captureCandidate(input: CaptureRequest): Promise<CaptureResult>` — explicit save or deliberate mark only.
- `verifyEvidence(input: EvidenceCheckRequest): Promise<EvidenceCheckResult>` — source route, excerpt/version/hash, support disposition and policy freshness.
- `isFresh(input: { readonly claimClass: ClaimClass; readonly asOf: string; readonly now: string; readonly policy: FreshnessPolicy }): FreshnessResult`

- [ ] **Step 1: Write failing tests for both deliberate paths.** A normal question produces no candidate; an explicit user statement and a marked project artifact each produce one bounded candidate; an unreferenced, secret-bearing, hash-mismatched, stale, unavailable, superseded or unsupported source is rejected/quarantined with the named disposition; replay does not duplicate.

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `npm run test -- test/system/native-knowledge-registry.system.test.ts test/system/native-knowledge-retrieval.system.test.ts`

Expected: FAIL because capture/evidence operations are not registered.

- [ ] **Step 3: Write the capture operation and skills.** Register `real_ming_capture_knowledge_candidate` with an allowlisted `kind`, bounded envelope, source references, `capturedAt`, `asOf`, sensitivity, trust domain and retention class. The skill instructs Hermes to ask for or quote a source and to mark only a deliberate durable signal. It explicitly says that no mark means no nightly ingestion and that the operation does not alter native memory.

- [ ] **Step 4: Implement evidence checks.** Compare the recorded excerpt/structured field to the source version and hash, preserve source account/resource routing and failure class, apply the proposed decision/project/research windows at publication and retrieval, and require an explicit support disposition. Treat a matching hash as identity evidence only; an adversarial fixture with a matching excerpt but an unsupported interpretation must remain quarantined. Label a user statement narrowly as “Ming said/decided X” rather than as proof of an external claim.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run: `npm run test -- test/system/native-knowledge-registry.system.test.ts test/system/native-knowledge-retrieval.system.test.ts`

Expected: PASS; no ordinary-turn candidate, no provider call, and no native memory mutation.

- [ ] **Step 6: Commit the capture/evidence slice.**

```bash
git add src/knowledge/native-consolidation/evidence.ts src/integration/real-ming-tools.ts hermes/skills/ming/knowledge-capture/SKILL.md hermes/skills/ming/knowledge-consolidation/SKILL.md test/system/native-knowledge-registry.system.test.ts test/system/native-knowledge-retrieval.system.test.ts
git commit -m "feat(knowledge): gate selective candidates by evidence"
```

---

### Task 3: Implement immutable generation publication and crash reconciliation

**Status:** ✅ implemented and controlled-tested locally; filesystem preparation
precedes the SQLite active-pointer commit.

**Files:**

- Create: `src/knowledge/native-consolidation/publication.ts`
- Test: `test/system/native-knowledge-publication.system.test.ts`
- Modify: `src/knowledge/native-consolidation/registry.ts` and `src/operations/operations-state.ts`

**Interfaces:**

- `stageGeneration(input: StageGenerationRequest): Promise<StagedGeneration>`
- `activateGeneration(input: ActivationRequest): ActivationResult`
- `reconcileGenerations(input: ReconcileRequest): ReconcileResult`
- `readManifest(path: string): GenerationManifest`

- [ ] **Step 1: Write failing failpoint and continuity tests.** Exercise crashes after each of: candidate claim, file write, manifest flush, temporary-to-immutable rename, SQLite pointer commit, read-back and status update. Assert that readers see either the prior valid generation, one verified new generation, or `needs-repair`/quarantine—never a false `published` state or a staging directory. Publish unrelated page A, publish unrelated page B in a later run, and assert both are retrievable from the second complete active snapshot; then forget A and assert B remains retrievable while A is suppressed.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `npm run test -- test/system/native-knowledge-publication.system.test.ts`

Expected: FAIL because the new publication protocol is absent.

- [ ] **Step 3: Stage and flush a complete immutable snapshot.** Start from the previous active generation's manifest, carry forward every still-valid page, merge the current batch, and write the complete page set plus `index.md`, `log.md` and `manifest.json` below `${OBSIDIAN_VAULT_PATH}/.real-ming/staging/<run_id>`. Reject absolute/`..`/symlink paths, calculate per-file hashes/byte counts, enforce 128 pages/128 KiB per page/16 MiB active-snapshot limits, flush files and directories, and rename to `${OBSIDIAN_VAULT_PATH}/.real-ming/generated/generations/<generation_id>` on the same filesystem. Never edit a generation in place or evict the active generation to fit a new one.

- [ ] **Step 4: Make `activateGeneration` the sole publication authority.** Revalidate path containment, regular-file status, manifest hashes, source/tombstone epoch and lease token. Then use one SQLite transaction to change `active_generation_id`, manifest identity, publication epoch and candidate statuses. Do not describe this as a filesystem/database transaction. The pointer is the only eligibility event.

- [ ] **Step 5: Implement startup reconciliation and retention.** A complete immutable directory with a non-terminal record may finish activation only with the current token/epoch. An orphan with no committed pointer remains quarantined or retention-purge eligible while the previous active pointer serves. A published record with missing/mismatched files clears the active pointer and becomes `needs-repair`. Temporary/incomplete directories never enter the reader. Retain at most three generations and 64 MiB under the generated root; purge only non-active generations after pointer verification, and mark `storage-limit` without evicting the active generation when the cap cannot be met.

- [ ] **Step 6: Run the focused test and verify it passes.**

Run: `npm run test -- test/system/native-knowledge-publication.system.test.ts`

Expected: PASS for all failpoints, path traversal, symlink escape, duplicate activation and old-pointer recovery cases.

- [ ] **Step 7: Commit the publication slice.**

```bash
git add src/knowledge/native-consolidation/publication.ts src/knowledge/native-consolidation/registry.ts src/operations/operations-state.ts test/system/native-knowledge-publication.system.test.ts
git commit -m "feat(knowledge): publish immutable generations with fenced activation"
```

---

### Task 4: Implement explicit forgetting, derivative suppression and independent restore fencing

**Status:** ✅ implemented and controlled-tested locally; supported-path
forgetting is fenced by the independent tombstone-head contract.

**Files:**

- Create: `src/knowledge/native-consolidation/tombstones.ts`
- Create: `src/providers/azure-blob-tombstone-head-store.ts`
- Modify: `src/runtime/control-plane-backup.ts`
- Modify: `src/config/control-plane-restore-cli.ts`
- Test: `test/system/native-knowledge-forgetting.system.test.ts`

**Interfaces:**

- `forgetWikiKnowledge(request: ForgetRequest): Promise<ForgetResult>`
- `TombstoneHeadStore.readHead(): Promise<TombstoneHeadResult>`
- `TombstoneHeadStore.appendIfVersion(input: AppendTombstoneRequest): Promise<AppendTombstoneResult>`
- `reconcileTombstonesAfterRestore(input: RestoreTombstoneRequest): Promise<RestoreTombstoneResult>`
- `ForgetResult.status` is one of `suppressed`, `head_sync_pending`,
  `restore_safe` or `cleanup-complete`; it also returns the local tombstone
  epoch and verified head epoch. `restore_safe` is impossible without a
  successful conditional append and exact read-back.

- [ ] **Step 1: Write failing race and restore tests.** Cover duplicate forgets, forget during final activation, an expired worker after takeover, multi-source derivative suppression, in-flight retrieval, an unavailable/stale remote head, a local tombstone whose Azure append fails followed by host loss and restore, and restoring a backup that predates a newer tombstone. Assert `suppressed`, `head_sync_pending`, `restore_safe` and `cleanup-complete` are distinct states; a readable remote head that lacks a pending local entry must still leave retrieval disabled.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `npm run test -- test/system/native-knowledge-forgetting.system.test.ts`

Expected: FAIL because no tombstone operation or independent head exists.

- [ ] **Step 3: Add the minimal local tombstone ledger and sync outbox.** Normalize subject aliases/source/page IDs, write an append-only tombstone and increment the publication epoch in the same registry serialization boundary used by activation. Filter active retrieval immediately; refuse new candidates and in-flight publication whose token/epoch is older. Store bounded candidate-to-page dependencies, the local tombstone epoch, `head_sync_pending` state and an opaque sync-outbox entry, never forgotten prose in logs. Return local `suppressed` immediately, but do not return `restore_safe` until the independent head is verified.

- [ ] **Step 4: Add and verify the independent protected head.** Implement a provider adapter over the existing protected Azure Blob backup container using conditional ETag/version updates, append-only object/version retention and monotonic epochs. The head is an integrity/versioned user-action ledger, not a semantic-truth hash. On every append, read back the object/version and the exact tombstone identity before returning `restore_safe`; conditional ETags prevent conflicting writes but are not treated as proof that an entry was persisted. If append or read-back is unavailable, local supported retrieval remains suppressed but health records `head_sync_pending`; the sync outbox is included in the next protected backup and restoration cannot enable wiki retrieval until the remote head covers every recorded local epoch and pending entry.

- [ ] **Step 5: Fence retrieval and restore.** Check tombstones before loading and again before returning content. Suppress a whole derived page/index/excerpt when dependencies cannot be safely removed. Restore registry/files and the local sync outbox into a temporary destination, read the independent head first, compare its verified epoch and entry identities with the snapshot's highest local epoch and pending entries, replay newer tombstones, verify manifest/path state, then enable the reader. If the head is readable but incomplete, any pending local entry exists, the required epoch is not covered, or completeness cannot be established, mark `needs-repair` and fail closed. Native memory, session history, authoritative sources and already-delivered Telegram text remain outside this wiki-forget guarantee; a post-backup, pre-head-append forget is explicitly not recoverable and must not be reported as restore-safe.

- [ ] **Step 6: Run the focused test and verify it passes.**

Run: `npm run test -- test/system/native-knowledge-forgetting.system.test.ts`

Expected: PASS for final-commit races, expired workers, derivative suppression, old-backup restore, the unsynchronized-forget/host-loss case, independent-head coverage checks and idempotent repeats.

- [ ] **Step 7: Commit the forgetting/restore slice.**

```bash
git add src/knowledge/native-consolidation/tombstones.ts src/providers/azure-blob-tombstone-head-store.ts src/runtime/control-plane-backup.ts src/config/control-plane-restore-cli.ts test/system/native-knowledge-forgetting.system.test.ts
git commit -m "feat(knowledge): fence forgetting and restore with tombstone head"
```

---

### Task 5: Add the fail-closed supported retrieval path

**Status:** ✅ implemented and controlled-tested locally; arbitrary direct
filesystem reads remain outside the product guarantee.

**Files:**

- Create: `src/knowledge/native-consolidation/retrieval.ts`
- Modify: `src/integration/real-ming-tools.ts`
- Modify: `hermes/skills/ming/knowledge-consolidation/SKILL.md`
- Test: `test/system/native-knowledge-retrieval.system.test.ts`

**Interfaces:**

- `wikiRetrieve(request: WikiRetrieveRequest): WikiRetrieveResult`
- MCP tool: `real_ming_wiki_retrieve`

- [ ] **Step 1: Write failing reader tests.** A valid complete active generation returns a bounded cited result. Publish unrelated page A, publish unrelated page B in a later run, and assert both remain retrievable from the second generation; forget A and assert B remains while A is suppressed. Registry outage, missing active reference, manifest/path/hash mismatch, tombstone, stale claim, quarantine, staging path or unsupported role returns a fail-closed result while a normal native chat fixture still answers. Assert the generated-root retention cap is respected without deleting the active generation.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `npm run test -- test/system/native-knowledge-retrieval.system.test.ts`

Expected: FAIL because `wikiRetrieve` is not registered.

- [ ] **Step 3: Implement the reader contract.** Resolve the single SQLite active pointer, load the matching complete immutable manifest, reject symlink/traversal and generation mismatches, check tombstones and retrieval-time freshness, and return only a bounded page with source reference, excerpt/claim evidence, `capturedAt`, `asOf`, disposition, uncertainty label and generation identity. Retry once if the pointer changes during the read; never search staging, quarantine, superseded generations or device projections. The active manifest must carry forward prior valid pages, so a batch-limited run cannot hide older knowledge.

- [ ] **Step 4: Wire the skill and MCP result.** Instruct Hermes to use `real_ming_wiki_retrieve` for generated-area queries. A registry failure returns `wiki-unavailable` and does not block ordinary Hermes reasoning. Useful query results are candidates, never direct writes to published output.

- [ ] **Step 5: Run the focused test and verify it passes.**

Run: `npm run test -- test/system/native-knowledge-retrieval.system.test.ts`

Expected: PASS with cited output and fail-closed behavior.

- [ ] **Step 6: Commit the retrieval slice.**

```bash
git add src/knowledge/native-consolidation/retrieval.ts src/integration/real-ming-tools.ts hermes/skills/ming/knowledge-consolidation/SKILL.md test/system/native-knowledge-retrieval.system.test.ts
git commit -m "feat(knowledge): expose fail-closed cited retrieval"
```

---

### Task 6: Build the bounded Hermes runner and keep native cron as the only trigger

**Status:** ✅ implemented and controlled-tested locally. The schedule remains
in an inactive manifest; no native cron row was created or activated.

**Files:**

- Create: `src/knowledge/native-consolidation/runner.ts`
- Create: `hermes/scripts/run-native-knowledge-consolidation.py`
- Create: `hermes/systemd/hermes-knowledge-consolidation.service.example`
- Create: `src/config/native-knowledge-cron-manifest.ts`
- Modify: `src/config/native-cron-manifest-cli.ts` only to print the new secret-free entry; do not activate it
- Test: `test/system/native-knowledge-isolation.system.test.ts`

**Interfaces:**

- `runConsolidation(input: ConsolidationRunRequest): Promise<ConsolidationRunResult>`
- Wrapper exit contract: `0` only after registry run success/read-back; `2` for bounded failure recorded in health; `78` for isolation/config ineligibility; never `[SILENT]` on a false success.

- [ ] **Step 1: Write failing runner tests.** Assert one lease; at most 12 candidates; 64 KiB candidate envelopes; 256 KiB source/2 MiB run; one model call; 48 MCP/tool calls; 128 pages at 128 KiB/page; 16 MiB active snapshot; 64 MiB generated-root cap; and a 10-minute total wall budget in which both retries share the same timer. Assert no provider writes, no native memory/profile/config/skill/plugin/cron writes, and ordinary Telegram/native learning continuing during both success and failure. Record 20 baseline and 20 paired short-turn samples and fail if p95 first native progress exceeds baseline + 2 seconds or 5 seconds absolute, p95 completion exceeds 125% of baseline, or any paired turn drops/fails.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `npm run test -- test/system/native-knowledge-isolation.system.test.ts`

Expected: FAIL because the isolated runner and manifest do not exist.

- [ ] **Step 3: Implement the runner as a deterministic boundary.** Claim the registry lease, list only staged/unforgotten candidates, load the prior active manifest and carry forward every still-valid page, call the native Hermes synthesis operation, require source-support/freshness results, enforce the candidate/source/output/tool/model/storage limits, stage a complete snapshot, call `activate_generation`, read back through `wiki_retrieve`, then mark the run successful. Record failure reason, retry count and run ID without dumping source content. Never call provider write tools or native memory/configuration APIs.

- [ ] **Step 4: Implement the wrapper with pinned controls.** Start the pinned `AIAgent` with `skip_memory=True` and the preflight-proven `tools.include` set exactly to `real_ming_knowledge_list_candidates`, `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation` and `real_ming_wiki_retrieve`; activation remains a local deterministic runner operation. Use a dedicated profile/session directory, staging work directory and OS restrictions; expose only read-only cited sources and the staging/output roots. Treat any unsupported constructor/CLI/include option, extra callable, denied-operation failure or full-default-toolset fallback as exit `78`, not as a permissive fallback. Task 0 uses a fake/local model boundary with networking disabled and no credentials. A separately authorized one-shot may mount only a named Hermes auth profile read-only for the job identity; it must not inherit Telegram, Notion, Calendar, mail, GitHub or Vercel credentials. The wrapper's own Hermes session record is allowed; `MEMORY.md`/`USER.md` and the main interactive session are not touched.

- [ ] **Step 5: Define the native cron row without activating it.** The manifest contains one proposed `02:00` `Asia/Kuala_Lumpur` script-only job, `deliver: local`, explicit model/provider names from protected configuration, the skill names, limits and idempotency key. It does not create the row or edit the existing 07:30/21:30 report jobs.

- [ ] **Step 6: Run the focused test and verify it passes.**

Run: `npm run test -- test/system/native-knowledge-isolation.system.test.ts`

Expected: PASS for toolset/memory/filesystem isolation, lease/retry limits and failure isolation. No live cron row exists.

- [ ] **Step 7: Commit the runner slice after implementation approval.**

```bash
git add src/knowledge/native-consolidation/runner.ts hermes/scripts/run-native-knowledge-consolidation.py hermes/systemd/hermes-knowledge-consolidation.service.example src/config/native-knowledge-cron-manifest.ts src/config/native-cron-manifest-cli.ts test/system/native-knowledge-isolation.system.test.ts
git commit -m "feat(knowledge): add isolated native Hermes consolidation runner"
```

---

### Task 7: Add health to the existing private dashboard without creating a second dashboard

**Status:** ✅ implemented and controlled-tested locally; the read model exposes
opaque run/generation/tombstone/repair health only.

**Files:**

- Modify: `src/dashboard/dashboard-read-model.ts`
- Modify: `src/runtime/daily-operations-control-plane.ts`
- Modify: `src/integration/real-ming-tools.ts` (read-only health operation)
- Test: `test/system/dashboard.system.test.ts`, `test/system/native-knowledge-live-acceptance.system.test.ts`

**Interfaces:**

- Read-only MCP tool: `real_ming_knowledge_health`
- Dashboard view: `knowledgeConsolidation { runId, lastSuccess, backlog, activeGenerationId, tombstoneHeadEpoch, staleCount, quarantinedCount, repairState, isolationEligible }`

- [ ] **Step 1: Write failing dashboard tests.** Show a healthy run, backlog, stale/quarantined candidates, `head_sync_pending`, `needs-repair`, and isolation ineligibility without exposing candidate prose, secrets, native-memory content or hidden reasoning transcripts.

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `npm run test -- test/system/dashboard.system.test.ts test/system/native-knowledge-live-acceptance.system.test.ts`

Expected: FAIL because the new read model is absent.

- [ ] **Step 3: Add the bounded read model.** Project only opaque IDs/counts, timestamps, disposition/status, generation/manifest identity, run failure class, tombstone epoch and repair state. Keep the native Hermes dashboard as the native session/cron surface; this is a Real-Ming CEO read model, not a replacement Kanban or dashboard.

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run: `npm run test -- test/system/dashboard.system.test.ts test/system/native-knowledge-live-acceptance.system.test.ts`

Expected: PASS with no payload leakage.

- [ ] **Step 5: Commit the read-model slice.**

```bash
git add src/dashboard/dashboard-read-model.ts src/runtime/daily-operations-control-plane.ts src/integration/real-ming-tools.ts test/system/dashboard.system.test.ts test/system/native-knowledge-live-acceptance.system.test.ts
git commit -m "feat(dashboard): expose consolidation health without payloads"
```

---

### Task 8: Complete controlled acceptance, evidence and the separate live-activation packet

**Status:** ✅ implemented and controlled-tested locally. The evidence and
CEO-only activation packet are complete; live acceptance and activation remain
separate approvals.

**Files:**

- Modify: `test/system/native-knowledge-live-acceptance.system.test.ts`
- Create after controlled tests pass: `docs/evidence/native-knowledge-consolidation-controlled-acceptance-2026-09-09.md`
- Create after controlled tests pass: `CEO-Office/native-knowledge-consolidation-activation-runbook.md`
- Modify after evidence review: `docs/BASELINE.md`, `README.md`, `docs/agents/POST-RM-40-HANDOFF.md`, `docs/planning/RM-40-v6-requirement-ledger.md`

**Interfaces:**

- Controlled evidence contains exit codes, fixture IDs, registry/run/generation IDs, disposition counts, file hashes and failure states; it contains no credentials, full source prose or native-memory contents.
- Activation runbook asks Ming to approve the exact artifact, schedule, destination, limits and rollback before any live provider/cron action.

- [ ] **Step 1: Add the complete controlled matrix.** Cover all 14 design acceptance rows: no ordinary interception, explicit capture, marked selection, source dispositions/hash-vs-truth, one lease/limits, one-owner activation, cited retrieval, immediate forget, final-commit/expired-worker races, crash boundaries, path/symlink/handwritten-note preservation, registry outage/resource isolation, backup/restore without credentials/native OAuth or uncovered pending tombstones, and successive complete snapshots retaining valid B after publishing A then B and suppressing only forgotten A.

- [ ] **Step 2: Run all focused tests and verify failure states by exit code.**

Run: `npm run test -- test/system/native-knowledge-registry.system.test.ts test/system/native-knowledge-publication.system.test.ts test/system/native-knowledge-forgetting.system.test.ts test/system/native-knowledge-retrieval.system.test.ts test/system/native-knowledge-isolation.system.test.ts test/system/native-knowledge-live-acceptance.system.test.ts`

Expected: PASS; failed provider/registry/runner scenarios remain isolated and ordinary native chat fixtures still succeed.

- [ ] **Step 3: Run the repository gates.**

Run: `npm run check`

Expected: exit `0`.

Run: `npm audit --audit-level=high`

Expected: exit `0` and no high-severity vulnerabilities.

Run: `git diff --check`

Expected: exit `0`.

- [ ] **Step 4: Write the evidence and activation runbook.** The runbook must state that implementation approval is not activation approval and include: a harmless source-backed note; a fresh-session `wiki_retrieve`; explicit forget; concurrent normal Telegram question/native learning; forced failure/retry; restart/reconciliation; backup/restore with newer and pending tombstones; private dashboard review; exact resource and p95 responsiveness measurements; expected exit/status evidence; and rollback. Its rollout order must be explicit: reviewed artifact → approved deployment with recurring execution disabled → authorized one-shot live acceptance → evidence review → separate approval to enable exactly one recurring native cron row.

- [x] **Step 5: Record the approved boundary.** Supported-path forgetting, the first-slice/freshness windows, Azure canonical generated/staging paths, silent success with operational health, and the inactive `02:00 Asia/Kuala_Lumpur` manifest are approved. Production deployment, live acceptance and cron activation remain CEO actions in the activation runbook.

- [ ] **Step 6: Commit evidence/docs separately after review.**

```bash
git add test/system/native-knowledge-live-acceptance.system.test.ts docs/evidence/native-knowledge-consolidation-controlled-acceptance-2026-09-09.md CEO-Office/native-knowledge-consolidation-activation-runbook.md docs/BASELINE.md README.md docs/agents/POST-RM-40-HANDOFF.md docs/planning/RM-40-v6-requirement-ledger.md
git commit -m "docs(knowledge): record controlled consolidation acceptance"
```

---

### Task 9: Retire stale implementation only after the replacement is live-verified

**Files:**

- Modify: `docs/planning/RM-40-v6-module-disposition-inventory.md`
- Modify: `docs/BASELINE.md`, `README.md`, `docs/agents/POST-RM-40-HANDOFF.md`
- Candidate deletion only after live proof: `src/knowledge/knowledge-operations.ts`, `src/knowledge/knowledge-compiler.ts`, `src/knowledge/knowledge-vault.ts`, `src/knowledge/hermes-projection.ts`, `src/knowledge/obsidian-materializer.ts` and tests/imports that exist solely for the old advanced path

**Interfaces:**

- No new public interface. The new native-consolidation modules and `real_ming_wiki_retrieve` are the verified replacement; historical design/evidence documents remain readable.

- [ ] **Step 1: Re-run the import graph and live evidence check.** Confirm no native production path imports a candidate legacy file, the new runner has passed controlled and authorized live acceptance, and the rollback window is closed. If any check fails, keep the legacy file and document why.

- [ ] **Step 2: Delete only the verified stale code in one focused change.** Remove the old module's callers/tests together with the module, run `rg` for its imports, and preserve all superseded documents with a scope/date label. Never delete a document merely because the design changed.

- [ ] **Step 3: Run all gates and inspect the diff.**

Run: `npm run check`, `npm audit --audit-level=high`, and `git diff --check`.

Expected: all exit `0`; no stale import, baseline drift, credential-shaped text, or CEO-Office archive content.

- [ ] **Step 4: Commit and review each deletion separately.**

```bash
git add src/knowledge/knowledge-operations.ts src/knowledge/knowledge-compiler.ts src/knowledge/knowledge-vault.ts src/knowledge/hermes-projection.ts src/knowledge/obsidian-materializer.ts docs/planning/RM-40-v6-module-disposition-inventory.md docs/BASELINE.md README.md docs/agents/POST-RM-40-HANDOFF.md
git commit -m "refactor(knowledge): retire superseded compiler after live proof"
```

Do not combine this with unrelated dashboard, scheduler, provider or document work. If the advanced compiler still supplies a demonstrated stronger guarantee, retain it and relabel its scope rather than deleting it.

---

## Live acceptance and rollback sequence (after all controlled gates)

Live actions remain separately authorized. The ordered packet is:

1. Review the exact implementation artifact, job definition, generated root,
   protected tombstone-head destination, model/provider reference, resource
   limits, notification policy and rollback target. Approve implementation and
   deployment separately from recurrence.
2. Deploy the reviewed artifact with recurring execution disabled. Verify the
   version, isolated service identity, disabled cron row and absence of any
   duplicate 07:30/21:30 report owner.
3. Authorize one native cron one-shot in `local` delivery mode with a
   harmless, source-backed decision/project note. Verify the process exit code,
   registry state, immutable manifest, active pointer and `wiki_retrieve`
   citation.
4. Start a fresh native Hermes Telegram session and ask for the note through
   the supported retrieval operation. Verify normal Telegram formatting,
   typing/progress and native commands remain native; do not compare hidden
   chain-of-thought or require a JSON envelope.
5. Issue an explicit forget request. Verify `suppressed`,
   `head_sync_pending`/`restore_safe`, retrieval refusal, derivative
   suppression and independent tombstone-head epoch. Do not claim native
   `MEMORY.md` or session history was erased.
6. Run a normal Telegram question and a legitimate native memory update while
   consolidation is active. Verify no prohibited files/configuration/provider
   writes and the measured p95 responsiveness thresholds under the recorded
   limits.
7. Force a bounded source/registry failure, verify a nonzero run outcome and
   deduplicated health notice, then retry and verify no duplicate generation or
   delivery.
8. Restart/reconcile the service, then restore a backup older than the
   tombstone head into an isolated destination. Read the independent head and
   pending outbox first; if coverage cannot be established, keep wiki
   retrieval disabled.
9. Review all evidence and make a separate decision to enable exactly one
   recurring native cron row. Enable it only after that decision, then verify
   Asia/Kuala_Lumpur timing, last-success/run IDs and no duplicate delivery
   after restart.

Rollback pauses the new native cron row, stops the wrapper, leaves generated
   generations and registry evidence recoverable, and points the reader to the
   last verified generation or disables it with `needs-repair`. It does not
   delete native Hermes memory, sessions, configuration, OAuth, handwritten
   Obsidian notes, Telegram state, or the existing 07:30/21:30 jobs. Any
   deletion or provider mutation requires its own explicit approval.

## Remaining CEO actions after controlled Tasks 0–8

1. Review the controlled evidence and local Task 0–8 commits.
2. If desired, separately approve deployment with recurrence disabled, then a
   harmless one-shot live acceptance run.
3. Review live evidence and separately approve enabling exactly one native cron
   row at `02:00 Asia/Kuala_Lumpur`.
4. Decide later whether to deploy the optional one-way local Obsidian mirror;
   its transport requires a separate post-live-acceptance plan.

Plan status: **Tasks 0–8 implemented and controlled-tested on 9 September 2026;
not production-wired or live-accepted. Task 9 and all outward-facing actions
remain pending.**
