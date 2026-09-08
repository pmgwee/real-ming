# Going live — what each of your four asks actually needs

**TL;DR.** You asked to connect Telegram to Hermes, use the Codex OAuth model
path, inspect the dashboard on a production domain, and set up Obsidian. The
Phase 4 implementation is now present locally: Real-Ming owns the governed
Telegram ingress, the private Hermes API owns conversation/reasoning, the
dashboard shows payload-free Hermes state, Obsidian export is scheduled on
generation changes, and Hermes session state is backup-aware. Azure
authentication, Telegram ownership cutover, domain exposure, Obsidian path
selection and the off-host backup resource remain live CEO actions. Follow
the [activation runbook](RM-40-phase4-activation-runbook.md) for those steps.

Phase 3 built the **governed operations spine**: instructions in, Work Items
out, authority enforced, evidence recorded, nothing done without an Approval.
It deliberately did not build the parts that make a system *feel* like an
assistant. That was the right order — the ungoverned version of those parts is
exactly the thing you did not want — but it means "ready to go" is not where we
are.

---

## 1. Telegram → Real-Ming governance → Hermes runtime

**Status: the Phase 4 adapter and coordinator are implemented; Azure activation
is still gated.**

`REAL_MING_TELEGRAM_BOT_TOKEN` and `REAL_MING_TELEGRAM_CEO_ID` are both
supplied — `npm run secrets:preflight` reports 10 supplied / 9 Gate-1-required
(the RM-09-produced identifier is also present) — and RM-15 proved the
front door from your phone with the Lenovo shut down. It is private to your
Telegram ID, and it works.

What it does today: the custom Real-Ming Azure listener receives the update,
checks the CEO identity, idempotency and Sensitive Secrets, then routes ordinary
natural language to the Hermes coordinator. The coordinator binds one durable
Hermes session per Telegram chat, accepts Hermes's structured intent and
role/Work Item proposal, serves only Projection Broker briefs, gates tool
requests, records the turn without storing the prompt, and returns the verified
answer through the existing delivery ledger. Explicit slash commands and review
controls remain governed Real-Ming commands.

The transport invariant is unchanged: **one Telegram polling owner**. Do not
enable the Hermes Desktop Telegram gateway for this bot. The first production
cutover keeps the proven Real-Ming poller and runs Hermes as a private
authenticated API server beside it. Running two consumers would race and split
messages. Hermes-owned transport remains a later option only if an equivalent
pre-model governance hook is proven.

---

## 2. LLM through your Codex OAuth

**Status: the private Hermes API adapter is implemented and proven against the
real Hermes server protocol; Azure OAuth/API-server activation is pending.**

`src/hermes/hermes-runtime-client.ts` speaks Hermes's `/api/sessions` and
`/api/sessions/{id}/chat` endpoints, sends a bounded Real-Ming envelope and
requires a strict structured turn plan. `src/hermes/hermes-turn-coordinator.ts`
keeps session/turn idempotency, creates Work Items from Hermes proposals,
serves projection-only context, denies unconfigured or unapproved tools, and
returns a safe answer. The production composition reads the Hermes API-server
key from the protected environment or Key Vault and never handles the Codex
OAuth token.

Hermes Agent 0.21.0 successfully invoked GPT-5.6 Sol through the CEO's existing
Codex OAuth session on 3 September 2026. The selected default remains GPT-5.6
Sol with medium reasoning. For the always-on Azure service, authenticate Hermes
as the `real-ming` service account; Real-Ming connects only to its loopback API
with `REAL_MING_HERMES_API_KEY`. This key is an API-server boundary secret, not
the OAuth credential.

The implementation preserves the intended responsibility boundary:

1. Hermes interprets the message, chooses answer/clarification/research/work,
   selects an Executive Role, plans research or coding and decides which
   context/tools it needs.
2. Real-Ming validates identity, idempotency, secret exclusion, Work Items,
   projections, policy and exact Approvals; it records evidence and owns
   Telegram delivery.
3. Hermes performs its native reasoning/research/coding loop. Real-Ming does
   not become a second LLM or an arbitrary shell executor.
4. A final Hermes answer is checked for Sensitive Secrets and delivered through
   the durable Telegram ledger.

