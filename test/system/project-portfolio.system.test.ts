import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { PortfolioProjectInput } from "../../src/portfolio/project-portfolio.js";

describe("RM-19 Project Portfolio", () => {
  let directory: string;
  let harnesses: RealMingSystemHarness[];

  beforeEach(() => {
    directory = mkdtempSync(join(process.env.TEMP ?? ".", "real-ming-rm19-"));
    harnesses = [];
  });

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const duitsini: PortfolioProjectInput = {
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
      {
        kind: "github",
        reference: "pmgwee/subscription-agent",
        asOf: "2026-09-02T08:00:00.000Z",
      },
      {
        kind: "vercel",
        reference: "vercel:duitsini",
        asOf: "2026-09-02T08:00:00.000Z",
      },
      {
        kind: "agent-brain",
        reference: "agent-brain:duitsini",
        asOf: "2026-09-02T08:00:00.000Z",
      },
      {
        kind: "operating-instructions",
        reference: "github:pmgwee/subscription-agent/README.md",
        asOf: "2026-09-02T08:00:00.000Z",
      },
    ],
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z",
  };

  function start(
    statePath = join(directory, "state.sqlite"),
    nowValue = "2026-09-02T09:00:00.000Z",
  ): RealMingSystemHarness {
    const harness = createRealMingSystemHarness({
      statePath,
      now: () => nowValue,
    });
    harnesses.push(harness);
    return harness;
  }

  it("persists DuitSini as a complete canonical Portfolio Project", () => {
    const harness = start();
    const saved = harness.upsertPortfolioProject(duitsini);

    expect(saved).toMatchObject({
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
      remoteReady: { ready: true },
    });
    expect(saved.remoteReady.reasons).toEqual([]);
    expect(harness.portfolioProject("project:duitsini")).toEqual(saved);
    expect(harness.portfolioProjects()).toEqual([saved]);

    const reconstructed = start(join(directory, "state.sqlite"));
    expect(reconstructed.portfolioProject("project:duitsini")).toEqual(saved);
  });

  it("recomputes source freshness when the persisted catalogue is reopened later", () => {
    const statePath = join(directory, "state.sqlite");
    const first = start(statePath, "2026-09-02T09:00:00.000Z");
    first.upsertPortfolioProject(duitsini);
    first.close();
    harnesses.splice(harnesses.indexOf(first), 1);

    const later = start(statePath, "2026-09-04T09:00:00.000Z");
    expect(later.portfolioProject("project:duitsini")?.sourceLinks[0]?.freshness).toBe("stale");
  });

  it("makes missing authoritative links and instructions visible instead of guessing", () => {
    const harness = start();
    const incomplete: PortfolioProjectInput = {
      ...duitsini,
      id: "project:incomplete",
      name: "Incomplete",
      repository: null,
      productionBranch: null,
      deploymentIdentifiers: { github: null, vercel: null },
      evidenceIdentity: null,
      operatingInstructions: null,
      sourceLinks: [],
    };

    const saved = harness.upsertPortfolioProject(incomplete);
    expect(saved.remoteReady.ready).toBe(false);
    expect(saved.remoteReady.reasons).toEqual(
      expect.arrayContaining([
        "repository-missing",
        "production-branch-missing",
        "github-deployment-missing",
        "vercel-deployment-missing",
        "agent-brain-evidence-missing",
        "operating-instructions-missing",
      ]),
    );
    expect(harness.portfolioReconciliation("project:incomplete").issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-github-repository" }),
        expect.objectContaining({ code: "missing-vercel-deployment" }),
        expect.objectContaining({ code: "missing-agent-brain-evidence" }),
      ]),
    );
  });

  it("does not call a project Remote-Ready without an instruction source link", () => {
    const harness = start();
    const saved = harness.upsertPortfolioProject({
      ...duitsini,
      id: "project:unlinked-instructions",
      sourceLinks: duitsini.sourceLinks.filter((source) => source.kind !== "operating-instructions"),
    });

    expect(saved.remoteReady.ready).toBe(false);
    expect(saved.remoteReady.reasons).toContain("operating-instructions-source-link-missing");
    expect(harness.portfolioReconciliation(saved.id).issues).toContainEqual(
      expect.objectContaining({ code: "missing-operating-instructions-source-link" }),
    );
  });

  it("rejects configuration records with an unknown responsible role", () => {
    const harness = start();
    expect(() =>
      harness.upsertPortfolioProject({
        ...duitsini,
        id: "project:invalid-role",
        responsibleRoles: ["HACKER" as never],
      }),
    ).toThrow("Unknown responsible Executive Role");
  });

  it("surfaces conflicting source identifiers as reconciliation findings", () => {
    const harness = start();
    const saved = harness.upsertPortfolioProject({
      ...duitsini,
      sourceLinks: [
        ...duitsini.sourceLinks,
        {
          kind: "github",
          reference: "pmgwee/wrong-repository",
          asOf: "2026-09-02T08:00:00.000Z",
        },
      ],
    });

    expect(saved.remoteReady.ready).toBe(true);
    expect(harness.portfolioReconciliation("project:duitsini")).toMatchObject({
      reconciled: false,
      issues: [
        expect.objectContaining({
          code: "conflicting-github-identifier",
          references: expect.arrayContaining([
            "pmgwee/subscription-agent",
            "pmgwee/wrong-repository",
          ]),
        }),
      ],
    });
  });

  it("projects the canonical portfolio and source freshness through the CEO dashboard", async () => {
    const harness = start();
    harness.upsertPortfolioProject(duitsini);

    const overview = await harness.dashboardOverview({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
    });

    expect(overview.projectPortfolio).toEqual([
      expect.objectContaining({
        id: "project:duitsini",
        name: "DuitSini",
        portfolioState: "owned production",
        remoteReady: true,
        sourceFreshness: {
          github: "current",
          vercel: "current",
          "agent-brain": "current",
          "operating-instructions": "current",
        },
      }),
    ]);
  });
});
