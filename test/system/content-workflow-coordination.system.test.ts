import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { PortfolioProjectInput } from "../../src/portfolio/project-portfolio.js";
import type { AgentBrainEvidenceReadResult } from "../../src/evidence/evidence-broker.js";

const now = "2026-09-03T02:00:00.000Z";
const projectId = "project:ming-creatives-content";
const workflowRecord = "content-workflow:board:card-142";

describe("RM-32 content workflow coordination", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const contentProject: PortfolioProjectInput = {
    id: projectId,
    name: "Ming Creatives content",
    portfolioState: "owned active",
    repository: null,
    productionBranch: null,
    deploymentIdentifiers: { github: null, vercel: null },
    evidenceIdentity: "agent-brain:ming-creatives-content",
    responsibleRoles: ["CMO"],
    sensitivity: "internal",
    health: "healthy",
    operatingInstructions: "content-workflow:operating-instructions",
    sourceLinks: [
      {
        kind: "content-workflow",
        reference: "content-workflow:board",
        asOf: "2026-09-03T01:00:00.000Z",
      },
      {
        kind: "agent-brain",
        reference: "agent-brain:ming-creatives-content",
        asOf: "2026-09-03T01:00:00.000Z",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  function start(
    options: { readonly evidence?: { readonly stale?: boolean; readonly unavailable?: boolean } } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm32-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      evidence: {
        provider: {
          read: async (): Promise<AgentBrainEvidenceReadResult> =>
            options.evidence?.unavailable === true
              ? { kind: "failed", reason: "provider-unavailable" }
              : {
                  kind: options.evidence?.stale === true ? "stale" : "ok",
                  sourceIdentity: "agent-brain:ming-creatives-content",
                  canonicalEvidenceId: "agent-brain:evidence:content-brief-1",
                  sourceReference:
                    "agent-brain://ming-creatives-content/brief-1",
                  content:
                    "Audience research summary for the September series.",
                  citations: ["agent-brain://ming-creatives-content/brief-1"],
                  asOf:
                    options.evidence?.stale === true
                      ? "2026-08-01T01:00:00.000Z"
                      : "2026-09-03T01:00:00.000Z",
                  retrievedAt: now,
                  freshness:
                    options.evidence?.stale === true ? "stale" : "current",
                },
        },
      },
    });
    harnesses.push(harness);
    harness.upsertPortfolioProject(contentProject);
    return harness;
  }

  it("represents the content project with its workflow source and CMO responsibility", () => {
    const harness = start();

    const project = harness.portfolioProject(projectId);

    expect(project?.responsibleRoles).toEqual(["CMO"]);
    expect(
      project?.sourceLinks.find((link) => link.kind === "content-workflow")
        ?.reference,
    ).toBe("content-workflow:board");
  });

  it("links a Content Creation Work Item to its workflow record instead of copying it", async () => {
    const harness = start();

    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "selection",
      intent: "Choose the September series topic",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.workItem.accountableExecutive).toBe("CMO");
    expect(result.workItem.workstream).toBe("Content Creation");
    expect(result.workflowLink).toBe(workflowRecord);

    const view = await harness.masterTasksView("CMO Work View");
    expect(view.map((record) => record.workItemId)).toContain(
      result.workItem.id,
    );
    // Linked, not copied: the record reference travels, the workflow's own
    // body does not become Real-Ming state.
    expect(JSON.stringify(view)).toContain(workflowRecord);
    expect(JSON.stringify(view)).not.toContain(
      "Audience research summary for the September series.",
    );
  });

  it("serves the CMO only the evidence allowed for that Work Item", async () => {
    const harness = start();
    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "Research the September series topic",
    });
    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;

    const allowed = await harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CMO",
      workItemId: result.workItem.id,
      purpose: "content research",
      portfolioProjectId: projectId,
    });
    const otherRole = await harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "Personal CFO",
      workItemId: result.workItem.id,
      purpose: "content research",
      portfolioProjectId: projectId,
    });

    expect(allowed.kind).toBe("served");
    expect(otherRole).toMatchObject({ kind: "denied", reason: "not-authorized" });
  });

  it("records the task's evidence in the Outcome Report", async () => {
    const harness = start();

    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "distribution",
      intent: "Publish the September series opener",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    const report = harness.outcomeReport(result.workItem.id);
    expect(report?.completedEffect.kind).toBe("content-workflow-coordination");
    expect(report?.completedEffect.value).toContain("distribution");
    expect(report?.completedEffect.value).toContain(workflowRecord);
  });

  it("keeps the workflow authoritative when its record changes", async () => {
    // Real-Ming links rather than copies, so a workflow update must not leave a
    // stale snapshot behind that reads as though it were current.
    const harness = start();

    await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "production",
      intent: "Produce the September series opener",
    });
    const updated = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "production",
      intent: "Produce the September series opener",
    });

    expect(updated.kind).toBe("coordinated");
    if (updated.kind !== "coordinated") return;
    expect(harness.workItems()).toHaveLength(1);
    const report = harness.outcomeReport(updated.workItem.id);
    // The record reference is what travels. A superseded summary must not be
    // presented as the current state of the workflow.
    expect(report?.completedEffect.value).toContain(workflowRecord);
    expect(report?.completedEffect.value).not.toContain("awaiting edit");
    expect(report?.completedEffect.value).toBe(
      `production for ${workflowRecord}`,
    );
  });

  it("labels a stale workflow source rather than treating it as authoritative", async () => {
    // The portfolio already computes freshness for the content-workflow source
    // link. Coordinating without reading it presents a months-old workflow
    // reference as the current authority.
    const harness = start();
    harness.upsertPortfolioProject({
      ...contentProject,
      sourceLinks: contentProject.sourceLinks.map((link) =>
        link.kind === "content-workflow"
          ? { ...link, asOf: "2026-06-01T01:00:00.000Z" }
          : link,
      ),
    });

    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "Research the September series topic",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.workflowFreshness).toBe("stale");
  });

  it("refuses to coordinate against a project it may not touch", async () => {
    const harness = start();

    const missing = await harness.coordinateContentWorkItem({
      projectId: "project:absent",
      workflowRecord,
      task: "research",
      intent: "Research",
    });
    harness.upsertPortfolioProject({
      ...contentProject,
      id: "project:not-cmo",
      responsibleRoles: ["CTO"],
    });
    const wrongRole = await harness.coordinateContentWorkItem({
      projectId: "project:not-cmo",
      workflowRecord,
      task: "research",
      intent: "Research",
    });
    harness.upsertPortfolioProject({
      ...contentProject,
      id: "project:no-workflow",
      sourceLinks: contentProject.sourceLinks.filter(
        (link) => link.kind !== "content-workflow",
      ),
    });
    const noWorkflow = await harness.coordinateContentWorkItem({
      projectId: "project:no-workflow",
      workflowRecord,
      task: "research",
      intent: "Research",
    });
    const unbounded = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "x".repeat(241),
    });

    expect(missing).toMatchObject({ reason: "project-not-in-portfolio" });
    expect(wrongRole).toMatchObject({ reason: "project-not-cmo" });
    expect(noWorkflow).toMatchObject({ reason: "workflow-source-missing" });
    expect(unbounded).toMatchObject({ reason: "unbounded-content-intent" });
    expect(harness.workItems()).toHaveLength(0);
  });

  it("durably records the evidence citation for the selected task", async () => {
    const harness = start();

    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "Research the September series topic",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    const served = harness
      .auditTrail(result.workItem.id)
      .find((event) => event.type === "project-evidence.served");
    expect(served?.details["canonicalEvidenceId"]).toBe(
      "agent-brain:evidence:content-brief-1",
    );
    expect(served?.details["executive"]).toBe("CMO");
    expect(served?.details["portfolioProjectId"]).toBe(projectId);
    expect(served?.details["freshness"]).toBe("current");
    expect(served?.details["citationCount"]).toBe(1);
  });

  it("labels stale project evidence rather than presenting it as current", async () => {
    const harness = start({ evidence: { stale: true } });
    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "Research the September series topic",
    });
    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;

    expect(result.evidence?.kind).toBe("stale");
    expect(result.evidenceFreshness).toBe("stale");
  });

  it("labels evidence unavailable when no evidence source is configured at all", async () => {
    // No broker is the most degraded case there is. Reporting it as current
    // would claim evidence that was never even sought.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm32-noevidence-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
    });
    harnesses.push(harness);
    harness.upsertPortfolioProject(contentProject);

    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "Research the September series topic",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.evidence).toBeUndefined();
    expect(result.evidenceFreshness).toBe("unavailable");
  });

  it("labels degraded project evidence rather than coordinating as if it were healthy", async () => {
    const harness = start({ evidence: { unavailable: true } });

    const result = await harness.coordinateContentWorkItem({
      projectId,
      workflowRecord,
      task: "research",
      intent: "Research the September series topic",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.evidence?.kind).toBe("unavailable");
    expect(result.evidenceFreshness).toBe("unavailable");
  });
});
