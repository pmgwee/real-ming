# RM-17 Personal Context selection and evidence

> **Completed — one small, non-secret Personal Context item was selected and
> verified through the RM-17 ingestion boundary.** The selected specimen is
> recorded below. It remains a Candidate Envelope for later governed
> compilation; it is not an imported truth or memory dump.

## Why this cannot be delegated

The Personal Context Package is an explicit CEO allowlist, not an automatic
import of the Notion workspace, `real-me`, or the local filesystem. An agent
may validate and ingest the exact item after approval, but it may not decide
which personal information becomes durable context.

## Choose one item

Reply with one row containing every field below. Prefer a small curated excerpt
or one markdown file; do not paste credentials, recovery codes, identity
documents, payment-card details, account numbers, or an entire Notion export.

| Field | Required value |
| --- | --- |
| Page/file title | Human-recognizable name |
| Purpose | The decision or assistance this improves |
| Trust Domain | `Personal`, `Ming Creatives`, `Academic`, `Entertainment`, or `Finance` |
| Sensitivity | `general`, `private`, or `sensitive` (`secret` is excluded) |
| Allowed roles | Exact Executive Roles that may read the raw item |
| Authority | `authoritative fact`, `personal plan`, `reflection`, or `historical record` |
| Freshness | How often it changes or should be rechecked |
| Source reference | Notion page identifier/URL or local file path |
| Snapshot or pointer | `snapshot` for a bounded copy, or `pointer` to the Source of Record |

## Approved first specimen

| Field | Approved value |
| --- | --- |
| Page/file title | Working preferences and routine |
| Purpose | Help the CEO receive useful personalized daily planning |
| Trust Domain | `Personal` |
| Sensitivity | `private` |
| Allowed roles | `COO` |
| Authority | `personal plan` |
| Freshness | Monthly review |
| Retention class | `personal-context-30d` |
| Source reference | `personal-context/working-preferences.md` (local, Git-ignored) |
| Snapshot or pointer | `snapshot` |

The file contains only the bounded planning preferences approved in the CEO
conversation. It contains no credentials, financial account details,
identity documents, or other Sensitive Secrets.

## What happened after approval

1. RM-17 validates the allowlist entry and scans the bounded input for
   Sensitive Secrets.
2. It creates a Candidate Envelope containing the source, stable reference,
   captured and `as of` times, content hash, authority, sensitivity, Trust
   Domain, permitted roles, retention class, supersession, and snapshot/pointer.
3. The raw staging payload is encrypted outside Git and marked
   `verified-ingestion` or `quarantined`; its finite retention class controls
   purge eligibility (`personal-context-30d` is 30 days; a stricter class such
   as `personal-context-7d` is honoured).
4. No Compiled Knowledge, Hot Runtime Memory, Source of Record, or Agent Brain
   record is changed by RM-17. Later compilation is RM-42 and requires its own
   governed path.

## Expected checks

| Test | Expected result |
| --- | --- |
| Re-ingest the same manifest entry | Same Candidate Envelope identity/content hash; no duplicate promotion |
| Change the source content | New hash and a superseding envelope; prior evidence remains append-only |
| Submit a token, recovery code, card detail, or identity document | Rejected/quarantined before encrypted staging |
| Read with an unlisted Executive Role | Denied; no raw payload returned |
| Inspect Git | No raw staging file, secret, or encryption key tracked |

Retention classes are explicit policy names ending in a finite duration (`d`,
`w`, `m`, or `y`). The CEO allowlist stores a digest of the complete manifest,
so changing roles, Trust Domain, sensitivity, source mode, or retention policy
requires a fresh approval.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Source reference is missing or ambiguous | Stop and provide the exact Notion page ID/URL or file path |
| Sensitivity is `secret` | Choose a redacted bounded item; secrets are never ingested |
| The item is a whole workspace/export | Narrow it to one CEO-selected page or file |
| The item has no stable `as of` time | Supply the source timestamp or approve a captured-at pointer |
| A role needs another domain | Use an Approved Projection later; do not widen RM-17 raw access |
