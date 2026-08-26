# Real-Ming LLM Wiki and Persistent-Memory Research

Research date: 2026-08-26  
Scope: Karpathy's LLM Wiki pattern, Obsidian, Hermes Agent, and provenance boundaries for Real-Ming.

## Conclusion

Real-Ming should use an **Obsidian-compatible Markdown knowledge vault as its persistent, compiled knowledge layer**, with Hermes as the runtime that ingests, compiles, queries, lints, and schedules work. This is technically well supported: current Hermes Agent includes both a bundled `llm-wiki` skill based on Karpathy's pattern and an `obsidian` skill for filesystem-first vault access.

The vault must not become a universal Source of Record or an unrestricted shared memory. Karpathy's canonical separation is explicit: immutable raw sources are the source of truth; the wiki is LLM-generated synthesis; and a schema controls the compiler. Therefore, Real-Ming should treat wiki pages as **derived, cited, versioned knowledge**. Notion, Calendar, email, application databases, finance exports, repositories, GitHub, Vercel, Canvas, Teams, and other domain providers remain authoritative.

The recommended name is **Real-Ming Knowledge Vault**. It is one logical knowledge service, implemented as five Trust-Domain-isolated Markdown roots plus a CEO projection root—not one directory that every Executive Role can read. The five Executive Roles are policy-scoped views over those roots; they are not storage boundaries and do not map one-to-one to the five Trust Domains.

## Source classification

### Primary evidence

