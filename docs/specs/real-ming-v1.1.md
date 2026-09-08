# Real-Ming v1.1 Personal Executive Operations Specification

Version 1.1 · 2026-08-27 · Adds the approved Trust-Domain Knowledge Vault and LLM Wiki memory architecture without changing the two-tracer rollout or human-authority boundaries. Design amendment 2026-09-08 adds a selective, native-first knowledge-consolidation path; Tasks 0–8 are controlled-tested, while production activation remains separately gated.

**Real-Ming v1.1 · Architecture Revision 6** · 2026-09-06 · Moves the runtime composition to native Hermes with a thin Real-Ming extension, per [ADR-0020](../adr/0020-run-ming-on-the-native-hermes-runtime.md). Outcomes, authority boundaries, Sources of Record, exclusions and the two-tracer rollout are unchanged. The clauses this revision replaces are listed under "Architecture Revision 6 composition delta". Revision 6 is the design baseline; the deployed system is Revision 6 and remains partially activated. The selective consolidation design is recorded separately in [ADR-0022](../adr/0022-native-knowledge-consolidation-around-hermes.md).

## Problem Statement

Ming operates several production application projects while also managing personal commitments, career work, academic responsibilities, content creation, subscriptions, finances, investments, email, calendar events, and daily tasks. The authoritative information for these responsibilities is distributed across application databases, repositories, Notion, Google Calendar, email providers, finance applications, local files, Agent Brain, GitHub, Vercel, and the Lenovo private environment. Existing assistants can answer questions or perform isolated jobs, but they do not provide one durable operating system that can coordinate all of this work, preserve authority boundaries, continue useful work while the laptop is offline, and return review-ready outcomes to Ming as CEO.

The central problem is not a lack of another general chatbot. Ming needs a private executive organization that can capture authorized work, route it to a bounded Executive Role, retrieve only the context that role needs, perform safe work through cloud or private workers, preserve the correct Source of Record, request Approval at the right boundary, verify results, and present an Outcome Report. The system must reduce Ming's day-to-day operational workload without silently expanding agent authority or making the CEO inspect raw agent activity.

The current systems also create information-management and safety risks if combined naively. Copying every source into one shared memory would create stale duplicates and expose personal, academic, career, and financial context across unrelated roles. Direct access to repositories and production systems could allow an agent to deploy an unreviewed artifact. Direct finance integrations could blur the distinction between editing records and performing Money Movement. A laptop-only runtime would disappear whenever the Lenovo sleeps, while an unrestricted cloud runtime would expose local files and credentials.

Real-Ming v1 must first serve Ming as its sole operator while establishing durable actor, workspace, provenance, Approval, audit, and Trust Domain boundaries that permit future productization. It must prove value through two tracer outcomes: a Daily Operations Loop and a guarded DuitSini MicroSaaS Operations Loop.

## Solution

Real-Ming will be Ming's private personal-operations umbrella. Ming remains CEO above five bounded Executive Roles: COO, CTO, Personal CFO, CAO, and CMO. Every role reports directly to the CEO. The COO coordinates the daily portfolio and routes work but cannot approve peers, inherit their raw context, or act as a universal agent. Each Executive Role is a durable boundary for responsibility, context, policy, and work; reasoning workers wake only for jobs rather than running five continuous LLM loops.

One private Telegram bot will be the primary remote command and Approval surface. An authenticated dashboard will provide a CEO Overview, Work Views, Approvals, Outcome Reports, Project Portfolio, GitHub/Git/Vercel operations, integration and worker health, Metered Platform Cost, scheduler monitoring, audit, and recovery. Telegram and the dashboard will use the same identity, policy, Work Item, Approval, and audit services so neither surface can bypass the other.

Master Tasks will be the canonical Notion data source for operational Work Items. Five current task databases will be backed up, migrated, reconciled, and replaced in daily use by linked Work Views for the CEO and each Executive Role. All Work Items will use one lifecycle, one Accountable Executive, optional Collaborating Executives, provenance-linked commitments, explicit risk and Approval state, and a recorded Outcome Report.

The system will compose rather than replace existing systems. Hermes is the product runtime: its native gateway owns the Telegram transport, supported commands and presentation, and its agent loop owns conversation, session continuity, reasoning, tool selection, research, coding, test execution and the final answer. Real-Ming is an additive extension reached as a tool, supplying only behaviour the native runtime does not provide: Ming-specific context and role playbooks, Master Tasks semantics and cross-source reconciliation, cross-app records and evidence, CEO-specific views, and explicitly retained stronger guarantees. Agent Brain will remain the source of cited Project Evidence behind an Evidence Broker. Domain systems will remain Sources of Record. Personal Context will be curated through an allowlisted Personal Context Package and encrypted Context Vault. Persistent knowledge uses the native Obsidian and LLM Wiki workflow over Markdown that Obsidian can open; the encrypted, versioned Knowledge Vault with separate Trust Domain roots and a CEO Approved-Projection root is retained as an optional stronger guarantee and is activated only where a required guarantee is demonstrated. Native Hermes memory and session search are first-class stores under the ADR-0020 memory policy, and never become the authoritative record for a task, commitment, financial figure or academic obligation.

Execution will be hybrid. An isolated always-on control plane will handle Telegram, schedules, cloud APIs, cloud-accessible repositories, monitoring, and Remote-Ready Projects. The Lenovo will act as an on-demand private worker for local files, existing browser sessions, Windows-only tools, sensitive processing, and other Local-Only Work. Work that truly requires the Lenovo will queue safely while it is unavailable instead of pretending it can execute in the cloud.

Authority will be tiered. Read, monitor, classify, summarize, and draft operations may proceed automatically. Reversible low-risk actions may proceed only within explicit Standing Authority. External communications, production promotion, destructive actions, purchases, permission changes, financial Record Changes outside an approved scope, and other high-risk actions require an exact, artifact-bound Approval. No Executive Role may perform Money Movement or brokerage trading.

## User Stories

