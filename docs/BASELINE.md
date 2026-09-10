# Real-Ming baseline

**Real-Ming v1.1 · Architecture Revision 6**

Revision 6 is the authoritative **design and specification** baseline: native
Hermes owns the Telegram gateway, conversation, tools and execution, and
Real-Ming is a thin additive extension. See
[ADR-0020](adr/0020-run-ming-on-the-native-hermes-runtime.md) and the
[V6 diagram](architecture/real-ming-agent-diagram-v6.html). Every current
artifact below states this label, and `test/docs/baseline.test.ts` fails the
build if any of them drifts.

**Deployed revision: Architecture Revision 6, partially activated (7 September
2026).** The Malaysia West host `real-ming-control-plane-my` runs image
`real-ming:v6-9ef3fac` with
`REAL_MING_TELEGRAM_OWNERSHIP=native-hermes-gateway`, so Real-Ming no
longer polls Telegram. The native Hermes gateway (v0.21.0, pinned
`561b053f794a1781868bb032029d589c67708119`) holds the bot credential and
allowlist; it is the single Telegram consumer with 60 native commands
registered. The supervised Hermes dashboard is loopback-only at `127.0.0.1:9119`
and Real-Ming remains loopback-only at `127.0.0.1:8787`. Both sockets stay on
loopback, but since 8 September the Hermes dashboard is *reachable* from
approved tailnet devices through Tailscale Serve behind Nous Portal OAuth, with
Funnel off — the bind did not move, the trust boundary did, and stating only
the bind would mislead. See
[ADR-0021](adr/0021-reach-the-dashboard-over-tailscale-with-nous-oauth.md). Native cron owns
scheduling with exactly two enabled Telegram-delivering jobs (07:30 and 21:30
`Asia/Kuala_Lumpur`); the first successful unattended run fired at 21:30 on
7 September. Nine MCP servers expose 272 tools, of which the Real-Ming
extension contributes nine covering Work Items, scheduled reports, calendar
read and create, and mail search, read and draft across three Google accounts.
There is deliberately no send tool and no `gmail.send` scope: the agent drafts
and Ming sends from his own Gmail. Real-Ming states no opinion about Hermes
memory: its configuration fragment carries no `memory:` block, and the native
built-in provider is active. A protected post-deploy backup and isolated restore
passed; the remaining acceptance boundary is recorded in the
[deployment evidence](evidence/RM-40-v6-deployment-evidence-2026-09-07.md).
The design baseline and deployed revision are stated separately on purpose and
neither is evidence for the other. Status lives in the [V6 implementation
plan](planning/RM-40-v6-native-first-implementation-plan.md), the [requirement
ledger](planning/RM-40-v6-requirement-ledger.md) and the [cutover
evidence](evidence/RM-40-v6-milestone-3-cutover-evidence.md).

## Artifacts

| Role | Artifact | Identity |
| --- | --- | --- |
| Product and specification baseline | [docs/specs/real-ming-v1.1.md](specs/real-ming-v1.1.md) | Real-Ming v1.1 Personal Executive Operations Specification, Architecture Revision 6 |
| Current architecture diagram | [docs/architecture/real-ming-agent-diagram-v6.html](architecture/real-ming-agent-diagram-v6.html) | Architecture Revision 6 — native Hermes + thin Real-Ming extension |
| Current architecture render | [docs/architecture/real-ming-agent-diagram-v6.png](architecture/real-ming-agent-diagram-v6.png) | Revision 6 render |
| Current architecture presentation | [docs/architecture/real-ming-agent-diagram-v7-cleanup.html](architecture/real-ming-agent-diagram-v7-cleanup.html) | Architecture Revision 6, v7 cleanup — same revision, corrected presentation. The v6 HTML and PNG above are retained unchanged as the prior render. **PNG render outstanding.** |
| Post-RM-40 knowledge design | [docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md](superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md) and [ADR-0022](adr/0022-native-knowledge-consolidation-around-hermes.md) | Revision 6 additive design; Tasks 0–8 controlled-tested, with no production caller or cron activation |
| Post-RM-40 knowledge implementation plan | [docs/superpowers/plans/2026-09-09-native-knowledge-consolidation.md](superpowers/plans/2026-09-09-native-knowledge-consolidation.md) | Tasks 0–8 implemented and controlled-tested; live activation and Task 9 remain separately gated |
| Decision record set | [docs/adr/](adr) | ADR 0001 through ADR 0022 |
| Implementation graph | [real-ming-phase3-tickets.json](../real-ming-phase3-tickets.json) | Phase 3 tracer-bullet decomposition, 44 tickets |

