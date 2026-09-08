# Native knowledge consolidation around Hermes

**Status:** controlled implementation for Tasks 0–8 complete · production activation not authorized · 9 September 2026
**Baseline:** Real-Ming v1.1 · Architecture Revision 6
**Decision owner:** Ming, CEO
**Implementation status:** Tasks 0–8 are implemented and controlled-tested locally. No
cron job, deployment, provider call, live acceptance or production configuration
change is authorized by this document. Task 9 cleanup remains separately gated.

## Decision

Add a small, optional knowledge-maintenance path around the native Hermes
runtime. Hermes remains the agent: it selects eligible material, reasons about
it, uses the native LLM-Wiki and Obsidian skills, and writes the generated wiki
pages. Real-Ming contributes only a minimal durable registry and bounded MCP
operations for candidate eligibility, deduplication, source-support checks,
forget tombstones, crash reconciliation and run health.

This is an additive extension inside Architecture Revision 6. It is not a
second memory engine, a replacement for Hermes memory, a second Telegram
consumer, or a mandatory per-message workflow.

The approved capture scope is **selective durable knowledge**:

- explicit requests such as “save this to the wiki” or “remember this in the
  knowledge base”;
- decisions and corrections deliberately marked for durable use; and
- source-backed research or useful project artifacts deliberately selected by
  Hermes or Ming.

Casual conversation, transient task chatter, raw inboxes, provider dumps and
native memory housekeeping are excluded. Eligible, traceable material may be
published automatically into an agent-owned generated area. Conflicts,
unsupported interpretations, stale sources and uncertain claims remain
quarantined and are excluded from normal retrieval. Handwritten Obsidian notes
are never overwritten.

The Azure-hosted vault is canonical for this capability. A future local Obsidian
mirror is optional and, if approved later, is only an activation-triggered,
one-way, read-only projection of an accepted Azure generation. Local edits never
sync upstream; the mirror cannot satisfy `wiki_retrieve` and cannot become a
runtime dependency. Its transport and deployment require a separate
post-live-acceptance plan. Tasks 0–8 do not create or synchronize this mirror.

## Product contract

| Concern | Contract | Current evidence state |
| --- | --- | --- |
| Native experience | Telegram, conversation, session history, `MEMORY.md`, `USER.md`, tools, skills, plugins, MCP, progress, formatting and native cron remain Hermes-owned | Designed; current V6 live evidence remains valid |
| Capture | No hook or wrapper intercepts ordinary turns. Candidates are created only by an explicit capture action or a deliberate durable-signal action using the capture skill/tool | Controlled-tested; no production caller |
| Publication | Hermes writes only a temporary generation; one deterministic Real-Ming activation operation alone makes an immutable generation eligible for supported retrieval | Controlled-tested; activation remains local and inactive |
| Retrieval | The supported `wiki_retrieve` path resolves and verifies the registry's active-generation reference, tombstones and freshness; registry failure fails closed for wiki results while ordinary chat continues | Controlled-tested; no live caller |
| Forgetting | An explicit forget request immediately suppresses future intake and supported retrieval, then retires or suppresses affected generated content; native-memory deletion remains unrelated housekeeping | Controlled-tested on the supported path; no live caller |
| Failure | A failed or unavailable consolidation run is visible, retryable and must not make ordinary Telegram chat fail | Controlled-tested; not production-wired |

“Source-backed” means that a claim is supported by evidence. A matching hash
proves identity/version of the bytes that were read; it does not prove that the
claim is true, current, complete or correctly interpreted.

## Capability disposition and ownership