1. As the CEO, I want one private Telegram identity for Real-Ming, so that I can request work from anywhere without choosing among multiple bots.
2. As the CEO, I want the COO to receive unqualified requests by default, so that routine work is coordinated without making the COO a universal authority.
3. As the CEO, I want to address the CTO, Personal CFO, CAO, or CMO explicitly, so that I can bypass coordination when I already know the accountable role.
4. As the CEO, I want information questions answered without creating unnecessary Work Items, so that the work queue represents actual commitments.
5. As the CEO, I want clear action requests to create acknowledged Work Items automatically, so that asynchronous work cannot disappear inside chat.
6. As the CEO, I want one focused clarification for ambiguous requests, so that agents do not execute an incorrect interpretation.
7. As the CEO, I want every multi-step or asynchronous request tracked through its lifecycle, so that I always know its state and accountable role.
8. As the CEO, I want every Work Item to have exactly one Accountable Executive, so that responsibility for the outcome is never ambiguous.
9. As the CEO, I want multiple Collaborating Executives when needed, so that cross-functional work does not require shared ownership.
10. As the CEO, I want every Executive Role to report directly to me, so that the organizational model does not hide decisions behind the COO.
11. As the CEO, I want the COO to consolidate portfolio status without approving peers, so that coordination remains distinct from authority.
12. As the CEO, I want a 07:30 Asia/Kuala_Lumpur morning brief, so that I start each day with current commitments, exceptions, and proposed priorities.
13. As the CEO, I want a 21:30 Asia/Kuala_Lumpur Executive Roll-Up, so that I see completed outcomes, unresolved risks, pending Approvals, and tomorrow's priorities.
14. As the CEO, I want lighter weekend operations, so that routine automation respects my weekly rhythm.
15. As the CEO, I want a 23:00-07:00 do-not-disturb period, so that only genuinely critical Exception Notices interrupt me overnight.
16. As the CEO, I want Telegram interruptions limited to Approvals, material blockers, critical incidents, completed Outcome Reports, and the scheduled brief, so that routine progress does not become noise.
17. As the CEO, I want to approve, request changes, reject, or cancel Review-Ready Work, so that every review has a clear decision path.
18. As the CEO, I want an Approval bound to an exact action or artifact version, so that later changes cannot inherit stale permission.
19. As the CEO, I want an Approval to become invalid when its target changes, so that agents cannot promote a different commit or message than the one I reviewed.
20. As the CEO, I want an Outcome Report to explain the request, work performed, evidence, verification, risks, and remaining decisions, so that I review outcomes rather than raw activity.
21. As the CEO, I want an append-only audit of commands, policy decisions, Work Item transitions, Approvals, worker actions, and outcomes, so that every material action is explainable.
22. As the CEO, I want one authenticated dashboard, so that I can inspect the entire operating picture without using Telegram for deep investigation.
23. As the CEO, I want dashboard summaries to be redacted by default, so that opening the dashboard does not expose raw personal or financial information.
24. As the CEO, I want explicitly authorized drill-down to raw sources, so that sensitive detail is available only when the task genuinely requires it.
25. As the CEO, I want dashboard global search to exclude raw personal documents, messages, academic files, career files, and financial worksheets, so that convenient search does not erase Trust Domain boundaries.
26. As the CEO, I want Master Tasks to contain every operational Work Item, so that status does not diverge across executive task lists.
27. As the CEO, I want a CEO All Work view, so that I can see all Workstreams and accountable roles in one place.
28. As the COO, I want a Personal Life and Career Job Work View, so that I can manage those Workstreams without browsing unrelated raw context.
29. As the Personal CFO, I want a Finance Work View, so that financial tasks are distinct from financial source records.
30. As the CAO, I want an Academic Work View, so that academic commitments and progress are visible together.
31. As the CTO, I want a MicroSaaS Work View, so that application work, deployments, and project outcomes are coordinated.
32. As the CMO, I want a Content Creation Work View, so that content selection, research, production, and distribution work is coordinated.
33. As the CEO, I want the five existing Notion task databases backed up before migration, so that no task history is lost.
34. As the CEO, I want existing `Done` records mapped to Completed and ambiguous `Pending` or `To Do` records reconciled, so that migration does not invent false status.
35. As the CEO, I want the old task databases archived after cutover, so that I never maintain two writable task systems.
36. As an Executive Role, I want to edit a linked Work View and update the same Master Tasks record, so that familiar pages remain useful without duplication.
37. As the COO, I want to propose missing priorities and dates, so that incomplete tasks can enter a workable plan.
38. As the CEO, I want CEO-set priorities and deadlines locked, so that an agent cannot silently change my commitments.
39. As the CEO, I want external deadlines to retain their source and agent dates to be labelled as Proposed Commitments, so that confirmed commitments are distinguishable from estimates.
40. As an Executive Role, I want Work Items to move through Captured, Triaged, Planned, Awaiting Approval, Executing, Waiting/Blocked, Verifying, Ready for CEO Review, Completed, Changes Requested, and Cancelled, so that every role reports work consistently.
41. As the COO, I want Google Calendar to remain the calendar Source of Record behind Notion Calendar, so that Real-Ming reads and updates the calendar Ming actually uses.
42. As the COO, I want the morning brief to reconcile Google Calendar and Master Tasks, so that schedule conflicts and missing commitments are visible.
43. As the CEO, I want personal and opportunity email read and drafted but not sent without authority, so that assistance does not become unsupervised communication.
44. As the CAO, I want academic email and Microsoft Teams information read and drafted within the Academic Trust Domain, so that deadlines and actions can be coordinated safely.
45. As the COO, I want cross-domain email to produce limited action projections, so that coordination does not require universal mailbox access.
46. As the CEO, I want selected Notion pages and personal files curated manually in v1, so that I decide what Real-Ming may ingest.
47. As the CEO, I want every Personal Context item to retain source, authority, freshness, sensitivity, and allowed roles, so that agents can judge whether a fact is current and permitted.
48. As the CEO, I want stale Personal Context visibly labelled, so that old information is never presented as current fact.
49. As the CEO, I want selected always-on context encrypted in a Context Vault, so that cloud availability does not require placing raw personal files in Git.
50. As the CEO, I want Sensitive Secrets excluded from model context, tasks, outcomes, dashboards, and audit logs, so that credentials and payment material cannot leak through agent work.
51. As an Executive Role, I want only a role- and task-scoped Approved Projection, so that high-quality context does not imply access to an entire Trust Domain.
52. As an Executive Role, I want cited Project Evidence from Agent Brain through the Evidence Broker, so that project decisions are grounded in historical work without enabling global brain access.
53. As the CEO, I want Real-Ming to own the canonical Project Portfolio, so that repositories, deployments, evidence identities, responsibility, sensitivity, health, and Portfolio State are reconciled.
54. As the CTO, I want Remote-Ready Projects identified, so that cloud workers know which application work can continue while the Lenovo is offline.
55. As the CEO, I want Real-Ming reachable while the Lenovo sleeps or is powered off, so that I can issue cloud-capable work at any time.
56. As the CEO, I want Local-Only Work queued while the private worker is offline, so that the system does not fail or claim work it cannot perform.
57. As the CEO, I want the private worker to report capability and heartbeat state, so that I can distinguish offline work from failed work.
58. As the CEO, I want private-worker jobs to be bounded, leased, idempotent, and auditable, so that reconnects do not duplicate actions.
59. As the CEO, I want read, monitor, classify, summarize, and draft work to proceed automatically, so that low-risk assistance remains useful.
60. As the CEO, I want reversible low-risk actions to require an explicit Standing Authority policy, so that autonomy is defined rather than assumed.
61. As the CEO, I want external messages, production promotion, destructive actions, purchases, and permission changes to require Approval, so that consequential actions stay human-owned.
62. As the CEO, I want no Executive Role to perform Money Movement or brokerage trading, so that financial assistance never becomes transaction authority.
63. As the Personal CFO, I want read/write access to DuitSini subscription and payment-method metadata, so that billing records can be maintained without accessing bank credentials.
64. As the Personal CFO, I want Moomoo holdings ingested through export or a curated worksheet in v1, so that portfolio analysis does not expose trading capability.
65. As the Personal CFO, I want Realbyte Money Manager activity ingested through supported Excel export, so that income and expense analysis does not depend on iPhone UI automation.
66. As the Personal CFO, I want dated Financial Snapshot versions, so that corrections and monthly updates preserve every original workbook.
67. As the Personal CFO, I want to own financial meaning, reconciliation, and validation, so that technical workbook changes do not silently change financial facts.
68. As the CTO, I want to maintain workbook formulas, imports, and automation, so that financial tooling is reliable without transferring financial accountability.
69. As the CEO, I want CFO validation before reviewing a CTO-prepared Financial Snapshot, so that the review package has both technical and financial verification.
70. As the CAO, I want academic calendar and Master Tasks access to be read/write, so that plans and commitments remain current.
71. As the CAO, I want Canvas course files and announcements available read-only, so that academic planning is informed without submitting work on Ming's behalf.
72. As the CEO, I want academic submission excluded, so that Real-Ming assists learning without becoming a student proxy.
73. As the CMO, I want the existing content-creation workflow treated as an authoritative project source, so that Real-Ming coordinates rather than reinvents the workflow.
74. As the COO, I want current career facts to come from the authoritative career files, so that application claims cannot be invented from agent memory.
75. As the COO, I want career Project Evidence restricted and cited, so that historical job-search context is useful without exposing personal records to unrelated roles.
76. As the CTO, I want a GitHub Repository Center, so that repositories, branches, pull requests, checks, reviews, releases, and incidents are visible by Portfolio Project.
77. As the CTO, I want Git state and lineage monitoring, so that branch heads, divergence, tags, and deployment associations are explainable.
78. As the CTO, I want Vercel preview and production deployments associated with exact commits, so that the running artifact can be traced to source.
79. As the CEO, I want dashboard and Telegram production controls to approve only a verified Deployment Candidate, so that there is no arbitrary deploy-latest action.
80. As the CEO, I want the first MicroSaaS pilot to use DuitSini, so that the workflow proves value on a real production application with pending work.
81. As the CTO, I want every DuitSini pilot change implemented on a task branch with tests, a draft pull request, and a preview, so that unattended engineering stops before production authority.
82. As the CEO, I want preview and test evidence to exclude production financial metadata, so that the pilot does not leak sensitive records.
83. As the CEO, I want database migrations and production-data changes approved separately from code promotion, so that one Approval cannot hide multiple risk classes.
84. As the CEO, I want production verification and a final Outcome Report after promotion, so that a merged change is not treated as successful until the live outcome is checked.
85. As the CEO, I want Metered Platform Cost grouped by project, provider, model, and period where available, so that API and cloud spending is attributable.
86. As the CEO, I want every cost observation to show its source and `as of` time, so that delayed provider billing is not presented as real-time fact.
87. As the CEO, I want a global RM250 monthly Metered Platform Cost cap with approved provider and project budgets, so that agent operations remain economically bounded.
88. As the CEO, I want agent-tool plans and other Recurring Subscriptions excluded from dashboard cost analytics, so that DuitSini remains their sole Source of Record.
89. As the CEO, I want every scheduler and recurring job inventoried with expected cadence, last heartbeat, last success, next expected run, duration, and failure count, so that silent automation failures are detectable.
90. As the CEO, I want one missed critical Scheduler Heartbeat to trigger an Exception Notice, so that critical operations fail loudly.
91. As the CEO, I want routine schedulers to alert only after two consecutive failures, so that transient errors do not create notification noise.
92. As the CEO, I want repeated identical errors grouped and recovered jobs reported once, so that Telegram remains readable.
93. As the CEO, I want raw ingestion staging deleted after verified ingestion, so that temporary copies do not become permanent archives.
94. As the CEO, I want active projections, superseded projections, Financial Snapshots, Approvals, Outcome Reports, and audit events retained according to the confirmed policy, so that history is useful without retaining all raw inputs indefinitely.
95. As a future workspace owner, I want every record to carry actor and workspace ownership from v1, so that later multi-user productization does not require untangling global data.
96. As the CEO, I want the system to degrade visibly when a provider is unavailable or stale, so that missing data is never silently treated as an empty or healthy source.
97. As the CEO, I want retries to be idempotent and bounded, so that provider failures cannot duplicate Work Items, messages, database changes, or deployments.
98. As the CEO, I want model routing to use an adequate cost-conscious provider while respecting sensitivity policy, so that quality, privacy, and the Metered Platform Cost cap are balanced.
99. As the CEO, I want persistent agent knowledge compiled into cited, versioned Markdown, so that research and operations accumulate without replacing authoritative providers.
100. As the CEO, I want the Knowledge Vault isolated into Personal, Ming Creatives, Academic, Entertainment, and Finance roots plus a CEO projection root, so that persistent knowledge does not erase Trust Domain boundaries.
101. As an Executive Role, I want Compiled Knowledge served through the Projection Broker for my current Work Item, so that useful history does not grant direct filesystem or cross-domain access.
102. As the CEO, I want every compiled claim linked to a Candidate Envelope or cited Project Evidence with source, hash, `as of` time, sensitivity, allowed roles, and retention, so that derived knowledge remains explainable and refreshable.
103. As the CEO, I want contradictions quarantined and derived pages superseded through versioned publication, so that an LLM cannot silently choose a convenient truth or erase history.
104. As the CEO, I want Hermes scheduled jobs to ingest, query, file useful outputs, and lint the Knowledge Vault without converting daily notes or chats automatically into stable facts.
105. As the CEO, I want Hermes native memory and session continuity to remain Hermes-owned and governed by its native behavior, while Sources of Record remain authoritative and Real-Ming never overrides or bulk-fills that memory, so that the integration layer cannot degrade native continuity or turn it into a universal cross-domain archive.
106. As the CEO, I want Obsidian to display the Knowledge Vault while the encrypted filesystem, brokers, and policy engine enforce durability and access, so that the viewer is not mistaken for the security boundary.
107. As the CEO, I want only explicitly saved or deliberately marked durable knowledge selected for wiki consolidation, so that ordinary Hermes conversation and native memory remain unaffected.
108. As the CEO, I want an explicit wiki-forget request to suppress intake and supported retrieval promptly, retire active generated pages, and remain distinct from native memory housekeeping.
109. As the CEO, I want published claims checked against readable source evidence and an appropriate freshness policy, so that a matching hash is not mistaken for truth or currency.
110. As the CEO, I want registry state and generated files reconciled after a crash, so that no incomplete generation is presented as published knowledge.
111. As the CEO, I want consolidation resource limits and failure isolation, so that normal Telegram turns and native Hermes memory retain their quality while the optional job runs.

