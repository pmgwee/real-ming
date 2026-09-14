# Verify the live capabilities yourself, from Telegram

**Status:** ready to run. Nothing here is blocked, and nothing here changes
production configuration.

## TL;DR

Six tests you run from your own Telegram chat with the Real-Ming agent. Each one
proves a capability the README marks **Live**, and each says exactly what a pass
looks like. They take about fifteen minutes end to end.

Two tests create harmless, clearly-labelled test data (one Work Item, one Notion
row). Test 6 tells you how to remove them. Nothing here sends mail, moves money,
deploys, or changes a schedule.

**Do not paste a token, password or secret into Telegram, this file, or an
issue.** None of these tests needs one.

## Why this needs you

Everything below was already proven once from the host on 14 September 2026 and
recorded in the
[RM-54 evidence record](../docs/evidence/RM-54-live-operations-and-knowledge-2026-09-14.md).
That proof was mechanical: an operator drove the production MCP surface
directly.

This runbook is the other half — proving the same capabilities answer **you**,
in your own chat, in ordinary language. Only you can do that, because only you
own the Telegram account the agent is allowlisted to.

## Before you start

| Check | How | If it fails |
| --- | --- | --- |
| The agent answers at all | Send `hello` | See Troubleshooting, row 1 |
| You are in the right chat | The bot replies as your Real-Ming agent | You are in another bot's chat |

You do **not** need your laptop, the dashboard, SSH, or Tailscale for any test
except the optional Obsidian check in Test 5.

---

## Test 1 — Ordinary conversation stays ordinary

**Proves:** Real-Ming is reached as a tool, not as a gate. The README claims
plain chat needs no Work Item, no role ceremony and no structured turn.

**Send:**

```
What's a good way to spend a free Saturday afternoon?
```

