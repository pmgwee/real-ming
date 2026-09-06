## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `pmgwee/real-ming`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with `CONTEXT.md` and system-wide ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### Notion task semantics

Before interpreting, migrating, or writing a Notion task status, read `docs/agents/notion-task-status-semantics.md`. It defines the CEO-confirmed legacy meanings and canonical lifecycle mapping.

## Environment prerequisites

The loop needs three things present before the first ticket:

| Requirement | Check | Fix |
| --- | --- | --- |
| `gh` authenticated | `gh auth status` | `gh auth login` |
| Chromium for the browser tests | `node -e "require('playwright').chromium.launch({headless:true}).then(b=>b.close())"` | `npx playwright install chromium` |
| `.env` present | `npm run secrets:preflight` | see `CEO-Office/GATE-1-provisioning-runbook.md` |

`npm run check` runs a real browser test for the CEO dashboard and **fails rather than skips** when Chromium cannot launch. That is deliberate: a silent skip would let the dashboard read model go unproven while the suite still reported green. Install the browser rather than weakening the test.

## How work is selected

Never choose a ticket from memory, and never increment a ticket number. The scheduler decides:

```bash
npm run graph:status
```

It validates the 44-node graph in `real-ming-phase3-tickets.json`, reconciles against live GitHub issue state, and names the next unblocked node. Live GitHub state always overrides the local snapshot.

Work one ticket at a time: read the issue and its comments, implement only its acceptance criteria, then recompute.

## Definition of done for a ticket

1. Red-to-green TDD through the two approved seams only — the Real-Ming System Harness (`src/testing/real-ming-system-harness.ts`) and the Provider Adapter Contract Harness (`src/testing/provider-adapter-contract-harness.ts`). Do not add a third seam or test internals.
2. `npm run check`, `npm audit --audit-level=high`, and `git diff --check` all pass. Verify by **exit code**, not by pattern-matching output.
3. Independent Standards and Spec reviews against the previous commit. Reproduce every suspected defect with a failing test before fixing it.
4. Commit only that ticket's work, push, and close the issue with evidence.

## Branching

One branch and one pull request per milestone, never one growing branch. `docs/BASELINE.md` and `CEO-Office/README.md` carry the current milestone table. A 44-ticket pull request cannot be meaningfully reviewed, which defeats the review discipline this system exists to enforce.

## When you are blocked on the CEO

Anything only Ming can do — creating an identity, handling a secret, approving a promotion, making a product decision — stops the loop. When that happens:

1. Say so plainly in your reply: what is blocked, which ticket, and what he must do.
2. Write or update a runbook in `CEO-Office/`, following the format of the existing ones: TL;DR, why it cannot be delegated, prerequisites, numbered steps, test cases with expected output, troubleshooting table.
3. Refresh the status board in `CEO-Office/README.md`.

Never bury a blocker in a summary, and never leave a new document for him to discover. `CEO-Office/` is the only place CEO-facing material belongs — not `docs/`.

## Decisions he must make

Opening a pull request, choosing a vendor, or anything else needing a yes/no goes in your reply as its own line with the number, what it contains, and your recommendation, and into the Decisions table in `CEO-Office/README.md`.

## Live systems

From RM-07 onward the work touches real accounts: Telegram, Notion, Google Calendar, DuitSini, Vercel, Agent Brain. Ask before any outward-facing or hard-to-reverse action — sending a message, mutating Notion, deploying, restarting a service.

Default tests must never contact a provider, spend quota, use a credential, or touch production data. Live smoke tests stay behind both an explicit flag and supplied credentials.

## Secrets

Values live only in a gitignored `.env` or the secret store. Code reads variable **names**; never a literal. Nothing may put a credential into Git, issue text, a test fixture, a log, or a prompt. `npm run secrets:preflight` reports names only. A test in `npm run check` scans every tracked file for credential-shaped material.

## Baseline

Preserve **Real-Ming v1.1 · Architecture Revision 6** across `docs/BASELINE.md`, the specification, and the current V6 diagram. A test fails the build if any artifact drifts.

Two labels exist and must not be conflated. The **design baseline** is Revision 6 (native Hermes owns transport, conversation and execution; Real-Ming is a thin additive extension — see `docs/adr/0020-run-ming-on-the-native-hermes-runtime.md`). The **deployed revision** is still Revision 5. Superseded revisions keep their original labels as historical evidence; the baseline test enforces that preservation rather than rewriting them.