## Implementation Decisions

### System composition and module boundaries

- Hermes is the product runtime. Its native gateway, agent loop, tools, skills, plugins, MCP servers, memory, cron and durable task board are configured rather than replaced. Real-Ming adds durable work coordination, Master Tasks semantics, policy and Approval contracts, projection, audit and CEO surfaces as an additive extension, never as a second agent core and never as a mandatory pre-model gate.
- One Telegram turn is `Ming → native Hermes gateway → native Hermes agent loop → native tools, skills and plugins, calling the Real-Ming integration when useful → native reply`. There is no mandatory turn envelope, no second Telegram consumer, and no Real-Ming rewriting of Hermes's answer. Ordinary conversation creates no Work Item, requires no role-selection ceremony, and does not depend on a Real-Ming record operation; when an optional integration fails, the operation reports that failure and the conversation continues.
- The system is divided into an Identity and Command Gateway, Executive Role Registry, Work Orchestrator, Policy and Approval Engine, Master Tasks integration, Source Connector layer, Context Vault, Knowledge Vault and Projection Broker, Evidence Broker, Project Portfolio, Worker Coordinator, Outcome and Audit service, Operations Read Model, dashboard, and notification service.
- External providers are accessed through explicit adapters. Provider-specific payloads do not leak into the Work Orchestrator; adapters normalize provenance, freshness, capabilities, success, retryability, denial, and failure.
- V1 is single-user-first, but every durable record carries an actor identity and workspace identity. Public signup, billing, and generalized role administration are deferred.

