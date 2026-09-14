# Scope native knowledge retrieval by Trust Domain

- **Status:** Accepted and controlled-tested under GitHub issue #53 · no production activation
- **Date:** 2026-09-14
- **Baseline:** Real-Ming v1.1 · Architecture Revision 6
- **Supersedes:** none; this narrows the reader contract accepted in [ADR-0022](0022-native-knowledge-consolidation-around-hermes.md)

## Context

ADR-0022's candidate contract already requires `trustDomain`, but the controlled
implementation drops that value when Hermes synthesizes a page. The generation
manifest and cited retrieval result therefore cannot prove which Trust Domain a
page belongs to. `real_ming_wiki_retrieve` also accepts an optional free-form
role and has no domain argument. An active mixed corpus would consequently make
the role playbooks' intended knowledge boundaries advisory rather than
enforceable.

The existing domain model already answers the policy question. COO is scoped to
Personal, CTO and CMO share Ming Creatives, CAO is scoped to Academic, and the
Personal CFO is scoped to Finance. Entertainment is a Trust Domain without an
Executive Role. CEO is the human authority, not an Executive Role or capture
domain; cross-domain CEO material is an Approved Projection rather than raw
generated-wiki retrieval.

## Decision

Each candidate and generated page has exactly one canonical `trustDomain` from
the existing five-value `TrustDomain` type. A synthesized page is publishable
only when every source candidate has the same domain and the page declares that
exact domain. The value survives into the immutable generation manifest and
each retrieval citation.

The manifest schema advances to
`real-ming.native-knowledge-generation.v2`. A v1 manifest, a page with a missing
or malformed domain, or a mixed-domain page fails closed. No live migration is
required because selective consolidation has no production caller or active
cron row; the first authorized activation must build a fresh v2 generation.

`real_ming_wiki_retrieve` requires both an `ExecutiveRole` and one
`TrustDomain`. The reader validates the pair before resolving the active
generation or reading page bytes:

| Executive Role | Permitted Trust Domain |
| --- | --- |
| COO | Personal |
| CTO | Ming Creatives |
| CMO | Ming Creatives |
| CAO | Academic |
| Personal CFO | Finance |

CEO, missing or unknown roles, mismatched domains, multiple domains, and an
invented Entertainment executive are denied through the same fail-closed
result. Entertainment remains a valid capture/publication domain, but has no
role-scoped reader until a separate decision introduces a legitimate consumer.
Cross-domain collaboration uses an Approved Projection; it does not broaden
raw retrieval.

Role playbooks may request their fixed domain only when durable knowledge is
relevant to the task. They must treat unavailable or denied generated knowledge
as unavailable evidence and continue ordinary reasoning where safe. Retrieval
is not an every-turn preamble. These playbook instructions improve selection;
the reader contract is the enforcement boundary.

## Consequences

- Domain isolation is enforced before content bytes are read and remains
  auditable in the manifest and citation.
- CTO and CMO can use one storage taxonomy without conflating their role
  procedures. More granular section views, if needed, remain a separate design.
- Existing controlled v1 fixtures must be regenerated or updated to v2. An old
  or tampered active generation becomes `needs-repair`; it is never treated as
  an empty healthy result.
- Hermes remains the sole conversation and execution runtime. This change adds
  no store, Telegram consumer, scheduler owner, provider call, or live cron row.
- Plugin enforcement and role/procedure skill decomposition remain separate
  work. Neither is smuggled into this retrieval slice.

## Alternatives considered

- **Infer domains during synthesis:** rejected because a model classification
  error could cross a privacy boundary.
- **Allow multiple domains per page:** rejected because retrieval would either
  leak the page or require redaction after reading it.
- **Treat CEO as a universal role or sixth capture domain:** rejected because it
  collapses the Approved Projection boundary.
- **Create one filesystem root or store per role:** rejected because Trust
  Domains are the storage taxonomy and CTO/CMO legitimately share one domain.
