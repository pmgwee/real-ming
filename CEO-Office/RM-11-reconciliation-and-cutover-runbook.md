# RM-11 — Reconcile and approve the Master Tasks cutover

> **TL;DR — reconciliation and Phase A are complete.** Review the current
> [Phase B packet](RM-11-phase-b-approval-packet.md) and paste its exact Approval
> sentence to authorize the linked-view cutover and retirement of the five legacy
> writers. No Phase B mutation occurs merely by reading this runbook.

---

## Why this cannot be delegated

RM-10 proved that all 34 legacy records can be backed up and normalized without
changing Notion. It also identified 34 status decisions, 15 Job/Life Workstream
decisions, and 3 missing-field flags. Only Ming, acting as CEO, can decide the
current business meaning of those records and authorize replacing five writable
systems with Master Tasks. An agent may propose dispositions and execute an
approved plan, but it cannot approve its own proposal.

---

## Prerequisites

- [x] RM-09 Master Tasks and six Work Views exist.
- [x] RM-10 backed up five sources and completed a read-only isolated rehearsal.
- [x] The local evidence directory is gitignored and contains 34 source records.
- [x] Ming started the CEO reconciliation session.
- [x] Every active item received an accepted status, Workstream, Accountable Executive, commitment provenance, and migration disposition.
- [x] Ming approved `RM11-CUTOVER-2`; Phase A imported and verified 30 Work Items.
- [ ] Ming approves `RM11-CUTOVER-3` for the Phase B commit point.

Do not paste task contents, Notion credentials, or backup JSON into chat.

---

## Completed reconciliation steps

1. Reply in the active implementation session:

   > Start the RM-11 CEO reconciliation working session. Prepare a private review digest from the local RM-10 evidence, present the decisions in manageable batches, and do not mutate Notion until I separately approve the exact cutover plan and final reconciliation digest.

2. Review each proposed item disposition. For every item, confirm or correct:
   status, Workstream, Accountable Executive, commitment provenance, and whether
   to migrate, merge as a duplicate, or retain only as archived evidence.

3. Ask the agent to regenerate the reconciliation digest until all 34 records are
   accounted for and no unresolved decision remains.

4. Review the exact cutover plan. It must name the backed-up source identifiers,
   approved digest/integrity reference, target Master Tasks data source, expected
   post-cutover counts, sample checks, rollback boundary, and the five source
   databases that will become archived read-only evidence.

5. If the digest and plan are correct, give an explicit approval tied to that
   exact version. Starting the session or approving individual item decisions is
   not approval to mutate Notion.

6. After execution, verify that the familiar pages are linked Master Tasks views,
   edits reach the canonical Work Item, the original five databases are no longer
   parallel writable systems, and post-cutover counts/samples match the approved
   report.

---

---

## Stale Approval (29 Aug 2026)

**`RM11-CUTOVER-1` was not executed. Notion is unchanged.**

The read-only preflight compared every one of your 34 records against the payload
you reviewed. The record set is intact — same five sources, same counts
(4, 8, 7, 15, 0), nothing added or removed — but **4 records had their Status
edited** after you approved:

| Source | Records with a changed Status |
| --- | ---: |
| Content Creation | 1 |
| MicroSaaS | 3 |

Titles are unchanged; in each case exactly one property moved, and it was Status.
That is the one field the entire reconciliation turned on — `Pending`, `To Do`,
`Issues` and `Pending to Review` are what decided each record's lifecycle. So the
Approval no longer describes the records it would migrate, and your own sentence
said to stop on any drift.

Nothing was written. This is the documented behaviour, not a failure.

### Resolved — the change was cosmetic

All four records changed the same way: `To Do (Event/Work)` became `To Do`. That
is a Notion status-option rename, not a change of meaning. The status semantics
you confirmed say a domain suffix such as `To Do (Life)` retains the `To Do`
meaning, so all four keep the `Planned` lifecycle, the same Workstream, the same
Executive and the same disposition.

**Not one of the 34 decisions changed.** That was proved, not assumed: the plan
was rebuilt from the fresh snapshot and its decisions compared field by field
against the ones you approved. Only the four payload hashes moved.

`RM11-CUTOVER-2` therefore asks nothing new of you. It is the same reconciliation
re-bound to a snapshot that matches Notion as it stands now. Your RM-10 backup is
untouched and remains the immutable recovery evidence.

That historical approval completed Phase A. It must not be replayed for Phase B.