The controlled production-composition tracer proves the adapter and dashboard
path without contacting a provider. Live activation, a non-sensitive Telegram
question, and a bounded DuitSini coding smoke test remain in the
[activation runbook](RM-40-phase4-activation-runbook.md). Metered API-cost
accounting remains separate from Codex subscription usage; the dashboard
surfaces model/session health, while the OAuth provider remains Hermes's owner.

---

## 3. Dashboard on a production domain

**Status: the authenticated dashboard now includes Hermes runtime/session
metadata; public domain exposure remains a security decision.**

The dashboard is served by the control plane on the Azure VM
(`real-ming-control-plane`) and should still be reached over the private
Tailscale/SSH path during the first Hermes activation. Its overview now shows
Hermes status, configured model, session count, turn count, last intent and
Work Item reference without prompts or chain-of-thought. `REAL_MING_DASHBOARD_TOKEN`
is still the only application credential, so it is not sufficient protection
for a public internet URL.

That was a deliberate choice. Everything the dashboard renders — Work Items,
Approvals, audit trail, financial reconciliation, career claims — is the most
sensitive material in the system.

**Your decision.** If you want a URL you can open on your phone, it becomes a
separate deployment change with DNS, TLS, identity-aware authentication,
rate-limiting, logging and rollback. I would not put the current bearer-only
authentication on the public internet. Inspect privately first as described in
the activation runbook.

---

## 4. Obsidian

**Status: materialization is implemented and wired to the scheduled knowledge
pipeline; the host-local destination is still unbound.**

The Knowledge Vault is real and working — cited pages, `index.md`, append-only
`log.md`, contradiction quarantine, atomic versioned generations, per-role
scoping. But it stores those generations **encrypted in SQLite**.

The new materializer calls the vault only as the CEO, writes the configured
roots to a staging folder, swaps atomically, retains `.previous`, and publishes
only a metadata manifest. The scheduler invokes it after a successful Knowledge
Compiler tick **only when a root's generation changes**, so an idle control
plane does not rewrite the vault every cycle. CEO Approved Projections are the
default export; additional roots must be explicit.

**For you:** choose a host-local directory. With Azure as the always-on home,
the production export must live on Azure (for example
`/var/lib/real-ming/obsidian`) unless you separately approve encrypted sync or
a pull process to Lenovo. A plain folder is readable by whatever can access or
sync it; Obsidian is a viewer/IDE, never the Source of Record or policy layer.

---

## 5. Off-host recovery before relying on the service

**Off-host backup.** Losing the Azure VM loses your operations state — every
Work Item, Approval, Outcome Report and audit event. Local backup meets every
acceptance criterion, but "local" means on the VM.

It needs an Azure Storage account and a narrowly scoped role assignment, which
is yours to create. `REAL_MING_BACKUP_STORAGE_ACCOUNT` and
`REAL_MING_BACKUP_STORAGE_CONTAINER` already exist as variable names. The
backup code now includes the durable Hermes session mapping (`hermes.sqlite`)
and Hermes native conversation state (`hermes-state.db`) when they exist,
uploads the manifest last and records health. It never copies Hermes
`auth.json` or the Codex OAuth credential. A restore can therefore reopen the
operating state, Telegram mapping and persistent Hermes conversations. The
code side is ready; the Azure resource and one approved restore rehearsal are
not.

---

## Summary

| Ask | Real status | Who unblocks it |
| --- | --- | --- |
| Telegram → governed Hermes | Real-Ming owns polling; the Hermes API adapter/coordinator is implemented and controlled end-to-end | Azure Hermes activation, one-owner cutover and live smoke test |
| LLM via Codex OAuth | Hermes owns the OAuth session; Real-Ming binds to its private API with an API-server key | Authenticate the Azure Hermes service account; never copy Lenovo OAuth |
| Dashboard on a domain | Hermes metadata is rendered; private Tailscale/SSH remains the safe path | You — choose DNS/TLS/identity-aware exposure |
| Obsidian | Atomic generation-change export is wired; no production directory is selected | You — choose host-local path and sync policy |
| Off-host backup | Local recovery set includes optional `hermes.sqlite` plus native `hermes-state.db` | You — provision Azure Storage and run restore rehearsal |

**The honest headline:** you now have the locally proven, Hermes-first
implementation that gives the governed operations spine a real conversational
brain, durable session continuity, dashboard visibility and scheduled Obsidian
export. You do not yet have the Azure Hermes service authenticated and serving
your live bot. That final mile is a controlled activation and infrastructure
decision, not another rewrite of the architecture.
