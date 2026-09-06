# Lessons learned: keep the intended product aligned through delivery

Recorded: 6 September 2026. Applies to future projects as well as Real-Ming.

## TL;DR

Use **both a human-readable lesson record and a reusable agent skill**. This document explains the lessons and gives you prompts to carry forward. The installed `$build-alignment` skill turns them into checkpoints during interviews, specifications, ticketing, architecture changes and acceptance. Keep the project-specific decisions in the project repository.

The central lesson is to maintain a traceable chain:

**User outcome → confirmed requirements → architecture → implementation work → actual runtime → acceptance evidence.**

Your initial prompt does not need to contain a perfect technical specification. The interview and engineering investigation should turn your intent into observable outcomes, expose important uncertainty and prove the riskiest interaction early.

For this project's execution sequence, use [the V6 implementation plan](../planning/RM-40-v6-native-first-implementation-plan.md). For historical evidence, use [the architecture review](../architecture/RM-40-v6-architecture-review.md) and [the native capability review](../architecture/RM-40-hermes-native-capability-review.md).

## 1. What we learned from Real-Ming

### Generating tickets before the last diagram was not sufficient to explain the failure

It can create drift when a later architecture change never reaches the specification, tasks, code or acceptance criteria. But an architecture does not need to become permanently final before implementation starts. Iteration is normal. The necessary discipline is to reconcile the affected work whenever a consequential decision changes.

In Real-Ming, the earlier specification already said Hermes would provide the agent runtime. The historical review links that requirement to the versioned specification and diagrams. Later readiness evidence identified a fixed production responder and missing runtime integration. That was an implementation/composition gap even before the stronger native Telegram experience was clarified.

The later request to preserve native commands, presentation, tools and memory added useful specificity. It also exposed that calling a Hermes API through a custom JSON workflow did not deliver the same product experience as using its native gateway and agent harness.

### Requirements needed more observable detail; responsibility was shared

“An intelligent personal agent powered by Hermes” left room for materially different implementations. Useful interview questions would have established: which native behavior must remain; who performs the coding; whether ordinary chat creates records; what Ming sees during a long operation; and what continues when the laptop is off.

Those questions were the interviewer's responsibility to surface. The engineer should investigate available capabilities and integration semantics. You should not have to know an SDK, discover an unbound callback, or prescribe the correct process topology to obtain the product you described.

We cannot attribute the failure to one original prompt, one interview answer or a named skill without the corresponding evidence. The repository supports a more specific conclusion: component delivery and controlled tests progressed without adequate proof of the promised agent experience.

### Passing component tests was useful but insufficient

The operational code was not wasted. Task lifecycle, reconciliation, evidence and recovery behavior remain useful where their contracts are still required. Their tests establish those contracts within their tested scope.

They do not establish that the installed Hermes runtime receives Telegram messages, performs a coding loop, preserves native commands or presents usable replies. The real phone test exposed gaps that a fixture-based dashboard and a mocked responder could not reveal.

### Reuse analysis must precede custom implementation

For each capability, investigate in this order:

1. The selected platform's native feature.
2. Configuration, instructions or a skill.
3. An existing compatible integration, CLI, plugin or MCP server.
4. A small custom extension for the remaining requirement.
5. A separately operated service when the requirement justifies it.

Record support at a specific version and prove compatibility. A catalog listing is not a successful account connection; a skill is not a transactional guarantee. Today's Hermes feature overlap does not prove that every feature existed at the original kickoff date.

Custom code remains appropriate where a demonstrated requirement needs it. Existing code should earn its continued role through that requirement, just as new code should.

## 2. The workflow to use next time

| Stage | Produce | Check before advancing |
| --- | --- | --- |
| Initial prompt | Desired users/jobs, reference experience, priorities, constraints and examples of unacceptable results | State what is confirmed and what needs an interview; avoid silently assuming the platform's role |
| Grill-me/interview | A short read-back: ordinary interaction, substantial job, ambiguity, failure/recovery, ownership and exclusions | Resolve choices that change the product; investigate technical facts without asking the user to invent implementation details |
| Capability investigation | Versioned native/configuration/integration/custom disposition for each important capability | Unknown fit becomes a bounded investigation; each proposed custom component names an unmet requirement |
| First product demonstration | The smallest real interaction that exercises the riskiest composition | Observe the intended runtime and actual result, including a relevant failure; label any simulation |
| Specification | Requirement IDs, outcomes, ownership, constraints, non-goals and acceptance scenarios | Every important promise has observable pass/fail evidence and an accountable runtime path |
| Tickets | Detailed work for the next demonstrable milestone; later work stays provisional where discovery matters | Each task links to requirements, affected interfaces, verification and evidence; ticket count is not a completion metric |
| Implementation/review | Working composition plus controlled regression checks | Inspect the real entry point and actual dependency wiring; a library with no caller is not activated |
| Architecture change | An explicit old/new decision delta and affected-artifact list | Reconcile spec, glossary/ADRs, diagrams, tickets, configuration, code, data ownership, tests and evidence |
| Acceptance | Revision-specific scenario results, operational recovery proof and user review | Distinguish deployed behavior from target design and user acceptance from engineering assertions |

