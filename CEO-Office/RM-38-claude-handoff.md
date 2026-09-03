# Claude Code handoff — Real-Ming RM-38

**Handoff purpose:** continue the active Phase 3 graph goal from this exact
checkpoint. The current Codex turn is intentionally stopping here at the
user's request; it has not started RM-40.

## Repository checkpoint

- Repository: `C:\Users\quekm\Desktop\projects\real-me`
- Branch: `feat/tracer-1-daily-operations`
- HEAD before this handoff: `d2fd70a` (`docs: update graph board after RM-44`)
- Previous implementation commit: `04e5640` (RM-44)
- GitHub repository: `pmgwee/real-ming`
- RM-38 is GitHub issue **#39**, currently open and scheduler-selected.
- RM-40 is issue **#41**, still blocked by RM-38.
- Do not merge `main`, rewrite pushed history, discard existing changes, expose
  secrets, or invoke Superpowers skills.

`npm run graph:status` at handoff reports **42 completed, 1 ready
(RM-38), 1 blocked (RM-40)**. The scheduler, live GitHub issue state, and
repository files are authoritative if this note becomes stale.

## Working-tree state

RM-38 was already staged by the preceding session. The current Codex session
added corrective changes on top of that staged snapshot. The work is **not yet
committed or pushed**. Preserve all of it.

Tracked RM-38 implementation/test files currently touched:

- `src/dashboard/dashboard-page.ts`
- `src/knowledge/knowledge-operations.ts`
- `src/knowledge/knowledge-vault.ts` (Git reports this source as binary because
  its pre-existing hash delimiter contains a NUL byte; do not normalize it)
- `src/knowledge/personal-context-ingestion.ts`
- `src/operations/operations-state.ts`
- `src/operations/retention-policy.ts` (new)
- `src/runtime/daily-operations-control-plane.ts`
- `src/runtime/production-control-plane.ts`
- `src/testing/real-ming-system-harness.ts`
- `test/system/retention-policy.system.test.ts` (new)

Two existing regression tests were updated because the new RM-38 Work Item
secret boundary correctly rejects secret-bearing captures:

- `test/system/private-worker.system.test.ts`
- `test/system/deployment-promotion.system.test.ts`

The new handoff file itself is this uncommitted file under `CEO-Office/`.

## What the current implementation does

The RM-38 changes now:

1. Persist payload-free Candidate Envelope provenance in an append-only
   `knowledge_candidate_retention` table before staging. Raw payloads remain
   ephemeral; the later purge still has the candidate ID, source identity and
   reference, evidence ID, Trust Domain, timestamps, hash, and retention class
   after compilation or a restart.
2. Calculate raw-candidate eligibility from the candidate's finite retention
   class and record that class in purge evidence. A stricter class is not
   silently relabelled as the 30-day default.
3. Preserve the Personal Context retention class in its purge-event projection,
   so evidence reports (for example) `personal-context-7d` accurately.
4. Make compiled-generation retention explicit for every Trust Domain: Personal
   superseded generations use 12 months; Ming Creatives, Academic,
   Entertainment, and Finance use the explicit 30-day v1 policy. Vault purge
   evidence records the calculated publication-plus-retention eligibility date.
5. Reconcile the Knowledge Vault's durable local purge log on every sweep, so a
   vault deletion is not lost if the central OperationsState write fails and a
   later process restarts.
6. Require an injected backup adapter to return a candidate plus
   `deleted: true` and `verified: true` before central backup purge evidence is
   recorded. Production control-plane composition defaults `retentionRequired`
   to true, so it refuses to report a configured retention runtime as healthy
   without Personal Context and backup-purge capabilities.
7. Reject Sensitive-Secret-shaped values before Work Item, commitment, Outcome
   Report, or audit durability. The existing private-worker and deployment
   tests were adjusted to assert the new boundary.

## Evidence already run

Before this handoff:

- `npm run check` completed successfully: 60 test files, 741 passing, 2
  skipped; typecheck, build, and deployment preflight passed.
- Focused RM-38/Knowledge suites passed (52 tests across the three focused
  suites; the RM-38 file has 9 passing tests after the final additions).
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `git diff --check` exited 0.
- The first red run was captured before the fixes: raw-after-compile evidence,
  strict Personal Context policy, calculated vault eligibility, backup proof,
  and secret-bearing Work Item scenarios failed. The focused suite is now
  green.

## Required work before RM-38 can close

1. Re-read `AGENTS.md`, `CEO-Office/README.md`, `CONTEXT.md`,
   `docs/specs/real-ming-v1.1.md`, `docs/BASELINE.md`, and the live issue:
   `gh issue view 39 --repo pmgwee/real-ming --comments`.
2. Inspect `git status`, the complete diff against `d2fd70a`, and the current
   generated graph status. Do not rebuild or overwrite RM-07–RM-44 work.
3. Collect the pending independent Standards and Spec re-reviews against
   `d2fd70a`. Codex had requested both reviews immediately before handoff;
   if their replies are unavailable, run fresh read-only reviews. Reproduce any
   claimed defect with a failing test before changing code.
4. Re-run the focused suites and all gates by exit code. If a reviewer still
   treats Financial Snapshot restart durability, Personal Context projection
   persistence, or live backup-store wiring as an RM-38 blocker, decide from
   the issue/ADR scope and either fix it in RM-38 or document the exact
   follow-up ticket; do not silently claim it is live.
5. Stage only the RM-38 implementation and its necessary regression tests,
   commit one ticket-only commit, push it, comment issue #39 with the commit,
   gate results, and both review verdicts, then close #39 only when its
   acceptance criteria are evidence-backed.
6. Recompute `npm run graph:status`. Only after RM-38 is genuinely closed may
   the scheduler release RM-40 (#41). Continue one ticket at a time until the
   graph terminal condition in `CEO-Office/RESUME-PROMPT.md` is met; do not
   stop after this handoff unless a real CEO-only blocker is reached.
7. Keep `CEO-Office/README.md` and `docs/BASELINE.md` synchronized with the
   live graph. Any documentation/status-board commit must remain separate from
   the ticket-only RM-38 commit. Do not merge `main` without CEO approval.

## Suggested Claude Code continuation prompt

Read this handoff first, then resume the active Real-Ming graph goal from the
repository checkpoint. Verify every claim against the repository and live
GitHub; where this file disagrees, the repository wins. Preserve all existing
RM-38 work, finish RM-38 with the AGENTS.md red-to-green, focused/full-gate,
independent Standards/Spec review, ticket-only commit, push, issue-close, and
graph-recompute loop, then continue the scheduler-selected tickets until the
documented terminal condition or the next genuine CEO-only blocker. Do not
start RM-40 before RM-38 is closed, do not merge main, do not rewrite pushed
history, do not expose secrets, and do not invoke Superpowers skills. Use
subagents only for bounded independent review/investigation; keep one
implementation owner and have the primary agent integrate, verify, commit,
push, and close issues.

