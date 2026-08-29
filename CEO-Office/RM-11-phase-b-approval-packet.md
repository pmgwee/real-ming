# RM-11 — Exact Phase B continuation approval packet

> **Decision required — approve or reject `RM11-CUTOVER-3`.** Phase A already
> imported and independently verified 30 canonical Work Items. The five legacy
> databases remain unchanged, writable, and the daily system. This packet binds
> the pending Phase B commit point to the unchanged reviewed evidence and the
> completed Phase A report.

## Why Version 3 exists

`RM11-CUTOVER-2` completed Phase A, but its published Step 4 named
`RM11-DIGEST-1` while the packet's bound-value table, private digest hash,
executable bindings, and actual Phase A execution used `RM11-DIGEST-2`. The
decisions and execution were correct, but exact Approval cannot rely on
contradictory prose. Version 3 is a Phase B continuation; it does not repeat or
reinterpret the 34 CEO-reviewed decisions.

## Exact bindings

| Field | Bound value |
| --- | --- |
| Phase B continuation | `RM11-CUTOVER-3` |
| Authorized execution phase | `B` only |
| Reconciliation digest | `RM11-DIGEST-2` |
| Private digest SHA-256 | `f6d31c8d318cdefb7f488df68f50be64829f99dc6b38369f1450f7bd721a17b6` |
| Source snapshot SHA-256 | `c66d697d04a7da1f0be61e2827e250a84cca47f1c10329f985757dda05546325` |
| Completed Phase A report SHA-256 | `a148737ae4d6e61761570d5726130898d9c580a361bb070cf3dffaad725f2f7f` |
| Master Tasks database | `9f337269-ae6b-431a-916d-cf69675d1a57` |
| Master Tasks data source | `fd13a605-5781-4b55-abc0-adfefc8aa19b` |
| Reviewed / imported / archive-only | `34 / 30 / 4` |

Any change to a bound hash, identifier, count, mapping, target, or pending step
invalidates this Approval and requires a new version.

## Verified Phase A state

- Master Tasks contains 30 pages with 30 unique deterministic source references.
- Lifecycle totals are 15 Captured, 10 Planned, 2 Waiting/Blocked, and 3 Ready
  for CEO Review.
- Routing totals are Content Creation 4, MicroSaaS 6, Academic 10, Career Job 1,
  Personal Life 7, and Finance 2.
- The four archive-only records were not imported.
- All five legacy databases remain unchanged and writable.
- The 30 imports can still be quarantined by their `notion-migration:` prefix.

The executable rejects `--phase=A` under Version 3 before any source read, write,
or evidence-file replacement. Before Phase B writes anything, it re-hashes the digest, source
snapshot, and completed Phase A report; re-reads all five sources; verifies all
34 record payloads; and idempotently reconciles every existing import against its
exact lifecycle, Workstream, Executive, commitment provenance, and canonical
projection. Any per-item or aggregate drift stops execution.

## Exact Phase B steps

1. Create or verify five linked views over the bound Master Tasks data source,
   retaining the familiar Content Creation, MicroSaaS, Academic, Job x Life, and
   Finance task-page names and their approved Workstream filters.
2. Edit one reversible sample through each non-empty linked view, verify that the
   same canonical Work Item changes, and restore the sample.
3. Probe all five legacy sources for retirement before retiring any one of them.
4. Rename all five originals with the `ARCHIVED EVIDENCE` prefix, lock them
   against editing, and retain their contents without deletion or synchronization.
5. Verify that Master Tasks is the only writable task system and record the view
   identifiers, sample checks, retirements, counts, timestamp, and recovery state
   in the RM-11 Phase B report.

## Recovery boundary

- Before the first legacy retirement, stop safely: the legacy databases remain
  daily use and the 30 imports can be quarantined.
- The first successful rename-and-lock crosses the commit point. A partial
  failure records exactly which sources retired.
- After the commit point, recover by unlocking and restoring all five legacy
  databases together, then quarantining the 30 imports. Never leave both systems
  writable or introduce bidirectional synchronization.

## Decision

Recommendation: **approve and execute `RM11-CUTOVER-3`**. It corrects the exact
artifact boundary without changing a CEO-reviewed decision and authorizes only
the still-pending Phase B retirement.

Use this exact sentence:

> I approve RM11-CUTOVER-3 bound to RM11-DIGEST-2, digest SHA-256 f6d31c8d318cdefb7f488df68f50be64829f99dc6b38369f1450f7bd721a17b6, source snapshot SHA-256 c66d697d04a7da1f0be61e2827e250a84cca47f1c10329f985757dda05546325, and completed Phase A report SHA-256 a148737ae4d6e61761570d5726130898d9c580a361bb070cf3dffaad725f2f7f. Execute only the documented Phase B continuation and stop on any drift.

## Test cases

| Test | Expected result |
| --- | --- |
| Any bound evidence hash differs | No Phase B write; Approval rejected as stale. |
| A source record differs from the bound snapshot | No Phase B write; return for a new CEO decision. |
| Phase A reconciliation replays | Master Tasks remains at 30 unique imports. |
| A linked-view sample cannot round-trip | Stop before retirement. |
| Any source cannot be retired | Stop before retiring the first source. |
| Phase B succeeds | Five linked views work, five originals are read-only evidence, and Master Tasks is the only writable system. |

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Source count or payload differs | Rehearse read-only again and prepare a new version. |
| Phase A report hash differs | Preserve both files, investigate the difference, and do not run Phase B. |
| A linked view points elsewhere | Stop and correct the target before retirement. |
| Retirement fails after the commit point | Follow the generated Phase B failure report; restore all five together. |
| Raw task content appears in Git | Remove it from the change set; raw evidence stays in ignored `tmp/`. |
