# Does Real-Ming block any normal Hermes operation?

**Date:** 7 September 2026
**Host:** `real-ming-control-plane-my` (Malaysia West), Hermes v0.21.0 pinned
`561b053f`
**Question asked:** whether Real-Ming's configuration, policies, permissions,
approvals, evaluation or cost monitoring block anything Hermes would otherwise
do.

## Short answer

**Nothing Real-Ming does blocks any Hermes operation.** No approval gate,
permission wrapper, cost cap or evaluation hook sits in front of the agent.
The CEO's position — that none of those are wanted, because Hermes already
handles them well with its own native harnesses — is the settled one, and the
audit confirms none exist.

**One capability is missing, and the fix is native, not ours.** The agent
cannot create a Notion task from Telegram. The right answer is to install
Hermes's own official Notion MCP connector — OAuth, no stored credential, no
Real-Ming code — not to build a Real-Ming tool as this document first
recommended. See the corrected recommendation below.

Along the way I removed a memory write-approval flag from Real-Ming's config
fragment. It had never been applied to the host, and the host's memory settings
are byte-for-byte what Hermes shipped. Details below.

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

### Nothing on the host was changed — verified by diff

The removal was **repo-side only**. Diffing the live Hermes config against the
`config.yaml.pre-rev6` backup taken on 4 September, before any V6 work, the
memory values are identical:

| Key | Before V6 work | Now |
| --- | --- | --- |
| `memory_enabled` | `true` | `true` |
| `user_profile_enabled` | `true` | `true` |
| `memory_char_limit` | `2200` | `2200` |
| `user_char_limit` | `1375` | `1375` |
| `nudge_interval` | `10` | `10` |

`write_approval` does not appear in the config file at all, before or after.
`hermes config get memory` reports `false` because that is Hermes's **built-in
default**, not a value anyone wrote.

So the memory settings are Hermes's own, exactly as they shipped and exactly as
they were while memory was working well. Real-Ming never configured them and
there is nothing to restore.

Confirmed live in the dashboard: **Memory Provider = `(built-in / default)`,
active**, using Hermes's own `MEMORY.md` and `USER.md` (the user file is at
`/var/lib/hermes-real-ming/memories/USER.md`).

### What Real-Ming *did* change in the Hermes config

For completeness, the same diff shows the substantive changes the V6 work made
to native Hermes configuration. There are three, and no more:

| Change | Why |
| --- | --- |
| `model.default`: `anthropic/claude-opus-4.6` → `gpt-5.6-sol`, `provider`: `auto` → `openai-codex` | The shipped default pointed at OpenRouter/Anthropic while the only credential is Codex OAuth. Left alone, the native gateway would have failed every call. |
| `timezone` → `Asia/Kuala_Lumpur` | Unset, so cron would have fired in UTC — the 07:30 brief at 15:30 KL. |
| Two cron jobs | The 07:30 brief and 21:30 roll-up, approved separately. |

Everything else in the diff is Hermes rewriting its own YAML — quote style,
key ordering, and materializing its own defaults (`agent.max_turns: 500` and
friends) into the file. One visible side effect: the config file went from
113 KB to 4 KB because Hermes strips its explanatory comments when
`hermes config set` rewrites it. Values are unchanged; the comments are in
`config.yaml.pre-rev6` if ever wanted.

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

## Recommendation — corrected: use the native connector, write no Real-Ming code

My first recommendation here was to add a `real_ming_create_work_item` tool with
a Notion token in the gateway environment. **That was the wrong shape**, and
Ming was right to push back on it.

Native Hermes already ships an official Notion connector in its MCP catalog:

```
notion    available    Pages and databases from your Notion workspace.
```

Its manifest (`optional-mcps/notion/manifest.yaml`) is a Nous-approved entry for
the vendor-hosted remote MCP at `https://mcp.notion.com/mcp`, using **OAuth 2.1
with Dynamic Client Registration**. Hermes's own MCP client and
`mcp_oauth_manager` handle discovery, PKCE, token exchange and refresh.

This is strictly better than what I proposed:

| | My proposal | Native connector |
| --- | --- | --- |
| Credential on the host | A Notion integration token in the gateway environment | **None** — OAuth, managed by Hermes |
| Real-Ming code | A new tool plus harness scenarios | **None** |
| Capability | Create a Work Item | Full read/write over pages *and* databases |
| Shape | Real-Ming re-implementing a native capability | The V6 principle: native owns it |

It is also exactly how Claude Code reaches Notion, which is what Ming compared
it to.

**The steps** (the browser authorization is his; the host is headless, so the
flow uses the paste-callback path):

```bash
hermes mcp install notion
hermes mcp login notion
```

Hermes prints an authorization URL. Open it on a laptop, approve access, paste
the redirect URL back, then restart the session so the tools load.

**Why it still needs Ming:** authorizing an OAuth application against his real
Notion workspace is an outward-facing action against live data, and a Telegram
message becoming a real Master Task is a behaviour change he should choose. But
it costs no credential storage and no Real-Ming code.

**Correction to the gap above:** the shortfall is not a missing Real-Ming
feature. It is a native Hermes connector that was never installed.

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