The first demonstration should be safe and narrow. For an agent product, an example is: an allowed user sends an ordinary question, receives a native reply without a task record, then requests a bounded tool operation and sees a verified result. For another kind of product, choose its corresponding core interaction instead.

Keep normal CI isolated from real providers and production data. Run deliberate integration checks separately with the required access and authorization. Both evidence tracks are necessary; neither substitutes for the other.

## 3. What to do whenever architecture changes

Record a compact delta before implementing affected behavior:

1. What approved user behavior changed, and why?
2. Which requirements and decisions are affected?
3. Which artifacts and work items are **retain / revise / retire / investigate**?
4. Which existing test results remain valid, and which readiness claims are now stale?
5. Who owns the affected records, writes, schedules and publication after migration?
6. What is the next demonstrable slice, its pass/fail evidence and its rollback?

Do not erase historical diagrams or completed evidence. Label their scope and revision. Do not reopen a user choice that the latest explicit decision already settles. Do not update only the word “current” while leaving contradictory clauses and task criteria in place.

Use one compact traceability table in the project's existing plan or specification:

| Requirement/revision | Decision and work | Actual composition | Evidence and next proof |
| --- | --- | --- | --- |
| Ordinary questions retain native agent behavior | Native gateway decision; integration task | Identify the real entry point and runtime binding | Controlled checks; then native session/reply and zero new task records at the candidate revision |
| Agent develops a feature | Native tools/workspace; selected recording integration | Agent edits and tests; integration saves evidence | Changed files, actual test exit status, final response and record read-back where promised |

## 4. Use precise readiness language

| State | Meaning |
| --- | --- |
| Designed | The behavior and ownership are specified |
| Implemented | Code/configuration exists for the behavior |
| Controlled-tested | Isolated checks prove the stated contract at a revision |
| Production-wired | The deployed entry point actually connects the required components |
| Live-verified | An authorized scenario succeeded against the intended installed system |
| User-accepted | The user reviewed the outcome and accepted it |

Attach environment, revision, timestamp and proof scope. A model's claim that it used a tool is weaker evidence than the tool result and observable artifact. A missing login is a human-access blocker; a missing runtime client or caller is engineering work. Record them separately.

## 5. Carry the lessons into Codex and other agents

The reusable skill is installed at `C:/Users/quekm/.codex/skills/build-alignment/SKILL.md`, with its stage playbook in `references/checkpoints.md`. Its interface metadata enables implicit invocation, but explicit invocation is the reliable way to request this discipline for an important milestone. It complements the interview/spec/ticket skills you choose.

Paste this at project kickoff:

> Use $build-alignment alongside my grill-me → specification → tickets workflow. First establish the user experience and outcomes, including what the reference product already does that must remain. Ask focused questions about consequential business choices and investigate technical capability fit yourself. Separate confirmed requirements, assumptions and unresolved decisions. Prefer native features, configuration and existing integrations before custom code. Demonstrate the riskiest real product interaction early. Link requirements to architecture, tasks, runtime wiring and acceptance evidence, and reconcile those links whenever the architecture changes.

Paste this when changing direction:

> Use $build-alignment for this approved architecture change. Produce the old/new behavior delta, retain/revise/retire/investigate list, affected requirement-to-evidence links, migration ownership and next demonstrable increment. Apply our settled decisions; ask only about unresolved choices that materially change the outcome.

Paste this before declaring a milestone done:

> Use $build-alignment to review readiness. Show the actual runtime path and scenario evidence for each required outcome. Distinguish controlled-tested, production-wired, live-verified and user-accepted. Compare the native/reference experience before and after customization and identify the next missing proof.

For Claude Code or another agent, provide the skill folder or install it in that agent's documented skill location. The Codex installation does not automatically install it into other products. You can also explicitly ask an agent to read this lesson file and the skill/playbook by path. No global Claude instructions were changed by this work.

An optional future project's `AGENTS.md` or equivalent can say:

> At kickoff, specification, ticket decomposition, architecture changes and milestone acceptance, use the Build Alignment skill or its checkpoint playbook. Keep a requirement-to-runtime-to-evidence record in the project's existing planning documents. Apply only the checkpoint relevant to the current work; unrelated small edits do not require a new interview.

## 6. What the reusable skill was checked against

The skill was exercised with a synthetic architecture-drift scenario: almost all tickets closed, many mocked tests passing, a missing native runtime binding, and a newer approved architecture while the next ticket remained cosmetic work.

Five earlier unguided samples already detected the central missing-runtime problem. The skill is not credited with discovering something those agents missed. The guided samples made the reuse investigation, artifact reconciliation, evidence stages and next real slice more consistently explicit. Five guided outputs were inspected across the continued work. A small-edit counterexample also confirmed that the checkpoint should not trigger a full interview for a typo.

This is bounded qualitative testing, not a statistical guarantee or proof that future projects cannot drift. The skill-creator Python validator could not run because the available Python environments lack PyYAML; structure, metadata, references and contents are checked separately. Keep updating the playbook when real project evidence exposes a new failure mode.
