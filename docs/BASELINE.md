# Real-Ming baseline

**Real-Ming v1.1 · Architecture Revision 5**

This is the single shared label for the current authoritative design baseline. Every artifact below states this label, and `test/docs/baseline.test.ts` fails the build if any of them drifts.

## Artifacts

| Role | Artifact | Identity |
| --- | --- | --- |
| Product and specification baseline | [docs/specs/real-ming-v1.1.md](specs/real-ming-v1.1.md) | Real-Ming v1.1 Personal Executive Operations Specification |
| Current architecture diagram | [docs/architecture/real-ming-personal-agent-diagram-v5-CEO-review.html](architecture/real-ming-personal-agent-diagram-v5-CEO-review.html) | Real-Ming Architecture Revision 5 — Hermes-first / CEO review |
| Current architecture render | [docs/architecture/real-ming-personal-agent-diagram-v5-CEO-review.png](architecture/real-ming-personal-agent-diagram-v5-CEO-review.png) | Rendered from the current architecture HTML |
| Decision record set | [docs/adr/](adr/) | ADR 0001 through ADR 0019 |
| Implementation graph | [real-ming-phase3-tickets.json](../real-ming-phase3-tickets.json) | Phase 3 tracer-bullet decomposition, 44 tickets |

## Superseded artifacts

| Superseded | Replaced by | Location |
| --- | --- | --- |
| Real-Ming v1 specification | Real-Ming v1.1 specification | Removed; history preserved in Git |
| Architecture diagram v1 | Architecture Revision 5 | [docs/architecture/old_archieved/](architecture/old_archieved/) |
| Architecture diagram v2 | Architecture Revision 5 | [docs/architecture/old_archieved/](architecture/old_archieved/) |
| Architecture diagram v3 and v3 simplified | Architecture Revision 5 | [docs/architecture/old_unenhanced/](architecture/old_unenhanced/) |
| Architecture diagram v4 final draft | Architecture Revision 5 | [docs/architecture/real-ming-personal-agent-diagram-v4-final.html](architecture/real-ming-personal-agent-diagram-v4-final.html) |

`docs/architecture/real-ming-v1.html` remains the narrative v1.1 final-architecture page and is not a diagram revision.

## Architecture agreement

Revision 5 is the current Phase 4 architecture. It keeps the v1.1 Trust-Domain Knowledge Vault and LLM Wiki memory architecture, and makes the Hermes-first Telegram composition explicit (ADR-0019):

- Ming is the sole CEO; every consequential action stops at an exact, artifact-bound Approval, and no Executive Role performs Money Movement or brokerage trading.
- Five bounded Executive Roles — COO, CTO, Personal CFO, CAO, CMO — each report directly to the CEO, and the COO coordinates without inheriting peer authority.
- Hermes remains the conversational, tool, scheduling, and Knowledge Compiler runtime; Real-Ming adds governance, durable work, Approval, projection, audit, and CEO surfaces.
- Hermes performs interpretation, role selection, planning, research, coding and final answers. Real-Ming validates identity, idempotency, secret exclusion, Work Items, policy/Approval, projections, tool boundaries, provider write-backs, continuity and dashboard evidence.
- One Telegram turn is `Ming → Real-Ming ingress → persistent Hermes conversation → Hermes structured turn plan → Real-Ming governance/projections → Hermes execution/reasoning → verified answer → Telegram`; Real-Ming never becomes a second LLM.
- Persistent knowledge is compiled into cited, versioned Markdown across isolated Personal, Ming Creatives, Academic, Entertainment, and Finance roots plus a CEO Approved-Projection root.
- Obsidian is the CEO-facing knowledge IDE and is never the access-control boundary; Hermes native memory stays bounded Hot Runtime Memory.
- Agent Brain stays the source of cited Project Evidence behind the Evidence Broker, and domain systems stay Sources of Record.
- Execution is hybrid: an always-on control plane plus the Lenovo private worker for Local-Only Work.

## Changing the baseline

1. Update the specification and both diagram HTML files together.
2. Re-render both PNGs from their HTML and confirm the render visually.
3. Update this file, including the label if the revision number changes.
4. Run `npm run check`; the baseline test enforces label agreement and render presence.
