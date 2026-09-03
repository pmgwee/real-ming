# Notion task-status semantics

This is the canonical interpretation of Ming's five legacy Notion task-board
categories. Apply it whenever an agent reads, migrates, summarizes, or writes one
of the task databases. Emoji, spacing, and parenthetical view labels are display
variants; the meaning comes from the category below.

| Notion category | CEO-confirmed meaning | Real-Ming lifecycle | Agent behavior |
| --- | --- | --- | --- |
| `Pending` | Future backlog. Ming will move it to To Do when its timing is ready. | `Captured` | Preserve it without treating it as planned, blocked, or currently executable. |
| `To Do` | Open work that is ready for Ming or an Executive Agent to start and complete. | `Planned` | Treat it as actionable, subject to authority, commitment, and scheduling rules. |
| `Issues` | Work has a blocker, problem, or obstacle that must be cleared first. | `Waiting/Blocked` | Record the blocker and next clearing action; do not report the underlying task as completed. |
| `Pending to Review` | Work left To Do after execution and is waiting for the CEO's final review. | `Ready for CEO Review` | Present evidence and an Outcome Report. Only the CEO can choose Completed, Changes Requested, or Cancelled. |
| `Done` | Work is completed. | `Completed` | Preserve completion provenance and evidence; do not re-execute on migration or replay. |

## Normalization

- Match category names case-insensitively after removing emoji and normalizing
  whitespace.
- A domain suffix such as `To Do (Life)` or `To Do (FYP/Research Paper)` retains
  the `To Do` meaning; the suffix may inform Workstream routing.
- `Pending` is backlog, not `Waiting/Blocked`. `Issues` is the blocked state.
- `Pending to Review` is distinct from `Pending` and must be matched first.
- Preserve the original category and source reference as migration provenance.

## Unrecognized or incomplete records

An empty or unknown status has no implied lifecycle. Route it through CEO
reconciliation or an explicitly approved migration disposition. A blank-title row
is not a valid canonical Work Item and should normally remain archive-only evidence.

`Daily Routine` is legacy recurrence metadata rather than one of the five workflow
categories. For the RM-11 cutover, preserve the recurrence marker and migrate an
approved active routine as `Planned`; future scheduling work may materialize its
individual occurrences.

## Completion criterion

A migration or adapter interpretation is complete only when every source record
has its original category preserved, one authorized canonical lifecycle or an
archive-only disposition, and no `Pending`, `Issues`, or `Pending to Review` item
has been collapsed into another meaning.
