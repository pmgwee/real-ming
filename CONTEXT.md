# Real-Ming

Real-Ming is Ming's private personal-operations umbrella: the language shared by the human CEO and the agents that coordinate daily life and Ming Creatives. It distinguishes authoritative records, derived context, delegated work, and decisions that remain human-owned.

## Organization

**Real-Ming**:
The private umbrella under which Ming coordinates personal, business, academic, and entertainment responsibilities.
_Avoid_: Ming Creatives, Real-Me, company

**Ming Creatives**:
Ming's owned-business domain for application projects, commercial opportunities, and content operations within Real-Ming.
_Avoid_: Real-Ming, personal life, holding company

**Executive Role**:
A durable, bounded delegation identity with a defined responsibility and authority that becomes active only when work requires it.
_Avoid_: Always-on agent, persona, chatbot

**Chief Operating Officer**:
The Executive Role that coordinates Real-Ming's daily portfolio and routes work without inheriting another executive's authority.
_Avoid_: Super-agent, chief approver, universal worker

**Chief Technology Officer**:
The Executive Role acting as Ming's product engineer and accountable for MicroSaaS application engineering, product implementation, and technical operations within Ming Creatives.
_Avoid_: Coding bot, developer mode, DevOps agent

**Personal Chief Financial Officer**:
The Executive Role acting as Ming's financial, accounting, wealth, and asset-management advisor; it owns financial meaning and validation, may propose or perform approved record changes, and never initiates Money Movement.
_Avoid_: Payment agent, trader, Ming Creatives accountant

**Chief Academic Officer**:
The Executive Role accountable for Ming's academic commitments, progress, and study outcomes.
_Avoid_: Professor, tutor bot, student proxy

**Chief Marketing Officer**:
The Executive Role accountable for Ming Creatives' content strategy, production portfolio, and distribution outcomes.
_Avoid_: Caption writer, social bot, content mode

## Authority

**CEO**:
Ming, the sole human authority for the internal system, who reviews outcomes and grants or withholds approval. Future members do not share this authority merely by gaining access.
_Avoid_: End user, admin, owner

**Approval**:
An explicit CEO decision authorizing one bounded action, plan, or exact artifact version whose authority has not already been granted.
_Avoid_: Confirmation, acknowledgement, consent

**Standing Authority**:
A revocable CEO policy that pre-authorizes a defined class of reversible, low-risk actions within stated limits.
_Avoid_: Autonomy, blanket permission, full access

## Information

**Source of Record**:
The external domain system whose current record is authoritative; Real-Ming may reference or derive context from it but does not replace it.
_Avoid_: Master database, copied source, central truth store

**Candidate Envelope**:
An immutable, provenance-bearing input to knowledge compilation that records the source identity, source reference, capture and `as of` times, content hash, Trust Domain, sensitivity, allowed roles, retention class, and either a bounded snapshot or a pointer to the Source of Record.
_Avoid_: Memory dump, imported truth, whole-source copy

**Compiled Knowledge**:
Cited, derived Markdown produced from validated Candidate Envelopes; it may be regenerated or superseded but never silently overrides a Source of Record or canonical evidence.
_Avoid_: Source of Record, raw memory, model belief

**Knowledge Vault**:
The encrypted, versioned, Obsidian-compatible Markdown knowledge service containing separate Personal, Ming Creatives, Academic, Entertainment, and Finance roots plus a CEO Approved-Projection root.
_Avoid_: Universal memory, flat shared vault, Obsidian database, Source of Record

**Knowledge Compiler**:
The governed LLM Wiki pipeline that ingests Candidate Envelopes, reconciles conflicts, emits cited Compiled Knowledge, updates indexes and logs, lints the result, and publishes a new version atomically.
_Avoid_: Memory writer, source synchronizer, automatic truth promoter

**Hot Runtime Memory**:
The deliberately small, write-gated Hermes memory or generated role brief loaded for execution convenience; it contains stable routing preferences and pointers, not domain corpora or authoritative facts.
_Avoid_: Knowledge Vault, chat dump, durable personal memory

**Personal Context**:
Provenance-linked facts, preferences, policies, and summaries used to assist Ming without superseding their Sources of Record.
_Avoid_: Data dump, complete profile, raw archive

**Personal Context Package**:
The CEO-curated, manifest-backed set of files and source references that Real-Ming is allowed to ingest as Personal Context.
_Avoid_: Personal-information dump, whole Notion workspace, duplicate source of truth

**Context Vault**:
The encrypted always-on store for selected Personal Context that cloud agents may retrieve only through role- and task-scoped projections.
_Avoid_: Git repository, shared folder, secret vault, whole-document prompt

**Financial Snapshot**:
An immutable, dated workbook version that reconciles selected financial Sources of Record into a reviewable aggregate; corrections produce a new version after Approval.
_Avoid_: Live bank account, mutable balance sheet, trading ledger

**Record Change**:
A change to application metadata or an approved new document version that does not move money outside the application.
_Avoid_: Payment, transfer, trade, Money Movement

**Money Movement**:
Any external payment, bank transfer, card charge, brokerage order, or other transaction that changes ownership or custody of money or assets.
_Avoid_: Marking a bill paid, editing a payment-method label, producing a Financial Snapshot

**Project Evidence**:
Cited, project-scoped history of work performed on an application project, kept distinct from general Personal Context.
_Avoid_: Personal memory, source code, project database