| Capability | Native Hermes route | Real-Ming addition | Guarantee type |
| --- | --- | --- | --- |
| Session continuity and compact memory | Native sessions, `MEMORY.md`, `USER.md` | None | Enforced by Hermes; untouched here |
| Candidate selection | Native agent session search plus a Ming knowledge-capture skill | Candidate registry accepts only explicit/marked candidates | Selection intent is skill-guided; registry admission is enforceable |
| Synthesis and Markdown writing | Native LLM-Wiki and Obsidian skills | Agent-owned path and generation manifest | Writing behavior is skill-guided; path ownership and manifest checks are enforceable |
| Source support | Native agent reads the cited source | Registry validates source reference, captured/as-of times, excerpt and hash | Reference/hash checks are enforceable; semantic truth remains model/human judgment |
| Forgetting | Native conversation can express an explicit forget request | Tombstone ledger, active-index filtering and file retirement | Registry/index/file state is enforceable on the supported path; arbitrary shell access is not a security boundary |
| Scheduling | One native Hermes cron job | Registry lease, idempotency and run reconciliation | Native scheduler and registry lease; no Real-Ming scheduler fork |
| Backup/recovery | Existing protected control-plane backup | Include registry, tombstones, manifests and generated paths | Backup/restore hashes and reconciliation are enforceable |
| Telegram presentation | Native gateway | No formatter or response wrapper | Native Hermes; preserved by design |

Real-Ming must not read or reinterpret every native memory deletion. An explicit
forget request is a separate user-intent operation. It does not change native
memory settings, delete native memory, or claim that Hermes's compact memory
has forgotten anything.

## Minimal state and paths

The registry is metadata and a coordination ledger, not a searchable memory
corpus. It contains no full conversation archive and no duplicate copy of
`MEMORY.md` or `USER.md`.

Each candidate record contains only:

```text
candidate_id
fingerprint (stable hash of the bounded candidate envelope)
kind (explicit-save | decision | correction | source-backed-artifact)
trust_domain / allowed_roles
source references, captured_at, as_of, sensitivity, retention class
support disposition (supported | unsupported | stale | unavailable | superseded | needs-review)
status (staged | claimed | published | quarantined | forgotten | needs-repair)
run_id, lease token/expiry, publication epoch, target generation/page ids,
bounded candidate-to-page dependencies, created/updated timestamps, failure code
```

The registry singleton separately stores `active_generation_id` and the
manifest identity for the current publication epoch; those values are not
copied into every candidate record.

The bounded candidate envelope or source pointer lives in the existing
agent-owned staging area, subject to the current retention policy. The registry
stores the pointer and hash, not an unlimited transcript. Generated pages,
indexes, manifests and logs live below the native vault's agent-owned area;
human-authored notes remain in their separate path.

The exact directory names and whether a dot-prefixed generated directory is
appropriate remain an implementation choice. The current handoff's warning
about Obsidian indexing tens of thousands of Agent Brain generations is a
separate concern and must not be silently applied to the native vault.

## Candidate capture and selection

### Capture without ordinary-turn interception

There is no `pre_llm_call`, gateway wrapper or universal session listener in
this design. A normal question stays a normal Hermes question. A candidate is
created through one of two deliberate paths:

1. **Explicit capture:** Ming asks Hermes to save a bounded fact, decision,
   correction, research result or artifact to the wiki. The knowledge-capture
   skill asks for a source or records that the item is unsupported; Hermes then
   calls the candidate operation.
2. **Marked durable signal:** during a substantial, source-backed task, Hermes
   may deliberately mark a decision, correction or artifact for consolidation.
   The mark points to the relevant session turn, Work Item, artifact or source;
   it does not copy the whole conversation. If no mark is emitted, the nightly
   job does not infer that every turn is eligible.

The nightly job processes only staged, unforgotten candidates. It may use native
session search to inspect the bounded references needed to explain a candidate,
but it does not sweep or summarize all Telegram sessions. This is a quality and
privacy boundary, not an assertion that the native model can never choose a
poor candidate. The registry rejects malformed, over-sized, duplicate,
secret-bearing or unreferenced envelopes.

