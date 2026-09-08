# RM-40 V6 · daily report readability refinement

Executed 7 September 2026 on the V6 implementation branch. This record covers
the presentation defect found in the native Telegram morning brief and evening
roll-up. It does not change source authority, Work Item lifecycle semantics,
scheduler ownership or Hermes memory behaviour.

## Problem observed

The live messages were technically truthful but not useful as a daily decision
surface. They repeated empty sections, exposed migration boilerplate as if it
were a blocker explanation, and listed the entire open backlog as “next
priorities”. The result hid the one or two things that needed Ming's attention.

The defect was in the report/presentation contract, not in the native Hermes
runtime. Real-Ming must continue to compose source-backed evidence; Hermes must
continue to own the conversation, final wording and Telegram delivery.

## Chosen contract

- **Focus first.** Begin with one sentence identifying the most important
  recorded decision, review, blocker or uncertainty for the day.
- **Evidence before prose.** Real-Ming keeps the full structured projection for
  dashboards and returns a bounded, replayable evidence artifact to Hermes.
- **Useful sections only.** Render source-health warnings, decisions,
  verified outcomes, blockers, review-ready outcomes, changes requested and
  possible next steps only when they contain information. Empty calendar state
  remains explicit; an unread calendar remains `unknown`, never `none`.
- **Bounded choices.** Show at most three ready, routed options, ordered by
  confirmed date, recorded priority and current progress. They are options,
  not new commitments or instructions to execute.
- **Honest backlog.** Captured/Triaged work is counted as backlog rather than
  promoted into today's priorities. Omitted-item counts remain visible so a
  concise report cannot be mistaken for a complete list.
- **No invented certainty.** Preserve stale/unavailable warnings, task names,
  approval/review distinctions, incidents and dates. Missing blocker detail
  becomes a concrete clearing question instead of the migration boilerplate.
- **Native voice.** The native Hermes cron prompt asks Hermes to turn the
  evidence into a concise 180–250 word Telegram response with Markdown-safe
  headings and bullets. It must not dump JSON, narrate MCP internals, browse,
  mutate records or send a second Telegram message.

## Implementation

- `src/operations/daily-digest.ts` contains presentation-only bounding,
  escaping, blocker cleanup and ready-option ordering.
- `src/operations/morning-brief.ts` and
  `src/operations/executive-roll-up.ts` retain their existing structured
  fields and add only the bounded presentation fields.
- `src/config/native-cron-manifest.ts` and the scheduled-report MCP
  description give Hermes the native-first presentation contract.
- `src/operations/native-scheduled-reports.ts` documents that the durable
  occurrence ledger records the source artifact; Hermes session history holds
  the final prose and neither composition nor ledger success proves delivery.

No provider credential, Telegram destination, source record or Work Item is
written by this change. No stale historical evidence document is rewritten;
the current production state and the staged refinement are kept separate.

## Verification

Controlled system tests cover backlog bounding, blocker naming, stale-calendar
focus, empty-section suppression, dated ready-option ordering, preserved full
structured projections, no state mutation and no Telegram delivery from the
composer. The focused suite passed **57 tests**. The full `npm run check`
passed with **820 tests and 2 skips**, including typecheck, build and the
deployment preflight. `npm audit --audit-level=high` exited 0 with no high
severity findings, and `git diff --check` exited 0.

These are repository-level proofs. The new image/prompt has **not** yet been
deployed to Malaysia West, and the first unattended job using the refinement
has not been accepted from Ming's phone. Deploying it is a separate
outward-facing action requiring CEO approval; after deployment verify one
morning brief and one roll-up, source warnings, Markdown/code readability and
no duplicate after restart.
