# Native knowledge consolidation — superseded controlled acceptance snapshot

> Historical evidence retained for audit. The implementation recorded here is
> superseded by the bounded remediation branch. Use the current remediation
> review packet for the exact corrective artifact and its verification results.

**Date:** 9 September 2026 (Asia/Kuala_Lumpur)
**Baseline:** Real-Ming v1.1 · Architecture Revision 6
**Scope:** Tasks 0–8, controlled/local evidence only
**Status:** Controlled-tested; not production-wired, not live-accepted, and not activated

This evidence records the implementation slices approved for Tasks 0–8. It is
not evidence of an Azure deployment, a native cron row, a Telegram delivery, a
provider call, or a local Obsidian mirror. Task 9 stale-code deletion remains
outside the approval and is intentionally not performed.

## Task 0 isolation gate

The offline probe passed with exit code `0` and the ineligible scenarios returned
exit code `78`.

| Control | Controlled result |
| --- | --- |
| Pinned Hermes source object | `561b053f794a1781868bb032029d589c67708119` (source read from the exact Git object; the interactive checkout head is reported separately) |
| Memory control | `skip_memory=True` proved in the pinned constructor/forwarding path |
| Enabled runtime grouping | `file` only; this is not treated as an operation filter |
| Effective MCP callable set | `real_ming_knowledge_list_candidates`, `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation`, `real_ming_wiki_retrieve` — exact set equality |
| Denied callable set | Work-item, scheduled-report, calendar, mail-search, mail-draft and calendar-write operations absent/rejected |
| Authentication | `offline-fake-local-no-credentials`; network disabled; no interactive credential inherited |
| OS containment | Windows ACL probe allowed only disposable staging/job-session roots; native memory, profile/config, skills/plugins, cron, credentials and unrelated roots rejected; traversal/escape scenario returned `78` |
| Fallback | No full-default-toolset fallback; extra/missing/unsupported include scenarios returned `78` |

The wrapper also passed its controlled-only check with exit code `0`. It still
refuses a live launch unless an explicitly named auth-profile environment value
and the exact controls are supplied. No model/provider request was made by the
probe or wrapper.

## Commands and exit codes

Focused controlled matrix (9 files, 43 tests):

```text
node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run test -- test/system/native-knowledge-registry.system.test.ts test/system/native-knowledge-evidence.system.test.ts test/system/native-knowledge-publication.system.test.ts test/system/native-knowledge-forgetting.system.test.ts test/system/native-knowledge-retrieval.system.test.ts test/system/native-knowledge-runner.system.test.ts test/system/native-knowledge-isolation.system.test.ts test/system/native-knowledge-dashboard.system.test.ts test/system/native-knowledge-live-acceptance.system.test.ts
exit code: 0
```

The focused run included the real OS containment probe and completed 9 test
files / 43 tests. It includes the transient-source retry case: one explicitly
classified source outage is retried within the same lease and cumulative wall,
tool, source and model budgets; publication and activation failures are not
replayed. TypeScript typecheck also passed with exit code `0`.

Final repository gates after the implementation and evidence/status changes:

```text
npm run check
npm audit --audit-level=high
git diff --check
```

| Gate | Result |
| --- | --- |
| `npm run check` | exit code `0` — typecheck, 80 test files / 906 passed / 2 skipped, build and deployment preflight all passed |
| `npm audit --audit-level=high` | exit code `0` — 0 vulnerabilities |
| `git diff --check` | exit code `0` |
| `npm run secrets:preflight` | exit code `0` — names only; no credential value read, printed or transmitted |

The focused matrix was rerun with the pinned Hermes Python executable outside
the restricted test sandbox because the sandbox cannot spawn that executable:
9 files / 43 tests passed, exit code `0`. The sandbox-only attempt returned
`EPERM` before the probe started and is not acceptance evidence.

No command in this evidence uses a provider credential or production data.

## Requirement disposition