**Pass looks like:** a normal, direct answer. No role announcement ("As your
COO…"), no Work Item ID, no task created, no mention of Real-Ming.

**Fail looks like:** the agent announces a role, creates a Work Item, or routes
an everyday question through a task workflow. That would mean the extension has
become a gate. Record what it said and stop.

---

## Test 2 — Work Items and lifecycle

**Proves:** the `Work items and lifecycle` row. Native Hermes captures work
through Real-Ming's governed lifecycle, and capture cannot complete work.

**Send:**

```
Capture a work item for me: [CEO test] Check the living room lightbulb.
Expected effect: confirm whether it needs replacing. Use idempotency key
ceo-verify-lightbulb-1.
```

**Pass looks like:**

- The agent confirms a Work Item was captured and gives you an ID.
- The state is **`Captured`** — not "done", not "completed".

**Then send:**

```
List my work items that are in Captured state.
```

**Pass looks like:** your `[CEO test] Check the living room lightbulb` item
appears in the list.

**Fail looks like:** no ID returned; or a state of `Completed`/`Done`. Capture
is only allowed to create `Captured` work — anything else means the lifecycle
boundary leaked.

---

## Test 3 — Idempotency

**Proves:** a retry is a read, not a duplicate. This is what stops a flaky
connection from filling your board with copies.

**Send the *exact same message as Test 2 again*,** including the same
`ceo-verify-lightbulb-1` key.

**Pass looks like:** the **same Work Item ID** comes back, and the agent
indicates it already existed (deduplicated) rather than making a second one.

**Then send:**

```
List my work items that are in Captured state.
```

**Pass looks like:** still **exactly one** lightbulb item, not two.

**Fail looks like:** a second, different ID, or two lightbulb rows in the list.

---

## Test 4 — Notion task coordination

**Proves:** the `Notion task coordination` row. The capture reached the real
Notion database, not a local queue.

**Open Notion** (phone app is fine) **and look at your Master Tasks board.**

**Pass looks like:**

- A row titled `[CEO test] Check the living room lightbulb`.
- Its board category is **`Pending`**.
- There is exactly one such row.

**Fail looks like:** no row in Notion even though Telegram reported success.
That combination is the important one — it would mean the agent reported a write
that did not happen. Record it and stop.

> `Ready for CEO Review` is **not** the same as completed. If you ever see that
> category, the item is waiting on your decision, not finished.

---

## Test 5 — Role-scoped selective native knowledge

**Proves:** the `Role-scoped selective native knowledge` row — governed
publication, role and Trust-Domain-gated retrieval, and that forgetting works.

### 5a. Retrieve a cited page

> **Read this first — it is why the original version of this test failed.**
> `wiki_retrieve` is a **literal contiguous substring match**, not search. The
> whole query must appear verbatim in the page id, path, citation or body.
> There is no tokenising, ranking or fuzzy matching. So
> `RM-54 live acceptance` finds nothing — that exact phrase is nowhere in the
> page — and neither does `role-scoped native knowledge Malaysia West`, because
> the body reads "…native knowledge **is live on** Malaysia West" and the words
> are not contiguous. This is a real limitation of today's reader, not a fault
> in your phrasing.

**Send:**

```
Search the wiki for the exact phrase "role-scoped native knowledge" and cite the source.
```

**Pass looks like:** the agent returns the page and **cites** it — source
reference `issue:54/live-acceptance-live`, Trust Domain `Ming Creatives`. The
content is one line: *"Real-Ming role-scoped native knowledge is live on
Malaysia West; retrieval is bounded to the Ming Creatives Trust Domain."*

`rm54-live-acceptance-live` works as a query too — the page id is matched as
well as the body.

**Fail looks like:** a confident answer with **no** citation, or an invented
source. Note that "no published supported page matched" is the *correct* answer
to a query whose exact words are not in the page — that is the reader being
honest, not broken.

**Worth knowing:** if you ask a natural-language question and get nothing, the
agent is not hiding anything and the knowledge is not lost. Retry with an exact
phrase you expect to be in the text.

### 5b. The role gate actually refuses

**Send:**

```
As Personal CFO, retrieve the Ming Creatives wiki knowledge.
```

**Pass looks like:** a **refusal** — the agent says that role is not authorized
for that Trust Domain. A refusal here is the correct, successful result.

**Fail looks like:** it returns the content anyway. That is the one result worth
paging someone about: the gate is the guarantee.

### 5c. Forgetting is honest about its own limits

**Send:**

```
What exactly does it mean when you forget something from the wiki? What is NOT erased?
```

**Pass looks like:** it distinguishes supported-path suppression from things
outside the guarantee — it should be clear that already-delivered Telegram
messages, Hermes's own native memory, and authoritative source systems are
**not** erased.

**Fail looks like:** a claim that forgetting erases everything everywhere.

### 5d. Optional — the generated notes on disk

Only if you want to see the files. Open your Obsidian vault as described in the
[access runbook](dashboard-and-obsidian-access-runbook.md) and look under
`.real-ming/generated/`.

**Pass looks like:** generation folders, each with `manifest.json`, `index.md`
and a `pages/` directory.

> Your own notes are untouched by this. The generated tree is separate and
> agent-owned; your writer-owned notes sit outside `.real-ming/`.

---

## Test 6 — Clean up your test data

**Proves nothing** — it just leaves your board tidy.

**In Notion:** delete the `[CEO test] Check the living room lightbulb` row, or
leave it if you would rather keep the trace.

The Work Item stays in Real-Ming's own store as an ordinary `Captured` item.
It is harmless: nothing executes it, and it will simply sit there. If you want
it gone, say so and it becomes a one-line ticket — there is deliberately no
"delete my records" tool for you to fire from chat.

---

## What these tests do NOT prove

Being straight about the boundary matters more than a long pass list.

| Not proven here | Why |
| --- | --- |
| **Recurring knowledge consolidation** | It is **switched off on purpose.** There is no `02:00` cron row; exactly two scheduled jobs run, the 07:30 brief and the 21:30 roll-up. Enabling recurrence is your separate decision in the [activation runbook](native-knowledge-consolidation-activation-runbook.md) |
| **The legacy six-root Curated Knowledge Vault** | **Not running, and not partially running.** No production entrypoint enables it, its encryption key is not even passed to the container, and its configured directory holds zero files. None of these tests touch it |
| **Sending email** | There is no send tool. The agent drafts; you send |
| **Moving money** | No agent can. That is a property of the tool surface, not a rule it follows |
| **Uptime** | "Always-on" describes the host and its supervised units. No availability target is set or monitored |

---

## Expected results at a glance

| Test | Capability | Pass condition |
| --- | --- | --- |
| 1 | Messaging front door | Ordinary answer, no role ceremony, no Work Item |
| 2 | Work items and lifecycle | Work Item ID returned, state `Captured` |
| 3 | Idempotency | Same ID on replay; exactly one item |
| 4 | Notion task coordination | One `Pending` row on Master Tasks |
| 5a | Native knowledge retrieval | Exact-phrase query returns a **cited** page |
| 5b | Role/Trust-Domain gate | `Personal CFO` is **refused** |
| 5c | Forget honesty | Names what forgetting does not erase |
| 5d | Generated wiki on disk | `.real-ming/generated/` holds generation folders |

---

## Troubleshooting

| Symptom | What it means | Action |
| --- | --- | --- |
| No reply at all in Telegram | The Hermes gateway is down, or you are in another bot's chat | Confirm the chat first. If it is the right one, the gateway needs a restart — that is an operator action, not a setting you change from the phone |
| Reply, but any Real-Ming tool fails | The extension is down while Hermes is healthy; they are separate processes | Report it. This exact split happened during the RM-54 rollout and was recovered by restarting the extension |
| Telegram says the Work Item was captured, but Notion has no row | The most serious case: a reported write that did not land | Record the Work Item ID and the time, then report it. Do not retry repeatedly |
| Test 3 creates a second item | Idempotency is not holding | Record both IDs and report it |
| Test 5b returns the content instead of refusing | The role gate is not enforcing | Report immediately and treat as a real defect. Do not keep querying |
| Test 5a returns "no published supported page matched" | Usually your phrase is not a contiguous substring of the page — the reader does not tokenise | Retry with an exact phrase such as `role-scoped native knowledge`, or the page id `rm54-live-acceptance-live` |
| Test 5a answers **with content but no citation** | Retrieval fell back to ordinary reasoning instead of the wiki | Ask again and say "cite the wiki source". If it still cannot, report it |
| A capability answers correctly but the README calls it something else | A documentation drift, not an outage | Worth a ticket, not an alarm |

## CEO sign-off record

- [ ] Test 1 — ordinary conversation stays ordinary.
- [ ] Test 2 — Work Item captured in `Captured` state.
- [ ] Test 3 — replay returned the same ID, one item only.
- [ ] Test 4 — one `Pending` row on the Notion Master Tasks board.
- [ ] Test 5a — exact-phrase query returned a cited page.
- [ ] Test 5b — unauthorized role refused.
- [ ] Test 5c — forgetting described honestly.
- [ ] Test 5d — generated tree present (optional).
- [ ] Test 6 — test data cleaned up or deliberately kept.
