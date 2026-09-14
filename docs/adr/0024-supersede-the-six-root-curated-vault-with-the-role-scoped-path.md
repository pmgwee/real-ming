# Supersede the six-root curated vault with the role-scoped native path

- **Status:** Accepted under GitHub issue #54 · CEO decision, 14 September 2026
- **Date:** 2026-09-14
- **Baseline:** Real-Ming v1.1 · Architecture Revision 6
- **Supersedes:** the activation path of [ADR-0018](0018-compile-knowledge-into-trust-domain-vaults.md). ADR-0018 is retained as the record of the original design; its label is not rewritten.

## Context

ADR-0018 designed an encrypted, versioned Knowledge Vault over six Trust-Domain
roots, with an LLM-wiki folder shape, Candidate Envelope quarantine and a
Projection Broker. [ADR-0020](0020-run-ming-on-the-native-hermes-runtime.md)
made it optional under Revision 6, "activated only where a required guarantee is
demonstrated." The CEO then deferred the activation decision until the native
knowledge path had been proven in production rather than argued in advance.

That proof now exists. Under RM-54 the role-scoped selective native knowledge
path was deployed and live-accepted on the Malaysia West host: governed
generation and publication, role- and Trust-Domain-gated retrieval, restore-safe
forgetting against an independent tombstone head, and native Hermes invocation
through the production MCP surface.

Comparing the two against the guarantees ADR-0018 actually promised:

| Guarantee | Role-scoped native path |
| --- | --- |
| Versioned, atomic publication | Met. Immutable generations with one active pointer |
| Candidate quarantine before publication | Met. Candidates admitted, hashed and dispositioned; unsupported material excluded |
| Access-controlled cross-domain projection | Met. Gated by Executive Role and Trust Domain; an unauthorized role is refused, not served |
| Trust-Domain scoping | Met. [ADR-0023](0023-scope-native-knowledge-retrieval-by-trust-domain.md) |
| Forgetting with an independent head | Met. Restore-safe, proven on the host |
| Encryption at rest across six separate roots | **Not met** |
| A distinct Projection Broker component | **Not met.** Retrieval is gated directly instead |

The vault implementation remains in the repository and its credential
`real-ming-vault-key` is provisioned and resolves at startup. It has never had a
production caller: `control-plane-cli.ts` does not pass `knowledgeOperations`,
so the vault, knowledge compiler, Projection Broker and Obsidian materializer
are all constructed as `undefined`. The configured Obsidian directory holds no
files and none of the six roots exist.

No required guarantee was identified that the live path does not already
provide. Activating the vault would therefore add a second knowledge system —
with its own keys, its own publication state, and a second place where "what the
agent knows" can diverge — to obtain encryption-at-rest across six roots that
nothing has asked for.

## Decision

The **role-scoped selective native knowledge path is the knowledge architecture**
for Real-Ming v1.1. The six-root encrypted Curated Knowledge Vault and its
Projection Broker are **superseded as an activation target**.

1. The README capability is stated as a **guarantee**, not as an implementation,
   and is `Live` because the guarantees are delivered by the live path.
2. The vault implementation, its tests and `real-ming-vault-key` are **retained
   unchanged**. This is a decision not to activate, not a deletion.
3. Encryption-at-rest across six roots and a separate Projection Broker are
   **accepted as not required**. If either becomes required, that is a new
   decision with a named guarantee behind it, and this ADR is superseded rather
   than quietly reinterpreted.
4. No documentation may describe the six-root vault as live, partially live, or
   as a stage the live path passes through. They are different systems.

## Consequences

**Good.** One knowledge system to operate, key and reason about. The capability
table stops carrying a row that no production caller has ever reached. The
guarantee the CEO cares about — that an unauthorized role cannot read another
domain's knowledge — is enforced by the path that actually runs.

**Accepted cost.** Generated knowledge is not encrypted at rest in six separate
roots. It lives under `${OBSIDIAN_VAULT_PATH}/.real-ming/generated` on the
Azure-hosted vault, protected by host and storage controls rather than by
per-root envelope encryption. For an operator-only system whose generated corpus
is currently two pages, that is a proportionate trade, and it is recorded here
so it is a known position rather than an oversight.

**Reversible.** Nothing is deleted. Activating the vault later means passing
`knowledgeOperations`, creating the roots and compiling — the work described in
`CEO-Office/curated-knowledge-vault-activation-runbook.md`, which is retained.

**Unchanged.** This ADR does not alter the design baseline. Revision 6 stands;
ADR-0018 keeps its own label as the record of what was designed.
