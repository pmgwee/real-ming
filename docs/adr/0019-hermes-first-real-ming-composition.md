# Keep Hermes as the intelligence runtime behind governed Real-Ming ingress

## Decision

Telegram remains owned by the Real-Ming ingress process. For each allowlisted
CEO chat, Real-Ming binds a durable conversation reference to a persistent
Hermes API session and sends a bounded turn envelope. Hermes interprets the
request, chooses answer/clarification/research/work, selects the Executive
Role, proposes the Work Item and plans the reasoning/research/coding loop.

Real-Ming is the deterministic operating layer: it validates identity,
idempotency and Sensitive Secret exclusion; records or selects the Work Item;
serves only role-, Trust-Domain- and Work-Item-scoped Projection/Evidence
Broker results; validates tool requests and exact Approvals; records evidence,
continuity and dashboard state; and delivers the verified answer back through
Telegram. Real-Ming is not a second LLM and does not silently execute an
arbitrary shell command on Hermes's behalf.

Hermes owns its Codex OAuth session and native reasoning/tool runtime. The
control plane receives only a private Hermes API-server credential. The first
production host is Azure and must remain usable while Lenovo is offline; a
Lenovo worker or Obsidian view is an optional extension.

## Consequences

- One Telegram polling owner prevents update races and preserves pre-model
  governance. Running Hermes's Telegram gateway for the same bot is prohibited.
- Native Hermes memory remains bounded Hot Runtime Memory. Persistent knowledge
  is compiled into encrypted, versioned Trust-Domain Markdown and exposed only
  through the Projection Broker; Obsidian is a viewer/IDE.
- A structured plan is the integration contract. Malformed plans, unknown
  roles, unscoped context, Sensitive Secrets and unapproved capabilities fail
  closed, while ordinary questions do not create a Work Item unless Hermes
  proposes research/work/context/tool activity.
- Session and turn metadata are durable and dashboard-visible, but prompts and
  chain-of-thought are never persisted in the control-plane read model.
- Azure activation, OAuth login, Telegram cutover, public dashboard exposure,
  Obsidian sync and off-host backup remain explicit CEO decisions.
