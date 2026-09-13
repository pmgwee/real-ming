# Plan — role-scoped native knowledge retrieval

**Status:** completed and controlled-tested under GitHub issue #53. Production
deployment, live acceptance, and cron activation remain separately gated by
the existing activation runbook.

## Outcome

Carry the candidate's explicit `trustDomain` through native consolidation and
require an authorized Executive Role/domain pair for generated-wiki retrieval,
without adding another runtime, store, provider effect, or testing seam.

## Contract

- One candidate and one generated page have exactly one `TrustDomain`.
- All source candidates for a page must share the page's declared domain.
- Generation schema v2 requires a valid domain on every page.
- Retrieval requires one `ExecutiveRole` and its canonical domain, validated
  before any generated page is read.
- COO/Personal, CTO/Ming Creatives, CMO/Ming Creatives, CAO/Academic, and
  Personal CFO/Finance are the complete allowed matrix.
- CEO, Entertainment-as-role, missing/malformed scope, cross-domain scope,
  mixed-domain pages, stale/unsupported pages, tombstones, damaged manifests,
  and changed consistency fences fail closed.
- Citations include the Trust Domain and retain source, freshness, disposition,
  uncertainty, and generation identity.

## Implementation sequence

1. Record the decision in ADR-0023, reconcile the canonical specification and
   the 10 September workbook, and fix the contract here before code changes.
2. Extend the Real-Ming System Harness with a controlled native-knowledge
   composition. Add failing system scenarios only through that approved seam.
3. Propagate `trustDomain` through staged pages, schema-v2 manifests,
   carry-forward publication, MCP parsing, retrieval results, and the runner's
   read-back.
4. Enforce same-domain lineage at synthesis and the canonical role/domain matrix
   at retrieval before filesystem page reads.
5. Update the five role playbooks with intent-triggered retrieval guidance only
   after the executable contract is green. Keep role perspective separate from
   reusable procedures.
6. Run focused tests, `npm run check`, `npm audit --audit-level=high`, and
   `git diff --check`; verify exit codes.
7. Run independent Standards and Specification reviews against commit
   `593d7f1cac48959a9370c343ad77fafbb9640a3d`. Reproduce any suspected behavior
   defect with a failing system test before fixing it.
8. Commit and push only issue #53, close it with test/review evidence, and
   recompute the Phase 3 graph. Do not create or enable a live cron row.

## Acceptance evidence

- A Personal page is retrievable by COO/Personal with a Personal citation.
- CTO and CMO can each retrieve Ming Creatives; neither can retrieve another
  domain. CAO and Personal CFO are similarly bounded.
- A missing role/domain, invalid role/domain, CEO role, Entertainment role, and
  every cross-domain pair is denied before page bytes are read.
- A mixed-domain synthesis cannot activate a generation.
- Missing or invalid manifest domain data returns `needs-repair`.
- Existing citation, freshness, tombstone, backup/restore, carry-forward,
  active-pointer, and fencing scenarios remain green without provider calls.

The dated command results and review disposition are recorded in
[the controlled acceptance evidence](../evidence/role-scoped-native-knowledge-retrieval-2026-09-14.md).
