---
name: knowledge-consolidation
description: Use when the bounded native-cron knowledge consolidation job runs. Read deliberately selected decisions, corrections and project/research artifacts, verify support and freshness, and stage generated wiki pages without changing native memory or ordinary Hermes chat.
version: 1.1.0
author: Real-Ming
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Ming, knowledge, consolidation, Obsidian, LLM-Wiki]
    related_skills: [real-ming, knowledge-capture]
---

# Knowledge consolidation

The job is a small maintenance path around native Hermes. Hermes remains the
only reasoning runtime and owns native memory, profile, sessions, Telegram,
skills, plugins and MCP. This skill composes selected knowledge into the
agent-owned generated area; it is not a second memory engine.

## Bounded run

1. Claim one run lease. List only admitted, unforgotten candidates selected
   for this run. A run handles at most 12 candidates, one model call and 48
   permitted MCP/tool calls, within the shared 10-minute wall budget and two
   retries. The job has no ordinary-session sweep.
2. Read each bounded source through its declared identity, reference and
   version. Preserve an excerpt and citation. Verify semantic support as an
   explicit supported/unsupported/uncertain disposition; a byte hash proves
   identity, not truth. Preserve the candidate's single explicit
   `trustDomain`; each page's source candidates must all share that domain.
3. Apply the first-slice freshness policy at publication and retrieval:
   decisions remain valid until superseded or forgotten, project artifacts
   expire after 90 days, and research artifacts expire after 30 days.
   Calendar, task and mail claims are outside this slice.
4. Use the native LLM-Wiki and Obsidian conventions inside the generated
   area. Stage a complete immutable snapshot at
   `${OBSIDIAN_VAULT_PATH}/.real-ming/staging`; the canonical generated view is
   `${OBSIDIAN_VAULT_PATH}/.real-ming/generated`. Handwritten notes are not
   edited. Staging, quarantine and superseded generations are not searchable.
5. Carry forward still-valid pages from the previous active snapshot. Apply
   tombstones and lease fencing during the deterministic activation commit;
   an expired worker cannot publish. A failure leaves the previous active
   generation available and records health without claiming success.
6. Role-facing reads use only `real_ming_wiki_retrieve` with one authorized
   Executive Role and its exact `trustDomain`. The operation authorizes before
   reading page bytes, then checks the active registry pointer, schema-v2
   manifest, path containment, tombstones, freshness and citations. It fails
   closed when any check is unavailable. Entertainment has no Executive Role;
   preserve its domain without inventing a reader. Useful query results are
   candidates, never direct writes.

## Isolation and reporting

The wrapper must run the pinned Hermes commit with `skip_memory=True` and the
preflight-proven exact four-operation MCP allowlist. It writes only staging
and its disposable job session directory. It cannot write `MEMORY.md`,
`USER.md`, native configuration, skills, plugins, cron state, credentials or
unrelated paths. Its own native session record is allowed. A successful run is
silent; failures and backlog are deduplicated into the existing operational
report/dashboard.

The Azure vault is canonical. A future local Obsidian mirror would be an
optional one-way, activation-triggered, read-only projection; it cannot sync
local edits upstream, serve `wiki_retrieve`, or become a runtime dependency.
Its transport and deployment need a separate post-live-acceptance plan.

## Completion criterion

Return success only after the run, immutable manifest, active pointer and an
authorized role/domain read-back (or manifest/byte verification for the
role-less Entertainment domain) verify. On any unsupported source,
freshness, tombstone, registry, isolation or resource condition, record a
bounded failure and leave native Hermes chat independent.
