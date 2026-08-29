# RM-10 — Share the five legacy task sources

> **Completed 29 Aug 2026.** Ming shared all five databases and the read-only
> rehearsal completed successfully. This runbook remains as the audit record.

> **TL;DR — connect the existing `Real-Ming` Notion connection to each of the five task databases below, then tell the implementation agent that all five are shared.** Do not export, duplicate, rename, or send their contents. This should take a few minutes.

---

## Why this needs Ming

RM-10 must make a read-only backup and migration rehearsal from every current task record. A Notion connection can discover and query only pages explicitly shared with it. The live access check on 29 Aug 2026 returned no visible result for all five exact database names, so an agent cannot complete the evidence-backed rehearsal until the workspace owner shares them.

The rehearsal writes only to a gitignored local `tmp/` directory. It does not edit the five databases or the live Master Tasks data source.

---

## Prerequisites

- [ ] Sign in to the Notion workspace that owns the task databases.
- [ ] Confirm the existing `Real-Ming` connection is available.
- [ ] Do not paste `REAL_MING_NOTION_TOKEN` or task contents into chat.

---

## Steps

For each database below, open its full page, select **... → Connections** (or **Connect to**), choose **Real-Ming**, and confirm access:

1. `(IP Content Creation) Task To Do List`
2. `(MicroSaaS) Task To Do List`
3. `(Academic) Task To Do List`
4. `(Job x Life) Task To Do List`
5. `(Finance) Task To Do List`

After all five are connected, reply:

> I shared all five RM-10 legacy task databases with the Real-Ming Notion connection. Continue the read-only migration rehearsal.

Do not send page contents or credentials. The implementation discovers each source by its exact title and stops if a title is missing or ambiguous.

---

## What the agent will do next

1. Discover exactly one data source for each approved title.
2. Read every page with pagination and preserve the complete source payload in a local backup under `tmp/rm10-migration-rehearsal/`.
3. Record source identifiers, counts, capture time, and SHA-256 integrity evidence.
4. Import normalized candidates into an isolated local target only.
5. Produce duplicate, missing-field, ownership, status, and proposed-commitment reconciliation reports.
6. Replay the rehearsal to prove it creates no duplicate target Work Items, then roll back the isolated target.

## Completion evidence

- Five sources were discovered after tolerating legacy capitalization and whitespace differences while retaining the canonical Real-Ming source names.
- Source record counts were `4, 8, 7, 15, 0` (34 total).
- Five timestamped backups include SHA-256 integrity evidence in the gitignored local evidence directory.
- The isolated import produced 34 candidates; replay remained at 34 and created no duplicate Work Items.
- Reconciliation found 0 duplicate candidates, 3 missing-field flags, 0 ownership ambiguities, 34 status ambiguities, 15 workstream ambiguities, and 0 proposed commitments.
- The provider manifest records `sourcesMutated: false`; the isolated target was rolled back to zero.
- No legacy task contents or backup files were committed or printed to chat.

The ambiguities are expected inputs to the RM-11 CEO reconciliation session. RM-11,
not RM-10, controls any mutation of Master Tasks or the legacy sources.

RM-11, not RM-10, controls any real Master Tasks import or legacy-source cutover.

---

## Test cases

| Test | Expected result |
| --- | --- |
| Run the live discovery after sharing | Exactly five approved source identifiers are found. |
| Run the rehearsal | Five backups with counts, timestamps, and SHA-256 evidence are written locally. |
| Inspect the source databases afterward | No source page or property was changed. |
| Replay in the same rehearsal | Isolated target count does not increase. |
| Roll back the isolated target | Target count becomes zero; backup and report evidence remain. |

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| A title is reported as not shared | Open that database as a full page and add `Real-Ming` under Connections. |
| A title is ambiguous | Two visible databases have the same exact title. Do not rename or delete either; tell the agent so it can require stable IDs. |
| Query returns 403 | The connection can see the page but lacks read-content capability; enable read access in the connection settings. |
| One database is nested inside another page | Share the database itself; sharing only an ancestor may not expose the data source. |
| Sensitive task data appears in Git status | Stop immediately. Evidence belongs only under the gitignored `tmp/` directory. |
