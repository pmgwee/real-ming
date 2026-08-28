# RM-09 — Share the Master Tasks parent page

> **Completed 29 Aug 2026.** Ming shared and approved the parent page. Provisioning created one Master Tasks data source and the six canonical linked Work Views; replay and live reconciliation were verified. Six accidental replay duplicates were moved to recoverable Notion Trash.

> **TL;DR — create one empty Notion page, share it with the existing `Real-Ming` connection, and send the page URL to the implementation agent.** Do not create Master Tasks yourself. This should take about one minute.

---

## Why this needs Ming

Notion only permits an API connection to create a data source inside a page that a workspace owner has explicitly shared with that connection. The `Real-Ming` token is already provisioned, but an agent cannot grant its own connection access to a new parent page.

RM-09 must create and verify the real **Master Tasks** data source and its six linked Work Views. A mocked or hand-created substitute would not satisfy the ticket and would weaken the migration evidence required by RM-10 and RM-11.

---

## Prerequisites

- [ ] Sign in to the Notion workspace that contains the five current task databases.
- [ ] Confirm the `Real-Ming` connection still exists.
- [ ] Do not paste `REAL_MING_NOTION_TOKEN` into chat, GitHub, or this repository.

---

## Steps

1. In Notion, create a new **empty page** at a stable location in your workspace.
2. Name the page **Real-Ming Operations**.
3. Open the page's `...` menu and choose **Connections** (or **Connect to**).
4. Select the existing **Real-Ming** connection and confirm the access prompt.
5. Copy the page link.
6. Reply to the implementation agent with the **page link only** and this approval sentence:

   > I approve RM-09 creating Master Tasks and its six linked Work Views inside this Notion page.

7. Do **not** create a database or add properties yourself. RM-09 owns the exact schema and must verify what it creates.

The page URL/ID identifies a container; it is not a credential. The Notion token remains only in the gitignored `.env`.

---

## What the agent will do after approval

1. Add red contract and system tests using only the approved harnesses.
2. Implement an idempotent Notion provisioning adapter and lifecycle validation.
3. Run the provision command against the approved parent page behind an explicit live flag.
4. Create **Master Tasks** and these six views over the same underlying records:
   - CEO All Work
   - COO Work View
   - Personal CFO Work View
   - CAO Work View
   - CTO Work View
   - CMO Work View
5. Write the resulting Master Tasks identifier to the local `.env` as `REAL_MING_NOTION_MASTER_TASKS_ID` without printing its value.
6. Prove idempotent read/write behavior and report the resulting Notion links for CEO review.

No legacy task database will be migrated or mutated in RM-09. That work remains separately controlled by RM-10 and RM-11.

---

## Test cases

| Test | Expected result |
| --- | --- |
| Open the new page as Ming | The page is named `Real-Ming Operations` and is otherwise empty. |
| Inspect page Connections | `Real-Ming` is listed as connected. |
| Run the future RM-09 access check | The connection can read the parent page; no database is created during the check. |
| Run provisioning once after explicit approval | One Master Tasks data source and six linked Work Views are created. |
| Run provisioning again | The same resources are discovered or reconciled; no duplicate records or databases are created. |
| Run `npm run secrets:preflight` afterward | 10/10 variables are supplied and no value is printed. |

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Real-Ming` is absent from Connections | Open Notion **Settings → Connections**, confirm the connection exists in this workspace, then retry on the page. |
| Notion reports 404 for the page | The page is not shared with the connection, or the copied URL is from another workspace. Reconnect it and copy the link again. |
| Notion reports 403 on creation | The connection lacks **Insert content** or **Update content**. Enable those capabilities in the connection settings. |
| The page already contains a hand-made Master Tasks database | Do not delete it. Tell the agent before proceeding so it can inspect and choose an evidence-preserving adoption or rename path. |
| You accidentally pasted a token | Revoke the connection token immediately, issue a replacement, and update only the local `.env`. |
