# RM-40 native knowledge consolidation — Task 0–8 review packet

**Review date:** 9 September 2026 (Asia/Kuala_Lumpur)
**Review scope:** approved Tasks 0–8 only
**Repository:** `C:\Users\quekm\Desktop\projects\real-me`
**Branch:** `main`
**Task 0–8 implementation tip:** `669355afaebae0a65a85d9712c28328b49b9db7f`
The packet itself is an additional documentation commit; verify its exact SHA
with `git log --follow -- docs/agents/RM-40-task0-8-review-packet-2026-09-09.md`.
**Status:** controlled/local implementation verified; not deployed, live-accepted,
scheduled or production-wired

## Instructions for the reviewing agent

Treat this packet as a review record, not an authorization to mutate anything.
Review the exact commit range and linked evidence. Do not push, deploy, call a
provider, create or activate cron, restart a service, synchronize an Obsidian
mirror, delete Task 9 code, or change credentials/configuration. Report any
finding as **confirmed**, **disputed with evidence**, or **requires CEO/live
action**.

Authoritative supporting documents:

- [Controlled acceptance evidence](../evidence/native-knowledge-consolidation-controlled-acceptance-2026-09-09.md)
- [Task 0–8 implementation plan](../superpowers/plans/2026-09-09-native-knowledge-consolidation.md)
- [Design specification](../superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md)
- [ADR-0022](../adr/0022-native-knowledge-consolidation-around-hermes.md)
- [CEO activation runbook](../../CEO-Office/native-knowledge-consolidation-activation-runbook.md)
- [Module disposition inventory](../planning/RM-40-v6-module-disposition-inventory.md)

## Exact commit and diff record

All commits below are local commits on `main`; none was pushed. The review base
is handoff commit `8bcf944ba1c231c506f29b89b6e3b89dbb6ef26b` and the reviewed
tip is `6830032af34bc9f954913810a5e0cdcfd9c57f25`.

| Scope | Exact commit | Files changed in that commit |
| --- | --- | --- |
| Task 0 — pinned isolation proof | `a20979932d390c96328f57e6e7d90794ca6f486f` | `hermes/scripts/verify-native-knowledge-isolation.py`; `test/system/native-knowledge-isolation.system.test.ts`; `docs/evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md` |
| Task 0 — suite-load test stability | `669355afaebae0a65a85d9712c28328b49b9db7f` | `test/system/native-knowledge-isolation.system.test.ts` (30-second timeout for the real OS probe; assertions and exit-code contract unchanged) |
| Task 1 — bounded registry | `ed07a562ce18fcf5c130efc1f1d831fc8a3b8e37` | `src/knowledge/native-consolidation/contracts.ts`; `src/knowledge/native-consolidation/registry.ts`; `test/system/native-knowledge-registry.system.test.ts` |
| Task 2 — capture/evidence | `091f18678af34d77b10849d6d70d6f9faf67e2f0`; `f448fce105451d0a8d5f2e00a42bc71f562a5d40`; `2cd7ffea31986cad9de8695423320dbe3fef219d` | `hermes/skills/ming/knowledge-capture/SKILL.md`; `hermes/skills/ming/knowledge-consolidation/SKILL.md`; `src/knowledge/native-consolidation/evidence.ts`; `test/system/native-knowledge-evidence.system.test.ts`; `test/docs/hermes-skill-pack.test.ts` |
| Task 3 — immutable publication | `b51b15666fec79ed607660fc7e7f2b25a53ab50d` | `src/knowledge/native-consolidation/contracts.ts`; `src/knowledge/native-consolidation/publication.ts`; `test/system/native-knowledge-publication.system.test.ts` |
| Task 4 — forgetting/restore | `22f8bf0429c3e809657d9597415357fb0dfc46d2` | `src/config/control-plane-restore-cli.ts`; `src/knowledge/native-consolidation/tombstones.ts`; `src/providers/azure-blob-tombstone-head-store.ts`; `src/runtime/control-plane-backup.ts`; `test/system/native-knowledge-forgetting.system.test.ts` |
| Task 5 — fail-closed retrieval | `135f476530f19170452bfdabae4354d9fba61f9a` | `src/integration/real-ming-tools.ts`; `src/knowledge/native-consolidation/retrieval.ts`; `test/system/native-knowledge-retrieval.system.test.ts` |
| Task 6 — runner/wrapper/inactive manifest | `713ff70fc430e75fdae087a158a967bc9c3e569a` | `hermes/scripts/run-native-knowledge-consolidation.py`; `hermes/systemd/real-ming-hermes-knowledge-consolidation.service.example`; `src/config/native-cron-manifest-cli.ts`; `src/config/native-knowledge-cron-manifest.ts`; `src/knowledge/native-consolidation/runner.ts`; `test/system/native-knowledge-isolation.system.test.ts`; `test/system/native-knowledge-runner.system.test.ts` |
| Task 7 — opaque dashboard health | `de4119ab019212cc62a06f1d0f04f43f135f2851` | `src/dashboard/dashboard-page.ts`; `src/dashboard/dashboard-read-model.ts`; `src/dashboard/dashboard-server.ts`; `src/integration/real-ming-tools.ts`; `src/runtime/daily-operations-control-plane.ts`; `test/system/native-knowledge-dashboard.system.test.ts` |
| Task 8 — complete controlled matrix and retry fencing | `41e63a82bfe9e5ce20dc53fe85df5c1575206b75` | `src/knowledge/native-consolidation/registry.ts`; `src/knowledge/native-consolidation/runner.ts`; `test/system/native-knowledge-live-acceptance.system.test.ts`; `test/system/native-knowledge-runner.system.test.ts` |
| Task 8 — documentation/evidence packet | `6830032af34bc9f954913810a5e0cdcfd9c57f25` | `CEO-Office/README.md`; `CEO-Office/native-knowledge-consolidation-activation-runbook.md`; `CEO-Office/phase-4-ceo-action.md`; `README.md`; `docs/BASELINE.md`; `docs/adr/0022-native-knowledge-consolidation-around-hermes.md`; `docs/agents/POST-RM-40-HANDOFF.md`; `docs/architecture/real-ming-agent-diagram-v6.html`; `docs/architecture/real-ming-agent-diagram-v6.png`; `docs/evidence/native-knowledge-consolidation-controlled-acceptance-2026-09-09.md`; `docs/planning/RM-40-v6-native-first-implementation-plan.md`; `docs/planning/RM-40-v6-requirement-ledger.md`; `docs/research/real-ming-llm-wiki-memory-research.md`; `docs/specs/real-ming-v1.1.md`; `docs/superpowers/plans/2026-09-09-native-knowledge-consolidation.md`; `docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md`; `hermes/README.md` |