**Evidence Broker**:
The authority boundary that grants an Executive Role only the Project Evidence permitted by its current responsibility.
_Avoid_: Global brain access, shared wiki, universal search

**Project Portfolio**:
Real-Ming's canonical catalogue of owned, collaborative, historical, and reference application projects.
_Avoid_: Repository list, Agent Brain registry, Vercel projects

**Portfolio Project**:
One application project represented in the Project Portfolio regardless of whether it is deployed, active, or evidence-enabled.
_Avoid_: Repository, production app, registered project

**Portfolio State**:
The canonical classification of a Portfolio Project as owned production, owned active, prototype, archived, collaborative, or reference.
_Avoid_: Git branch, deployment status, health

**Evidence-Enabled Project**:
A Portfolio Project whose historical agent work is available as cited Project Evidence.
_Avoid_: Registered repository, indexed folder, shared memory

**Trust Domain**:
A boundary within Real-Ming whose source identities, raw context, and authority remain isolated from other domains.
_Avoid_: Email account, agent, department

**Approved Projection**:
A deliberately limited summary that may cross a Trust Domain boundary without granting access to the underlying raw context.
_Avoid_: Shared memory, full context, data sync

**Sensitive Secret**:
Authentication or payment material that must remain unavailable to agents and models, even when an authorized connector uses it on Ming's behalf.
_Avoid_: Sensitive context, private note, financial data

## Work

**Daily Operations Loop**:
The recurring cycle that turns Ming's current commitments and project state into priorities, authorized actions, and an end-of-cycle reconciliation.
_Avoid_: Morning summary, daily digest, to-do list

**MicroSaaS Operations Loop**:
The recurring cycle in which application work is detected, delegated, completed within authority, and presented to the CEO as a reviewable outcome.
_Avoid_: Autonomous deployment, coding agent, project summary

**Outcome Report**:
The review package showing what was requested, what was completed, supporting evidence, remaining risks, and any decision still required from the CEO.
_Avoid_: Status update, chat summary, final answer

**Work Item**:
A bounded unit of requested, scheduled, monitored, or delegated work with one responsible Executive Role and a recorded outcome.
_Avoid_: Chat, prompt, agent run

**Master Tasks**:
The canonical Notion data source containing every operational Work Item across Real-Ming.
_Avoid_: Task view, old task database, executive queue

**Work View**:
A filtered presentation of Master Tasks for the CEO, an Executive Role, or a Workstream; editing it changes the same underlying Work Item.
_Avoid_: Copied database, synchronized replica, separate task list

**Accountable Executive**:
The single Executive Role responsible for a Work Item's outcome and Outcome Report.
_Avoid_: Collaborator, assignee list, COO by default

**Collaborating Executive**:
An Executive Role contributing bounded work without owning the Work Item's final outcome.
_Avoid_: Co-owner, Accountable Executive, reviewer

**Workstream**:
A routing classification for Work Items: Personal Life and Career Job default to the COO, Finance to the Personal CFO, Academic to the CAO, MicroSaaS application work to the CTO, and Content Creation to the CMO.
_Avoid_: Trust Domain, Notion page, Executive Role

**Proposed Commitment**:
An agent-suggested priority or date that is visibly distinguished from a CEO-set or externally sourced commitment until authorized.
_Avoid_: Deadline, promise, confirmed schedule

**Deployment Candidate**:
An exact commit with passing required checks and a verified preview deployment that may be presented for CEO Approval.
_Avoid_: Branch name, latest code, unverified build

**Production Promotion**:
The audited act of making one approved Deployment Candidate live through the project's reviewed pull-request and deployment workflow.
_Avoid_: Arbitrary deploy button, direct production push, redeploy latest

**Scheduler Heartbeat**:
A time-stamped signal proving that a scheduled or recurring job ran, succeeded or failed, and produced its expected outcome.
_Avoid_: Cron configuration, log line, uptime check

**Metered Platform Cost**:
Provider-reported or estimated usage charges for model APIs, cloud infrastructure, storage, queues, and other consumption-priced services, carrying a source and `as of` time.
_Avoid_: Recurring subscription, agent-tool plan, DuitSini billing record

**Recurring Subscription**:
A repeating plan or bill tracked authoritatively in DuitSini, including paid agent-tool subscriptions; it is linked from Real-Ming rather than copied into dashboard cost analytics.
_Avoid_: Metered Platform Cost, API token usage, cloud consumption

**Review-Ready Work**:
A verified Work Item presented to the CEO with an Outcome Report but not yet approved or completed.
_Avoid_: Approved work, finished task, ready

**Authorized Work Source**:
A CEO request, approved backlog entry, scheduled responsibility, monitored exception, or authorized delegation from which an Executive Role may create a Work Item.
_Avoid_: Agent idea, autonomous objective, unsolicited feature

**Executive Roll-Up**:
The COO's consolidated daily account of completed outcomes, current exceptions, pending approvals, and portfolio priorities across Executive Roles.
_Avoid_: Activity log, progress feed, chat history

**Exception Notice**:
A direct CEO interruption caused by a required Approval, material blocker, critical incident, or completed Outcome Report.
_Avoid_: Notification, progress update, reminder

**Remote-Ready Project**:
An application project whose authoritative assets and repeatable operating instructions are available without Ming's personal computer.
_Avoid_: Deployed project, public repository, cloud project

**Local-Only Work**:
Work that depends on a private or physical environment and therefore waits while that environment is unavailable.
_Avoid_: Failed work, offline agent, blocked project