## Recorded historical baseline

Revision 5 artifacts are retained unchanged as the record of the deployed
system. Their labels are preserved rather than rewritten, and the baseline test
enforces that preservation.

| Role | Artifact | Identity |
| --- | --- | --- |
| Recorded V5 architecture diagram | [docs/architecture/real-ming-personal-agent-diagram-v5-CEO-review.html](architecture/real-ming-personal-agent-diagram-v5-CEO-review.html) | Real-Ming Architecture Revision 5 — deployed implementation baseline |
| Recorded V5 architecture render | [docs/architecture/real-ming-personal-agent-diagram-v5-CEO-review.png](architecture/real-ming-personal-agent-diagram-v5-CEO-review.png) | Historical V5 render |

## Superseded artifacts

| Superseded | Replaced by | Location |
| --- | --- | --- |
| Real-Ming v1 specification | Real-Ming v1.1 specification | Removed; history preserved in Git |
| Architecture diagram v1 | Architecture Revision 6 | [docs/architecture/old_archieved/](architecture/old_archieved) |
| Architecture diagram v2 | Architecture Revision 6 | [docs/architecture/old_archieved/](architecture/old_archieved) |
| Architecture diagram v3 and v3 simplified | Architecture Revision 6 | [docs/architecture/old_unenhanced/](architecture/old_unenhanced) |
| Architecture diagram v4 final draft | Architecture Revision 6 | Removed; history preserved in Git |
| Architecture Revision 5 as the design target | Architecture Revision 6 | Retained above as the recorded deployed revision |

`docs/architecture/real-ming-v1.html` remains the narrative v1.1
final-architecture page and is not a diagram revision.

## Architecture agreement

Revision 6 records the agreement below (ADR-0020, superseding the named clauses
of ADR-0019, ADR-0014 and ADR-0018):

- Ming is the sole CEO; every consequential action stops at an exact,
  artifact-bound Approval, and no Executive Role performs Money Movement or
  brokerage trading.
- Five bounded Executive Roles — COO, CTO, Personal CFO, CAO, CMO — each report
  directly to the CEO, and the COO coordinates without inheriting peer
  authority. They are expressed as Ming role playbooks, not five services.
- The native Hermes gateway is the single Telegram consumer for the bot. It
  owns supported commands, presentation, progress and attachments.
- Hermes owns conversation, session continuity, reasoning, tool selection,
  research, coding, test execution, iteration and the final answer. There is no
  mandatory turn envelope and no Real-Ming rewriting of Hermes's answer.
- Real-Ming adds only demonstrably missing behaviour: Ming-specific context and
  role playbooks, Notion Master Tasks semantics and cross-source
  reconciliation, cross-app records and evidence, CEO-specific views, and
  explicitly retained stronger guarantees. It is reached as a tool, not as a
  gate.
- Ordinary conversation requires no Work Item, role-selection ceremony or
  Real-Ming record operation.
- Native memory and session search are first-class under the ADR-0020 memory
  policy. Sources of Record stay authoritative and Sensitive Secrets stay out.
- Persistent knowledge uses the native Obsidian and LLM Wiki workflow. The
  encrypted, versioned Trust-Domain vault, Candidate Envelope quarantine and
  Projection Broker are retained as optional stronger guarantees, activated
  only where a required guarantee is demonstrated.
- Agent Brain stays the source of cited Project Evidence behind the Evidence
  Broker, and domain systems stay Sources of Record.
- Execution is hybrid: an always-on Azure control plane on private networking,
  plus the optional Lenovo private worker for Local-Only Work.

## Changing the baseline

1. Update the specification and the current diagram HTML together.
2. Re-render the current PNG from its HTML and confirm the render visually.
3. Update this file, including the label if the revision number changes, and
   move the outgoing revision into "Recorded historical baseline" rather than
   rewriting its label.
4. State the deployed revision separately and honestly. Promoting the design
   baseline does not promote the deployment.
5. Run `npm run check`; the baseline test enforces label agreement, historical
   label preservation and render presence.