### Identity, commands, and Executive Roles

- Telegram accepts commands only from the CEO's allowlisted numeric Telegram identity, enforced by the native gateway's allowlist. Dashboard access is authenticated and resolves to the same CEO actor.
- The COO is the default perspective. Explicit role addressing selects the named Executive Role without passing authority through the COO. Hermes interprets the role address conversationally through Ming's role playbooks; it is never handled by a parser that bypasses the agent loop.
- A role playbook expresses behaviour and is not access control. Restrictions on consequential actions are enforced by narrowed credentials and tested tool boundaries on the actual execution path, or the effect is left unavailable.
- A command classifier distinguishes information questions, clear action requests, ambiguous requests, and multi-step/asynchronous work. Only actionable work creates a Work Item; ambiguity produces one focused clarification.
- Executive Role definitions are durable policy records containing responsibility, allowed Trust Domains, allowed Project Evidence, Standing Authority, notification rules, and Work Views. Worker processes are ephemeral executions of those roles.
- Every Work Item has one Accountable Executive. Collaborating Executives receive bounded sub-work or projections and cannot independently complete or approve the parent outcome.

### Work model and Master Tasks

- Master Tasks is the canonical Notion data source for operational Work Items and supplies six linked Work Views: CEO All Work plus COO, Personal CFO, CAO, CTO, and CMO views.
- The five migration sources are Content Creation, MicroSaaS, Academic, Job and Life, and Finance task databases. They remain writable until a backed-up, reconciled cutover; afterward they are archived read-only.
- Work Item data includes stable identity, workspace, source and source reference, title, intent, Trust Domain, Workstream, Accountable Executive, Collaborating Executives, status, priority, commitment value and provenance, risk class, Approval requirement, Portfolio Project, timestamps, evidence references, and Outcome Report reference.
- The canonical lifecycle is Captured, Triaged, Planned, Awaiting Approval, Executing, Waiting/Blocked, Verifying, Ready for CEO Review, Completed, Changes Requested, and Cancelled.
- Migration maps only unambiguous `Done` records directly to Completed. `Pending`, `To Do`, empty, or custom statuses require reconciliation.
- CEO-set commitments are immutable except through CEO action. Externally sourced commitments retain provenance. Agent-generated priority or timing is stored as a Proposed Commitment until authorized.
- All state transitions create audit events. Transition guards enforce required evidence, Approval, or Outcome Report fields rather than relying on UI convention.

