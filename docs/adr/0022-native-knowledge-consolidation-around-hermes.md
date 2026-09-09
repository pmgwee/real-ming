# Add selective native knowledge consolidation around Hermes

- **Status:** Accepted for bounded Tasks 0–8 implementation · controlled-tested only · no production activation
- **Date:** 2026-09-08
- **Baseline:** Real-Ming v1.1 · Architecture Revision 6
- **Supersedes:** none; this is an additive decision under [ADR-0020](0020-run-ming-on-the-native-hermes-runtime.md)

## Context

Milestone 6 proved that native Hermes memory, session continuity, a cited
Obsidian note, restart retrieval, and protected backup/restore work. It did not
prove a recurring second-brain maintenance loop. The existing Real-Ming
Knowledge Compiler can provide stronger provenance, quarantine and atomic
publication guarantees, but it is deliberately optional and has no production
caller.

Ming wants useful durable knowledge without weakening the native Hermes
Telegram experience or creating a second memory engine. The desired scope is
selective: explicit wiki-save requests, deliberately marked decisions and
corrections, and source-backed research or artifacts. Casual conversation and
native memory housekeeping must remain outside the pipeline.

## Decision

Use one optional native Hermes cron job and the bundled native LLM-Wiki and
Obsidian skills for selection, reasoning, synthesis and Markdown writing. Add
only a minimal Real-Ming registry/MCP boundary for:

- candidate metadata, bounded size and idempotent fingerprints;
- source reference, excerpt/hash, support disposition and source-specific
  freshness checks at publication and retrieval;
- one-run lease, fenced activation, retry and crash reconciliation;
- immediate explicit-forget tombstones, derivative suppression and
  active-index filtering; and
- run/generation health for the existing dashboard/read model.

The registry stores coordination metadata and bounded pointers, not a second
conversation archive or a copy of Hermes `MEMORY.md`/`USER.md`. It does not
intercept `pre_llm_call`, native memory deletion or ordinary Telegram turns.

Eligible source-backed material may publish automatically to an agent-owned
generated wiki path. Conflicts, stale/unsupported evidence and uncertain
interpretations are quarantined and excluded from normal retrieval. Human
authored Obsidian notes remain a separate writer-owned path. Ordinary wiki
queries use the supported `wiki_retrieve` operation; registry failure fails
closed for generated knowledge while ordinary Hermes chat continues.

The Azure-hosted vault is canonical. A future local Obsidian mirror is optional
and, only after a separate approval, may be an activation-triggered, one-way,
read-only projection of an accepted Azure generation. Local edits never
synchronize upstream; the mirror cannot serve `wiki_retrieve` and cannot become
a runtime dependency. Its transport and deployment are a separate
post-live-acceptance plan and are outside Tasks 0–8.

## Publication authority, forgetting and enforcement boundary

The deterministic Real-Ming `activate_generation` operation is the only
publication authority. Hermes writes an immutable candidate generation to a
temporary/staging root. The supported system does not recognize a directory
rename, `index.md` edit or Obsidian view as activation; write permissions for
those paths should be withheld from non-authority processes. If an out-of-band
edit is possible, the registry's active reference remains unchanged and
reconciliation marks the view `needs-repair`. Arbitrary filesystem write access
is outside the hard security boundary, just as arbitrary reads are. The
activation operation checks manifest contents, path containment,
source/tombstone epoch and the lease token in one serialized commit. Path
traversal, absolute paths and symlink escapes are rejected.

Each active generation is a complete snapshot, not only the current run's
batch. A later run carries forward every still-valid page from the prior active
manifest before merging new pages. Page bytes may be deduplicated, but the
active manifest resolves the complete set without searching staging,
quarantine or superseded generations. The first slice permits 128 pages at
128 KiB each, a 16 MiB active snapshot and a 64 MiB generated root with at
most three retained generations; a size overflow leaves the prior pointer
active.

An explicit user request to forget wiki knowledge is a separate operation from
Hermes's native memory housekeeping. Publication and forgetting share the same
serialization boundary. The tombstone is written before another candidate can
be admitted; active indexes and supported retrieval exclude the subject;
generated pages, summaries and excerpts with an affected dependency are
retired or suppressed; and in-flight runs re-check the tombstone inside the
conditional commit. A lease token and publication epoch prevent an expired
worker from activating a generation after a takeover or forget.