| Requirement | Controlled disposition | Evidence |
| --- | --- | --- |
| NKC-01 | **Pass (controlled)** — ordinary capture without an explicit/marked signal is ignored; the native-chat harness remains a separate path | capture/evidence tests; live Telegram remains untested here |
| NKC-02 | **Pass (controlled)** — bounded secret-safe metadata, fingerprint idempotency and twelve-candidate guard | registry, capture and runner tests |
| NKC-03 | **Pass (controlled)** — source identity/excerpt/freshness and an explicit semantic-support disposition are required; a matching hash alone is quarantined when support is not established | evidence and runner tests |
| NKC-04 | **Pass (controlled)** — Hermes is the synthesis boundary, native-memory controls are isolated by Task 0, and failed optional work leaves native chat usable | isolation, runner and live-acceptance tests |
| NKC-05 | **Pass (controlled)** — SQLite active-generation pointer is the sole activation event and one live lease is enforced | registry/publication tests |
| NKC-06 | **Pass (controlled)** — immutable files are flushed/verified before pointer commit; tamper/orphan reconciliation fails closed | publication and acceptance tests |
| NKC-07 | **Pass (supported path, controlled)** — local suppression is immediate, final-commit activation is fenced by the tombstone epoch, and forgotten dependencies are removed from the next complete snapshot | forgetting, runner and acceptance tests; arbitrary direct filesystem reads remain outside the guarantee |
| NKC-08 | **Pass (controlled)** — independent-head coverage, pending outbox state and old-backup restore are distinct; unknown/incomplete coverage returns `needs-repair` | forgetting and backup/restore acceptance tests |
| NKC-09 | **Pass (controlled)** — registry/path/manifest/repair/freshness failures do not return generated knowledge | retrieval tests |
| NKC-10 | **Pass (controlled)** — pinned `skip_memory`, exact MCP include and OS-level containment are hard gates; the wrapper has no permissive fallback | Task 0 evidence and runner tests |
| NKC-11 | **Pass (controlled guardrails)** — lease, candidate, page, source and tool limits and failed-run isolation are exercised; no claim is made about production resource load | runner/isolation/live-acceptance tests |
| NKC-12 | **Pass (controlled)** — private read model/MCP health projects only opaque run, generation, tombstone, backlog, repair and isolation fields | dashboard and live-acceptance tests |
| NKC-13 | **Deferred by explicit scope** — stale code is retained until an authorized live replacement verification; no deletion is allowed in Tasks 0–8 | module-disposition rule; Task 9 remains pending |
| NKC-14 | **Pass (controlled)** — publishing A then B retains both; after forgetting A and publishing an unrelated C, B/C remain and A is absent from the active manifest | runner/retrieval/acceptance tests |

## Controlled scenarios covered

- deliberate capture versus an ordinary unmarked turn;
- duplicate candidate fingerprint and secret/size rejection;
- supported, unsupported, conflicting and stale source evidence;
- one-owner activation, expired lease fencing and final-commit forget race;
- immutable generation hashes, traversal rejection, tamper detection and
  orphan reconciliation;
- explicit forget with an unavailable independent head, successful read-back,
  multi-source suppression and recovery `needs-repair`;
- complete generation continuity (A → B → forget A → C);
- explicitly classified transient source outage retry within cumulative budgets;
- opaque dashboard/MCP health with no source prose or native-memory content;
- native Hermes chat after a failed optional consolidation run;
- manifest-verified, credential-free outbox backup and isolated restore.

## Rollout boundary

The implementation is deliberately stopped at controlled evidence. The only
permitted future order is:

1. review this artifact and the exact local Task 0–8 commits;
2. approve a deployment with the recurring row still disabled;
3. authorize one harmless live run using the named Hermes auth profile and the
   existing private source routes;
4. review live evidence (fresh-session `wiki_retrieve`, forget, restart,
   backup/restore, private dashboard and chat noninterference); and
5. separately approve exactly one recurring native cron row at
   `02:00 Asia/Kuala_Lumpur`.

None of those live steps, provider mutations, service restarts, Telegram
deliveries, local mirror synchronization or cron actions occurred here.
