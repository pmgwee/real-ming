import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type {
  AgentBrainEvidenceProvider,
  AgentBrainEvidenceReadResult,
} from "../../src/evidence/evidence-broker.js";
import type { PortfolioProjectInput } from "../../src/portfolio/project-portfolio.js";

describe("RM-20 Evidence Broker", () => {
  let directory: string;
  let harnesses: RealMingSystemHarness[];

  beforeEach(() => {
    directory = mkdtempSync(join(process.env.TEMP ?? ".", "real-ming-rm20-"));
    harnesses = [];
  });

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const project: PortfolioProjectInput = {
    id: "project:duitsini",
    name: "DuitSini",
    portfolioState: "owned production",
    repository: "github:pmgwee/subscription-agent",
    productionBranch: "main",
    deploymentIdentifiers: {
      github: "pmgwee/subscription-agent",
      vercel: "vercel:duitsini",
    },
    evidenceIdentity: "agent-brain:duitsini",
    responsibleRoles: ["CTO", "Personal CFO"],
    sensitivity: "sensitive",
    health: "healthy",
    operatingInstructions: "github:pmgwee/subscription-agent/README.md",
    sourceLinks: [
      { kind: "github", reference: "pmgwee/subscription-agent", asOf: "2026-09-02T08:00:00.000Z" },
      { kind: "vercel", reference: "vercel:duitsini", asOf: "2026-09-02T08:00:00.000Z" },
      { kind: "agent-brain", reference: "agent-brain:duitsini", asOf: "2026-09-02T08:00:00.000Z" },
      { kind: "operating-instructions", reference: "github:pmgwee/subscription-agent/README.md", asOf: "2026-09-02T08:00:00.000Z" },
    ],
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z",
  };

  function providerFor(
    result: AgentBrainEvidenceReadResult,
    counters: { reads: number; writes: number },
  ): AgentBrainEvidenceProvider {
    return {
      read: async () => {
        counters.reads += 1;
        return result;
      },
      // This is intentionally outside the broker contract. The broker must
      // never discover or call a write path on an Agent Brain provider.
      write: async () => {
        counters.writes += 1;
      },
      writeGeneratedMarkdown: async () => {
        counters.writes += 1;
      },
      writeSqlite: async () => {
        counters.writes += 1;
      },
    } as AgentBrainEvidenceProvider & { write: () => Promise<void> };
  }

  function start(provider: AgentBrainEvidenceProvider): RealMingSystemHarness {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, `state-${harnesses.length}.sqlite`),
      now: () => "2026-09-02T09:00:00.000Z",
      evidence: { provider },
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureCtoWork(harness: RealMingSystemHarness): Promise<string> {
    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `rm20:evidence:${harnesses.length}`,
      text: "Review DuitSini project evidence",
      workstream: "MicroSaaS",
      expectedEffect: { kind: "record-note", value: "Review project evidence" },
    });
    if (result.kind !== "work-item-acknowledgement") throw new Error("Expected Work Item acknowledgement.");
    harness.bindPortfolioProject(result.workItem.id, "project:duitsini");
    return result.workItem.id;
  }

  const currentEvidence: AgentBrainEvidenceReadResult = {
    kind: "ok",
    sourceIdentity: "agent-brain:duitsini",
    canonicalEvidenceId: "agent-brain:duitsini:evidence:42",
    sourceReference: "agent-brain://duitsini/evidence/42",
    content: "The last reviewed DuitSini change used a task branch and preview verification.",
    citations: ["agent-brain://duitsini/evidence/42"],
    asOf: "2026-09-02T08:30:00.000Z",
    retrievedAt: "2026-09-02T09:00:00.000Z",
    freshness: "current",
  };

  it("serves cited, project-scoped evidence with provenance and records a redacted audit", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor(currentEvidence, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    const generatedPath = join(directory, "agent-brain-generated.md");
    const sqlitePath = join(directory, "agent-brain.sqlite");
    writeFileSync(generatedPath, "canonical generated evidence\n");
    writeFileSync(sqlitePath, "canonical sqlite evidence\n");
    const beforeArtifacts = [generatedPath, sqlitePath].map((path) =>
      createHash("sha256").update(readFileSync(path)).digest("hex"),
    );

    const result = await harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:duitsini",
    });

    expect(result).toMatchObject({
      kind: "served",
      evidence: {
        sourceIdentity: "agent-brain:duitsini",
        canonicalEvidenceId: "agent-brain:duitsini:evidence:42",
        freshness: "current",
        citations: ["agent-brain://duitsini/evidence/42"],
      },
    });
    expect(result.kind === "served" ? result.evidence.content : "").toContain("task branch");
    expect(counters).toEqual({ reads: 1, writes: 0 });
    expect([generatedPath, sqlitePath].map((path) =>
      createHash("sha256").update(readFileSync(path)).digest("hex"),
    )).toEqual(beforeArtifacts);
    expect(harness.evidenceAuditTrail(workItemId)).toContainEqual(
      expect.objectContaining({
        type: "project-evidence.served",
        details: expect.objectContaining({
          executive: "CTO",
          portfolioProjectId: "project:duitsini",
          canonicalEvidenceId: "agent-brain:duitsini:evidence:42",
        }),
      }),
    );
    expect(JSON.stringify(harness.evidenceAuditTrail(workItemId))).not.toContain(currentEvidence.content);
  });

  it("wraps selected evidence as a cited Candidate Envelope without writing Agent Brain", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor(currentEvidence, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);

    const result = await harness.captureProjectEvidenceCandidate({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Compile cited DuitSini project history",
      portfolioProjectId: "project:duitsini",
    });

    expect(result).toMatchObject({
      kind: "candidate-envelope",
      candidate: {
        sourceSystem: "agent-brain",
        sourceIdentity: "agent-brain:duitsini",
        canonicalEvidenceId: "agent-brain:duitsini:evidence:42",
        sourceReference: "agent-brain://duitsini/evidence/42",
        trustDomain: "Ming Creatives",
        sensitivity: "sensitive",
        allowedRoles: ["CTO", "Personal CFO"],
        retentionClass: "project-evidence-30d",
        mode: "snapshot",
        freshness: "current",
      },
    });
    if (result.kind === "candidate-envelope") {
      expect(result.candidate.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.candidate.id).toMatch(/^candidate:[0-9a-f]{64}$/);
      expect(result.candidate.citations).toEqual([currentEvidence.sourceReference]);
    }
    expect(counters).toEqual({ reads: 1, writes: 0 });
  });

  it("provides a CEO-only production binding path through the dashboard", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor(currentEvidence, counters));
    harness.upsertPortfolioProject(project);
    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm20:dashboard-binding",
      text: "Review DuitSini project evidence",
      workstream: "MicroSaaS",
      expectedEffect: { kind: "record-note", value: "Review project evidence" },
    });
    if (result.kind !== "work-item-acknowledgement") throw new Error("Expected Work Item acknowledgement.");

    const server = await harness.startDashboard([
      {
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        accessToken: "rm20-dashboard-token",
      },
    ]);
    try {
      const response = await fetch(`${server.origin}/api/project-evidence-bindings`, {
        method: "POST",
        headers: {
          authorization: "Bearer rm20-dashboard-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workItemId: result.workItem.id,
          portfolioProjectId: "project:duitsini",
        }),
      });
      expect(response.status).toBe(200);
      expect(harness.portfolioProject("project:duitsini")).toBeDefined();
      expect(
        await harness.serveProjectEvidence({
          workspaceId: "workspace:real-ming",
          executive: "CTO",
          workItemId: result.workItem.id,
          purpose: "Review the previous DuitSini deployment workflow",
          portfolioProjectId: "project:duitsini",
        }),
      ).toMatchObject({ kind: "served" });
      expect(harness.evidenceAuditTrail(result.workItem.id)).toContainEqual(
        expect.objectContaining({ type: "project-evidence.bound" }),
      );
    } finally {
      await server.close();
    }
  });

  it("denies an unrelated project, role, or purpose without revealing restricted evidence", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor(currentEvidence, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    const request = {
      workspaceId: "workspace:real-ming",
      executive: "CTO" as const,
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:missing",
    };

    expect(await harness.serveProjectEvidence(request)).toEqual({ kind: "denied", reason: "not-authorized" });
    expect(await harness.serveProjectEvidence({ ...request, portfolioProjectId: "project:duitsini", executive: "COO" })).toEqual({ kind: "denied", reason: "not-authorized" });
    expect(await harness.serveProjectEvidence({ ...request, portfolioProjectId: "project:duitsini", purpose: "" })).toEqual({ kind: "denied", reason: "not-authorized" });
    expect(counters.reads).toBe(0);
  });

  it.each([
    ["unavailable", { kind: "failed", reason: "provider-unavailable" }],
    ["stale", {
      kind: "stale",
      sourceIdentity: currentEvidence.sourceIdentity,
      canonicalEvidenceId: currentEvidence.canonicalEvidenceId,
      sourceReference: currentEvidence.sourceReference,
      content: currentEvidence.content,
      citations: currentEvidence.citations,
      asOf: "2026-08-01T08:30:00.000Z",
      retrievedAt: currentEvidence.retrievedAt,
      freshness: "stale",
    }],
    ["uncited", { ...currentEvidence, citations: [] }],
  ] as const)("keeps %s provider outcomes explicit", async (_label, providerResult) => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor(providerResult as AgentBrainEvidenceReadResult, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    const result = await harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:duitsini",
    });

    if (_label === "unavailable") expect(result).toEqual({ kind: "unavailable", reason: "provider-unavailable" });
    if (_label === "stale") expect(result).toMatchObject({ kind: "stale", evidence: { freshness: "stale" } });
    if (_label === "uncited") expect(result).toEqual({ kind: "rejected", reason: "uncited" });
    expect(counters.writes).toBe(0);
  });

  it("rejects citations that do not identify the returned canonical evidence", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor({ ...currentEvidence, citations: ["agent-brain://other"] }, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    await expect(harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:duitsini",
    })).resolves.toEqual({ kind: "rejected", reason: "invalid-evidence" });
  });

  it("rejects contradictory stale metadata instead of relabeling it", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor({ ...currentEvidence, kind: "stale", freshness: "current" }, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    await expect(harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:duitsini",
    })).resolves.toEqual({ kind: "rejected", reason: "invalid-evidence" });
  });

  it("converts a provider exception into a redacted unavailable result", async () => {
    const harness = start({
      read: async () => {
        throw new Error("Agent Brain private path should not be returned");
      },
    });
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    await expect(harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:duitsini",
    })).resolves.toEqual({ kind: "unavailable", reason: "provider-unavailable" });
  });

  it("rejects credential-shaped evidence references before returning them", async () => {
    const counters = { reads: 0, writes: 0 };
    const harness = start(providerFor({
      ...currentEvidence,
      sourceReference: "https://api.telegram.org/bot8123456789:AAabcdefghijklmnopqrstuv/sendMessage",
      citations: ["https://api.telegram.org/bot8123456789:AAabcdefghijklmnopqrstuv/sendMessage"],
    }, counters));
    harness.upsertPortfolioProject(project);
    const workItemId = await captureCtoWork(harness);
    await expect(harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "Review the previous DuitSini deployment workflow",
      portfolioProjectId: "project:duitsini",
    })).resolves.toEqual({ kind: "rejected", reason: "invalid-evidence" });
  });
});