The capture skill is guidance: it can be ignored or misunderstood by a model.
The registry's schema, size, source-reference, secret-pattern and idempotency
checks are enforceable at the Real-Ming operation boundary. No unsupported
candidate is silently promoted merely because a skill asked for it.

## Consolidation and publication flow

```text
explicit save / marked durable signal
  → bounded candidate envelope + source pointer
  → registry admission, fingerprint and tombstone check
  → native Hermes cron claims one lease
  → Hermes reads only the referenced evidence
  → source-support + freshness checks
  → native LLM-Wiki/Obsidian synthesis in a temporary generation
  → claim citations, index and link lint
  → conflict/uncertainty quarantine OR deterministic activation of an immutable generation
  → registry commit after activation and file verification
  → supported on-demand cited retrieval
```

Publication is automatic only for an allowlisted Trust Domain, supported source
type and claim class whose evidence checks pass. An old source is not made
current by hashing it. Claim freshness is evaluated against a source-specific
policy:

- schedules, tasks and mail require a short current window and are stale when
  that window expires; they are excluded from the first implementation slice
  unless a separate source-specific profile is approved;
- project and research material records an `as_of` date and a configured
  review window; and
- durable decisions and stable reference material remain usable only while no
  superseding correction or explicit forget tombstone exists.

The initial windows are configuration inputs, not hard-coded facts. A source
without a known freshness policy is quarantined until one is defined. Every
published claim must retain the source reference, source excerpt or structured
field used, `captured_at`, `as_of`, a support disposition and any
uncertainty/inference label. The disposition is one of `supported`,
`unsupported`, `stale`, `unavailable`, `superseded` or `needs-review`. A
validator checks that the referenced source can still be read, that the
excerpt/field matches the recorded source version, and that the claim is not
past its retrieval-time freshness window. The presence of a disposition and
matching evidence is enforceable; whether Hermes interpreted that evidence
correctly remains model/human judgment. A user-authored statement may support
the narrower claim “Ming said/decided X” without independently proving an
external claim contained in it. Source account/resource routing and provider
failure states remain part of the evidence record.

No generated page writes Notion, Calendar, email, GitHub, Vercel, Agent Brain,
native memory or another Source of Record. Promotion to those systems remains a
separate authorized operation.

## Publication authority and reader contract

The deterministic Real-Ming `activate_generation` operation is the only
publication authority for the generated wiki area. Hermes writes a candidate
generation below an agent-owned temporary/staging root; the supported system
does not recognize a Hermes skill, Obsidian client or direct filesystem edit of
`index.md` or a directory name as activation. Write permissions for those
paths should be withheld from non-authority processes; if an out-of-band edit
is nevertheless possible, the registry's active reference remains unchanged
and reconciliation marks the view `needs-repair`. Arbitrary filesystem write
access is outside the hard security boundary, just as arbitrary reads are.

Each immutable generation contains its pages, `index.md`, `log.md` and a
manifest. The registry stores one `active_generation_id`, a monotonically
increasing publication epoch and the manifest identity. The activation
operation validates the manifest, source/tombstone epoch, lease token and
path containment in one serialized registry transaction, then changes only
that active-generation reference. Generation files are never edited in place.
Relative paths containing `..`, absolute paths, symlink escapes or targets
outside the configured generated root are rejected.

The supported `wiki_retrieve` operation reads the active-generation reference,
loads the matching immutable manifest, checks tombstones and retrieval-time
freshness, and returns a bounded cited result. A reader retries if the active
reference changes during the read. It never searches staging, quarantine or
superseded generations. Registry unavailability, a missing manifest or a
hash/path mismatch fails closed for wiki knowledge; ordinary Hermes chat and
native memory continue independently.

The native LLM-Wiki skill remains the reasoning and synthesis guide. A
Ming-specific retrieval instruction directs generated-area queries through
`wiki_retrieve`; the bundled skill itself is not edited. An Obsidian-visible
directory, if provided, is a separately materialized view of the active
generation. It is eventually consistent and never the publication authority;
a mismatch is shown as `needs-reconcile` rather than served as canonical
knowledge. Human-authored notes remain outside this writer-owned path.