The supported `wiki_retrieve` operation resolves the active reference, verifies
the immutable manifest, checks tombstones and retrieval-time freshness, and
returns a bounded cited result. Registry failure, a missing manifest or a
hash/path mismatch fails closed for generated knowledge. Staging, quarantine,
superseded generations and device views are outside ordinary retrieval. A
forget acknowledgement distinguishes local `suppressed`,
`head_sync_pending`, `restore_safe` and `cleanup-complete` states. Repeated
requests are idempotent. Content already delivered in an earlier Telegram
message, native memory, session history and authoritative providers are
separate operations.

Local suppression is not restore-safe completion. The independent head append
must succeed and be read back with the exact tombstone identity at or above
the local epoch before `restore_safe` can be returned. A failed append leaves
an outbox entry and `head_sync_pending`; a restore must compare the verified
head epoch and entries with that outbox. A readable but incomplete head, a
pending entry or unknown completeness keeps retrieval disabled as
`needs-repair`. A forget after the last backup and before head append cannot
be inferred after host loss and is explicitly outside the recoverable
guarantee.

Restore loads the registry, local tombstone outbox and tombstones before
enabling retrieval. The latest tombstone state is obtained from an independent
append-only tombstone head in the existing protected backup store, rather than
inferred from the restored generation or registry snapshot alone; recovery
replays newer entries before opening the reader and requires the remote head
to cover the snapshot's highest local epoch and every pending entry. If that
head is unavailable, stale, inconsistent or incomplete, retrieval remains
disabled and the state is `needs-repair`. Superseded generations and backups
follow the existing retention purge policy; ordinary purge is not called
cryptographic erasure.

The current native Hermes service account can read permitted plaintext files
through arbitrary shell operations. Therefore the supported retrieval path can
enforce the forget contract, while arbitrary direct filesystem reads are not a
hard security boundary. Cryptographic erasure would require a separate
encrypted/brokered store and a new CEO decision; it is not included in this
lightweight change.

## Source truth and freshness

A content hash proves which bytes were read, not that a claim is true or
current. A claim is publishable only when its source reference is readable, its
recorded excerpt/field matches the source version, and a source-specific
freshness policy is satisfied at both publication and retrieval. Every claim
carries source routing, captured/as-of time, a support disposition and
uncertainty/inference metadata. A source without a configured freshness profile
is quarantined. A user-authored statement can support the narrower claim
“Ming said/decided X” without independently proving an external claim in that
statement. Evidence matching and disposition presence are enforceable;
semantic interpretation remains model/human judgment.

## Crash consistency and job isolation

SQLite registry state and Markdown files are coordinated with a write-ahead
protocol: claim a unique lease, write/hash/flush an immutable temporary
generation, rename it to a unique immutable directory and flush the parent,
then ask `activate_generation` to validate it and atomically change the single
active reference and publication epoch in SQLite. The filesystem installation
and SQLite transaction are not one transaction; the registry pointer is the
only publication event. Verify through `wiki_retrieve`, then mark the registry
published. Startup reconciliation may finish a complete generation only when
its lease token and publication epoch are still current; an installed orphan
without a committed pointer stays quarantined while the prior pointer serves.
A missing/mismatched published generation becomes `needs-repair` and is
excluded from retrieval. Temporary files are never exposed as knowledge.
Forget tombstones precede cleanup and use the same conditional commit, so a
crash preserves suppression.

The cron entry uses a native script-only trigger whose wrapper starts the
pinned Hermes `AIAgent` with explicit `skip_memory=True`. Its `real-ming` MCP
server must use the pinned `tools.include` filter with exactly these callable
operations: `real_ming_knowledge_list_candidates`,
`real_ming_read_knowledge_source`, `real_ming_stage_knowledge_generation` and
`real_ming_wiki_retrieve`. Deliberate interactive capture is not exposed to
the nightly job, and `activate_generation` remains a deterministic local
runner operation. The preflight must read the effective `tools/list` result,
require set equality (an `enabled_toolsets` grouping is not itself an operation
filter), and prove that all existing work-item, scheduler,
calendar and mail operations are absent/rejected. A filesystem sandbox alone
cannot prevent an allowed MCP operation from making an external write.

