# Phase 4 Architecture and Planning Readiness Checkpoint

Status: architecture approved; Phase 4 implementation in progress (V5 baseline promoted on 2026-09-04).

Phase 4 is the consistency and implementation-readiness gate following discovery, specification, and ticket decomposition. It does not claim that the Real-Ming application or the 44 implementation tickets are complete.

## Reconciled baseline

- Phase 1 discovery now records the approved persistent-knowledge decision and preserves the two-tracer rollout order.
- Phase 2 is published as the Real-Ming v1.1 specification in `docs/specs/real-ming-v1.md` and GitHub issue #1.
- Phase 3 contains 44 tracer-bullet tickets with explicit blocking edges in `real-ming-phase3-tickets.json` and GitHub issues #2 through #45.
- Architecture Revision 5 is represented by `docs/architecture/real-ming-personal-agent-diagram-v5-CEO-review.html` and its verified PNG rendering. The earlier v3 pair is retained under `docs/architecture/old_unenhanced/` for history only.
- The detailed human-readable architecture is updated to v1.1 in `docs/architecture/real-ming-v1.html`.
- The glossary defines Candidate Envelope, Compiled Knowledge, Knowledge Vault, Knowledge Compiler, and Hot Runtime Memory.
- ADR-0018 records the Hermes + LLM Wiki + Obsidian-compatible Knowledge Vault decision; ADR-0019 records the Hermes-first Telegram/control-plane composition; ADR-0017 covers candidate payload and compiled-generation retention.
- The primary-source research is retained in `docs/research/real-ming-llm-wiki-memory-research.md`.

## Locked memory and knowledge decisions

1. Sources of Record remain authoritative.
2. Storage follows the five Trust Domains, not the five Executive Roles.
3. The Knowledge Vault is one logical service over Personal, Ming Creatives, Academic, Entertainment, Finance, and CEO Approved-Projection roots.
4. Each domain root follows the LLM Wiki raw/schema/wiki discipline with `index.md`, append-only `log.md`, filing, and linting.
5. Hermes is the conversational, tool, scheduling, and Knowledge Compiler runtime.
6. Hermes native memory is bounded, write-gated Hot Runtime Memory rather than the persistent brain.
7. Obsidian is the CEO-facing IDE over encrypted, versioned Markdown and is not the Source of Record or policy boundary.
8. Agent Brain remains canonical, project-scoped Project Evidence behind the Evidence Broker; Real-Ming never edits its ledger or generated projections.
9. The Knowledge Compiler may publish a new derived generation but never writes directly to a Source of Record or silently promotes a daily note, chat, or uncited output into stable knowledge.
10. Telegram is governed by Real-Ming ingress, while Hermes owns the persistent conversation, reasoning, research, coding loop and final answer. Real-Ming creates/records the Work Item, serves bounded projections, gates tools and exposes durable outcomes.

## Remaining operational inputs

These are expected implementation inputs rather than unresolved architecture questions:

- the exact first DuitSini product update for RM-24 / GitHub issue #25;
- the first CEO-selected Personal Context item and its source metadata for RM-17 / issue #18;
- Telegram, Notion, Google, provider, GitHub, Vercel, and hosting credentials supplied through the approved secret path;
- the durable encrypted volume, backup, and optional synchronization provider for the Knowledge Vault;
- provider-specific API, model, cloud, scheduler, usage, and billing inventory plus budgets beneath the RM250 global cap;
- staged registration and verification of the remaining approved Agent Brain projects.

## Implementation handoff

The Phase 4 Hermes-first implementation is now present behind the approved
seams: Real-Ming owns Telegram ingress and governance, Hermes owns the durable
conversation/reasoning/coding loop, the Projection and Evidence Brokers bound
context, and the dashboard/Obsidian/recovery surfaces expose durable results.
Human-input tickets remain visibly `ready-for-human`; blocked live actions must
not be bypassed by starting a second Telegram owner or exposing the dashboard
without an identity decision. The remaining handoff is the
[RM-40 Phase 4 activation runbook](../../CEO-Office/RM-40-phase4-activation-runbook.md):
Azure Hermes OAuth/API key, private Telegram smoke, Obsidian destination,
dashboard security and off-host backup.

## Completion evidence

- [x] Phase 1 checkpoint and discovery artifacts reconciled.
- [x] Phase 2 local specification and GitHub specification synchronized.
- [x] Phase 3 local manifest and GitHub tickets synchronized.
- [x] Knowledge Vault ADR, terminology, retention, testing, and dashboard health incorporated.
- [x] Architecture Revision 5 CEO-review diagram generated as HTML and PNG, checked responsively, and visually inspected.
- [x] No Source of Record, production service, credential, Agent Brain ledger, or generated Agent Brain projection was modified.
