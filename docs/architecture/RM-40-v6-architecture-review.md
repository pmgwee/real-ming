# Phase 4 · V6 architecture review and why the earlier build drifted

Reviewed: 5 September 2026. Architecture/documentation work only; no production cutover, credential change, provider write or service restart.

## TL;DR

Use [the V6 architecture diagram](real-ming-agent-diagram-v6.html) as the latest design target.

**The best fit for your stated priorities is native Hermes first, with Real-Ming as a small personalization/integration extension—not a second agent platform.** A separate control plane is not required merely for five roles, connected apps, Obsidian, memory, schedules, durable tasks or an agent dashboard. The pinned Hermes source already includes substantial support for all of these categories. See the [primary-source capability review](RM-40-hermes-native-capability-review.md).

Retain existing Real-Ming code when it supplies something you demonstrably want beyond the native behavior: your Notion task semantics, cross-source reconciliation, selected provenance/projection contracts, and CEO-specific portfolio/evidence views. Some of that can be a Hermes plugin or dashboard extension; it does not all need a separate service.

V6 changes the target, not the deployed system. Malaysia still runs the V5 Real-Ming Telegram/API bridge. The Revision 5 specification, ADR and acceptance baseline have not yet been rewritten into V6 implementation requirements. Do that reconciliation before another broad implementation cycle.

## 1. What actually went wrong?

The main failure was **losing the product-level invariant while decomposing and validating components**: “Ming uses a real Hermes agent that performs the work” became “the Real-Ming operational contracts pass.” Those are not equivalent outcomes.

This is not simply a case of you forgetting to request Hermes. The versioned specification already said Hermes would remain the conversational, tool, scheduling and Knowledge Compiler runtime. The v3 simplified diagram also explicitly said “Hermes works.” The implementation failed to realize that declared composition.

There were also later refinements: preserving the exact native Telegram gateway experience, minimizing custom infrastructure, and clarifying always-on Azure execution became more explicit during Phase 4. We should distinguish those refinements from the earlier missing-runtime implementation gap.

### Evidence, rather than speculation about the interview

