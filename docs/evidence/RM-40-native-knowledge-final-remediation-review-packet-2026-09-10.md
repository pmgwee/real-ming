# RM-40 native knowledge consolidation — final remediation review packet

**Overall status: NOT READY — BLOCKERS REMAIN**

This is a bounded local remediation candidate. It is not independent
acceptance, deployment evidence, provider verification, live acceptance,
recurring-job authorization, or permission to delete Task 9 code.

## Review identity and scope

- Review date: 10 September 2026 (Asia/Kuala_Lumpur)
- Repository: `C:\\Users\\quekm\\Desktop\\projects\\real-me`
- Branch: `fix/rm40-native-knowledge-final-remediation`
- Exact authorized base: `265124a940bfd126ddb89934b3392a76b0ef3380`
- Code remediation tip before this evidence commit: `69de739815c6444e3e9ab0426c8e727c017f198d`
- Pinned Hermes commit required by the isolation contract: `561b053f794a1781868bb032029d589c67708119`

The evidence commit that adds this packet is intentionally documentation-only;
the final branch tip is printed by the handoff and must be used to inspect the
complete `base..tip` range. Existing reviewed history was not rewritten,
squashed, amended, rebased, or deleted.

The authorized scope allowed local source/test edits, synthetic adapters,
focused commits, build and bundle creation. It prohibited pushes, PRs, merges,
deployment, Azure or other provider calls, live credentials, service restart,
systemd/timer installation, cron creation/activation, Telegram delivery,
Obsidian synchronization, and Task 9 deletion. None of those actions occurred.

## Focused local commits

| Commit | Purpose |
| --- | --- |
| `69e9ab29b8fe24c5835b0d2663804576bba27b72` | Bind admitted candidates to exact lineage and preserve canonical tombstone aliases. |
| `09859f03318b0cfe59587a398d8d0cc4a8757a36` | Fence retrieval snapshots and hash the exact bytes returned. |
| `d033796448e890bae552175074cd3e79331cd0bc` | Wire the configured production source route through the MCP composition. |
| `02c67f81d8a86fdb874e1f56acae2f021e24c6b9` | Enforce the reviewed four-operation native knowledge job allowlist. |
| `f461c0ae4ad6c5d3d0c38b2dc41d2ecce8bf2d82` | Complete production MCP knowledge context and supported forgetting composition. |
| `e80049bd2f86e59de2f097880891503a537e2f23` | Harden publication, retention, restore and failure fencing. |
| `12054dce936b947c555cda836886e010139f4902` | Add the actual pinned-Hermes job entry point and make the wrapper execute it. |
| `32a302ed3651e759b526982f33a8a33324d831f7` | Record canonical Azure vault, mirror and final isolation constraints. |
| `7c2da1be9fdb44e8f3daad451d1b71dc732e985f` | Correct the restore-fence regression test's TypeScript narrowing. |
| `69de739815c6444e3e9ab0426c8e727c017f198d` | Add stale independent tombstone-head conflict coverage. |
| *(this packet)* | Add the reproducible remediation evidence and blocker record. |

## Changed files and diff stat

Before this packet, the implementation range
`265124a940bfd126ddb89934b3392a76b0ef3380..69de739815c6444e3e9ab0426c8e727c017f198d`
was **25 files changed, 2,359 insertions and 429 deletions**. The files were:

```text
docs/adr/0022-native-knowledge-consolidation-around-hermes.md
docs/superpowers/plans/2026-09-09-native-knowledge-consolidation.md
docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md
hermes/scripts/run-native-knowledge-consolidation.py
hermes/scripts/run-native-knowledge-hermes-job.py
hermes/scripts/verify-native-knowledge-isolation.py
src/config/native-knowledge-consolidation-cli.ts
src/config/real-ming-mcp-cli.ts
src/integration/real-ming-tools.ts
src/knowledge/native-consolidation/contracts.ts
src/knowledge/native-consolidation/publication.ts
src/knowledge/native-consolidation/registry.ts
src/knowledge/native-consolidation/retrieval.ts
src/knowledge/native-consolidation/runner.ts
src/knowledge/native-consolidation/tombstones.ts
src/providers/azure-blob-tombstone-head-store.ts
test/system/native-knowledge-forgetting.system.test.ts
test/system/native-knowledge-isolation.system.test.ts
test/system/native-knowledge-live-acceptance.system.test.ts
test/system/native-knowledge-production-acceptance.system.test.ts
test/system/native-knowledge-production-routing.system.test.ts
test/system/native-knowledge-publication.system.test.ts
test/system/native-knowledge-runner.system.test.ts
test/system/native-knowledge-wrapper.system.test.ts
test/system/real-ming-mcp-composition.system.test.ts
```