### Approval and authority

- The Policy and Approval Engine evaluates actor, Executive Role, current Work Item, Trust Domain, source capability, action, reversibility, risk, Standing Authority, and target artifact.
- Read, monitor, classify, summarize, and draft operations are the automatic baseline. Reversible low-risk writes require a matching Standing Authority. All other consequential writes stop at Awaiting Approval.
- An Approval records the CEO actor, action scope, target type, stable target identity, immutable version or digest, risk class, request time, decision time, expiration, and resulting action state.
- A changed target invalidates its Approval. A production Approval references repository, pull request, and exact commit. A message Approval references the exact content and recipient. A Financial Snapshot Approval references the exact successor version.
- Code promotion, database migration, production-data change, external communication, destructive action, permission change, purchase, and financial Record Change are distinct Approval scopes and cannot be bundled implicitly.
- Money Movement and brokerage trading have no grantable v1 capability. Credentials, recovery material, card details, brokerage transaction passwords, and identity documents are Sensitive Secrets and never enter normal agent context.

### Personal Context, Trust Domains, Project Evidence, and Compiled Knowledge

- The Personal Context Package is a CEO-curated ingestion allowlist. Each entry records source, authority, `as of` time, sensitivity, Trust Domain, permitted roles, and supersession.
- Version control stores schemas, policies, manifests, and redacted projections. Raw staging is excluded from Git. Selected always-on context is encrypted in the Context Vault.
- The Projection Broker releases the minimum approved slice for the current Executive Role and Work Item. Cross-domain summaries are Approved Projections, not shared raw memory.
- Personal, Ming Creatives, Academic, Entertainment, and Finance are separate Trust Domains. Dashboard search and general Executive context use projections by default.
- Agent Brain remains Project Evidence. The Evidence Broker requires a workspace, Executive Role, Work Item purpose, and allowed Portfolio Project, and returns cited project-scoped results.
- The optional advanced Knowledge Vault path is one logical encrypted and versioned Markdown service with isolated Personal, Ming Creatives, Academic, Entertainment, and Finance roots plus a CEO root containing only Approved Projections. Storage follows Trust Domains; Executive Roles are scoped views and do not define vault boundaries. This stronger path is not the default native-first consolidation route.
- Each Candidate Envelope records source system, stable source reference, captured and `as of` times, content hash, sensitivity, allowed roles, retention class, and a bounded snapshot or pointer. Sensitive Secrets are rejected before compilation.
- The optional advanced Knowledge Compiler follows the LLM Wiki raw/schema/wiki discipline and supports ingest, query, filing useful outputs, index maintenance, append-only logging, contradiction quarantine, linting, and atomic versioned publication. Its production caller remains separately gated.
- The post-RM-40 selective consolidation design uses a native Hermes cron job and native LLM-Wiki/Obsidian skills. It processes only explicit or deliberately marked candidates; it does not intercept ordinary turns, scan every session, or reinterpret native memory deletion.
- A minimal Real-Ming registry may enforce candidate fingerprints, bounded envelopes, source-reference/hash checks, source-specific freshness profiles, one-run leases, tombstones, generation manifests and crash reconciliation. It stores coordination metadata, not a second memory corpus.
- The deterministic `activate_generation` operation is the sole publication authority: immutable generations are complete snapshots containing their pages, `index.md`, `log.md`, and manifest; a later run carries forward still-valid pages before merging new candidates; the registry's single active-generation reference is what readers trust. `wiki_retrieve` fails closed on registry, manifest, freshness, tombstone, path, or hash mismatch, while ordinary Hermes chat continues.
- Explicit wiki forgetting writes a tombstone before new intake, suppresses the supported retrieval index, retires active generated pages, and aborts in-flight publication. Local `suppressed` is distinct from `head_sync_pending`, `restore_safe` and `cleanup-complete`; restore-safe status requires an independent tombstone-head append and exact read-back, and restore fails closed when a pending local entry is not covered. Native Hermes memory remains independently owned. Arbitrary shell reads of still-present plaintext files are outside the hard security boundary unless a future encrypted brokered store is separately approved.
- Compiled Knowledge is derived and rebuildable. It may supersede a prior wiki generation but may never write to a Source of Record, rewrite canonical Agent Brain evidence, edit Agent Brain-generated projections, or silently become a personal, career, financial, academic, or project fact.
- The optional advanced Projection Broker releases Compiled Knowledge only for the current Executive Role, Work Item, purpose, and allowed Trust Domains. CTO and CMO receive distinct views over Ming Creatives; Entertainment remains isolated even without a dedicated Executive Role. Native-first generated wiki retrieval instead uses its bounded active-generation contract.
- Native Hermes memory and session search are first-class stores holding Ming's stable preferences, routing conventions, project pointers and conversational continuity. Sources of Record stay authoritative: native memory never becomes the authoritative record for a task, commitment, financial figure or academic obligation. Sensitive Secrets are excluded, and domain corpora, raw inbox bodies, financial exports, academic files and Agent Brain payloads are not written wholesale into it.
- The Knowledge Vault contracts in this section — Candidate Envelope provenance, contradiction quarantine, versioned publication, `index.md`, append-only `log.md`, linting and Trust-Domain projection — are retained as optional stronger guarantees. Default persistent knowledge uses the native Obsidian and LLM Wiki workflow over an absolute vault path plus the reviewed selective-consolidation design's bounded registry and `wiki_retrieve` gate; Tasks 0–8 of that follow-on design are controlled-tested, but there is no production caller or active cron row. A retained guarantee must be wired to a real production caller and proven end to end before it is claimed.
- The selective consolidation cron uses a native script-only trigger whose wrapper starts the pinned Hermes `AIAgent` with `skip_memory=True` and a pinned `tools.include` set exactly containing `real_ming_knowledge_list_candidates`, `real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation` and `real_ming_wiki_retrieve`; deliberate capture is interactive-only and `activate_generation` remains a local deterministic operation. A dedicated Hermes home, staging work directory, and OS permissions keep native memory/profile files, configuration, skills/plugins, cron state, credentials, unrelated paths, and unrestricted shell writes unavailable. The exact controls are a pinned-runtime preflight gate; if they are absent, an extra callable is registered, or the full default toolset resolves, activation is not eligible. Task 0 uses a fake/local model boundary with networking and credentials removed; a later authorized one-shot may mount only a named Hermes auth profile read-only. The job's own session record is allowed. The Azure-hosted vault is canonical; a future local Obsidian mirror is optional, one-way, activation-triggered and read-only, cannot synchronize local edits upstream, cannot serve `wiki_retrieve`, and cannot become a runtime dependency. Mirror transport/deployment requires a separate post-live-acceptance plan.
- Obsidian is the CEO-facing IDE over the Markdown roots. Where a retained vault guarantee is active, the durable encrypted filesystem, versioned publication, backups, policy engine, and brokers—not Obsidian—provide persistence and access control. Exactly one writer owns each output path; a generated projection never overwrites native editable notes.
- The Project Portfolio records Portfolio State, repository, production branch, deployment identifiers, evidence identity, responsible roles, sensitivity, health, Remote-Ready status, and relevant source links.

