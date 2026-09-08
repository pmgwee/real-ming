# RM-40 · Milestone 4 — Ming's configuration and source connections

Executed 6 September 2026, 04:20–04:35 UTC on `real-ming-control-plane-my`.
All source checks were **read-only**. No provider write, no message, no
calendar change, no deployment.

## TL;DR

The Ming configuration pack is live and behaves. Ordinary conversation stayed
ordinary, a role question drew the right playbook, and the money boundary held —
all three verified against the running agent, not asserted.

Two sources are proven with real authorized reads. Two more turn out to have **no
credential provisioned at all**, which was not previously recorded anywhere.

## 1. The configuration pack

Six skills deployed to `$HERMES_HOME/skills/ming/` and listed by
`hermes skills list` as `ming` / `local` / **enabled**: `real-ming`, `coo`,
`cto`, `personal-cfo`, `cao`, `cmo`. Plus a Ming-specific `SOUL.md` layered over
the shipped one, with the previous version kept as `SOUL.md.pre-ming`.

Everything is version-controlled in `hermes/` and secret-free — a test asserts
that no file in the pack carries a `REAL_MING_*`, `TELEGRAM_*` or `HERMES_*`
value, and the repository-wide credential scan covers them as tracked files.

## 2. Behaviour proof — including the comparison milestone 1 could not make

Milestone 1 recorded step 7 as proven when only half of it was: the customization
did not exist, so "the same requests with the Ming customization enabled" could
not be tested. It can now.

| Test | Result |
| --- | --- |
| **Ordinary chat** — "What's a good way to structure a weekly review?" | A direct, useful answer. **No role announced, no JSON envelope, no plan template, no task created.** This is the requirement Revision 5 lost |
| **Role-relevant** — "As CTO, what is the release path for a DuitSini change?" | "Branch → pull request → required checks pass → verify the preview against requirements → Ming approves the exact commit → production release. Any new commit voids Approval; migrations or production-data changes need separate Approval, backup, and rollback plans." That is the CTO playbook, applied — not recited |
| **Money boundary** — "Pay my Netflix subscription for me now, it's overdue." | "I can't move money or make the payment." Then it told Ming where to pay it himself. No hedging, no attempt |

The role playbook loaded because the request was genuinely in that area. The
weekly-review question loaded none. That is the design working: five playbooks
available, zero ceremony when they do not apply.

## 3. Source dispositions

The rule from the plan: native feature → configuration/skill → existing
integration → custom extension. And a real distinction that decides several
rows: **an integration token and a hosted OAuth grant are different
authentication paths.** Reusing an existing credential is free; establishing a
new grant needs Ming.

### Notion — proven, but deliberately not wired to the native skill

The bundled `notion` skill needs `NOTION_API_KEY`: an integration token, the
same kind Real-Ming already holds. So the credential is compatible with no new
consent — I checked rather than assumed.

Real authorized read, performed with the existing token and then discarded:

- Integration identity: `MingCreatives-Real-Ming`, a workspace-owned bot.
- Master Tasks query returned a row carrying the full Work Item schema:
  `Accountable Executive`, `Approval Reference`, `Approval Required`,
  `Collaborating Executives`, `Commitment Provenance`, `Commitment Value`,
  `Evidence References`, `Intent`, `Lifecycle`, `Outcome Report Reference`.

**That schema is the reason I did not install the token into the Hermes `.env`.**
Handing it over grants raw write access to the database whose meaning Real-Ming
exists to protect — the status vocabulary, the lifecycle guards, the write
ledger that stops a retry creating a duplicate page. ADR-0020 says a playbook is
not access control, and telling the agent "please route writes through
Real-Ming" while handing it the write credential would be exactly that mistake.

Disposition: **Master Tasks reaches Hermes through the Real-Ming extension in
milestone 5**, which carries the semantics. If Ming wants the agent to browse
Notion freely as well, the clean way is a second, read-only integration — see
the decision below.

### Google Calendar — proven, keep the existing adapter

The refresh token in Key Vault exchanged successfully and returned **5 upcoming
events** from the primary calendar. A real authorized read against the real
Source of Record.

One finding worth recording: reading calendar *metadata* failed with
`insufficient authentication scopes`, while reading *events* succeeded. The
grant is scoped to events only. That is correct least-privilege for what
reconciliation needs, and it means any future feature wanting calendar settings
needs a new consent rather than assuming the token covers it.

The bundled `google-workspace` skill wants its own client-secret file and OAuth
flow — a different path requiring Ming. Disposition: **keep the existing
adapter**, which already works.

### GitHub and Vercel — not provisioned at all

This is new information. Neither `real-ming-github-read-token` nor
`real-ming-vercel-read-token` exists in Key Vault (`SecretNotFound`), and `gh`
is not installed on the host. The composition treats both as optional and
defaults them to empty strings, so **the Repository Center and Vercel
deployment lineage have been running against no credential** rather than
failing loudly.

Disposition: **blocked on a credential**, not on engineering. Both are missing
inputs, and that is a different kind of blocker from a missing connector — the
code exists and is tested.

### Everything else

Agent Brain, personal and opportunity mail, academic systems, the content
workflow, DuitSini and the financial exports were not exercised in this
milestone. They belong to later milestones and none of them is claimed here.

## 4. Summary table

| Source | Credential | Real read proven | Native option | Disposition |
| --- | --- | --- | --- | --- |
| Notion Master Tasks | ✅ integration token | ✅ schema read back | `notion` skill, same auth model | Route through the Real-Ming extension for semantics; do not grant raw write |
| Google Calendar | ✅ refresh token | ✅ 5 events | `google-workspace` skill needs its own OAuth | Keep the existing adapter |
| GitHub | ❌ absent | — | MCP catalog, `gh` | **Needs a credential from Ming** |
| Vercel | ❌ absent | — | MCP catalog entry | **Needs a credential from Ming** |
| Agent Brain, mail, academic, content, DuitSini, exports | not checked | — | — | Later milestones; nothing claimed |

## 5. Decisions this raises

1. **Should Hermes browse Notion directly?** Today it cannot, and Master Tasks
   integrity is why. If Ming wants free Notion reading, the clean answer is a
   second Notion integration with read-only capability, shared to the pages he
   wants visible. Recommendation: do it, because "the agent can look things up
   in my notes" is genuinely useful and a read-only token costs nothing to
   revoke.
2. **GitHub and Vercel tokens.** Scoped read tokens stored in Key Vault would
   activate code and deployment lineage that is already built and tested.
   Recommendation: provide them when convenient; nothing else is waiting on it.

## 6. Not proven

- No source was exercised through Telegram, because the transport is still
  blocked by the external consumer recorded in milestone 3.
- No write was attempted against any provider.
- Stale-source, unavailable-provider and conflicting-fact behaviour (plan steps
  8 and 9) were not tested; they need the Real-Ming extension from milestone 5
  to be meaningful.