The final range additionally contains this packet. Reproduce the authoritative
list and stat with:

```text
git diff --name-only 265124a940bfd126ddb89934b3392a76b0ef3380..HEAD
git diff --stat 265124a940bfd126ddb89934b3392a76b0ef3380..HEAD
```

## Defect-to-code-to-test mapping

| Remediation | Production path | Regression/acceptance coverage |
| --- | --- | --- |
| Exact source-byte hash identity | `evidence.ts` exact UTF-8 SHA-256 and canonical 64-hex validation (present at the base from `373c935`) | `native-knowledge-evidence.system.test.ts` fabricated, malformed and mismatched hash cases. |
| Atomic local forget and durable outbox | `registry.ts` `appendLocalTombstone`, `tombstones.ts` state transitions | `native-knowledge-forgetting.system.test.ts` atomic reopen, idempotent retry, stale/out-of-order and pending-outbox cases. |
| Backup coverage | Production control-plane backup set includes native outbox and registry state | `control-plane-backup.system.test.ts` production forget -> backup -> restore survival. |
| Restore reconciliation/non-resurrection | `tombstones.ts` independent-head replay, inventory/alias/gap checks and repair lock | Newer-head, equal-head, gap, conflict, interruption, alias-only and advancing-head tests. |
| Azure initial/concurrent writes | `azure-blob-tombstone-head-store.ts` uses `If-None-Match: *` at v0 and concrete `If-Match` thereafter | Local HTTP/client-adapter initial creation, competing create, update and stale ETag tests. No live Azure call. |
| Complete dependency retrieval/final fencing | `retrieval.ts` coherent snapshot, all identity aliases/dependencies, one byte read and post/pre-return fences | Dependency, mutation race, generation/tombstone fence and exact-byte tests. |
| Publication/runner fencing | `runner.ts` actual source epoch/current final timestamp, lease/tombstone/repair revalidation; `publication.ts` FS-before-SQLite and protected cleanup | Source mutation, lease loss, clock advance, competing publication, orphan and committed-activation-cleanup tests. |
| Production MCP composition/forget | `real-ming-mcp-cli.ts` and `real-ming-tools.ts` configured source route, exact allowlist, retrieval and supported atomic forget | `real-ming-mcp-composition.system.test.ts`, production-routing and offline acceptance tests. |
| Pinned Hermes isolation | `verify-native-knowledge-isolation.py` actual pinned AIAgent composition, explicit tool include, environment allowlist and OS checks | Isolation suite and direct probe. Current host cannot complete the pinned import because PyYAML is unavailable; see blockers. |
| Functional wrapper | `run-native-knowledge-consolidation.py` invokes `run-native-knowledge-hermes-job.py`; native runtime claim requires Hermes execution | Wrapper preflight/no-op/failure tests and offline production-path acceptance. |
| Limits and retention | `contracts.ts` limits; `publication.ts` page/manifest/root budgets and protected cleanup | Exact-limit, one-byte-over, retention, active/protected/in-progress, interruption/retry tests. |
| Repository verification | Portable probes, deterministic backup tests, redacted preflight and docs constraints | Full suite, typecheck/build/audit/secrets/preflight/diff checks below. Chromium remains an environment failure. |

The production path contains no fixed candidate, fixed source bytes, fixed page,
or fixed synthesis result. The explicitly named offline adapter is confined to
controlled tests and reports `runtime=offline-fixture`; `runtime=native-hermes`
is reported only after the Hermes job returns `hermesExecuted=true`.

## RED/GREEN evidence

These are the recorded defect reproductions and subsequent green runs. A
temporary local mutation was restored immediately after each RED run; no
reviewed history was rewritten.