### Hybrid execution and workers

- The always-on control plane handles Telegram, schedules, durable workflow state, cloud APIs, cloud-accessible repositories, monitoring, and Remote-Ready Projects.
- The Lenovo private worker advertises capabilities and heartbeat state. Jobs requiring local files, existing browser sessions, Windows-only tools, local credentials, or sensitive processing are Local-Only Work.
- A worker job contains a stable idempotency key, Work Item, required capability, bounded action, source references rather than copied secrets, lease, deadline, retry policy, and expected evidence.
- Offline Local-Only Work remains Waiting/Blocked with an explicit offline reason. Reconnection permits safe lease acquisition and resumption without duplicate execution.
- Job output is untrusted until verified by the Work Orchestrator. Worker completion alone does not make work Review-Ready.

### Daily Operations Loop

- The first tracer integrates the private Telegram front door, Google Calendar, five Notion task sources migrated to Master Tasks, Work Views, morning brief, task routing and write-back, evening roll-up, Approval, and audit.
- Google Calendar is the calendar Source of Record. Notion Calendar remains Ming's viewing client rather than a separate event source.
- Morning briefs run at 07:30 Asia/Kuala_Lumpur and reconcile scheduled commitments, overdue or blocked Work Items, pending Approvals, incidents, and Proposed Commitments.
- Evening Executive Roll-Ups run at 21:30 and summarize verified outcomes, outstanding risks, changes requested, pending Approvals, and next priorities.
- Do-not-disturb runs from 23:00 to 07:00. Only critical incidents and explicitly urgent Approval deadlines may bypass it. Weekend schedules are lighter.
- Email is added after the core tracer is reliable. Personal and academic email begin read-and-draft; sends remain separately authorized. Entertainment/application mail is digest-only, and future business mail is connected after the identity exists.

### Dashboard and operations monitoring

- The dashboard is an authenticated operations read model, not a second work database. Telegram remains the primary command surface.
- CEO areas include overview, Master Tasks and Work Views, Approvals, Outcome Reports, Executive state, Project Portfolio, integration and worker health, Metered Platform Cost, scheduler health, and audit.
- The GitHub Repository Center reports repository identity, production branch, open work branches, pull requests, checks, reviews, releases, and incident links.
- Git lineage reports exact commit heads, ahead/behind and divergence, tags, deployment association, and private-worker dirty state when available.
- Vercel monitoring associates preview and production deployments with environment, domain, status, exact commit, verification evidence, and rollback candidate.
- Dashboard production control is `Approve Promotion` for one verified Deployment Candidate. There is no arbitrary deploy-latest or direct production-branch control.
- Metered Platform Cost observations contain workspace, Portfolio Project, provider, service or model, period, amount, currency, source, `as of` time, and quality indicator such as provider-reported, estimated, stale, or unavailable.
- The global monthly Metered Platform Cost cap is RM250. Provider and project budgets are proposals until CEO-approved. Recurring Subscriptions and paid agent-tool plans remain exclusively in DuitSini.
- Scheduler monitoring records expected cadence, criticality, last Scheduler Heartbeat, last success, next expected run, duration, failure streak, accountable role, and evidence link.
- Knowledge health reports per-domain ingest, compile, publish, and lint state, candidate backlog, quarantined conflicts, stale pages, failed citations, and current generation identity without exposing raw notes in dashboard search or logs.
- One critical missed or failed heartbeat triggers an Exception Notice. Routine jobs trigger after two consecutive failures. Repeated identical errors are grouped, and recovery produces one notice.
- A selective consolidation run is bounded to one active lease, a configured candidate count, wall-clock budget and retry limit. Its failure is recorded and retried without failing an ordinary native Telegram turn. Its default delivery is operational health, not a generated-page dump.

### Domain-specific integrations

- DuitSini is authoritative for subscriptions, renewal schedules, bills, payment-method labels, and Recurring Subscriptions. The Personal CFO may perform approved Record Changes; no bank login or payment execution is introduced.
- Moomoo v1 uses export or a curated holdings worksheet. Direct OpenD connectivity is deferred and, if later approved, must run on a dedicated private read-only node without a transaction password.
- Realbyte Money Manager v1 uses its supported Excel export. iOS UI automation is excluded.
- Financial Snapshots are immutable, dated versions. The Personal CFO owns meaning and validation; the CTO owns formulas, imports, and automation. A CTO-prepared version requires CFO validation and CEO Approval.
- Academic calendar and Master Tasks are read/write. Academic Microsoft 365 email, Teams, and files are read-and-draft. Canvas is read-only for course files and announcements. Submission is excluded.
- The existing content-creation project remains the authoritative workflow for CMO operations. The CMO receives its direct source and allowed Project Evidence rather than a duplicated workflow in Real-Ming.
- Career facts and application claims come from authoritative career files. Agent memory and Project Evidence require source provenance before becoming user-facing claims.

### MicroSaaS Operations Loop and DuitSini pilot