### Generation continuity and retention

An active generation is a complete snapshot of all currently published,
non-suppressed pages; it is not only the current run's candidate batch. A run
starts from the previous active generation's immutable manifest, carries
forward every still-valid page, merges the newly admitted pages, and writes a
new complete immutable generation. The implementation may deduplicate page
bytes by content hash, but the active manifest must resolve every page without
consulting staging, quarantine or superseded generations. Consequently,
publishing page B after page A keeps both pages retrievable, while forgetting A
produces a later snapshot that retains B and suppresses A.

The first slice bounds the active snapshot to 128 pages, 128 KiB per page and
16 MiB total, and retains at most three immutable generations (the active
generation plus two rollback generations) under a 64 MiB generated-root cap.
If a run would exceed those limits, it remains unactivated and reports
`needs-repair`/`storage-limit` rather than evicting the active generation.

## Forgetting contract

An explicit “forget this wiki knowledge” request is handled promptly and is
not placed behind an ordinary uncertain-claim review queue.

1. The operation normalizes the requested subject, aliases, source references
   and known page ids, then takes the same serialization boundary used by
   publication. It writes an append-only tombstone and increments the
   publication epoch before accepting another candidate for the subject.
2. The active retrieval index is rebuilt or filtered without tombstoned
   candidates. Normal `wiki_retrieve` refuses a tombstoned candidate even if an
   old index entry or candidate pointer is supplied. A repeated request is
   idempotent.
3. The tombstone records bounded candidate-to-page dependencies. If a
   multi-source page cannot be safely edited without retaining the forgotten
   claim, the whole page, index summary and excerpt are suppressed until a
   clean generation is rebuilt. Logs retain opaque identifiers and operation
   status, not forgotten prose. Staging and quarantine are excluded from normal
   retrieval and follow the retention purge policy.
4. Publication and forgetting use a conditional commit with the same registry
   lock/transaction, publication epoch and lease token. A worker whose lease
   expired or whose epoch is older than the tombstone cannot activate a
   generation. The authoritative commit rechecks the tombstone; checks made
   only before the transaction are insufficient.
5. An in-flight retrieval checks the tombstone before loading content and again
   before returning it. Content already delivered in a prior Telegram message
   is outside the wiki-forget guarantee; native memory, session history and
   authoritative provider records are also separate operations.
6. A forget acknowledgement is `suppressed` only after the local tombstone and
   retrieval filter are durable. It becomes `cleanup-complete` only after
   active generated files and known derivatives are retired. Independently, it
    is `restore_safe` only after the independent head append succeeds and a
   read-back proves that the head contains the tombstone at or above the local
    tombstone epoch. A failed append is `head_sync_pending`: local retrieval is
    suppressed, but the operation must not claim restore-safe completion.
   Superseded generations, device views and backups remain recovery artifacts
   until their existing retention purge completes; the system never calls that
   ordinary purge cryptographic erasure.
7. Restore loads the registry and tombstones before enabling wiki retrieval. A
   restore snapshot carries the highest local tombstone epoch and any
   `head_sync_pending` outbox entries. The independent append-only tombstone
   head in the existing protected backup store is read and verified first;
   recovery replays every head entry newer than the restored snapshot and
   requires the head epoch to cover the snapshot's highest locally recorded
   epoch. A readable but incomplete head is not sufficient: if a pending entry
   exists, the head epoch is lower, or completeness cannot be established, the
   generated knowledge path stays disabled and is marked `needs-repair` rather
   than risking resurrection. A forget that happened after the last backup and
   before its head append cannot be inferred after host loss, so the supported
   system makes no restore-safety claim and fails closed.

