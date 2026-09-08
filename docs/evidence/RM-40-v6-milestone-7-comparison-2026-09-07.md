# RM-40 · Milestone 7 — the two dashboards compared

Observed 7 September 2026, 03:26–03:31 UTC (11:26–11:31 KL) on
`real-ming-control-plane-my`, read-only over the private Tailscale path.

## TL;DR

The two dashboards are **complementary, not duplicative**, and the boundary
between them holds: Real-Ming carries no secret, no reasoning and no native
session content. That settles the open question about `src/dashboard/` — it
earns its place rather than being replaced by the native view.

Both are loopback-only. Neither is reachable from any public interface.

## Binding and authentication

| | Native Hermes | Real-Ming |
| --- | --- | --- |
| Address | `127.0.0.1:9119` | `127.0.0.1:8787` |
| Public interface | none | none |
| Unauthenticated request | HTML shell, `/api/health`, `/api/status` | **HTTP 401** |
| Data endpoints unauthenticated | `/api/sessions`, `/api/cron`, `/api/tasks` all **401** | n/a — everything is 401 |

Worth recording because earlier evidence said only "native dashboard health
passed". `/api/health` returns `{"ok":true,"version":"0.21.0",
"auth_required":false}` — that is the health probe describing itself, not the
dashboard being open. The endpoints that carry sessions, cron and tasks are
authenticated.

`/api/status` is unauthenticated and was checked rather than assumed. It
returns operational metadata only: version, config version, gateway state,
per-platform state (`api_server`, `telegram`), `active_agents`, drain flags. No
credential, no chat id, no session content. 1,701 bytes, scanned.

## What each one is for

| Native Hermes shows | Real-Ming shows |
| --- | --- |
| Sessions and their tool activity | Work Items with canonical lifecycle — **33** |
| Native tasks and Kanban | Pending Approvals — 0 |
| Cron jobs and run history | Outcome Reports — 3 |
| Gateway/platform health | Audit events — 61 |
| Model, version, agent counts | Executive roles — 5; scheduler jobs — 3; control-plane health — 4; provider observations — 3 |

Native answers *what the agent is doing*. Real-Ming answers *what the work
means*: which Work Item, whose accountability, what was approved, what the
outcome was, what the audit trail says. The native dashboard has no concept of
a Work Item, an Accountable Executive or an artifact-bound Approval, so it
cannot replace that view.

**Disposition for `src/dashboard/` (1,119 lines): keep.** The module inventory
listed it as "evaluate at milestone 7 — may be deleted". This comparison
resolves it. What could still be reconsidered later is the *delivery* — an
authenticated tab inside the native dashboard rather than a separate service —
but the read model itself is not redundant.

## Leakage checks

The full authenticated Real-Ming overview payload (27,172 bytes) was scanned.

| Check | Result |
| --- | --- |
| Telegram bot token, OpenAI/GitHub/Notion keys, PEM material | none |
| `api_key` / `token` / `secret` / `password` value fields | none |
| Reasoning, chain-of-thought, scratchpad fields | none |
| Raw prompts or message arrays | none |
| **The actual `API_SERVER_KEY`** | **not present** — tested by direct comparison against the live value |

One check needed following up rather than reporting. Six strings matched a
64-hex pattern, which is the shape of the bridge key — and also the shape of a
SHA-256 digest. Walking the parsed structure found **no field holding a bare
64-hex value**; every match was a substring of
`provider-observation:<64hex>` identifiers and their derived idempotency keys.
Those are content-derived IDs, not credentials. Reporting a leak on the regex
alone would have been wrong.

## What Real-Ming reports about native Hermes

Exactly five fields, and nothing else:

```
owner        native-hermes-gateway
status       healthy
model        gpt-5.6-sol
checkedAt    2026-09-07T03:28:00.222Z
lastFailure  null
```

Reachability and model metadata. No session ids, no transcripts, no command
history, no native internals. This is the boundary ADR-0020 asks for, holding
in the live payload rather than only in a controlled test.

## What still needs Ming

His own review of whether the CEO view is *useful* — not whether it is correct.
Everything engineering can verify is verified: both dashboards are private and
healthy, the authentication boundary holds, and nothing crosses that should not.

Reaching it is the existing private tunnel:

```bash
ssh -N -L 8787:127.0.0.1:8787 azureuser@100.110.253.35   # Real-Ming
ssh -N -L 9119:127.0.0.1:9119 azureuser@100.110.253.35   # native Hermes
```

No public port is opened, and none should be.