Reproduce the exact aggregate diff with:

```text
git diff 8bcf944ba1c231c506f29b89b6e3b89dbb6ef26b..6830032af34bc9f954913810a5e0cdcfd9c57f25 --stat
git diff 8bcf944ba1c231c506f29b89b6e3b89dbb6ef26b..6830032af34bc9f954913810a5e0cdcfd9c57f25
git show --stat --format=fuller <commit-sha>
```

The aggregate range through the implementation tip remains **50 files changed,
6,814 insertions and 62 deletions**. All focused commits pass
`git diff <parent>..<commit> --check`.

## Task 0 isolation evidence

The valid offline probe returned exit code `0`; every negative scenario in the
isolation test returned the ineligibility exit code `78`.

| Control | Observed controlled result |
| --- | --- |
| Hermes source | Exact Git object `561b053f794a1781868bb032029d589c67708119`; source mode `exact-git-commit-object` |
| Memory | `skip_memory=True` present in the pinned constructor and forwarding path |
| Tool grouping | `enabled_toolsets=["file"]`; this is not treated as an operation filter |
| Effective MCP tools | Exactly `real_ming_knowledge_list_candidates`, `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation`, `real_ming_wiki_retrieve` |
| Denied operations | Work-item, scheduled-report, calendar, mail-search, mail-draft and calendar-write operations absent/rejected |
| Authentication | `offline-fake-local-no-credentials`; networking disabled and no credential values read |
| OS containment | Only disposable staging/job-session roots writable; native memory, profile/config, skills/plugins, cron, credentials, unrelated and traversal targets denied |
| Fallback | No default-toolset fallback; missing/extra/unsupported controls are ineligible |

The complete probe record is in
[the Task 0 evidence](../evidence/native-knowledge-hermes-isolation-preflight-2026-09-09.md).

## Controlled test and gate output

Focused acceptance command:

```text
node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run test -- test/system/native-knowledge-registry.system.test.ts test/system/native-knowledge-evidence.system.test.ts test/system/native-knowledge-publication.system.test.ts test/system/native-knowledge-forgetting.system.test.ts test/system/native-knowledge-retrieval.system.test.ts test/system/native-knowledge-runner.system.test.ts test/system/native-knowledge-isolation.system.test.ts test/system/native-knowledge-dashboard.system.test.ts test/system/native-knowledge-live-acceptance.system.test.ts
```

```text
Test Files  9 passed (9)
     Tests  43 passed (43)
exit code: 0
```

The first retry test was run red before the retry implementation, then green
afterward. The final matrix includes the real pinned Python containment probe;
the restricted sandbox-only attempt returned `EPERM` before starting the probe
and is not counted as acceptance evidence.

Full repository check:

```text
> real-ming@0.1.0 check
> npm run typecheck && npm run test && npm run build && node dist/config/control-plane-deployment-preflight-cli.js

Test Files  80 passed (80)
     Tests  906 passed | 2 skipped (908)
Control-plane deployment preflight passed.
exit code: 0
```

