# Resume the graph loop

Use this file whenever Codex or Claude Code stops because of a usage limit,
context reset, crash, or manual handoff. The repository and live GitHub state are
authoritative; exporting the previous conversation is optional and should not be
needed.

## Before restarting

1. Open `C:\Users\quekm\Desktop\projects\real-me` without switching branches or
   cleaning the working tree.
2. Choose the prompt for the receiving agent below.
3. In the receiving task/session, run `/goal` first. If its Goal exists, resume it
   when needed and use the short follow-up. If no Goal exists, paste that agent's
   full Goal prompt. Goals belong to a task/thread, not to the repository or the
   other agent.
4. If the receiving agent reports a CEO blocker, complete the linked runbook in
   `CEO-Office/` and paste the same prompt again afterward.

## Rotation rule

The rotation is repeatable; there is no special second-round prompt:

1. Codex stops → open or resume Claude Code and run `/goal`. If the Goal was
   restored, run `/goal resume` when paused and use the short follow-up. If no
   Goal exists, paste the **Claude Code continuation prompt**.
2. Claude Code stops → return to Codex. In the same Codex task, run `/goal` to
   inspect the Goal and `/goal resume` if it is paused. If no Goal exists—or this
   is a new Codex task—paste the **Codex Goal continuation prompt**.
3. Codex stops again → repeat Step 1; inspect first, resume when present, install
   the full Claude Goal only when absent.
4. Repeat. Each receiver reconstructs the checkpoint from Git, GitHub, the graph,
   and `CEO-Office/`; no prompt carries a stale commit number.

**No prompt below names a ticket, a file, or a commit.** Ticket state belongs in
`CEO-Office/README.md` and the scheduler, which are kept current; a prompt is
copied once and then rots. A hand-off that failed on 31 August failed exactly
this way: the board still said Azure was unprovisioned and RM-11 awaited an
approval sentence, so a correct reading of a stale board would have halted the
receiving agent while the scheduler reported work ready.

---

## Claude Code continuation prompt

> Copy this block into a new Claude Code session. It stays below Claude Code's
> 4,000-character goal limit. It is also the recovery prompt when `/goal` reports
> no Goal after a usage/credit-limit stop.

```text
/goal Continue Real-Ming Phase 3 through its deterministic graph-governed implementation loop.

Repository: C:\Users\quekm\Desktop\projects\real-me
Continue the currently checked-out milestone branch. Preserve the working tree exactly as found. Do not merge main, rewrite pushed history, discard changes, expose secrets, bypass CEO authority, or invoke Superpowers skills.

RECONSTRUCT THE CHECKPOINT FIRST
Read AGENTS.md, CEO-Office/README.md, CONTEXT.md, docs/specs/real-ming-v1.1.md, and docs/BASELINE.md in full. Run git status, git log -5, npm run graph:status, and inspect the selected GitHub issue plus comments. Treat Git, live GitHub state, the scheduler, and CEO-Office as authoritative over this prompt or prior chat summaries. Audit every existing uncommitted file before editing; it may be a valid partial ticket or CEO-blocker artifact.

GRAPH LOOP
1. Use only the node named by npm run graph:status; never select from memory or increment ticket numbers.
2. Assign that issue to @me and read its acceptance criteria and relevant ADRs.
3. Stop only when THIS ticket cannot proceed: a CEO-only decision, or an unmet CEO-Office action blocking it. An outstanding CEO item that blocks nothing is not a reason to stop. Where CEO-Office and npm run graph:status disagree on whether a ticket is blocked, the scheduler is right and the board is stale: correct the board as part of the ticket.
4. Implement only the selected ticket through red-to-green TDD using the Real-Ming System Harness and Provider Adapter Contract Harness.
5. Run focused tests, npm run check, npm audit --audit-level=high, and git diff --check; require successful exit codes.
6. Obtain independent Standards and Spec reviews against the previous commit. Reproduce each suspected correctness defect with a failing approved-seam test before fixing it. Before trusting a test as evidence, break the code it covers and confirm that test fails.
7. Commit only that ticket, push, close its issue with evidence, recompute the graph, and immediately continue.

SUBAGENTS
Use subagents when they materially increase confidence: independent Standards and Spec reviews, bounded read-only investigations, or isolated test analysis. Keep one implementation owner for the ticket. Never let parallel agents edit shared files or mutate live systems. Give each a narrow deliverable and fixed comparison point; the primary agent integrates findings and owns the final diff.

LIVE AUTHORITY
Ask before sending messages, mutating Notion or production data, deploying, restarting services, or performing another outward-facing or hard-to-reverse action. Preparation, read-only inspection, and local tests are not mutation approval. An Approval is exact-version scoped and cannot be inferred from general consent.

BLOCKERS
When only Ming can proceed, stop immediately, state the ticket and exact action, create/update its runbook in CEO-Office with TL;DR, prerequisites, steps, tests and troubleshooting, and refresh CEO-Office/README.md. Preserve partial work. Do not substitute another ready node because one selected node needs CEO action.

BRANCHING AND DECISIONS
Work on feat/tracer-1-daily-operations and open one PR per milestone, never one growing branch. This branch has one implementation owner at a time; if another agent session is active on it, stop and say so rather than committing. Announce every pull request in your reply with its number, contents, and your recommendation, and add it to the Decisions table in CEO-Office/README.md. Never let a PR appear that I have to discover myself.

TERMINAL CONDITION
Ordinary ticket completion is a checkpoint, not permission to stop. Continue until all 44 tickets are closed with evidence, or every unfinished ticket is blocked solely by documented CEO action; all gates pass; completed work is committed and pushed; baseline artifacts agree; milestone PRs carry CEO review packets; and main remains unmerged pending explicit approval.
```

