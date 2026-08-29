import type { CutoverBindings } from "./master-tasks-cutover.js";
import type { CutoverTitleMatchCounts } from "./cutover-plan-builder.js";

/**
 * Every value here is published in CEO-Office/RM-11-cutover-approval-packet.md,
 * which is what the CEO approved. The per-record decisions are deliberately NOT
 * here: they carry Ming's own task titles and stay in the gitignored evidence
 * directory, joined onto these bindings at run time.
 */
export const rm11CutoverBindings: CutoverBindings = {
  planVersion: "RM11-CUTOVER-1",
  digestVersion: "RM11-DIGEST-1",
  digestSha256:
    "0f094a43809c4309f09f48be9733982893a2cd608dc0378779162741fbb42039",
  backupSha256:
    "b7dee7b3ab1fb0265a1a3a8abea1eab92db4c4e597e4ed43d0c80272ba86e091",
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