| Behavior | RED execution/result | GREEN execution/result |
| --- | --- | --- |
| Fabricated syntactically valid SHA-256 rejected | Before the exact-byte fix, `node_modules\\.bin\\vitest.cmd run test/system/native-knowledge-evidence.system.test.ts -t "fabricated"` produced one failed assertion (fabricated hash was accepted). | Same command after `evidence.ts` fix: exit `0`, targeted test passed. The fix is present at the authorized base and was re-run in this remediation. |
| Canonical alias read-back | With alias normalization temporarily removed, targeted `canonicalizes aliases when verifying an independent head read-back` failed (restore was incorrectly marked safe). | Restored implementation: targeted test exit `0`. |
| Nonzero backup without complete inventory | With the inventory guard temporarily removed, targeted `keeps restore locked when a nonzero backup epoch has no complete tombstone inventory` failed (safe state returned). | Restored guard: targeted test exit `0`. |
| Local alias absent from independent head | With the alias-coverage guard temporarily removed, targeted `rejects restore when a local alias is absent from the independent head` failed (safe state returned). | Restored guard: targeted test exit `0`. |
| Malformed Azure ETag | Before malformed-ETag rejection, `node_modules\\.bin\\vitest.cmd run test/system/native-knowledge-forgetting.system.test.ts -t "malformed ETag"` exited `0` as a process but had one failed assertion (malformed head was returned as usable). | After `parseHead` validation: same command exit `0`, one targeted test passed. |
| Restore-head advancement | Before the final read-back guard, the advancing-head regression failed (reconciliation returned safe despite a second head read changing). | `keeps retrieval repair-locked when the independent head advances during reconciliation` exit `0`. |

The TypeScript narrowing correction in `7c2da1b` was a test/compiler RED
(`npm.cmd run typecheck` exit `1`, missing union property) followed by exit
`0`; it did not weaken the product assertion.

## Final verification commands and results