| Observation | Repository evidence | What it means |
| --- | --- | --- |
| Hermes was in the intended design | The specification at commit `80368cc`, Solution section, says it composes rather than replaces Hermes; the archived v3 simplified diagram names the Hermes runtime | The missing agent was not justified by the written architecture |
| Phase 3 did not contain a working model integration | Commit `39df4b0` corrects the readiness report: no model client, a fixed production question responder, and no deployed private worker | A credential alone could not complete the product; substantial implementation was absent |
| The daily tracer concentrated on operational contracts | [RM-16 / issue #17](https://github.com/pmgwee/real-ming/issues/17) checks Work Items, Notion views, briefings, approvals and recovery | Those are valuable checks, but they do not establish intelligent conversation or actual Hermes execution |
| Final readiness emphasized controlled system/provider seams | [RM-40 / issue #41](https://github.com/pmgwee/real-ming/issues/41) requires extensive harness and browser evidence, while live smoke tests remain explicit/opt-in | Controlled passing tests are not installed-runtime or CEO-experience acceptance; RM-40 was still open when checked |
| The first Phase 4 bridge preserved a custom workflow | [Hermes client](../../src/hermes/hermes-runtime-client.ts) demands one JSON plan; [Telegram front door](../../src/telegram/telegram-front-door.ts) retains a legacy action parser | Calling the real Hermes API did not automatically preserve its native Telegram product |
| One “coding” test proves denied execution, not completed coding | [Coordinator system test](../../test/system/hermes-turn-coordinator.system.test.ts) expects `workspace.read` to be denied and the Work Item to remain Captured | Correctly testing a safe refusal does not prove the requested edit/test workflow |
| The real phone test exposed the gap | [Telegram smoke findings](../evidence/RM-40-phase4-telegram-smoke-findings.md): missing typing/rich formatting, role-prefix bypass, unbound proposed tools | Service health and real LLM responses were insufficient evidence of the expected agent experience |

Historical source links: [initial v1.1 specification](https://github.com/pmgwee/real-ming/blob/80368cc/docs/specs/real-ming-v1.1.md), [readiness correction](https://github.com/pmgwee/real-ming/commit/39df4b03e04a1a56c06a7bffb87872689b1e7a4d).

### The causal interpretation

These conclusions are inferences from the artifacts above, not a reconstruction of every original conversation:

1. **Governance became the center of the implementation.** The spec strongly described roles, authority, Work Items and source boundaries. That detail was implementable and testable, while the Hermes runtime remained an abstraction that was not actually bound.
2. **The native integration was deferred behind too much scaffolding.** A minimal Telegram → real Hermes → real tool → answer demonstration should have been a first tracer. Instead, many surrounding capabilities were validated before the missing intelligence/runtime was confronted.
3. **Tests proved the contracts that had been written, not the whole experience you pictured.** Controlled model responses and provider edges are appropriate for safe, deterministic CI. The mistake was treating them as sufficient proof of native execution, usability and live composition.
4. **Architecture changes were not converted into enough new observable acceptance requirements.** A new diagram or “Hermes-first” label did not force native command reachability, actual code edits/tests, formatted delivery or task-free ordinary chat.
5. **The reuse analysis was incomplete.** We now have evidence that the installed Hermes version includes features earlier explanations assigned almost entirely to Real-Ming. We must evaluate those before maintaining duplicate infrastructure. This proves current overlap; it does not prove every feature existed on the original kickoff date.
6. **Readiness language was too broad.** “Implemented,” “controlled test passed,” “production wired,” “live workflow passed,” and “CEO accepted” need separate labels. Earlier assurances that blurred those stages were too strong.

The engineering process should have caught this earlier. It is not fair to assign the failure to your interview wording, or to the grill-me/to-spec/to-implements skill names alone. We do not have sufficient evidence to identify a specific interview answer or skill invocation as the cause.

Also, the first-stage system was not worthless or wholly incorrect: it produced meaningful operational components. The failure was presenting progress on those components as equivalent to delivering the intended personal agent. The live GitHub readiness ticket remains open; “all tickets complete” was not the verified state at this review.

## 2. Do these features need a separate Real-Ming service?

Usually, **no**. The distinction is between a capability and an extra guarantee.

| Your need | Start with | Add custom code only for |
| --- | --- | --- |
| COO / CTO / CMO / Personal CFO / CAO | Hermes role skills/playbooks and relevant context | Accountable-role reporting or stricter data boundaries that you actually require |
| Notion, Calendar, GitHub, Vercel | Available Hermes skills, CLIs and configured MCP integrations | Your exact task-status mapping, reconciliation, duplicate prevention and source-specific gaps |
| Personal memory and Obsidian | Native Hermes memory/session search, bundled Obsidian and LLM Wiki skills | Transactional publication, special provenance validation, quarantine or access-controlled projections beyond the skill workflow |
| Work tracking, schedules and coding workspaces | Native Hermes Kanban, cron and workspace capabilities | Mapping execution to existing Notion commitments; avoid two authorities for the same record or schedule |
| See what the agent is doing | Native Hermes web dashboard | A CEO-specific cross-app portfolio/evidence view; first consider the dashboard extension SDK |
| Exact production approval and audit | Scoped credentials plus supported, tested native tool/plugin hooks | Specific approval contracts and durable reconciliation of events, where the native behavior is insufficient |

The official [Obsidian skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/note-taking/obsidian/SKILL.md) handles filesystem-based Markdown operations. The official [LLM Wiki skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/research/llm-wiki/SKILL.md) also covers source capture, citations, synthesis and linting. This is substantially more than “Hermes remembers a few preferences.” A custom knowledge compiler should earn its place through additional guarantees, not through claiming native knowledge workflows do not exist.

Similarly, Hermes already has a [web dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard), [extension SDK](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard) and [durable Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban). A separate dashboard or task engine is an option, not a prerequisite.

Availability still is not connectivity. Each provider needs compatible tools, scopes and authorization. Vercel's MCP catalog entry in Hermes, for example, is not proof that the current client/account authorization works. Existing Real-Ming provider adapters may remain the best path where they already satisfy a tested requirement.

## 3. The corrected responsibility boundary

**Hermes decides and performs the agent workflow.** It selects the relevant perspective, reasons about the request, chooses tools, reads sources, changes files, runs tests, evaluates results and writes the answer. Native commands can execute directly without consulting the LLM; not everything benefits from a model decision.

**The Real-Ming extension supplies selected tools, context and cross-app records.** For example, Hermes may call a tool to link its native task to a Notion Master Tasks page. That tool validates fields and saves the record. Hermes remains the coding agent; the integration code is not implementing the feature on Hermes's behalf.

Deterministic operations do not need their own intelligence. Correctly deduplicating a record or enforcing a version-bound approval is software behavior. But such behavior can live in a native plugin/tool; it does not automatically justify a separately deployed platform.

The new main path is:

```text
Ming on Telegram ↔ native Hermes gateway ↔ native Hermes agent loop
                                            ↕
                              native tools / skills / plugins / MCP
                                            ↕ when useful
                              thin Real-Ming integration + data
```

There is no mandatory structured Turn Plan for each reply. Structured tool arguments remain appropriate for actual operations. There is no second Telegram poller and no Real-Ming rewrite of Hermes's final answer.

### One example: develop a DuitSini feature

Hermes clarifies and studies the repository, uses its native workspace/tools, edits the feature, runs tests and iterates. It may invoke the Real-Ming integration to link the native execution task to Master Tasks, retrieve a reconciled project brief, attach test/commit evidence, and request a precisely scoped release approval. The native gateway returns the formatted answer. Native agent visibility works independently; the CEO view adds the cross-app linkage.

The Real-Ming tool call is optional for ordinary coding capability, but required if that particular workflow promises a Notion record. If recording fails, the answer should report that failure instead of claiming the whole cross-app workflow completed.

## 4. What should be kept, reduced or deferred?

- **Keep now:** the approved Azure host, Hermes OAuth, private networking, recoverable state and existing backups. Do not delete operational stores because a native feature has a similar name.
- **Prefer native:** Telegram transport/presentation, conversation/session loop, tools, skills, plugins/MCP, memory, cron, Kanban and basic agent dashboard.
- **Configure:** Ming's role playbooks, personal/project context, writing preferences, source access and Obsidian/Wiki conventions.
- **Retain selectively:** Master Tasks semantics and mappings, useful Calendar/source reconciliation, Agent Brain evidence access, cross-app outcomes and selected exact-action contracts.
- **Evaluate before expanding:** a “Real-Ming CEO Office” Hermes dashboard tab, backed by existing data where valuable, versus maintaining a separate console. The architecture permits either; native extension is the recommended starting point.
- **Make optional:** the advanced encrypted/versioned Knowledge Vault pipeline. Preserve the design and code; activate it only if the additional publication/projection guarantees are still desired.
- **Retire only after a verified migration:** the custom Telegram consumer and mandatory JSON coordinator. No live component was retired in this task.

The earlier memory policy restricted all native memory writes and treated Hermes memory as only a tiny cache. Preserving native memory in V6 is a deliberate requirement change that must be reconciled with that old spec, not silently implemented under the old label.

Existing restrictions on consequential actions are not implicitly lifted. A role skill is not access control; an optional Real-Ming MCP server cannot force every other tool to route through it. Pinned hooks have documented limitations and failure behavior. Until enforcement is verified for an affected path, use narrow credentials or leave that capability unavailable. Ordinary unrelated native features should not be disabled merely to hide integration gaps. See the [hook evidence](RM-40-hermes-native-capability-review.md#integration-hooks-useful-but-do-not-overclaim-enforcement).

## 5. How to prevent the same mistake with Codex or Claude Code

Use this as the opening contract for the next implementation stage:

> Native Hermes is the product runtime and Telegram experience. Real-Ming is an additive integration. First inventory native capabilities and demonstrate the real end-to-end product slice. Do not replace the agent loop, command dispatcher or channel rendering with custom scaffolding. For each requirement, name the native feature/configuration or the exact missing custom behavior, then name its observable acceptance evidence. Separate controlled-test success from production wiring, live workflow success and CEO acceptance.

Then use the following checkpoints:

1. **Make the first tracer the product.** A real allowed Telegram user receives typing/progress, a readable answer, a working native command and one genuine tool result. Test a coding request with changed files and actual test exit status.
2. **Compare native behavior before customization.** Record the native feature/configuration baseline, then test the same interactions with the Real-Ming extension enabled. This catches regressions caused by personalization itself.
3. **Review scenarios, not only diagrams.** Include ordinary chat, role-addressed chat, coding, a source lookup, a failed connector, interrupted work/restart, a deliberate approval boundary, and a laptop-off run.
4. **Require traceability.** Every product requirement points to a real composition path and evidence. A mocked result may prove a contract but cannot be its only live-readiness evidence.
5. **Use separate status labels.** Designed → implemented → controlled-tested → production-wired → live-verified → CEO-accepted. Missing OAuth is different from a missing client; a healthy service is different from a functioning workflow.
6. **Reconcile after architectural changes.** Update the spec/ADR, acceptance criteria and implementation work when the diagram changes. Preserve history, but make the current target and deployed state unambiguous.
7. **Validate continuously with you.** Small milestone demonstrations prevent 44 locally correct tasks from accumulating around an incorrect product assumption. Safe controlled CI and deliberate authorized live smoke tests are complementary, not competing approaches.

## 6. Next implementation gate

Do not restart prerequisites or ask for another OAuth login merely because the architecture changed. The immediate gate is developer work: reconcile V6 requirements, stage the native gateway and selected extension, then perform a deliberate one-owner cutover with rollback.

The V6 diagram includes the ordered acceptance sequence for native Telegram, real coding, provider access, task mapping, private dashboard and memory/recovery. New production actions still need their exact scope and candidate reviewed; this architecture document is not a deployment receipt.

## Scope and verification of this document

Historical repository artifacts and issues were read; official installed/current Hermes capabilities were reviewed separately. The original interview/tool invocation transcript was not reconstructed. Root-cause interpretation is explicitly separated from evidence. No live model call, bot message, provider write or production mutation was needed for this architecture review.