There is an important enforcement boundary. The current native Hermes service
account can read files that it is permitted to read, including arbitrary shell
paths. The registry/index/retrieval contract can enforce forgetting on the
supported knowledge path, but it cannot make an unrestricted `cat` of a still
present plaintext file impossible. The implementation must therefore either:

- keep the supported path as the product guarantee and label arbitrary direct
  filesystem reads as outside the security boundary; or
- introduce a stronger encrypted/brokered generated store whose key is not
  available to the Hermes filesystem process.

The second option is a materially larger architecture and is not included in
the lightweight implementation without a separate CEO decision. No document
may call the first option “cryptographic forgetting.”

## Crash consistency and recovery

SQLite registry state and ordinary Markdown files do not share one transaction.
The implementation uses a small write-ahead protocol whose only publication
authority is `activate_generation`:

1. Claim a candidate with a unique `run_id` and lease. A duplicate fingerprint
   returns the existing record; a second live lease is rejected.
2. Write the bounded candidate/generation files to a unique temporary directory,
   flush them, and calculate per-file hashes plus a generation manifest. The
   manifest and all Markdown files are immutable once staged.
3. Rename the verified temporary directory to a unique immutable generation
   directory on the same filesystem and flush its parent directory. This
   filesystem installation is durable but still unreachable to supported
   readers because the registry's active pointer is unchanged. Ask
   `activate_generation` to revalidate source/tombstone epoch, lease token,
   path containment and manifest contents, then atomically change the single
   `active_generation_id` and publication epoch in one SQLite transaction.
   SQLite and the filesystem do not share a transaction; the registry pointer
   is the sole event that makes the already-installed generation eligible.
   Temporary directories are never indexed.
4. Re-read the active generation and manifest through the same reader contract.
   Only then mark the registry record `published` and the run successful. An
   Obsidian/device projection is updated after this point and can be marked
   `needs-reconcile` without changing canonical retrieval.
5. On startup or retry, reconcile both sides:
   - a complete verified immutable generation with a non-terminal registry
     record may finish the conditional SQLite activation only if its lease
     token and publication epoch are still current;
   - a complete generation with no committed pointer is an orphan candidate;
     quarantine it for inspection or remove it according to retention while
     leaving the prior active generation in service;
   - a `published` record with missing or mismatched files becomes
     `needs-repair`, clears the active reference and is excluded from retrieval;
   - incomplete temporary files are removed or quarantined without being
     presented as knowledge.

The same serialized protocol applies to forgetting: the tombstone is durable
before file retirement, and a crash leaves the subject suppressed even if
cleanup needs a retry. A successful run means registry, manifest, index and
active files agree; it does not mean a model's prose is true merely because
the hashes match.

## Supported job-local isolation

The first implementation slice uses the pinned Hermes runtime's explicit
per-invocation controls, not a name or profile as a security claim. The native
cron entry is a script-only trigger whose wrapper starts a fresh Hermes
`AIAgent` with `skip_memory=True`. Its `real-ming` MCP server configuration
must use the pinned `tools.include` filter with this exact callable set:

- `real_ming_knowledge_list_candidates` (read bounded metadata only);
- `real_ming_read_knowledge_source` (read the cited, allowlisted source only);
- `real_ming_stage_knowledge_generation` (write below the job staging root
  only); and
- `real_ming_wiki_retrieve` (read the active, supported generated path only).

`real_ming_capture_knowledge_candidate` is an interactive, deliberate-capture
operation and is not exposed to the nightly consolidation job. The job does
not receive `activate_generation`; activation is a deterministic local runner
operation after the model exits. The preflight reads the effective MCP
`tools/list` result and requires set equality with the four names above. Every
`enabled_toolsets` value is only a runtime grouping, not an operation filter;
if the pinned runtime requires an MCP toolset identifier, it is acceptable
only when the resolved callable set remains exactly these four names. Every
other Real-Ming operation—including `real_ming_list_work_items`,
`real_ming_get_work_item`, `real_ming_link_execution_task`,
`real_ming_run_scheduled_report`, `real_ming_list_calendar_events`,
`real_ming_create_calendar_event`, `real_ming_search_mail`,
`real_ming_read_email` and `real_ming_draft_email`—must be absent and rejected
by the server capability boundary. A filesystem sandbox alone is not enough
to prevent an MCP tool from performing an external write.

