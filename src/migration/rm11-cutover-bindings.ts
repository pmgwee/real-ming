import type { CutoverBindings } from "./master-tasks-cutover.js";
import type { CutoverTitleMatchCounts } from "./cutover-plan-builder.js";

/**
 * RM11-CUTOVER-3 is the exact Phase B continuation. RM11-CUTOVER-2 completed
 * Phase A, but its published Step 4 carried a stale DIGEST-1 label while its
 * bound values and executable behavior used DIGEST-2. Version 3 binds the
 * unchanged decisions and source snapshot plus the completed Phase A report.
 *
 * Every value here is published in the pending
 * CEO-Office/RM-11-phase-b-approval-packet.md Approval. The per-record decisions
 * are deliberately NOT here: they carry Ming's own task titles and stay in the
 * gitignored evidence directory, joined onto these bindings at run time.
 */
export const rm11CutoverBindings: CutoverBindings = {
  planVersion: "RM11-CUTOVER-3",
  digestVersion: "RM11-DIGEST-2",
  digestSha256:
    "f6d31c8d318cdefb7f488df68f50be64829f99dc6b38369f1450f7bd721a17b6",
  backupSha256:
    "c66d697d04a7da1f0be61e2827e250a84cca47f1c10329f985757dda05546325",
  phaseAReportSha256:
    "a148737ae4d6e61761570d5726130898d9c580a361bb070cf3dffaad725f2f7f",
  executionPhase: "B",
  databaseId: "9f337269-ae6b-431a-916d-cf69675d1a57",
  dataSourceId: "fd13a605-5781-4b55-abc0-adfefc8aa19b",
  archivePrefix: "ARCHIVED EVIDENCE",
  sources: [
    { dataSourceId: "5c389b83-bac5-8314-ac64-871b9f732931", recordCount: 4 },
    { dataSourceId: "6f2b0222-763e-4330-b52b-6a42b0adce60", recordCount: 8 },
    { dataSourceId: "6dbcdc0d-2de5-46d8-acb9-29fee86afd69", recordCount: 7 },
    { dataSourceId: "85da1881-c49d-444e-a53e-5fe90ffaf3e0", recordCount: 15 },
    { dataSourceId: "8c089b83-bac5-83be-8a4e-87745ce84c65", recordCount: 0 },
  ],
  reviewedRecordCount: 34,
  canonicalImportCount: 30,
  archiveOnlyCount: 4,
  sourceCommitmentCount: 0,
  lifecycleCounts: [
    { lifecycle: "Captured", count: 15 },
    { lifecycle: "Planned", count: 10 },
    { lifecycle: "Waiting/Blocked", count: 2 },
    { lifecycle: "Ready for CEO Review", count: 3 },
    { lifecycle: "Cancelled", count: 4 },
  ],
  routingCounts: [
    { workstream: "Content Creation", accountableExecutive: "CMO", count: 4 },
    { workstream: "MicroSaaS", accountableExecutive: "CTO", count: 6 },
    { workstream: "Academic", accountableExecutive: "CAO", count: 10 },
    { workstream: "Career Job", accountableExecutive: "COO", count: 1 },
    { workstream: "Personal Life", accountableExecutive: "COO", count: 7 },
    { workstream: "Finance", accountableExecutive: "Personal CFO", count: 2 },
  ],
};

/**
 * How the 34 reviewed rows join onto the backup. Two rows were reviewed under a
 * description rather than a literal title — a bracketed project name and a
 * link-only malformed record — and three source titles are blank. Any other
 * split means the digest and the backup no longer describe the same records.
 */
export const rm11CutoverTitleMatches: CutoverTitleMatchCounts = {
  exact: 29,
  blankSource: 3,
  descriptiveLabel: 2,
};
