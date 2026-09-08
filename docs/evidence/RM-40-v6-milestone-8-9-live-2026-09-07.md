# RM-40 · Milestones 8 and 9 — live acceptance and recovery

Executed 7 September 2026, 03:31–03:40 UTC (11:31–11:40 KL) on
`real-ming-control-plane-my`. Read-only against providers; one deliberate full
service restart.

> **Historical boundary:** this capture predates the later same-day native
> capability expansion and DuitSini tracer run. Its checkout/credential blocker
> is retained as evidence of that checkpoint; see [the later tracer evidence](RM-40-v6-unattended-cron-and-duitsini-2026-09-07.md)
> for the updated state.

## TL;DR

Notion reads back **exactly**, honest-failure behaviour holds live, and a full
restart of both services lost nothing and replayed nothing.

**One milestone 8 scenario is genuinely blocked and is not claimed:** the
DuitSini coding tracer. There is no checkout, no git credential and no `gh` on
the host, so the agent cannot reach the repository. That is a missing
credential, not missing engineering.

## Milestone 8 — what passed

### Notion read-back with the status semantics intact

A live authorized query of Master Tasks returned all 33 rows. The lifecycle
distribution matches Real-Ming's own state exactly:

| Lifecycle | Notion | Real-Ming |
| --- | ---: | ---: |
| Captured | 18 | 18 |
| Planned | 10 | 10 |
| **Ready for CEO Review** | **3** | **3** |
| Waiting/Blocked | 2 | 2 |

`Ready for CEO Review` survives as its own state in production data rather than
being collapsed into `Done`. That is the distinction
`docs/agents/notion-task-status-semantics.md` exists to protect, holding in the
live record and not only in a controlled test.

### Honest failure, live through the agent

| Probe | Result |
| --- | --- |
| Fetch a Work Item that does not exist | *"The Real-Ming lookup returned an error: 'No Work Item work-item:does-not-exist-12345.' No Work Item data was retrieved."* |
| Link a native task to a non-existent Work Item | `{"error": "No Work Item work-item:does-not-exist-12345."}` — refused, no dangling record |

Nothing was invented and nothing was written. This is the same contract the
harness asserts, now observed against the deployed extension.

### Native Telegram formatting and commands

Already user-observed and accepted on 6 September; see
`RM-40-v6-milestone-3-cutover-evidence.md` and the telegram/memory acceptance
record. Not re-run here.

### Blocked: the DuitSini coding tracer

No `*duitsini*` directory exists on the host, `real-ming` has no git credential
or `.git-credentials`, and `gh` is not installed. The agent can read, edit and
test code — milestone 1 proved that with a real diff and a verified exit status
— but it cannot reach this repository.

This needs a decision, not more engineering. A checkout plus a credential in the
**Hermes** environment would let the agent work on DuitSini; pushing a branch or
opening a pull request is a **write-scoped** grant and deserves its own
conversation rather than being bundled with the read-only tokens already
outstanding.

## Milestone 9 — restart and reconcile

Both services were restarted deliberately.

| | Before | After |
| --- | --- | --- |
| Work Items | 33 | **33** |
| Audit events | 61 | 61 |
| Scheduler occurrences for 2026-09-07 | 3 | **3** — nothing replayed |
| Native cron run id | `native-hermes-cron:executive…` | preserved |
| `hermes`, `hermes-dashboard`, `real-ming`, backup timer | active | **all active** |
| Gateway platforms | connected | `api_server` and `telegram` reconnected |
| Cron next runs | 07:30 / 21:30 `+08:00` | unchanged |
| Scheduler ownership | `native-hermes-cron` | preserved |
| Data directory | `drwxrws--- azureuser:real-ming-data` | **preserved** — the unit fix holds |

The last row matters: before today's fix, a restart silently reverted that
permission and disabled the MCP extension.

## Usage, cost and retention

Recorded by Hermes in `session_model_usage`:

| Model | Calls | Input tokens | Output tokens | Billing |
| --- | ---: | ---: | ---: | --- |
| `gpt-5.6-sol` | 44 | 487,749 | 19,083 | `openai-codex`, `subscription_included` |
| `gpt-6-astra` | 4 | 248,866 | 7,262 | `openai-codex`, `subscription_included` |

A second model appears and was checked rather than assumed. `gpt-6-astra` is
used for `background_review` and bills through the same Codex subscription — not
an unexpected paid provider. The `gpt-5.6-sol` calls break down as 23 primary,
18 `title_generation`, 2 `approval` and 1 `background_review`.

**Nothing is metered externally**, so the RM250 Metered Platform Cost cap is not
approached by agent usage. Azure compute and storage remain the real spend and
are unchanged by this work.

Retention: `retention_purge_events` and `knowledge_candidate_retention` exist and
hold **0** rows, which is correct — nothing has reached its retention window on a
system this young. Disk is 7.5 G of 123 G (7%); 7 backup generations occupy 36 M
and the native Hermes home 581 M.

## What is left before RM-40 can close

1. **Tonight's 21:30 roll-up and tomorrow's 07:30 brief** — the first unattended
   cron fires. Until one lands, native scheduling is verified by deliberate runs
   only.
2. **The DuitSini tracer** — blocked on a checkout and credential.
3. **Ming's own reviews** — the CEO dashboard's usefulness, and opening the
   Obsidian vault from his client.
4. **RM-40 (#41) acceptance criteria** — still Revision 5 shaped; nothing has
   been posted to GitHub.
5. **East Asia** — stays deallocated and undeleted until all of the above pass.