---

## Codex Goal continuation prompt

> Paste this block into Codex after Claude Code—or another Codex session—stops.
> Codex Goals require Codex 0.128.0 or later and may need `features.goals = true`.
> Use this full block when `/goal` reports that no Goal exists.

```text
/goal Continue the active Real-Ming Phase 3 implementation until its graph terminal condition is met.

Repository: C:\Users\quekm\Desktop\projects\real-me
Continue the currently checked-out milestone branch. Preserve every existing change. Do not merge main, rewrite pushed history, discard work, expose secrets, bypass CEO authority, or invoke Superpowers skills.

First reconstruct and audit the checkpoint. Read AGENTS.md, CEO-Office/README.md, CONTEXT.md, docs/specs/real-ming-v1.1.md, and docs/BASELINE.md in full. Run git status, git log -5, and npm run graph:status; inspect the selected live GitHub issue and comments. Git, GitHub, the scheduler, and CEO-Office override chat summaries. Determine which files are committed, pushed, intentionally dirty, partially implemented, reviewed, or still unverified before editing anything.

Then follow AGENTS.md's one-ticket graph loop exactly: scheduler selection; issue assignment and acceptance-criteria review; red-to-green work through only the two approved harnesses; focused and full gates; independent Standards and Spec reviews against the previous commit; failing-test reproduction before correctness fixes; ticket-only commit; push; evidence-backed issue close; graph recomputation; immediate continuation. Before treating a test as evidence, break the implementation it covers and confirm that test fails; a test that passes against a deliberately broken implementation is not evidence.

Use subagents selectively for bounded independent work that raises confidence: separate Standards and Spec reviews, read-only architecture/provider investigations, and isolated test analysis. Keep one implementation owner per ticket, never parallel-edit shared files, and never delegate live mutations. The primary agent owns integration, verification, commit, and closeout.

Work on feat/tracer-1-daily-operations and open one PR per milestone, never one growing branch. This branch has one implementation owner at a time; if another agent session is active on it, stop and say so rather than committing. Announce every pull request in your reply with its number, contents, and your recommendation, and add it to the Decisions table in CEO-Office/README.md. Never let a PR appear that I have to discover myself.

Ask before any outward-facing or hard-to-reverse live action. Stop immediately when the selected ticket cannot proceed without a CEO-only decision, or when CEO-Office names an unmet human action that blocks the selected ticket: state the exact action, create/update the CEO-Office runbook and status board, preserve partial work, and wait. An outstanding CEO item that blocks nothing is not a reason to stop; carry it forward in the status board and keep working. If CEO-Office and npm run graph:status disagree about whether a ticket is blocked, the scheduler is right and the board is stale, so correct the board as part of the ticket. Preparation or reconciliation review is not approval to mutate.

Do not stop after an ordinary ticket report. Keep working across turns until all 44 tickets are closed with evidence, or every unfinished node is blocked solely by documented CEO actions; all gates pass; completed work is pushed; baseline artifacts agree; milestone PRs carry CEO review packets; and main remains unmerged pending explicit approval.
```

---

## Short follow-up in the same session

If Claude Code or Codex still has its active Goal and context, inspect it first
with `/goal`. If paused, run `/goal resume`. Then use this short checkpoint prompt
instead of replacing the Goal:

```text
Continue the active Real-Ming graph goal from the repository checkpoint. Re-read AGENTS.md and CEO-Office/README.md, audit git status and npm run graph:status, preserve all existing work, and resume the selected ticket. Keep working until the documented terminal condition or the next genuine CEO blocker.
```

If `/goal` reports no current Goal, use the receiving agent's full Goal prompt.
Claude Code's session-resume picker can restore an active Goal, but a Goal cleared
by an exhausted usage/credit balance must be installed again. Goal state never
transfers between Claude Code and Codex, between unrelated tasks, or through Git.

## Why conversation export is optional

No required convention should live only in chat. `AGENTS.md` defines execution,
the graph and GitHub define work state, `CEO-Office/` defines human blockers,
and Git records completed changes. A transcript may add historical context, but a
receiving agent must verify the repository checkpoint independently.