The wrapper runs under a dedicated Hermes home and staging work directory
whose operating-system permissions expose the generated staging root and
read-only cited evidence only; the main Hermes home, native memory/profile
files, configuration, skills/plugins, cron store, provider credentials and
unrelated paths are not writable or mounted. The compatibility preflight must
verify the exact pinned constructor, `tools.include` behavior, effective list
and OS denials before implementation or activation.

Task 0 uses a fake/local model boundary with networking and provider
credentials removed; it proves containment without making a model call. A
later, separately authorized one-shot may use only a named Hermes auth profile
resolved by the pinned credential store, mounted read-only for the dedicated
job identity. The profile name and environment variable name may appear in
evidence, never the credential value, and the job must not inherit the main
Telegram, Notion, Calendar, mail, GitHub or Vercel secrets.

The compatibility preflight must read the exact pinned Hermes source and
exercise the constructor/CLI flags and MCP include filter. Any missing flag,
allowlist-resolution error, extra callable, or fallback to the full default
toolset fails closed and makes the job ineligible for activation. No global
memory restriction is applied to contain it. The job may create its own normal
Hermes session record, which is not a prohibited native-memory write.

Guardrails cover candidate/evidence bytes, output pages/bytes, model and tool
calls, storage growth, one active lease, wall-clock time and retries. A
consolidation failure is recorded and isolated; a concurrent ordinary Telegram
turn may continue and may legitimately update native memory through Hermes.
The design therefore claims only “no prohibited writes and no unacceptable
degradation observed under the tested workload,” never that an additive job can
make memory quality incapable of worsening.

## Resource and quality guardrails

The proposed initial defaults are deliberately bounded and can be changed by a
versioned, reviewable and appropriately approved configuration change. Retries
share the original wall-clock budget; a retry never resets the timer:

| Limit | Initial value | Failure behavior |
| --- | --- | --- |
| Concurrent consolidation leases | 1 | Second live lease returns `busy` |
| Candidates per run | 12 | Remaining candidates stay queued |
| Candidate envelope | 64 KiB each | Candidate is rejected |
| Cited source bytes | 256 KiB each, 2 MiB per run | Candidate is quarantined |
| Model calls | 1 per run | Run fails closed |
| MCP/tool calls | 48 per run | Run fails closed |
| Output pages | 128 per generation, 128 KiB per page | Generation remains unactivated |
| Active snapshot | 16 MiB | Generation remains unactivated |
| Generated-root storage | 64 MiB, retaining at most three generations | Retention/reconcile runs; active generation is never evicted |
| Wall time and retries | 10 minutes total, at most two retries | Run records a bounded failure |

No Telegram delivery occurs by default. The run result is recorded for the
dashboard/next operational report, without dumping generated pages into chat.
For resource noninterference, record 20 short native-chat baseline samples and
20 paired samples while consolidation runs. Pass only when p95 time to first
native progress is no more than baseline p95 + 2 seconds and no more than 5
seconds absolute, p95 completion is no more than 125% of baseline, and no
paired turn is dropped or fails.

The job must not write native Hermes configuration, memory files, profile files,
skills, plugin manifests or cron definitions. Its own normal session history is
allowed. Native chat and native memory are tested while the job is running and
when its MCP/skill path fails. A model's claim that the job is complete is not
evidence; file hashes, registry state, exit status and retrieval behavior are.

## Acceptance matrix

Controlled tests use only the existing Real-Ming System Harness and Provider
Adapter Contract Harness. They must prove:

1. ordinary chat creates no candidate; the consolidation job produces no
   prohibited native-memory, profile, configuration, skill, plugin, cron or
   provider writes; and a concurrent ordinary chat can still perform legitimate
   native learning. A cron session record is allowed;
2. explicit capture admits one bounded candidate, rejects an unreferenced or
   secret-bearing candidate, and deduplicates a replay;
3. marked decisions, corrections and source-backed artifacts are selected
   without sweeping unrelated sessions;
4. missing, stale, hash-mismatched, unavailable, superseded and semantically
   unsupported sources are quarantined with the appropriate disposition, while
   a valid claim retains matching evidence, source routing and retrieval-time
   freshness metadata. Adversarial fixtures prove that a hash alone is not
   accepted as truth;
5. one lease prevents overlap, candidate/time/retry limits are respected, and
   a failed run does not fail an ordinary Telegram turn;
6. only `activate_generation` can make a generation eligible; readers use the
   active reference and fail closed on registry, manifest or path mismatch;
7. a successful generation is readable through the supported retrieval path and
   an uncertain/conflicted or freshness-expired page is not returned as
   authoritative knowledge;
8. an explicit forget suppresses new intake, active index retrieval, published
   files, derived pages, in-flight publication and post-restore resurrection;
   cleanup status and old-backup purge are separately reported;
9. expired workers, duplicate forgets and final-commit races cannot activate
   forgotten content;
10. crashes between each registry/file step reconcile to either a complete
   published generation or a repair/quarantine state, never a false success;
11. path traversal and symlink escapes are rejected; authored notes remain
   unchanged and generated pages have one writer;
12. the exact evidence, output, model/tool, storage and retry budgets hold, a
    registry outage fails closed for wiki retrieval, and the measured
    concurrent-chat p95 thresholds are met; ordinary Telegram chat remains
    available;
13. backup/restore includes registry, tombstones, manifests and generated files
    without including credentials or native Hermes OAuth material, and refuses
    to enable retrieval when a pending local tombstone is not covered by the
    independent head; and
14. publishing A, then an unrelated B, retains both in the next complete active
    snapshot; forgetting A suppresses A while B remains retrievable and the
    generated-root retention cap remains satisfied.

Authorized rollout is staged: review the implementation artifact; approve its
deployment with recurring execution disabled; run one authorized live
one-shot; review its evidence; then make a separate decision to enable exactly
one recurring native cron row. The one-shot adds one small source-backed note,
fresh-session retrieval, explicit forgetting, a concurrent normal Telegram
question, forced consolidation failure/retry, restart/reconciliation, and
backup/restore verification. These live checks and the recurring-enable step
are not authorized by this design document.

## Documentation and implementation boundary

This document is the reviewed design record. The bounded implementation plan
and Tasks 0–8 have now been executed locally under explicit implementation
approval, with controlled evidence recorded separately. That approval does not
authorize deployment, provider/configuration mutation, live acceptance, cron
creation/activation, Telegram delivery, local mirror synchronization or Task 9
deletion. Stale code may be retired only after its replacement is live-verified,
one focused change at a time. Superseded documents are relabeled with scope
and date; they are not deleted.

## Decisions recorded for the first slice

Ming approved supported-path forgetting, explicit decisions/corrections and
deliberately selected project/research artifacts (90-day project and 30-day
research freshness), the Azure-canonical generated/staging paths, silent
success with operational failure/backlog health, and the inactive
`02:00 Asia/Kuala_Lumpur` manifest. Calendar, task and mail claims, an
encrypted/brokered store, and a local mirror are outside this slice. Arbitrary
direct filesystem reads remain outside the supported forget guarantee.

Only the following remain separate CEO actions: review the controlled artifact;
approve deployment with recurrence disabled; authorize one harmless live run;
review live evidence; and optionally approve one recurring native cron row.