---

## Current execution state (29 Aug 2026)

`RM11-CUTOVER-2` received exact Approval. Phase A then completed: 30 canonical
Work Items were imported, the four archive-only records were excluded, all
approved lifecycle and routing totals reconciled, and the five legacy databases
remained unchanged and writable.

Before Phase B, a checkpoint audit found one clerical contradiction in the
published packet: its bound-value table, private digest hash, executable binding,
and completed Phase A all use `RM11-DIGEST-2`, while Phase A Step 4 still named
`RM11-DIGEST-1`. Version 2 is preserved as historical evidence; the new
`RM11-CUTOVER-3` Phase B packet binds Digest 2 and the completed Phase A report.
No reviewed decision, count, mapping, target, or prior executable behavior changed.

Because this is an exact-Approval boundary, Phase B remains paused until Ming
approves Version 3 and explicitly authorizes the commit point. Use the single
exact sentence in `CEO-Office/RM-11-phase-b-approval-packet.md`.

Phase A is reversible — the 30 imports can be quarantined by their deterministic
`notion-migration:` source-reference prefix while the five legacy databases
remain the daily system. Phase B is the commit point.

```bash
npm run notion:cutover-master-tasks -- --live --phase=B --plan-version=RM11-CUTOVER-3 --approval=<approval-id> --digest-sha256=<digest-hash> --backup-sha256=<backup-hash> --phase-a-report-sha256=<phase-a-report-hash>
```

The command refuses to run without every flag, and refuses again if the digest,
source snapshot, or completed Phase A report no longer hashes to the approved
value. It then replays Phase A idempotently as a live drift check before Phase B.

### What the two independent reviews changed

Both reviews found real defects before anything ran. All were fixed and each is
held by a test:

| Defect | Why it mattered | Now |
| --- | --- | --- |
| Retirement ran source by source | A failure on the third left two databases already locked — a half-retired state this runbook forbids | Every source is probed first; one refusal leaves all five writable |
| Recovery stage was set only after Phase B fully succeeded | A crash mid-retirement would have told you "the legacy databases remain the daily system" while two were locked | The commit point is reported as crossed from the first successful retirement, and a Phase B failure writes `phase-b-failure.json` naming exactly what was retired |
| Master Tasks de-duplicates on Work Item ID | Losing the local state file between phases would have created a second Master Tasks page for all 30 records | Phase A refuses if a planned record is already imported under a different Work Item |
| Review-ready records had no Outcome Report | The 3 `Pending to Review` records would have been permanently uncompletable — you could only cancel or reject them | Each arrives with a migration Outcome Report (see below), and the database now enforces this on insert, not only on update |

### The three `Pending to Review` records

Real-Ming defines Review-Ready Work as a Work Item presented **with** an Outcome
Report. Those three records therefore arrive with one, and it says plainly that
the effect Real-Ming performed was the *migration* — not the underlying work,
which you did outside the system. Each report carries:

- a remaining risk naming the legacy record as the only evidence, and
- a required decision: confirm the legacy outcome before completing.

So you can complete them, but the report tells you what you are actually
confirming. Nothing claims Real-Ming executed or verified the original work.

---

## Test cases

| Test | Expected result |
| --- | --- |
| Start the working session | A private, batched review digest is prepared; Notion remains unchanged. |
| Leave one item unresolved | Cutover Approval is unavailable and no source mutation occurs. |
| Approve an older digest or plan | Approval is rejected as stale; a new exact-version Approval is required. |
| Execute the approved cutover | Master Tasks receives only approved records and linked views remain editable. |
| Inspect the five legacy sources | They are retained as archived read-only evidence, not synchronized writable copies. |
| Run post-cutover verification | Counts and sampled records reconcile; recovery instructions identify the immutable RM-10 backup. |

---

## Troubleshooting

| Symptom | Cause and response |
| --- | --- |
| Task contents appear in Git status | Stop. Raw evidence belongs only under the gitignored `tmp/rm10-migration-rehearsal/` directory. |
| A status or Workstream is unclear | Mark it unresolved and ask Ming; do not infer a business decision. |
| Counts differ from 34 before cutover | The source snapshot changed. Rerun a read-only backup/reconciliation and invalidate the old digest. |
| A source changed after Approval | Treat the Approval as stale and require a new digest and exact-version Approval. |
| Linked views do not update Master Tasks | Stop the cutover and use the documented recovery path; do not leave two writable task systems active. |
