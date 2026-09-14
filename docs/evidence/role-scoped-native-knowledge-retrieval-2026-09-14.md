# Role-scoped native knowledge retrieval — controlled acceptance

**Date:** 14 September 2026 (Asia/Kuala_Lumpur)

**Baseline:** Real-Ming v1.1 · Architecture Revision 6

**Issue:** GitHub #53

**Fixed review point:** `593d7f1cac48959a9370c343ad77fafbb9640a3d`

**Status:** Controlled-tested; not deployed, live-accepted, or cron-activated

## Outcome

The native generated-wiki path now preserves one canonical Trust Domain from
candidate admission through schema-v2 publication and citation. Retrieval
requires an authorized Executive Role/domain pair before resolving or reading
generated page bytes. The publication transaction rejects missing and
cross-domain candidate lineage even when called directly rather than through
the consolidation runner.

Entertainment remains publishable but has no invented Executive Role reader.
CEO remains the human authority and uses Approved Projections rather than raw
cross-domain retrieval. No provider, production data, deployment, service,
Telegram delivery, or cron row was contacted or changed.

## TDD and regression evidence

The first focused behavior run failed because the system-harness composition
did not exist. After the initial implementation, the independent reviews found
two remaining specification gaps. Both were reproduced through the approved
Real-Ming System Harness: 2 of 7 scenarios failed before the corrective change.

| Verification | Result |
| --- | --- |
| Role-scoped system matrix | exit `0` — 1 file, 7 passed |
| Native-knowledge regression matrix | exit `0` — 13 files, 94 passed |
| Control-plane backup regression | exit `0` — 1 file, 8 passed |
| `npm run check` | exit `0` — 85 files, 962 passed, 2 skipped; build and deployment preflight passed |
| `npm audit --audit-level=high` | exit `0` — 0 vulnerabilities |
| `git diff --check` | exit `0` |

The focused tests prove the five authorized role/domain routes, pre-read denial
of malformed and cross-domain requests, Entertainment isolation, schema-v2
manifest validation, candidate-domain identity, mixed-domain synthesis denial,
and atomic denial of missing or cross-domain lineage at direct activation.

## Independent review disposition

### Standards

The Standards review reported two hard violations and one judgment-call smell:

- the baseline inventory stopped at ADR-0022;
- issue #53 was not assigned to the active developer; and
- two callers duplicated the deterministic domain-to-read-back-role mapping.

All three were resolved. The baseline now inventories ADR-0023, issue #53 is
assigned, and both callers use one canonical routing helper. The same baseline
reconciliation also corrected its invariant test to the diagrams' actual
retained `old_uncleaned` paths after the earlier content-preserving move; no
diagram bytes or revision labels changed.

### Specification

The Specification review reported two P1 gaps:

- candidate admission did not validate a canonical domain or bind the domain
  into the identity fingerprint; and
- direct stage/record/activate could bypass same-domain source lineage checks.

Both were reproduced as failing system scenarios and fixed. Admission now
rejects unknown domains and treats a domain-changing replay as an identity
conflict. Activation resolves every source candidate and verifies its domain
inside the same SQLite transaction that advances the active pointer.

No remaining scope-creep or specification finding was reported before the
corrective pass.

## Rollout boundary

This evidence authorizes no live action. Production deployment, live source
acceptance, and creation or enablement of a recurring native cron row remain
subject to the existing CEO activation runbook and its separate decisions.