A dedicated Hermes home, OS permissions and staging work directory make the
main Hermes home, native memory/profile files, configuration, skills/plugins,
cron store, credentials and unrelated paths unavailable for writes. The
compatibility preflight must verify those exact pinned controls; missing flags,
include-filter support, an extra callable or allowlist fallback makes
activation ineligible. Task 0 uses a fake/local model boundary with networking
disabled and no credentials. A later authorized one-shot may mount only a
named Hermes auth profile read-only for the dedicated job identity; it must
not inherit the interactive Telegram, Notion, Calendar, mail, GitHub or Vercel
credentials; the installed wrapper strips known interactive credential
variables before launching its probe or job. No global memory restriction is
introduced. The job may create
its own normal session record. Evidence/output bytes, model and tool calls,
storage growth, lease count, wall time and retries are bounded; retries share
the wall-clock budget.

## Consequences

Positive:

- Hermes remains the only intelligence, Telegram owner and native memory owner.
- Durable wiki knowledge becomes useful without copying every conversation.
- Deduplication, source support, explicit forgetting and recovery have a small
  deterministic boundary.
- Existing full compiler code remains available for a future demonstrated need,
  without being promoted by assumption.

Costs and limits:

- Candidate creation and semantic selection are skill-guided model behavior,
  not universal event enforcement.
- The job consumes some model/host resources, so evidence/output size, model and
  tool calls, storage growth, concurrency, wall time and retries must be
  bounded and tested.
- Hard protection against an unrestricted shell reading a still-present
  plaintext file is outside the native filesystem-first design.
- The first source slice, exact freshness profiles, generated path, notification
  behavior and production cron time remain decisions before activation.
- “Additive” is not a zero-impact guarantee; acceptance can claim only no
  prohibited writes and no unacceptable degradation under the tested workload.

## Rejected alternatives

- **Activate the full custom Knowledge Vault by default:** unnecessary for the
  current single-operator requirement and risks recreating a second platform.
- **Nightly VPS-to-laptop export as the canonical path:** adds device and sync
  availability dependency; Azure remains the always-on home.
- **Intercept every Hermes conversation or memory deletion:** violates the
  native-first boundary and would make ordinary chat and memory quality depend
  on the extension.

## Required evidence before activation

Controlled tests must prove candidate eligibility without ordinary-turn
interception, source-support/freshness dispositions rather than hash-only
acceptance, deduplication, one-owner activation, path containment, overlap and
the exact operation allowlist, quarantine, immediate forgetting (including
final-commit races, expired workers, derivatives, an unsynchronized local
forget and restore), authored-note preservation, crash reconciliation,
successive complete generations (A then B, followed by forgetting only A),
job-local native-memory/config noninterference and failure isolation. Resource
tests use the stated byte/page/tool/model/storage limits and the measured p95
native-chat thresholds. Authorized live checks must then prove a selected note,
fresh-session retrieval through `wiki_retrieve`, registry-failure fail-closed
behavior, explicit forget, concurrent Telegram chat and legitimate native
learning, retry after failure, restart/reconciliation and backup/restore. The
rollout is deployment with recurrence disabled, one authorized one-shot,
evidence review, then a separate recurring-enable decision. This ADR authorizes
none of those live actions.

## Decisions recorded for the first slice

Ming approved the following implementation boundary on 9 September 2026:

1. Use supported-path forgetting; arbitrary plaintext filesystem reads remain
   outside the guarantee. Do not introduce an encrypted/brokered store.
2. Capture explicit decisions/corrections and deliberately selected
   project/research artifacts. Decisions remain valid until superseded or
   forgotten; project freshness is 90 days and research freshness is 30 days.
   Calendar, task and mail claims are excluded from this slice.
3. Use `${OBSIDIAN_VAULT_PATH}/.real-ming/generated` as the canonical generated
   path and `${OBSIDIAN_VAULT_PATH}/.real-ming/staging` for staging. Azure is
   canonical; a future local mirror is optional and read-only as defined above.
4. Keep successful runs silent and report deduplicated failure/backlog health
   through the existing operational report/dashboard.
5. Keep `02:00 Asia/Kuala_Lumpur` in an inactive manifest only. Creating or
   enabling a cron row, deployment, live acceptance and provider changes remain
   separate CEO approvals. Later tuning is versioned and reviewable.

The remaining CEO action is to review the controlled artifact, then separately
approve deployment, one-shot live acceptance and (if desired) one recurring
cron row. No such live action is authorized by this ADR.

See the complete design and acceptance contract in
[`docs/superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md`](../superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md).
