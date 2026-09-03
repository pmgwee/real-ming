# Going live — what each of your four asks actually needs

**TL;DR.** You asked to connect Telegram to Hermes, wire an LLM through your
Codex OAuth, open the dashboard on a production domain, and set up Obsidian.
Only one of those is a settings change. Two are unbuilt components, and one is a
decision you have not made yet. None is blocked on a credential you are missing
— which is why this document exists instead of a provisioning runbook.

Phase 3 built the **governed operations spine**: instructions in, Work Items
out, authority enforced, evidence recorded, nothing done without an Approval.
It deliberately did not build the parts that make a system *feel* like an
assistant. That was the right order — the ungoverned version of those parts is
exactly the thing you did not want — but it means "ready to go" is not where we
are.

---

## 1. Telegram → Hermes

**Status: already live. Nothing to connect.**

`REAL_MING_TELEGRAM_BOT_TOKEN` and `REAL_MING_TELEGRAM_CEO_ID` are both
supplied — `npm run secrets:preflight` reports 10 of 10 — and RM-15 proved the
front door from your phone with the Lenovo shut down. It is private to your
Telegram ID, and it works.

What it does today: you send an instruction, it becomes a Work Item, gets routed
to an Executive Role, and enters the lifecycle. You get the Morning Brief at
07:30 and the Roll-Up at 21:30.

What it does **not** do: answer you. Ask it a question and the deployed system
replies, verbatim:

> "I cannot answer questions yet: the private worker that would research this
> is not deployed. Send it as an instruction and I will capture it."

That is §2, not a Telegram problem.

**Nothing for you to do.**

---

## 2. LLM through your Codex OAuth

**Status: unbuilt. A credential changes nothing.**

This is the finding that most changes what you can expect, so it is worth being
exact. There is **no model client anywhere in the codebase.** Nothing calls
Anthropic, OpenAI, or any other vendor — I checked for every vendor endpoint
shape and there are none.

What exists is the *policy* half: `route()` picks which model **should** do a
piece of work — cheapest adequate model, high-sensitivity work confined to
local, refusal when local cannot do the job — and returns the model's **name**.
Nothing invokes it. The production question responder is a fixed refusal
string, not a fallback waiting for a key.

So supplying a Codex OAuth credential today would sit unused.

**What it would actually take** (a Phase 4 ticket, not a settings change):

1. A `QuestionResponder` implementation that calls a model.
2. A model client behind the existing Provider Adapter Contract, so it gets the
   same failure, staleness and redaction discipline as every other provider.
3. Wiring into the existing Metered Platform Cost so calls count against the
   RM250 cap that is already enforced.
4. Deciding what the answer is allowed to see — this is the real design
   question. Hermes already serves role-scoped Compiled Knowledge against a
   specific Work Item; an answering agent should go through that, not around it.

**For you:** decide whether you want this next. I would build it after §4,
because answering questions with no backup is the wrong order.

---

## 3. Dashboard on a production domain

**Status: no public domain exists. This is a decision, not a task.**

The dashboard is served by the control plane on the Azure VM
(`real-ming-control-plane`) and reached over an **SSH tunnel** — it has never
been exposed publicly, and `REAL_MING_DASHBOARD_TOKEN` is the only thing
standing between a viewer and your entire operations state.

That was a deliberate choice. Everything the dashboard renders — Work Items,
Approvals, audit trail, financial reconciliation, career claims — is the most
sensitive material in the system.

**Your decision.** If you want a URL you can open on your phone, say so and it
becomes a ticket with a real threat model: a domain, TLS, and an auth story
stronger than a bearer token in a cookie. I would not put the current
authentication on the public internet.

---

## 4. Obsidian

**Status: the vault exists; nothing writes it to disk.**

The Knowledge Vault is real and working — cited pages, `index.md`, append-only
`log.md`, contradiction quarantine, atomic versioned generations, per-role
scoping. But it stores those generations **encrypted in SQLite**.

There is a method, `materializeForCeo`, that writes a readable Obsidian folder
out of a generation. It is covered by its own test — and it is **never called by
any runtime path.** So there is currently no folder on any machine for Obsidian
to open.

**What it would take:** wire `materializeForCeo` into the scheduled knowledge
pipeline, and decide where the folder lives.

**For you:** pick the location. The choice has a privacy consequence worth a
moment's thought — the vault holds Personal, Finance, Academic and Ming
Creatives material in one tree, and Trust Domain separation is enforced *inside*
the system. Once it is a plain folder, whatever syncs that folder sees
everything. A local, non-synced path on the Lenovo is the conservative answer.

---

## 5. The one thing I would do before any of the above

**Off-host backup.** Losing the Azure VM loses your operations state — every
Work Item, Approval, Outcome Report and audit event. Local backup meets every
acceptance criterion, but "local" means on the VM.

It needs an Azure Storage account and a narrowly scoped role assignment, which
is yours to create. `REAL_MING_BACKUP_STORAGE_ACCOUNT` and
`REAL_MING_BACKUP_STORAGE_CONTAINER` already exist as variable names, so the
code side is waiting for the resource, not the other way round.

---

## Summary

| Ask | Real status | Who unblocks it |
| --- | --- | --- |
| Telegram → Hermes | **Already live** | Nobody — it works |
| LLM via Codex OAuth | Unbuilt: no model client exists | Phase 4 ticket, after you decide |
| Dashboard on a domain | No public domain; SSH tunnel only | You — it is a security decision |
| Obsidian | Vault works; never written to disk | Phase 4 wiring + you pick the path |
| Off-host backup | Not in place | You — Azure Storage account |

**The honest headline:** you have a working, well-governed operations spine with
a live front door. You do not yet have something that answers you, and you
cannot yet read your knowledge base in Obsidian. Both are close, and both are
build work rather than configuration.