- The first application pilot is DuitSini because it has a real CEO-selected update, an existing production deployment, and existing Project Evidence.
- The CTO synchronizes the current production branch, creates a bounded task branch, implements and tests the update, pushes the branch, opens a draft pull request, verifies the Vercel preview, and creates an Outcome Report.
- Preview verification uses mock, staging, synthetic, or redacted data and must not emit production finance-adjacent metadata into logs or evidence.
- A Deployment Candidate exists only when the exact commit has completed required checks and its preview has been verified against the Work Item's acceptance evidence.
- CEO Approval permits merge and promotion only for that Deployment Candidate. Direct production pushes and direct production deployments are excluded.
- Database migrations or production-data changes require their own plan, evidence, backup or rollback strategy, and Approval even when associated code is already approved.
- Production success requires live verification and a final Outcome Report. A merge or Vercel success state alone is insufficient.
- The exact first DuitSini product update is captured as the first implementation Work Item and does not alter this umbrella architecture.

### Retention, reliability, and model policy

- Verified raw ingestion staging is deleted after 30 days. Current projections remain while active. Superseded personal projections remain for 12 months. Financial Snapshots, CEO Approvals, Outcome Reports, and audit events are retained indefinitely in v1.
- Deleted Context Vault data ages out of backups within 30 days. Sensitive Secrets are never retained in work or audit records.
- Commands, provider events, worker jobs, writes, notifications, and promotions use stable idempotency keys. Retries are bounded, classified, and visible.
- Provider unavailability, stale data, missing permission, and unsupported capability are distinct states. None may be represented as an empty healthy response.
- Model routing chooses an adequate model under sensitivity, capability, quality, latency, and Metered Platform Cost policy. Raw high-sensitivity context is minimized or retained on the private worker.
- Routine operational events remain in dashboard history and the Executive Roll-Up. Exception Notices are deduplicated and rate-limited without hiding distinct critical failures.
- Knowledge Compiler jobs are scheduled only after scheduler health and recovery are available. They explicitly load their schema, index, Work Item purpose, and allowed roots rather than relying on prior-session Hot Runtime Memory.
- Verified raw candidate payloads become purge-eligible after 30 days unless a stricter domain policy applies. Provenance identifiers, hashes, tombstones, and purge evidence remain append-only without retaining the sensitive payload; compiled generations and backups follow Trust Domain deletion and supersession policy.

### Architecture Revision 6 composition delta

Revision 6 changes how the system is composed, not what it must achieve. Every
outcome, authority boundary, Source of Record and exclusion above is retained.
The table records exactly which Revision 5 clauses were replaced, so that
completed Revision 5 work and its evidence stay legible instead of silently
becoming wrong.

| Revision 5 clause | Revision 6 replacement | Why |
| --- | --- | --- |
| Real-Ming ingress owns the Telegram poller | The native Hermes gateway is the single Telegram consumer | The wrapper lost native typing, formatting, progress and attachment behaviour |
| Every turn carries a structured Turn Plan the integration validates | No turn envelope; structured arguments apply to real tool operations only | The envelope forced ordinary chat through a machine contract and degraded readability |
| Real-Ming selects the Executive Role and delivers a verified answer | Hermes interprets the perspective through role playbooks and answers natively | Role selection is interpretation, not governance |
| Role-prefixed messages route through the command parser | Role-prefixed messages reach the agent loop like any other message | The parser bypassed Hermes entirely, contradicting the Hermes-first decision |
| Hermes native memory is bounded Hot Runtime Memory requiring write Approval | Native memory and session search are first-class under the ADR-0020 memory policy | Continuity is a product requirement; Sources of Record still hold authority |
| The encrypted versioned Knowledge Vault is the default persistent-knowledge path | Native Obsidian and LLM Wiki are the default; vault guarantees are retained as optional and activated per demonstrated need | The stronger guarantees were never production-wired; the default path must actually produce readable notes |
| A separate Real-Ming console is the CEO surface | The native dashboard is the starting point; add only the missing CEO cross-app views | A second dashboard is an option, not a prerequisite |

The one-consumer, one-scheduler-owner, one-authoritative-field and
one-published-output invariants survive unchanged. Only their owners move.

Revision 5 code, tests and evidence remain valid within their recorded scope
and are relabelled rather than deleted. A passing Revision 5 harness scenario
is not evidence of Revision 6 behaviour.

## Testing Decisions

### Testing philosophy

- Tests assert externally observable behaviour at the highest stable boundary. They do not lock internal class structure, prompt wording, private helper functions, or vendor payload details outside adapter contracts.
- The implementation introduces only two primary testing seams: the Real-Ming System Harness and the Provider Adapter Contract Harness.
- The primary acceptance evidence is the resulting Work Item state, authorized provider effect, Approved Projection, Outcome Report, notification, and audit trail—not internal agent reasoning.
- No default test may require a real credential, contact an external provider, spend API quota, mutate production data, or expose a Sensitive Secret.

### Seam 1: Real-Ming System Harness

- The harness submits normalized CEO commands, dashboard actions, scheduled events, source events, and worker events through the same Operations Gateway used by production surfaces.
- It runs the real identity, role routing, Work Orchestrator, Policy and Approval Engine, durable state, read models, notifications, and audit against an isolated test workspace with controlled provider and worker fakes.
- System scenarios cover direct questions without Work Items, action capture, ambiguous clarification, one Accountable Executive, collaboration, lifecycle guards, Proposed Commitments, calendar/task reconciliation, morning brief, evening roll-up, do-not-disturb, grouped exceptions, recovery notices, Candidate Envelope compilation, versioned wiki publication, contradiction quarantine, scoped knowledge retrieval, and denied cross-domain lookup.
- Authority scenarios cover allowed reads, Standing Authority, denied cross-domain access, redacted dashboard projections, secret exclusion, exact-target Approval, changed-target invalidation, changes requested, cancellation, and disallowed Money Movement.
- Hybrid scenarios cover an online private worker, offline queueing, expired leases, retry after reconnect, duplicate delivery, verification failure, and worker output that cannot complete a Work Item without an Outcome Report.
- MicroSaaS scenarios cover branch creation, checks, preview verification, Deployment Candidate creation, stale commit Approval rejection, separately scoped migration Approval, production promotion, failed verification, rollback candidate presentation, and final Outcome Report.
- Dashboard scenarios use the highest browser/API boundary necessary to prove that CEO projections, Work Views, Approvals, portfolio health, costs, scheduler state, and sensitive drill-down rules match the underlying operations state.

