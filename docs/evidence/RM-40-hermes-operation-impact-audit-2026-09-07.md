# Does Real-Ming block any normal Hermes operation?

**Date:** 7 September 2026
**Host:** `real-ming-control-plane-my` (Malaysia West), Hermes v0.21.0 pinned
`561b053f`
**Question asked:** whether Real-Ming's configuration, policies, permissions,
approvals, evaluation or cost monitoring block anything Hermes would otherwise
do.

## Short answer

**One real gap, and it is a missing feature rather than a block.** No Real-Ming
approval gate, permission wrapper, cost cap or evaluation hook sits in front of
any Hermes operation. The gap is that the agent cannot create a Notion task
from Telegram, because that tool was never built and no Notion credential
reaches the gateway.

Along the way I found and removed one setting that *would* have degraded
Hermes: a memory write-approval flag. Details below.

## Method

I enumerated everything Real-Ming actually sets on the Hermes host, then
separated it from settings that merely look like impositions but are Hermes's
own shipped defaults. Conclusions come from the live host, not from the repo.

## Everything Real-Ming sets on the Hermes host — the complete list

| # | What | Where |
| --- | --- | --- |
| 1 | Two environment variables: `API_SERVER_KEY`, `REAL_MING_NATIVE_CRON_ENABLED` | `/etc/real-ming/hermes.env` |
| 2 | One MCP server exposing four tools | Hermes MCP config |
| 3 | `SOUL.md` plus six skills (`real-ming`, `coo`, `cto`, `personal-cfo`, `cao`, `cmo`) | `/var/lib/hermes-real-ming` |
| 4 | `timezone: Asia/Kuala_Lumpur` | Hermes config |
| 5 | Two cron jobs (07:30 brief, 21:30 roll-up) | Hermes native cron |
| 6 | systemd hardening on the unit | `deploy/systemd/hermes.service` |

That is the entire footprint. Verified list of environment variable names
present in the gateway environment:

```
API_SERVER_KEY
REAL_MING_NATIVE_CRON_ENABLED
```

Nothing else. No approval flag, no budget, no evaluation hook, no policy
engine.

## Settings that are Hermes defaults, not Real-Ming's doing

I checked each of these specifically because they look restrictive:

| Setting | Value | Whose |
| --- | --- | --- |
| Disabled toolsets (`video`, `video_gen`, `x_search`, `stt`, `context_engine`, `homeassistant`, `spotify`, `yuanbao`, `a2a`) | disabled | **Hermes shipped defaults** — Real-Ming disabled none of them |
| `agent.max_turns` | 500 | Hermes default |
| `approvals.mode` | `smart` | Hermes default |
| `memory_char_limit` | 2200 | Hermes shipped default |
| `user_char_limit` | 1375 | Hermes shipped default |
| Shell hooks | none configured | — |

If you want any of the disabled toolsets, enabling them is a Hermes config
change with no Real-Ming involvement.

## The one thing Real-Ming did impose — found and removed

The config fragment `hermes/config.native-first.example.yaml` carried a
`memory:` block setting `write_approval: true`, which would have made the agent
ask permission before writing its own working memory.

Two findings:

1. **It was never applied to the host.** I checked the live config: the
   `memory.write_approval` key was never set there at all. So no memory write
   was ever gated in practice.
2. **The rest of the block was worse than useless.** The two limits it set were
   already Hermes's own shipped defaults, so it restated defaults while adding a
   flag that could only cost quality.

On your instruction the entire `memory:` block was removed from the fragment,
and `test/docs/hermes-skill-pack.test.ts` now fails the build if a `memory:`
block, a `write_approval` key or a `memory_char_limit` key reappears in it.
Real-Ming states no opinion about Hermes memory.

Confirmed live in the dashboard: **Memory Provider = `(built-in / default)`,
active**, using Hermes's own `MEMORY.md` and `USER.md` (the user file is at
`/var/lib/hermes-real-ming/memories/USER.md`).

## The one real functional gap

**The agent cannot create a Notion task from Telegram.**

The Real-Ming extension exposes exactly four tools, confirmed against the
running gateway:

```
real_ming_get_work_item
real_ming_link_execution_task
real_ming_list_work_items
real_ming_run_scheduled_report
```

Three are read or link operations; the fourth triggers a report. **None
creates anything in Notion.** There is also no Notion credential in the
gateway environment, so even a new tool would need a provisioning step first.

Practical consequence: saying "remember to follow up with the supplier on
Friday" in Telegram does **not** become a Notion task. The agent can read your
Work Items and link execution to them, but capture still happens in Notion by
hand.

This is worth being precise about: nothing is *refusing* the action. There is no
policy blocking it, no approval waiting on you. The capability was never built —
milestone scope covered reading and linking, not creating.

## Recommendation

Adding a `real_ming_create_work_item` tool is a small, well-bounded piece of
work: one tool in the extension, one Notion integration token in the gateway
environment, and a system-harness scenario proving it writes to the right
database with the right status. It fits the existing seam and needs no
architectural change.

It does need a decision from you, because it puts a Notion write credential on
the Hermes host — the first credential there beyond the bridge key — and because
a chat message becoming a real task in your Master Tasks database is a behaviour
change you should choose, not inherit.

## Honest caveat about today's testing

Your Codex subscription hit its usage limit during this session. That is why the
agent stopped answering, and it is upstream quota, not configuration — nothing
in Real-Ming throttles or budgets the agent. It also means the final
conversational checks in this audit were made against configuration and the
running gateway rather than by asking the agent to perform each action live.

## What this audit did not find

- No approval gate in front of any Hermes tool
- No cost cap, budget or spend monitor applied to the agent
- No evaluation hook intercepting responses
- No permission wrapper around the filesystem, shell or model access
- No Real-Ming code in the conversation path — the extension is reached as a
  tool, never as a gate, exactly as ADR-0020 requires
