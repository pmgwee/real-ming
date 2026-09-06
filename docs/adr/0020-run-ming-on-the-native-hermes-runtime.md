# Run Real-Ming on the native Hermes runtime

## Status

Accepted, 6 September 2026. Architecture Revision 6. This decision supersedes
the named clauses of [ADR-0019](0019-hermes-first-real-ming-composition.md),
and the transport-ownership clause of
[ADR-0014](0014-use-one-private-telegram-front-door.md) and the native-memory
clause of [ADR-0018](0018-compile-knowledge-into-trust-domain-vaults.md). All
other clauses of those decisions remain in force.

Revision 6 is the design and specification baseline. The deployed Malaysia West
system still runs the Revision 5 bridge; this ADR records the approved target,
not an executed migration.

## Context

Revision 5 placed a custom Real-Ming process in front of Hermes: Real-Ming
polled Telegram, wrapped each turn in a mandatory JSON Turn Plan, and rendered
Hermes's answer itself. The
[5 September Telegram smoke](../evidence/RM-40-phase4-telegram-smoke-findings.md)
proved that real Hermes replies were reaching Ming, and simultaneously proved
that the product experience did not survive the wrapper: no typing indicator,
no Telegram-safe formatting, no streamed tool progress, role-prefixed messages
bypassing Hermes into a legacy action parser, and an unbound coding-tool path
whose only passing test asserted a denial.

The [native capability review](../architecture/RM-40-hermes-native-capability-review.md)
established that the pinned Hermes v0.21.0 install already supplies a native
messaging gateway, durable Kanban, cron, memory, skills, plugins, MCP and a web
dashboard. The 6 September live inventory confirmed those subsystems are
present on the Malaysia host and that most are unconfigured rather than absent.

Maintaining a second agent platform to obtain capabilities the runtime already
has costs the native experience and doubles the number of owners for every
transport, schedule and record.

## Decision

**Hermes is the product runtime.** Its native gateway owns the Telegram
transport, supported commands, presentation, progress and attachments. Its
agent loop owns conversation, session continuity, reasoning, tool selection,
research, coding, test execution, iteration and the final answer. Native
skills, plugins, MCP servers and memory are first-class and are configured
rather than replaced.

**Real-Ming is an additive extension, not a gate.** It supplies only behaviour
that the native runtime demonstrably does not provide: Ming-specific context
and role playbooks, Notion Master Tasks semantics and cross-source
reconciliation, cross-app records and evidence, CEO-specific views, and any
stronger guarantee explicitly retained under this ADR. Real-Ming is reached as
a tool the agent may call, not as a mandatory pre-model checkpoint.

The main path becomes:

```text
Ming on Telegram ↔ native Hermes gateway ↔ native Hermes agent loop
                                            ↕
                              native tools / skills / plugins / MCP
                                            ↕ when useful
                              thin Real-Ming integration + data
```

**Superseded ADR-0019 clauses.**

| Revision 5 clause | Revision 6 replacement |
| --- | --- |
| Telegram is owned by the Real-Ming ingress process | The native Hermes gateway is the single Telegram consumer for the bot |
| Running Hermes's Telegram gateway for this bot is prohibited | Running a second Real-Ming poller for this bot is prohibited; the one-owner invariant is retained and its owner changes |
| A structured JSON Turn Plan is the integration contract for every turn | There is no mandatory turn envelope. Structured arguments apply to actual tool operations only |
| Real-Ming selects the Executive Role and delivers the verified answer | Hermes interprets the perspective through Ming role skills and returns its own answer through the native gateway |
| Native Hermes memory remains bounded Hot Runtime Memory with write Approval | Native memory and session search are first-class stores under a written memory policy (see below) |

**Superseded ADR-0014 clause.** One private Telegram bot, CEO-allowlisted
identity and artifact-bound one-time Approval controls are retained unchanged.
The clause assigning that front door to the Real-Ming ingress process is
replaced by native gateway ownership. Explicit role addressing is retained as a
conversational convention interpreted by Hermes; it no longer routes through a
legacy action parser.

**Superseded ADR-0018 clause.** The Knowledge Vault, Candidate Envelope,
citation, quarantine, atomic versioned publication and Projection Broker
contracts are retained as *optional stronger guarantees* and are not activated
by default. The clause restricting Hermes native `MEMORY.md`/`USER.md` to
Hot Runtime Memory under write Approval is replaced by this memory policy:

- Native memory holds Ming's stable preferences, routing conventions, project
  pointers and conversational continuity.
- Sources of Record stay authoritative; native memory never becomes the
  authoritative record for a task, commitment, financial figure or academic
  obligation.
- Sensitive Secrets remain excluded from native memory, prompts and logs.
- Domain corpora, raw inbox bodies, financial exports, academic files and
  Agent Brain payloads are not written wholesale into native memory.
- Where versioned atomic publication, provenance validation, contradiction
  quarantine or access-controlled cross-domain projection is still required,
  the existing compiler/broker/materializer supplies it for that path only.

## Consequences

- The one-consumer invariant survives the change; its owner moves. Cutover must
  stop the Real-Ming poller, verify it stopped, and only then start the native
  gateway on the same bot credential.
- Ordinary conversation must not create a Work Item, require a role selection
  ceremony or depend on a Real-Ming record operation. A failing optional
  integration degrades that operation, not the conversation.
- A role skill expresses behaviour; it is not access control. Consequential
  action restrictions from Revision 5 are not implicitly lifted. Where a
  restriction cannot be enforced on the actual native execution path, narrow
  the credential or leave that effect unavailable rather than assuming a hook
  enforces it.
- Retained Real-Ming data and operations must be usable without owning
  Telegram, which requires separating the daily composition modes.
- Existing Revision 5 code, tests and evidence stay valid within their recorded
  scope. They are not proof of Revision 6 behaviour and are relabelled rather
  than deleted.
- Azure remains the always-on primary home with private networking. No public
  SSH or dashboard port is introduced. The Lenovo worker stays optional.
- Cutover, provider consent, new deployment artifacts and any new external
  grant remain explicit CEO decisions. The Revision 5 approved image digest is
  not approval for a Revision 6 artifact.
