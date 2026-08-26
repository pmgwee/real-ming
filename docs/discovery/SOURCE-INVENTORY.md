# Phase 1 Source Inventory

This is a discovery record, not the implementation specification. It records known Sources of Record, intended access, unresolved questions, and evidence-enablement candidates without storing credentials or unnecessary personal identifiers.

## Handling rules

- Never record passwords, recovery codes, API secrets, complete payment-card details, brokerage transaction passwords, or identity-document images here.
- Every imported record must retain its source and an `as of` time; stale data must never be presented as current.
- Direct source data remains authoritative. Agent Brain supplies Project Evidence and never replaces live source files or provider records.
- Personal-context ingestion is allowlisted page by page. Connecting the Notion workspace does not authorize indiscriminate ingestion of every page.
- Cross-domain consumers receive an Approved Projection unless their Executive Role is explicitly authorized for the raw source.

## Calendar and tasks

| Source | Source-of-record role | Intended access | Status |
|---|---|---|---|
| Google Calendar connected to Notion Calendar | Ming's single calendar of commitments | COO read/write | Confirmed; Notion Calendar is the viewing client, Google Calendar is the underlying calendar provider |
| `(IP Content Creation) Task To Do List` | Content Creation Work Items | CMO read/write; COO projection | Confirmed active source |
| `(MicroSaaS) Task To Do List` | MicroSaaS application Work Items | CTO read/write; COO projection | Confirmed active source |
| `(Academic) Task To Do List` | Academic Work Items | CAO read/write; COO projection | Confirmed active source |
| `(Job x Life) Task To Do List` | Career Job and Personal Life Work Items | COO read/write | Confirmed active source |
| `(Finance) Task To Do List` | Finance Work Items | Personal CFO read/write; COO projection | Newly created active source using the same current format |

Decision: converge the five confirmed sources on Master Tasks. Target Work Views are CEO All Work, COO Personal Life and Career Job, CFO Finance, CAO Academic, CTO MicroSaaS, and CMO Content Creation.

Default Workstream routing is confirmed: Personal Life and Career Job to the COO; Finance to the Personal CFO; Academic to the CAO; MicroSaaS application work to the CTO; and Content Creation to the CMO. Every Work Item has one Accountable Executive and may name multiple Collaborating Executives.

Cutover rule: continue updating the five existing databases until migration reconciliation is accepted. After cutover, their familiar pages become linked, filtered views of the single Master Tasks data source; edits through any linked view update the same underlying records, while filters, sorting, and grouping remain view-local. The original databases are then archived read-only and are not maintained through bidirectional synchronization. Source: https://www.notion.com/help/data-sources-and-linked-databases

Lifecycle migration: existing `Done` records map to Completed. `Pending` and `To Do` records are reconciled rather than blindly mapped. The canonical statuses are Captured, Triaged, Planned, Awaiting Approval, Executing, Waiting/Blocked, Verifying, Ready for CEO Review, Completed, Changes Requested, and Cancelled.

Commitment rule: the COO may add a Proposed Commitment where priority or timing is missing. CEO-set values are locked, external commitments retain their provenance, agent estimates are labelled, and material changes require Approval.

## Personal Notion context

The workspace contains many pages, but only selected pages should become Personal Context. Candidate categories visible or described during discovery include:

- personal facts and measurements;
- biography and past experiences;
- life plans and goals;
- work history and current responsibilities;
- hard and soft skills;
- habits and routines;
- selected finance summaries;
- other user-nominated pages with durable personal value.

Exclude by default: credentials, recovery information, identity-document images, raw account numbers, generic tutorials, reusable templates, unrelated research, transient notes, and pages whose value is unclear.

The CEO will manually curate a `personal-context` staging folder in Real-Ming. It is excluded from Git and treated as an explicit ingestion allowlist, not automatically as a new Source of Record. Schemas, policies, and redacted projections may be versioned; selected context required by the always-on service is encrypted in a Context Vault and disclosed through role-scoped projections. Copied CVs, resumes, cover letters, and Notion exports retain their original source and `as of` metadata; authoritative career files should preferably be referenced or projected rather than maintained as silent duplicates. V1 refresh is manual, with stale records visibly labelled; any later Notion synchronization is limited to explicit page identifiers.

For each nominated page, provide this metadata instead of pasting the whole page into chat:

