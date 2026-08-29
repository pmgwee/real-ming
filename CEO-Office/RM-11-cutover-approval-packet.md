# RM-11 — Exact Master Tasks cutover approval packet

> **Decision required — approve or reject `RM11-CUTOVER-1`.** This packet binds
> the reviewed 34-item digest to one source snapshot, one Master Tasks target,
> exact expected counts, a two-phase mutation sequence, verification, and
> recovery. No Notion mutation has occurred.

## Exact version

| Field | Bound value |
| --- | --- |
| Cutover plan | `RM11-CUTOVER-1` |
| Reconciliation digest | `RM11-DIGEST-1` |
| Private digest SHA-256 | `0f094a43809c4309f09f48be9733982893a2cd608dc0378779162741fbb42039` |
| RM-10 backup SHA-256 | `b7dee7b3ab1fb0265a1a3a8abea1eab92db4c4e597e4ed43d0c80272ba86e091` |
| Master Tasks database | `9f337269-ae6b-431a-916d-cf69675d1a57` |
| Master Tasks data source | `fd13a605-5781-4b55-abc0-adfefc8aa19b` |
| Reviewed source records | 34 |
| Canonical imports | 30 |
| Archive-only records | 4 |
| Source commitment dates | 0 |

Any change to a bound hash, source identifier, count, target, mapping, or step
invalidates this Approval and requires a new version.

## Bound source snapshot

| Canonical source | Data source identifier | Records |
| --- | --- | ---: |
| Content Creation | `5c389b83-bac5-8314-ac64-871b9f732931` | 4 |
| MicroSaaS | `6f2b0222-763e-4330-b52b-6a42b0adce60` | 8 |
| Academic | `6dbcdc0d-2de5-46d8-acb9-29fee86afd69` | 7 |
| Job x Life | `85da1881-c49d-444e-a53e-5fe90ffaf3e0` | 15 |
| Finance | `8c089b83-bac5-83be-8a4e-87745ce84c65` | 0 |

The private digest remains gitignored at
`tmp/rm11-ceo-review-digest.md`. It contains normalized decision fields, not raw
Notion payloads. The raw RM-10 backup remains gitignored.

## Approved-result shape

### Lifecycle counts

| Lifecycle | Count |
| --- | ---: |
| Captured | 15 |
| Planned | 10 |
| Waiting/Blocked | 2 |
| Ready for CEO Review | 3 |
| Archive-only with Cancelled disposition | 4 |

### Migrated Workstream and Executive counts

| Workstream | Accountable Executive | Count |
| --- | --- | ---: |
| Content Creation | CMO | 4 |
| MicroSaaS | CTO | 6 |
| Academic | CAO | 10 |
| Career Job | COO | 1 |
| Personal Life | COO | 7 |
| Finance | Personal CFO | 2 |

## Exact two-phase cutover

### Phase A — preflight, import, and verification

1. Re-read all five sources without mutation. Resolve and record each parent
   database container. Require the five bound data-source identifiers, the same
   34 record identifiers, and unchanged record payload hashes. Drift invalidates
   this plan before any write.
2. Verify Master Tasks points to the bound target and contains no conflicting
   source references.
3. Create 30 canonical Work Items with deterministic source references of
   `notion-migration:<data-source-id>:<page-id>`. Preserve original status and
   source identity as provenance. Import no source commitment because none exists.
4. Apply the exact lifecycle, Workstream, Executive, and disposition decisions in
   `RM11-DIGEST-1`. Create no Work Item for the four archive-only records.
5. Project the 30 canonical Work Items into Master Tasks idempotently. Replay must
   leave the target count unchanged.
6. Verify lifecycle totals, Workstream/Executive totals, all 30 source references,
   and at least one sampled record per non-empty Workstream.

Legacy databases remain operational throughout Phase A. Failure stops here and
leaves them unchanged.

### Phase B — switch daily use and retire legacy writers

7. Create or verify five linked views over the bound Master Tasks data source,
   retaining the familiar legacy task-page names. Filters are Content Creation,
   MicroSaaS, Academic, COO Personal Life plus Career Job, and Finance.
8. Edit one reversible sample through each non-empty linked view and verify that
   the same canonical Master Tasks record changes; restore the sample afterward.
9. Rename the five original databases with an `ARCHIVED EVIDENCE` prefix, lock
   them against editing, and remove them from daily operational navigation. Keep
   their contents intact and recoverable; do not delete or synchronize them.
10. Verify there is one writable task system: Master Tasks. Record final counts,
    view identifiers, source retirement state, samples, and timestamps in the
    RM-11 Outcome Report.

## Recovery boundary

- Before Step 9, recovery is to stop: the five legacy databases remain the daily
  system and imported Master Tasks records can be quarantined by their deterministic
  source-reference prefix.
- At Step 9, the commit point is locking and retiring all five legacy writers.
- After the commit point, recovery requires unlocking and restoring the five
  legacy databases together, then quarantining the 30 imports. Never enable both
  systems as writable sources or introduce bidirectional synchronization.
- The RM-10 backup is immutable recovery evidence; it is not written back
  automatically.

## Required gates before Step 1

- Red-to-green System and Provider Contract scenarios cover digest binding,
  stale-source rejection, idempotent import, linked-view verification, retirement,
  post-count reconciliation, and recovery.
- `npm run check`, `npm audit --audit-level=high`, and `git diff --check` pass.
- Independent Standards and Spec reviews pass against the previous commit.
- The live command requires an explicit flag, the exact plan version, digest hash,
  backup hash, and CEO Approval identifier.

## Decision

Recommendation: **approve `RM11-CUTOVER-1` only if the 30/4 disposition, mappings,
two-phase sequence, and recovery boundary above match your intent.** Approval lets
the implementation agent build, verify, and execute this exact plan. Any drift
stops execution and returns for a new CEO decision.

Use this exact sentence:

> I approve RM11-CUTOVER-1 bound to RM11-DIGEST-1, digest SHA-256 0f094a43809c4309f09f48be9733982893a2cd608dc0378779162741fbb42039 and RM-10 backup SHA-256 b7dee7b3ab1fb0265a1a3a8abea1eab92db4c4e597e4ed43d0c80272ba86e091. Execute only the documented two-phase plan and stop on any drift.

## Test cases

| Test | Expected result |
| --- | --- |
| Source identifier, record, or hash drifts | No write; Approval rejected as stale. |
| Import is replayed | Master Tasks remains at the same 30 imported source references. |
| Linked view sample is edited | The canonical Master Tasks record changes and the sample is restored. |
| A view or retirement step fails | Cutover stops before enabling a second writable system. |
| Post-cutover verification passes | Exactly 30 imports match the approved lifecycle and routing totals. |

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Source count differs from 34 | Rerun RM-10 read-only rehearsal and prepare a new digest/version. |
| Master Tasks already has a source reference | Reconcile it; never create a duplicate. |
| A legacy database cannot be locked | Stop before retirement and keep legacy daily use active. |
| A linked view writes somewhere else | Stop; correct the bound data source before cutover. |
| Any raw task payload appears in Git | Stop and remove it from the change set; raw evidence stays in ignored `tmp/`. |