### Seam 2: Provider Adapter Contract Harness

- One parameterized contract suite is applied to Telegram, Notion, Google Calendar, email, Agent Brain, GitHub, Git, Vercel, Metered Platform Cost providers, scheduler sources, Context Vault and Knowledge Vault storage, and the private worker protocol as each adapter is added.
- Every adapter proves capability discovery, authentication failure handling, input validation, normalized identity, provenance, `as of` time, idempotent write behaviour, retry classification, rate-limit handling, redaction, secret-safe errors, and stale/unavailable signalling.
- Read/write adapters prove that a retry cannot duplicate an external effect. Read-only adapters prove that unsupported writes are rejected locally before a provider call.
- Live smoke tests are opt-in, isolated, self-cleaning where possible, and skipped unless both an explicit run flag and securely supplied credentials exist.
- Provider billing and usage contract tests distinguish provider-reported, estimated, stale, and unavailable observations and never mix Recurring Subscriptions into Metered Platform Cost.

### Prior art and verification gates

- DuitSini supplies prior art for Node-based Vitest contract tests, stubbed global provider calls, provider-neutral adapters, secret-safe assertions, a mock-versus-production repository boundary, deterministic local persistence tests, and explicit opt-in live smoke tests.
- The Real-Ming implementation should preserve the same safety posture: local contract tests run without network or billable requests, while live verification is deliberate and separately identifiable.
- Each change must pass type checking, automated behavioural tests, secret/error scans appropriate to the changed adapters, and a production-equivalent build before becoming a Deployment Candidate.
- Knowledge tests use deterministic source fixtures and prove source identity, support dispositions, citations, conflict handling, one-owner generation activation, `index.md`, append-only `log.md`, lint findings, retention, path containment, and the prohibition on direct source or Agent Brain writes.
- The selective-consolidation tests additionally prove ordinary-turn non-interception, candidate admission and deduplication, source-support versus hash-only evidence, claim freshness at publication and retrieval, one-owner activation, path/symlink containment, immediate forget suppression across the supported retrieval path and in-flight publication, expired-worker fencing, derived-page suppression, old-backup restore handling, authored-note preservation, bounded resource use, job-local native-memory/config noninterference without freezing legitimate concurrent native learning, registry/file crash reconciliation, and fail-closed registry outage behavior. These are controlled implementation evidence for Tasks 0–8, not RM-40 live-acceptance or production-wiring evidence.
- Tracer 1 passes only when the CEO can submit work through Telegram, see the same Work Item in the correct Work View, receive the scheduled brief and roll-up, exercise an artifact-bound Approval, and inspect a complete audit trail without raw cross-domain leakage.
- Tracer 2 passes only when one bounded DuitSini update travels from CEO request to verified preview, exact-commit Approval, merge, production verification, and final Outcome Report without production-data leakage or unapproved migration effects.

## Out of Scope

- Public signup, customer billing, organizations, team invitations, generalized RBAC administration, or a multi-user product interface.
- Five separate Telegram bots or continuously running LLM loops for the five Executive Roles.
- A universal agent with unrestricted credentials, Project Evidence, personal context, or cross-domain memory.
- A single flat Obsidian vault available directly to every Executive Role, treating Obsidian as an access-control system, or treating Hermes native memory as the authoritative record for a task, commitment, financial figure or academic obligation.
- A second Telegram consumer for the same bot, a mandatory turn envelope on ordinary conversation, or a Real-Ming layer that rewrites Hermes's final answer.
- Raw chat, inbox, financial, academic, filesystem, or Agent Brain dumps promoted directly into Compiled Knowledge or Hot Runtime Memory.
- Replacing Google Calendar, Notion, email providers, finance applications, project databases, GitHub, Vercel, career files, content workflows, or Agent Brain as Sources of Record.
- Indiscriminate ingestion of the entire Notion workspace, entire email history, all local files, or every Agent Brain project.
- Storing raw personal files, credentials, recovery codes, complete payment-card details, brokerage transaction passwords, or identity documents in Git.
- Money Movement, bank transfers, card charges, purchases without Approval, brokerage order placement, or trade modification.
- Direct Moomoo OpenD connectivity in v1, even in read-only mode.
- iOS UI automation for Money Manager or Moomoo.
- Academic assignment or examination submission, impersonation, or unsupervised external academic communication.
- Arbitrary direct pushes to a production branch, direct `vercel --prod` deployment, deploy-latest controls, or self-approved production promotion.
- Treating a successful merge or provider deployment status as proof of a successful user outcome.
- Keeping the five legacy Notion task databases as parallel writable systems after Master Tasks cutover.
- Displaying paid agent-tool subscriptions or other Recurring Subscriptions in Real-Ming Metered Platform Cost analytics.
- Guaranteeing local-file, local-browser, or Windows-only execution while the Lenovo private worker is offline.
- Selecting the exact first DuitSini product change, cloud hosting vendor, model-provider allocation, credentials, or provider-specific budgets in this umbrella specification.
- Registering additional Agent Brain projects as part of specification publication.

## Further Notes

- Rollout is tracer-first. The Daily Operations Loop is implemented and proven before email, finance-source ingestion, or application-code execution is broadened. The DuitSini MicroSaaS Operations Loop is the second tracer.
- The exact first DuitSini update, selected Personal Context files, allowlisted Notion page identifiers, connector credentials, provider inventories, and provider/project budgets are operational inputs captured by later Work Items or tickets.
- Evidence-enablement candidates are the content-creation workflow, Agent Brain dashboard, personal portfolio, career operations, and Real-Ming itself. Registration is staged separately, followed by service restart, health and storage inspection, and a cited-query check.
- Real-Ming is a new implementation repository. Its glossary, ADRs, discovery records, and this specification are the current authoritative design baseline.
- Phase 3 decomposes this umbrella specification into tracer-bullet tickets with explicit blocking edges, including the Knowledge Vault foundation. Implementation must not treat this single specification issue as one monolithic coding task.