Commands were run with real exit status; no `|| true`, pass-filtering, or
discarded status was used. The focused native suites were green on the
remediation code. The full repository check remains red only because Chromium
cannot spawn in this Windows sandbox.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm.cmd ci` | 0 | 50 packages installed; audit reported 0 vulnerabilities. |
| `npm.cmd run typecheck` | 0 | TypeScript completed. |
| `npm.cmd run build` | 0 | Build completed. |
| `node_modules\\.bin\\vitest.cmd run` with all affected native-knowledge, MCP and backup files | 0 | 14 files passed; 92 tests passed; 6 skipped. |
| `node_modules\\.bin\\vitest.cmd run test/system/real-ming-mcp-composition.system.test.ts test/system/native-knowledge-production-acceptance.system.test.ts` | 0 | 2 files and 3 tests passed. |
| `node_modules\\.bin\\vitest.cmd run test/system/native-knowledge-production-acceptance.system.test.ts` | 0 | Offline production-composition acceptance passed. |
| `node_modules\\.bin\\vitest.cmd run test/system/control-plane-backup.system.test.ts` | 0 | 8 deterministic backup tests passed. |
| `node_modules\\.bin\\vitest.cmd run test/system/native-knowledge-isolation.system.test.ts` | 0 | 1 file and 10 tests passed; tests truthfully classify unavailable Python/runtime as ineligible. |
| Python `py_compile` for the three Hermes scripts | 0 | All scripts compiled. |
| `npm.cmd test` | **1** | 83 files passed, 1 failed; 945 tests passed, 11 skipped. Browser test failed because Chromium headless `spawn EPERM`. |
| `npm.cmd run check` | **1** | Same Chromium browser failure; check did not claim a green full suite. |
| `node ...\\npm-cli.js audit --audit-level=high` | 0 | 0 high vulnerabilities. |
| `npm.cmd run secrets:preflight` | 0 | Secret preflight passed; names/status only, no values read or printed. |
| `node dist/config/control-plane-deployment-preflight-cli.js` | 0 | Deployment preflight passed (does not deploy). |
| `git diff --check 265124a940bfd126ddb89934b3392a76b0ef3380..HEAD` | 0 | No diff whitespace errors (Git ignore warning only). |
| `git status --short` | 0 | No tracked modifications; pre-existing untracked `.claude/` and two old local review bundles remain outside the commits. |

Direct pinned probe (with a disposable exact-source archive selected by
`HERMES_AGENT_SOURCE`) returned exit `1`. Its JSON reported the required
runtime head, but `actualAIAgent=false` and `containmentProof=false` because
the pinned import raised `RuntimeError`; the isolated Python reports
`import yaml` exit `1` with `ModuleNotFoundError`. This is intentionally a
blocker, not fabricated isolation evidence.

## NKC-01 through NKC-14 disposition

| Requirement | Controlled disposition |
| --- | --- |
| NKC-01 | Pass: no mandatory conversation sweep; deliberate candidate capture only. |
| NKC-02 | Pass: bounded, secret-safe, fingerprint-idempotent admission. |
| NKC-03 | Pass: exact source identity/hash, explicit support and freshness; hash is not truth. |
| NKC-04 | Pass: Hermes owns reasoning/native memory; optional failure leaves chat independent. |
| NKC-05 | Pass: one lease and one SQLite active-generation authority. |
| NKC-06 | Pass: immutable files verified before pointer commit; tamper/orphan repair is fail-closed. |
| NKC-07 | Pass on supported path: forgetting covers candidates, aliases, pages and derivatives; arbitrary direct filesystem reads remain outside the guarantee. |
| NKC-08 | Pass controlled: independent head, outbox, inventory and restore replay fail closed when incomplete. |
| NKC-09 | Pass controlled: unsupported registry/path/manifest/tombstone/freshness states do not return generated content. |
| NKC-10 | **Blocked locally**: the contract is implemented as a hard gate, but this host cannot prove the actual pinned AIAgent import/containment because PyYAML is unavailable. |
| NKC-11 | Pass controlled guardrails: candidate, byte, page, tool, model, wall and retry budgets are exercised; production load is not claimed. |
| NKC-12 | Pass controlled: opaque run/generation/tombstone/backlog/repair/isolation read model. |
| NKC-13 | Deferred by authorization: Task 9 stale-code deletion was not authorized and no deletion occurred. |
| NKC-14 | Pass controlled: complete snapshots carry valid pages forward and forgetting A leaves unrelated B available. |

## Offline versus live acceptance

The offline test uses local synthetic source and model adapters but instantiates
the production MCP composition, runner, registry, publication, retrieval,
forget, backup and restore paths. It proves no provider or deployment behavior.

The deployment/live acceptance packet remains a separate CEO action. It must
run the deployed pinned Hermes artifact with an authorized harmless source,
source-backed citation, forget, restart/reconciliation and non-resurrection
checks. It is not part of normal tests and was not run here.

## Unresolved defects and environment blockers

1. The actual pinned AIAgent isolation proof is unavailable in this workspace:
   the pinned checkout's required `yaml` dependency is not installed in the
   discovered Python runtime, no usable pinned virtualenv was available, and
   the direct probe exits `1`. The implementation fails closed; no fallback
   toolset is used. This blocks claiming NKC-10 or native-Hermes execution.
2. `npm.cmd test` and `npm.cmd run check` exit `1` because Playwright's
   Chromium headless binary cannot spawn (`spawn EPERM`). This is an environment
   prerequisite, not a suppressed test result.
3. No live provider/Azure, deployed-runtime, Telegram, cron, systemd or
   Obsidian evidence exists by authorization. Those require a later CEO/live
   action and must use the deployed exact pinned commit.
4. The supported-path forgetting guarantee does not cover arbitrary direct
   filesystem reads, already-delivered conversation content, native Hermes
   memory/session history, or a future local mirror. The Azure generated vault
   remains canonical; any local mirror is one-way, activation-triggered,
   read-only and not a runtime dependency.
5. The repository has pre-existing untracked `.claude/` settings and two old
   review bundles. They were not staged or included in the remediation range;
   tracked source state is clean. Reviewers should inspect only the named Git
   range and supplied new bundle.

## Explicit no-live-action confirmation

No push, PR, merge, deployment, provider call, live credential access, service
restart, systemd installation, cron creation/activation, Telegram delivery,
Obsidian synchronization, production configuration mutation, or Task 9
deletion occurred. The only external-looking artifact is a local Git bundle
created for independent review.

## Reviewer reproduction

Use the exact final branch tip printed with this packet and run:

```text
git bundle verify RM-40-native-knowledge-final-remediation-2026-09-10.bundle
git merge-base --is-ancestor 265124a940bfd126ddb89934b3392a76b0ef3380 <FINAL_TIP>
git diff --stat 265124a940bfd126ddb89934b3392a76b0ef3380..<FINAL_TIP>
```

Then independently inspect and rerun the focused suites and the mandatory
gates. Even if all local prerequisites are installed and every gate becomes
green, this packet authorizes no rollout; it is only a candidate for final
independent review.