| Field | Meaning |
|---|---|
| Page title | Human-recognizable title |
| Purpose | What decision or assistance it improves |
| Trust Domain | Personal, Ming Creatives, Academic, Entertainment, or Finance |
| Sensitivity | General, private, sensitive, or secret/excluded |
| Allowed roles | Which Executive Roles may read raw content |
| Authority | Authoritative fact, personal plan, reflection, or historical record |
| Freshness | How often it can change or should be rechecked |
| Source reference | Notion page identifier or URL, supplied later through the connector setup |

## Email

| Identity label | Intended v1 treatment |
|---|---|
| Personal and opportunities | Read and draft; sensitive categories remain compartmentalized |
| Academic | CAO read and draft; COO receives deadline/action projections |
| Future Ming Creatives | COO/appropriate executive read and draft once created |
| Entertainment/applications | Low-priority digest only |
| Browser/Google identity | Excluded unless a real operational mailbox use case is identified |

Provider and connector details remain to be confirmed during integration setup.

## Career

| Source | Source-of-record role | Intended access | Status |
|---|---|---|---|
| `career-ops/cv.md` and its primary user-profile files | Verified career facts and claims | COO or scoped career worker; Approved Projections to other roles | Existing, active, sensitive |
| Career application tracker and reports | Application journey and outcomes | COO or scoped career worker | Existing, active, sensitive |
| Agent Brain Project Evidence for `career-ops` | Historical agent work and cited decisions | Restricted through Evidence Broker | Approved future registration after Phase 1 |

The Personal Context Package provides curated current context; it does not replace `career-ops`. The primary career files remain authoritative for CV/application claims, while registration preserves cited workflow history and decisions. Auto-memory or Project Evidence must not be promoted into a factual career claim without provenance to those files or explicit CEO confirmation.

## Finance

| Source | Source-of-record role | Intended access | Initial strategy |
|---|---|---|---|
| DuitSini / `subscription-agent` | Subscriptions, renewal schedules, and payment-method metadata | Personal CFO read/write | Direct application integration for Record Changes; no real bank/card transaction capability or Money Movement |
| Moomoo | Investment accounts and holdings | Personal CFO read-only | Export or curated holdings workbook for v1; later evaluate a dedicated private read-only OpenD without a transaction password |
| Money Manager by Realbyte on iOS | Income and expense transactions | Personal CFO read-only | Supported Excel export; no phone-UI automation in v1 |
| Monthly balance-sheet workbook | CEO-maintained financial aggregate and net-worth snapshot | Personal CFO read; approved creation of successor versions | Use immutable Financial Snapshot versions with explicit `as of` dates; preserve every original |

The CFO owns financial meaning, reconciliation, and validation and may, after Approval, produce a new Financial Snapshot version. The CTO acts as product engineer for workbook formulas, imports, and automation; CTO-prepared versions require CFO validation before CEO review. No Executive Role may receive or use a brokerage transaction password, place or modify an order, transfer funds, or execute a payment.

## Academic

| Source | Source-of-record role | Intended access |
|---|---|---|
| Google Calendar through Notion Calendar | Academic commitments | CAO read/write |
| `(Academic) Task To Do List` | Academic Work Items | CAO read/write |
| INTI student Microsoft 365 identity | Academic email, Teams, and associated files | CAO read; draft-only communications |
| INTI Canvas LMS | Course files and announcements | CAO read-only; no submission |

## Initial owned-production portfolio

1. `subscription-agent` / DuitSini
2. `agent-knowledge-base-codex`
3. `Ai-community-channel` / BersamaAi
4. `ming-portfolio`
5. `content-creator-ai-workflow`
6. `agent-brain-dashboard`

## Evidence-enablement candidates after Phase 1

| Order | Project | Why | Direct-source owner |
|---:|---|---|---|
| 1 | `content-creator-ai-workflow` | CMO workflow history | CMO, with CTO for application code |
| 2 | `agent-brain-dashboard` | Brain dashboard engineering history | CTO |
| 3 | `ming-portfolio` | Portfolio engineering and brand history | CTO and CMO according to task |
| 4 | `career-ops` | Career journey and agent-work history | COO or scoped career worker; sensitive |
| 5 | Real-Ming | System design and implementation history | CTO, with role-specific projections |

Each registration is performed separately after Phase 1, followed by service restart, health/storage inspection, and a cited-query verification. Registration is not authorization; the Evidence Broker controls which role may query each project.
