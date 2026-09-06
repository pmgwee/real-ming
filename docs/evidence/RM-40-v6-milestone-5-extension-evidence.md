# RM-40 · Milestone 5 — the Real-Ming extension, reached as tools

Executed 6 September 2026, 05:00–07:10 UTC. Repository work plus a live
registration on `real-ming-control-plane-my`.

## TL;DR

Native Hermes now calls Real-Ming as an MCP server and gets Ming's task
vocabulary back. Asked how many Work Items exist and how many wait on him, the
agent invoked `mcp__real_ming__real_ming_list_work_items` and answered **33
total, 3 waiting on Ming's decision** — which matches the operations database
exactly, and correctly treats `Ready for CEO Review` as *not finished*.

This is the disposition milestone 4 chose: Master Tasks reaches the agent
**with** its semantics rather than as a raw write credential.

The scheduler-ownership slice is now implemented in the repository and has its
own [controlled evidence](RM-40-v6-milestone-5-scheduler-ownership-evidence.md).
The Malaysia host still keeps the old owner until the CEO performs the live
native-cron cutover; no production job was created by that change.

## 1. What was built

Three files, no new runtime dependency — the repository still has zero.

| File | Role |
| --- | --- |
| `src/integration/execution-link.ts` | Append-only SQLite store linking one native Hermes task to one Work Item, keyed by idempotency key |
| `src/integration/real-ming-tools.ts` | The tool registry: three tools, plus the lifecycle → Notion category mapping |
| `src/integration/mcp-stdio.ts` | Minimal JSON-RPC 2.0 over stdio. Hand-written because the protocol surface Hermes uses is three methods, and a package here would be a supply-chain and audit obligation out of all proportion to the plumbing |
| `src/config/real-ming-mcp-cli.ts` | The entry point Hermes launches |

### The three tools, and why only three

| Tool | The gap it fills |
| --- | --- |
| `real_ming_list_work_items` | What work exists, and what each state *means* on Ming's board |
| `real_ming_get_work_item` | One item in full, with the native tasks linked to it |
| `real_ming_link_execution_task` | Which native task did which work — the cross-app record |

Anything an agent could answer without Real-Ming is deliberately absent. There
is no planner, no router, no second agent core.

### The semantics, which is the actual product

Every returned item carries its canonical lifecycle state, the Notion board
category it presents as, and two booleans that exist to prevent one specific
mistake:

```
Captured  -> Pending           completed: false
Planned   -> To Do             completed: false
Ready for CEO Review -> Pending to Review   completed: false, awaitingCeoDecision: true
Completed -> Done              completed: true
```

States with no board equivalent return `null` rather than being rounded to the
nearest one. Rounding is how `Ready for CEO Review` becomes `Done`, which is
precisely what `docs/agents/notion-task-status-semantics.md` exists to stop, and
an agent summarising the week is exactly where it would happen.

## 2. Controlled evidence

Eight scenarios through the **Real-Ming System Harness**. No third seam was
introduced: the extension is exposed on the existing harness, the way the
Telegram front door was.

| Scenario | Proves |
| --- | --- |
| Tool inventory is exactly three | The extension has not grown into a second agent |
| Lifecycle reports its Notion category | The vocabulary crosses the boundary intact |
| Nothing but `Completed` reads as completed | Review-ready work cannot be summarised as done |
| A replayed idempotency key creates no second link | A dropped connection and retry does not become two records |
| Linking a non-existent Work Item is refused | No dangling fact that reads as evidence later |
| A missing Work Item is reported, not invented | An empty object would be summarised as real work |
| An unknown tool is named | Failure is visible, not silent |
| Arguments are validated before any write | Durable state is not touched by a malformed call |

**The replay test is not vacuous.** Disabling the dedup branch was verified to
fail it — `× does not create a second link when a retry replays the same key` —
and restoring it passes.

`npm run check`: 801 passed, 2 skipped, exit 0. `npm audit --audit-level=high`:
0 vulnerabilities.

### A defect the suite caught, in my own change

The first version opened the link store during harness construction. Several
scenarios deliberately make construction **throw**, and a SQLite handle opened
before that point is never closed — on Windows that leaves the temp directory
undeletable and failed an unrelated test's cleanup with `EPERM`.

Confirmed as mine by stashing the change: the same test passed without it. The
store is now opened on first use, so harnesses that never touch the extension
never open it at all.

## 3. Live evidence

| Check | Result |
| --- | --- |
| Runs as the service account | `initialize` returned `{name: real-ming, version: 1.0.0}`, protocol `2024-11-05` |
| Reads the real operations database | 33 Work Items, first three returned with `Captured → Pending`, `Planned → To Do` |
| Registered with Hermes | `hermes mcp add real-ming --command … --args …`, 3/3 tools enabled |
| `hermes mcp test real-ming` | ✓ Connected (823 ms), ✓ 3 tools discovered |
| **The agent actually uses it** | Session `20260906_070616_0ca3a1` invoked `mcp__real_ming__real_ming_list_work_items` |
| **The answer is correct** | "Total 33, waiting on Ming's decision: 3, states: Captured, Planned, Ready for CEO Review, Waiting/Blocked" |
| Ground truth | 18 Captured, 10 Planned, 3 Ready for CEO Review, 2 Waiting/Blocked = 33 |
| Telegram | Gateway restarted; `telegram -> connected`, so the bot has these tools too |

The agent did not guess. The tool call is in the session store.

## 4. A permission trade-off, stated plainly

Hermes runs as `real-ming`; the operations database is owned by `azureuser` with
mode `0700`, so the extension could not read it. A shared group
`real-ming-data` now contains both accounts, and `/var/lib/real-ming` is `2770`
with the SQLite files at `660`.

**This widens what the agent can reach.** It can now read — and in principle
write — the operations database directly with its `file` and `terminal` tools,
bypassing the lifecycle guards the tools enforce. ADR-0020 says a playbook is
not access control, and that applies here: nothing in a prompt prevents it.

Why it is acceptable for now: SQLite WAL requires write access to the directory
even for readers, so a read-only grant is not available without a different
storage arrangement. The mitigation that would actually close it is a separate
read projection the extension writes and the agent reads, which is real work and
is **not** done. Recorded as an open item rather than waved away.

## 5. Remaining milestone-5 acceptance

The repository now has an explicit field-authority map for Master Tasks,
version-aware Notion upserts backed by a durable source-version ledger, and
controlled tests that refuse an overwrite after an external page edit. The
Operations Gateway already reports a failed projection after its bounded retry
and records provider health rather than claiming a cross-app success.

The native `real-ming` skill now tells Hermes when to call the three extension
tools, how to link a native task idempotently, and that native commands,
plugins, MCP, formatting, progress and attachments remain Hermes-owned.

Live acceptance is still required for the native cron owner switch and for a
real Notion read-back after the version check. The two native jobs remain zero
until the CEO follows the [cutover procedure](../planning/RM-40-v6-native-cron-cutover.md).