- Andrej Karpathy's [original X post](https://x.com/karpathy/status/2039805659525644595) describes raw inputs being incrementally compiled into an interlinked Markdown wiki, viewed in Obsidian, queried by an agent, enhanced with filed outputs, and maintained with lint-style health checks.
- Karpathy's [canonical LLM Wiki idea file](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) formalizes three layers: immutable raw sources, an agent-written wiki, and a schema such as `AGENTS.md` or `CLAUDE.md`. It also says the implementation details are intentionally modular.
- Nous Research's official Hermes sources provide a bundled [LLM Wiki skill](https://github.com/NousResearch/hermes-agent/blob/d0351e32309bd68a1012c302157947b955323fca/skills/research/llm-wiki/SKILL.md) and [Obsidian skill](https://github.com/NousResearch/hermes-agent/blob/d0351e32309bd68a1012c302157947b955323fca/skills/note-taking/obsidian/SKILL.md). The LLM Wiki skill adds raw-content hashes, provenance markers, confidence/contested metadata, contradiction handling, an index, an append-only log, and lint checks.
- Official Hermes documentation confirms a [Telegram-capable messaging gateway](https://hermes-agent.nousresearch.com/docs/user-guide/messaging), [scheduled cron jobs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron), a reusable [skills system](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), and a separate, deliberately bounded [native memory system](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).
- Obsidian's official documentation says a vault is a local folder of [Markdown-formatted plain-text files](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data). It supports [internal links](https://help.obsidian.md/Linking+notes+and+files/Internal+links), YAML-backed [properties](https://help.obsidian.md/Editing+and+formatting/Properties), and backlinks as documented in the official [Obsidian Help repository](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Plugins/Backlinks.md).
- NIST's [agentic evaluation work](https://www.nist.gov/programs-projects/building-evaluation-probes-agentic-ai) grounds agent claims against a human-curated reference corpus and stores citation evaluations in a structured audit trail. NIST's [Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) emphasizes provenance, origin/history, versioning, and human oversight. W3C [PROV-O](https://www.w3.org/TR/prov-o/) provides the corresponding distinction between a primary source and an entity derived from it.

### Supplied reference material

- The attached `llm-wiki.md` is not a secondary rewrite: after normalizing line endings, its content is identical to the current raw Karpathy gist (SHA-256 `A402E64FC0C46E618B01ACC3502F18A992B4A42222BFD7F87C9ABBEE3801C98F`). It can be treated as a local copy of the primary idea file.
- The attached NoteGPT transcript covers Nate Herk's YouTube video, *Andrej Karpathy Just 10x'd Everyone's Claude Code* (2026-04-05). It is a useful secondary implementation walkthrough, not Karpathy's specification. Its `hot.md` cache and “five-minute setup” are that implementation's choices and are not requirements of the canonical method.
- The supplied architecture image is an illustrative example. Its automatic “hot memory to stable facts” flow should not be copied without the provenance and Approval boundaries below.

## What Hermes memory is—and is not

Hermes' built-in memory is not the persistent store for Real-Ming's five domains. Official documentation describes two small files, `MEMORY.md` and `USER.md`, with strict character limits; they are injected into every session. Hermes explicitly advises against raw data dumps and supports an Approval gate for memory writes.

Use native Hermes memory only for compact runtime facts such as:

- Ming's timezone and communication preference;
- the active Real-Ming workspace and role identifiers;
- safe routing conventions and stable tool quirks;
- a pointer telling the runtime how to query the Knowledge Vault.

Set `memory.write_approval: true`. Do not place daily notes, email bodies, financial data, project corpora, academic files, or the compiled wiki in `MEMORY.md` or `USER.md`.

## Five role candidate streams, not five Sources of Record

The five Executive Roles define five **candidate-ingestion views**. Each view combines several authoritative providers and may span or share a Trust Domain; it is not itself authoritative. Storage and access control remain organized by Trust Domain, while Executive Roles receive task-scoped projections.

| Role view | Candidate inputs | Trust Domain roots | Important boundary |
| --- | --- | --- | --- |
| COO—Life and Career | selected Personal Context Package items, career files, Life/Job tasks, calendar commitments, opportunity email, approved entertainment digests | `personal/`, limited `entertainment/` projections | personal facts require provenance; career claims remain grounded in authoritative career files |
| CTO—MicroSaaS | repositories, GitHub, Vercel, application databases, deployment evidence, Agent Brain citations | `ming-creatives/` | Project Evidence stays project-scoped; the wiki cannot authorize deployment |
| Personal CFO—Finance | DuitSini records, versioned Financial Snapshots, Moomoo exports, Money Manager exports, finance tasks | `finance/` | no credentials, card data, brokerage secrets, or Money Movement; derived analysis is not a ledger |
| CAO—Academic | Canvas, Teams, student email, Academic tasks, calendar commitments, approved course files | `academic/` | retain course/source provenance and freshness; do not expose academic email to other roles |
| CMO—Content | content-creator workflow, CMO tasks, approved research and performance evidence | `ming-creatives/` | CTO and CMO share a Trust Domain but receive distinct task- and project-scoped projections; preserve source attribution and separate drafts from published content |

A sixth `ceo/` root contains only reviewed cross-domain Approved Projections, Executive Roll-Ups, decisions, and Outcome Reports. This preserves the existing Real-Ming rule that cross-domain summaries pass through explicit projections instead of raw shared memory.

## Recommended persistent-store topology

```text
Durable encrypted volume
├── personal/         raw pointers/snapshots + compiled wiki
├── ming-creatives/   raw pointers/snapshots + compiled wiki
├── academic/         raw pointers/snapshots + compiled wiki
├── entertainment/    raw pointers/snapshots + compiled wiki
├── finance/          raw pointers/snapshots + compiled wiki
└── ceo/              reviewed cross-domain projections only
```

Each root follows Karpathy's three-layer pattern:

```text
SCHEMA.md + index.md + log.md
raw/                 immutable snapshot or source-reference envelopes
wiki/                LLM-generated entities, concepts, summaries and queries
```

Obsidian is the human-facing IDE over these Markdown files. The durable encrypted filesystem is the actual store. A headless always-on Hermes host can maintain and query the files; Obsidian desktop/mobile can view synchronized copies. Each Hermes role/profile should receive only an Approved Projection from its allowed Trust Domain roots, not unrestricted filesystem access. The CEO projection process can read bounded outputs from all five roots.

The existing Agent Brain remains the brokered Project Evidence system. It may index the CTO/CMO project wiki read-only later, but it should not be a second writer. The single-writer rule is: the LLM Wiki compiler owns compiled Markdown; Agent Brain indexes or retrieves it; domain providers own their authoritative records.

## Memory migration pipeline

```text
Provider change or scheduled refresh
  → candidate envelope
  → immutable raw snapshot or source pointer
  → domain-scoped compilation staging
  → provenance/citation + confidence/contradiction metadata
  → lint and policy checks
  → atomic versioned publish to the domain wiki
  → on-demand lookup through index, wikilinks and scoped search
```

Every candidate envelope should include at least `source_system`, stable source identifier or URI, `captured_at`, `effective_at/as_of`, content hash, sensitivity, allowed roles, and retention class. Every material wiki claim should point back to one or more candidate envelopes or primary source references.

Promotion rules:

1. **Raw to compiled wiki:** may run unattended for allowlisted, low-risk sources when provenance, validation, and versioning pass. Failures or contradictions enter review rather than being silently resolved.
2. **Compiled wiki to CEO projection:** requires projection policy; sensitive cross-domain material is redacted or summarized.
3. **Compiled wiki to a Source of Record:** never automatic. Updating Notion, Calendar, email drafts, project records, or finance records remains a separately authorized Work Item.
4. **Compiled wiki to stable personal fact or Hermes native memory:** CEO Approval is required. The destination is the Personal Context Package/Context Vault or bounded Hermes memory—not Agent Brain.
5. **Chat/session history to wiki:** never dump entire conversations. Extract a cited candidate, classify it, then process it through the same pipeline.

Cron can collect candidates, compile eligible pages, lint the vault, produce daily notes, and deliver reports through Telegram. It must not bypass the pipeline or turn every daily note into a stable fact. A daily note is an operational record; only reviewed, source-backed conclusions are eligible for durable synthesis.

## Fit with the current Real-Ming design

This recommendation preserves the current [Real-Ming v1 specification](../specs/real-ming-v1.md) and ADRs:

- Domain systems remain authoritative ([ADR-0001](../adr/0001-keep-domain-systems-authoritative.md)).
- Hermes remains the runtime while Real-Ming remains the policy, workflow, Approval, and audit boundary ([ADR-0002](../adr/0002-compose-existing-agent-systems.md)).
- Trust domains remain isolated ([ADR-0006](../adr/0006-isolate-trust-domains.md)).
- Agent Brain remains brokered Project Evidence ([ADR-0009](../adr/0009-broker-project-evidence-by-role.md)).
- Personal context remains allowlisted and projected ([ADR-0012](../adr/0012-curate-personal-context-through-an-allowlisted-package.md)).
- Staging and retention remain governed ([ADR-0017](../adr/0017-retain-audit-and-purge-ingestion-staging.md)).

## Decision statement

Adopt **Hermes + its bundled LLM Wiki/Obsidian skills + Trust-Domain-isolated Obsidian-compatible Markdown roots** as Real-Ming's persistent compiled knowledge system. Expose role-specific views through the Projection Broker. Do not use Hermes native memory, Agent Brain, or a single unrestricted Obsidian vault as universal memory. Preserve raw source authority, make every compiled claim traceable, and gate any promotion from derived knowledge into personal facts or operational records.