Audit and formatting gates:

```text
> npm audit --audit-level=high
found 0 vulnerabilities
exit code: 0

> git diff --check
no output
exit code: 0

> npm run secrets:preflight
Tracer 1 secret preflight: 10/9 supplied
Every credential you provision is supplied. No value was read, printed, or transmitted.
exit code: 0
```

## NKC-01 through NKC-14 disposition

These are controlled dispositions, not live or production claims.

| Requirement | Result | Scope/evidence |
| --- | --- | --- |
| NKC-01 | Pass (controlled) | Ordinary turns are not intercepted or swept; deliberate capture only |
| NKC-02 | Pass (controlled) | Bounded, secret-safe, fingerprint-idempotent candidates and twelve-item guard |
| NKC-03 | Pass (controlled) | Source identity, semantic support and freshness required; hash is identity evidence, not truth |
| NKC-04 | Pass (controlled) | Hermes remains synthesis/native-memory boundary; failed optional work leaves chat usable |
| NKC-05 | Pass (controlled) | One lease and one SQLite active-generation publication authority |
| NKC-06 | Pass (controlled) | Immutable files verified before pointer commit; tamper/orphan reconciliation fails closed |
| NKC-07 | Pass on supported path (controlled) | Forget suppresses intake/retrieval/derivatives and final-commit tombstone races; arbitrary direct filesystem reads remain outside guarantee |
| NKC-08 | Pass (controlled) | Independent tombstone head, pending outbox and incomplete-head restore all fail closed |
| NKC-09 | Pass (controlled) | Registry/path/manifest/tombstone/freshness failures do not return generated content |
| NKC-10 | Pass (controlled) | Pinned memory/tool/auth/OS isolation is a hard gate with no fallback |
| NKC-11 | Pass (controlled guardrails) | Lease, candidate, byte, page, tool, model, wall-clock and retry budgets exercised; production load not claimed |
| NKC-12 | Pass (controlled) | Opaque run/generation/tombstone/backlog/repair/isolation dashboard read model |
| NKC-13 | Deferred by explicit scope | Stale code deletion requires live replacement verification; Task 9 was not authorized |
| NKC-14 | Pass (controlled) | Complete snapshots retain valid B after A→B; forgetting A suppresses only A |

## Controlled acceptance evidence covered

- deliberate capture versus an ordinary unmarked turn;
- duplicate/secret/size rejection and source-support/freshness dispositions;
- publication ordering, immutable hashes, path/symlink safety and orphan/tamper repair;
- final-commit forget fencing, expired-worker fencing, derivative suppression and idempotent tombstones;
- independent-head append/read-back, pending outbox and old-backup recovery safety;
- complete-generation continuity and explicitly classified transient-source retry;
- fail-closed retrieval and opaque dashboard health;
- ordinary native Hermes chat continuing after optional consolidation failure;
- inactive manifest with `02:00 Asia/Kuala_Lumpur`, Azure canonical generated/staging paths and exact four-call MCP boundary.

## Deviations, blockers and remaining boundaries

There is no implementation blocker inside the approved controlled scope. The
following are deliberate boundaries or preconditions for a future CEO/live
review:

1. The probe verifies the exact pinned Git source object. The installed Hermes
   checkout reported `runtimeHead=a7198a8855ad98681114ff5138eb01fe132a62e7`,
   which differs from the pinned object. The deployment artifact must be built
   and re-verified at the pinned commit before live acceptance; the controlled
   result is not live runtime proof.
2. No provider call, Azure deployment, service restart, Telegram delivery,
   cron creation/activation or local Obsidian mirror occurred.
3. The Azure-hosted generated vault is canonical. A future local Obsidian
   mirror is one-way, activation-triggered, read-only and not a runtime or
   `wiki_retrieve` dependency; it needs a separate post-live plan.
4. Direct arbitrary filesystem reads can bypass supported-path tombstones and
   are explicitly outside the forgetting guarantee.
5. Native Hermes memory/profile/session history remain owned by Hermes and are
   not erased or rewritten by this optional path.
6. Task 9 stale-code deletion is intentionally pending until a replacement is
   live-verified and the rollback window is closed. Superseded documents were
   relabeled and retained.
7. The real Windows isolation subprocess occasionally exceeded Vitest's
   default five-second test timeout only under full-suite contention. The
   follow-up raises that test timeout to 30 seconds; it does not relax any
   isolation assertion, callable allowlist, filesystem denial or exit code.

The CEO-facing sequence is documented in the
[activation runbook](../../CEO-Office/native-knowledge-consolidation-activation-runbook.md):
review artifact → deploy with recurrence disabled → authorize one harmless live
run → review retrieval/forget/restart/restore/dashboard evidence → separately
approve one recurring native cron row.
