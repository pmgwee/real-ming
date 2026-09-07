# RM-40 · Milestone 5 — native cron owns the brief and roll-up

Executed 7 September 2026, 02:56–03:05 UTC (10:56–11:05 KL) on
`real-ming-control-plane-my`, under CEO approval given the same day for the
outward Telegram action and the ownership switch.

## TL;DR

Native Hermes cron now owns the trigger and delivery of both daily reports.
Real-Ming still composes them from its four sources. Ownership is
`native-hermes-cron`, both jobs are active at the correct Kuala Lumpur times,
and **no duplicate delivery is possible** — proven, not assumed.

Two defects were found and fixed before the switch. A third — a genuine failure
during the first run — was reported honestly by the agent rather than papered
over, which is the behaviour the design asks for.

## Result

| Job | ID | Schedule | Next run |
| --- | --- | --- | --- |
| Real-Ming Morning Brief | `5a6a8093645a` | `30 7 * * *` | `2026-09-08T07:30:00+08:00` |
| Real-Ming Executive Roll-Up | `03d42efb662a` | `30 21 * * *` | `2026-09-07T21:30:00+08:00` |

Both pinned to `gpt-5.6-sol` / `openai-codex` so a later global model change
cannot silently alter unattended cost or behaviour.

## The duplicate guard, live-verified

This is the outcome that mattered most, and it was demonstrated rather than
reasoned about.

The old Real-Ming scheduler had already delivered today's morning brief at
07:30 KL. When the native job was run deliberately at 11:00 KL, the composition
returned **skipped** and the agent replied `[SILENT]` — no second brief.

The roll-up had *not* yet run today, so the same deliberate run composed and
delivered a real report:

```
Executive Roll-Up — 2026-09-07 (21:30 Asia/Kuala_Lumpur)
Consolidated by the COO
Verified outcomes: none.
Outstanding risks:
  - Personal Life — Migrated at the CEO-approved lifecycle Waiting/Blocked
    from legacy status "🚧Issues". …
```

Note the status semantics surviving the boundary: the legacy `🚧Issues`
category is presented as `Waiting/Blocked`, not collapsed into something
else. That is `docs/agents/notion-task-status-semantics.md` holding in a live
delivery.

Occurrence records afterwards, one owner each:

```
executive-roll-up | 2026-09-07 | succeeded | native-hermes-cron
morning-brief     | 2026-09-07 | succeeded | real-ming
```

So today's roll-up cannot fire twice at 21:30, and tomorrow's brief belongs to
native cron alone.

## Restart behaviour

`hermes.service` was restarted after the switch. Occurrences recorded for
2026-09-07 were **3 before and 3 after** — no replay. Both jobs survived with
their next-run times intact, and `telegram` reconnected.

## Defects found before the switch

**1. Cron would have run in UTC.** Recorded separately in the
[cutover procedure](../planning/RM-40-v6-native-cron-cutover.md). `30 7 * * *`
would have fired at 15:30 KL. Fixed by setting the Hermes profile `timezone`
key; the host stays `Etc/UTC` by design.

**2. The MCP extension was dead.** Recorded in
[the permission regression note](RM-40-v6-mcp-permission-regression-2026-09-07.md).
The unit reset the shared data group on every start, so the milestone 5 grant
had silently reverted.

**3. The bridge key never reached the extension.** The first deliberate run
failed with `real_ming_run_scheduled_report is not available in the Real-Ming
MCP tool registry`, and **the agent said so instead of inventing a brief** —
exactly what the manifest prompt requires of a failure.

The cause: the gateway does not pass its own process environment down to MCP
child processes, so `API_SERVER_KEY` from `/etc/real-ming/hermes.env` never
arrived, and the extension registered only three tools. That file is
`root:root 0600`, so the service account cannot read it either.

The fix supplies the key through the MCP server's own `env:` block in the
Hermes profile config, which is `0600 real-ming:real-ming` — the same
protection as the `.env` already holding the Telegram bot token, and the same
account that already holds the key in memory as the gateway. `hermes mcp test`
then reported **4 tools discovered**.

A diagnostic footgun worth remembering: `hermes mcp test` run from an SSH shell
shows only three tools, because that shell has no `API_SERVER_KEY`. The tool
count differs between the CLI and the gateway, and the gateway is the one that
matters.

## What this does not prove

- Neither job has yet fired **on its own schedule**. The first unattended proof
  is the 21:30 KL roll-up today; the first brief is 07:30 KL tomorrow.
- Ming received one failure message from the first attempt and one composed
  roll-up. He has not yet confirmed how the scheduled deliveries read on the
  phone.
- The old Real-Ming scheduler remains installed as the rollback. Reverting is
  `REAL_MING_SCHEDULER_OWNERSHIP=real-ming` plus a restart; the native jobs
  would then need disabling to avoid two owners.
