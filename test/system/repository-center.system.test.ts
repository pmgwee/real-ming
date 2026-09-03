import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRealMingSystemHarness, type RealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";
import { buildRepositoryCenterView } from "../../src/portfolio/repository-center.js";
import { createProductionControlPlane } from "../../src/runtime/production-control-plane.js";
import { tracerCredentials } from "../../src/config/tracer-secrets.js";
import type { PortfolioProjectInput } from "../../src/portfolio/project-portfolio.js";
import type { GitHubRepositorySnapshot } from "../../src/providers/github-repository-adapter.js";
import type { GitLineageSnapshot } from "../../src/providers/git-lineage-adapter.js";
import type { VercelDeploymentSnapshot } from "../../src/providers/vercel-deployment-adapter.js";

describe("RM-25/RM-26 Repository Center", () => {
  let directory: string;
  let harnesses: RealMingSystemHarness[];
  beforeEach(() => { directory = mkdtempSync(join(process.env.TEMP ?? ".", "real-ming-rm25-")); harnesses = []; });
  afterEach(() => { for (const harness of harnesses.splice(0)) harness.close(); rmSync(directory, { recursive: true, force: true }); });

  const project: PortfolioProjectInput = {
    id: "project:duitsini", name: "DuitSini", portfolioState: "owned production", repository: "github:pmgwee/subscription-agent", productionBranch: "main",
    deploymentIdentifiers: { github: "pmgwee/subscription-agent", vercel: "vercel:duitsini" }, evidenceIdentity: "agent-brain:duitsini", responsibleRoles: ["CTO", "Personal CFO"], sensitivity: "sensitive", health: "healthy", operatingInstructions: "github:pmgwee/subscription-agent/README.md",
    sourceLinks: [{ kind: "github", reference: "pmgwee/subscription-agent", asOf: "2026-09-02T08:00:00.000Z" }, { kind: "vercel", reference: "vercel:duitsini", asOf: "2026-09-02T08:00:00.000Z" }, { kind: "agent-brain", reference: "agent-brain:duitsini", asOf: "2026-09-02T08:00:00.000Z" }, { kind: "operating-instructions", reference: "github:pmgwee/subscription-agent/README.md", asOf: "2026-09-02T08:00:00.000Z" }], createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z",
  };

  const github: GitHubRepositorySnapshot = { owner: "pmgwee", name: "subscription-agent", fullName: "pmgwee/subscription-agent", url: "https://github.com/pmgwee/subscription-agent", productionBranch: "main", productionHeadSha: "sha-main", branches: [{ name: "main", sha: "sha-main", protected: true }, { name: "feat/rm-25", sha: "sha-work", protected: false }], pullRequests: [{ number: 99, title: "Repository center", state: "open", draft: false, url: "https://github.com/pull/99", head: { branch: "feat/rm-25", sha: "sha-work" }, base: { branch: "main", sha: "sha-main" }, reviewDecision: "APPROVED" }], checks: [{ name: "check", status: "completed", conclusion: "success", sha: "sha-work", url: "https://github.com/check/1" }], reviews: [{ pullRequestNumber: 99, reviewer: "reviewer", state: "APPROVED", commitSha: "sha-work", submittedAt: "2026-09-02T09:00:00.000Z" }], releases: [{ tag: "v1.2.0", targetSha: "sha-main", url: "https://github.com/release/1", publishedAt: "2026-09-02T09:00:00.000Z" }], incidents: [{ number: 7, title: "incident", url: "https://github.com/issue/7", openedAt: "2026-09-02T09:00:00.000Z" }] };
  const git: GitLineageSnapshot = { repositoryPath: "C:/controlled/subscription-agent", productionBranch: "main", productionHeadSha: "sha-main", currentBranch: "feat/rm-25", currentHeadSha: "sha-work", branches: [{ name: "main", sha: "sha-main", ahead: 0, behind: 0, divergence: "same" }, { name: "feat/rm-25", sha: "sha-work", ahead: 2, behind: 1, divergence: "diverged" }], tags: [{ name: "v1.2.0", sha: "sha-main" }], deploymentAssociations: [{ provider: "github", reference: "pmgwee/subscription-agent", commitSha: "sha-main" }], worker: { availability: "online", branch: "feat/rm-25", headSha: "sha-work", dirty: true, dirtyFiles: 1 } };
  const vercel: VercelDeploymentSnapshot = { projectReference: "vercel:duitsini", deployments: [{ id: "vercel-preview", status: "ready", environment: "preview", domain: "https://preview.duitsini.test", commitSha: "sha-work", branch: "feat/rm-25", pullRequestNumber: 99, sourceReference: "vercel:deployment:vercel-preview", createdAt: "2026-09-02T08:00:00.000Z", readyAt: "2026-09-02T08:30:00.000Z" }, { id: "vercel-production", status: "ready", environment: "production", domain: "https://duitsini.test", commitSha: "sha-main", branch: "main", pullRequestNumber: null, sourceReference: "vercel:deployment:vercel-production", createdAt: "2026-09-02T07:00:00.000Z", readyAt: "2026-09-02T07:30:00.000Z" }, { id: "vercel-old-production", status: "ready", environment: "production", domain: "https://old.duitsini.test", commitSha: "sha-work", branch: "feat/rm-25", pullRequestNumber: 99, sourceReference: "vercel:deployment:vercel-old-production", createdAt: "2026-09-01T07:00:00.000Z", readyAt: "2026-09-01T07:30:00.000Z" }, { id: "vercel-mismatched-production", status: "ready", environment: "production", domain: "https://mismatch.duitsini.test", commitSha: "sha-old", branch: "unknown", pullRequestNumber: null, sourceReference: "vercel:deployment:vercel-mismatched-production", createdAt: "2026-08-31T07:00:00.000Z", readyAt: "2026-08-31T07:30:00.000Z" }] };

  function result<T>(provider: string, value: T) {
    return { kind: "ok" as const, identity: { provider, workspaceId: "workspace:real-ming", accountReference: `${provider}:account:real-ming` }, provenance: { sourceIdentity: provider, sourceReference: "pmgwee/subscription-agent", asOf: "2026-09-02T09:00:00.000Z", retrievedAt: "2026-09-02T09:00:00.000Z", freshness: "current" as const }, value };
  }

  it("projects normalized GitHub and Git lineage into the authenticated dashboard", async () => {
    const harness = createRealMingSystemHarness({ statePath: join(directory, "state.sqlite"), now: () => "2026-09-02T09:00:00.000Z" }); harnesses.push(harness);
    const saved = harness.upsertPortfolioProject(project);
    const view = buildRepositoryCenterView({ project: saved, github: result("github", github), git: result("git", git), vercel: result("vercel", vercel), verificationEvidence: new Map([
      ["vercel-production", { reference: "verification:duitsini:production", asOf: "2026-09-02T08:00:00.000Z" }],
      ["vercel-old-production", { reference: "verification:duitsini:rollback", asOf: "2026-09-02T08:00:00.000Z" }],
    ]), now: "2026-09-02T09:00:00.000Z" });
    harness.setRepositoryCenterView(saved.id, view);
    expect(view.vercel?.deployments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "vercel-old-production", lineageStatus: "matched", verificationStatus: "verified", rollbackCandidate: true }),
      expect.objectContaining({ id: "vercel-mismatched-production", lineageStatus: "mismatched", verificationStatus: "unverified", rollbackCandidate: false }),
    ]));
    const overview = await harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" });
    expect(overview.projectPortfolio[0]?.repositoryCenter).toMatchObject({ projectId: saved.id, repository: { fullName: "pmgwee/subscription-agent", productionHeadSha: "sha-main" }, github: { observation: { status: "healthy", sourceReference: "pmgwee/subscription-agent" } }, git: { observation: { status: "healthy" }, worker: { availability: "online", dirty: true } } });
    const server = await harness.startDashboard([{ actorId: "ceo:ming", workspaceId: "workspace:real-ming", accessToken: "dashboard-token" }]);
    try {
      const response = await fetch(server.origin, { headers: { Authorization: "Bearer dashboard-token" } });
      const html = await response.text();
      expect(html).toContain("repository-center");
      expect(html).toContain("pmgwee/subscription-agent");
      expect(html).toContain("sha-main");
      expect(html).toContain("sha-work");
      expect(html).toContain("Repository center");
      expect(html).toContain("check:success");
      expect(html).toContain("reviewer:APPROVED");
      expect(html).toContain("v1.2.0");
      expect(html).toContain("incident");
      expect(html).toContain("diverged");
      expect(html).toContain("github:pmgwee/subscription-agent sha-main");
      expect(html).toContain("preview:ready sha-work matched unverified");
      expect(html).toContain("production:ready sha-work matched verified rollback-candidate");
      expect(html).toContain("production:ready sha-old mismatched unverified");
      expect(html).toContain("pr#99");
      expect(html).toContain("source=vercel:deployment:vercel-old-production");
      expect(html).toContain("evidence=verification:duitsini:rollback");
    } finally {
      await server.close();
    }
  });

  it("renders degraded observations and never reports an offline worker as clean", async () => {
    const harness = createRealMingSystemHarness({ statePath: join(directory, "state.sqlite"), now: () => "2026-09-02T09:00:00.000Z" }); harnesses.push(harness);
    const saved = harness.upsertPortfolioProject(project);
    const failed = { kind: "failed" as const, failure: { class: "unavailable" as const, retryable: true, message: "offline" } };
    const view = buildRepositoryCenterView({ project: saved, github: result("github", github), git: failed, vercel: { kind: "failed", failure: { class: "permission-denied", retryable: false, message: "denied" } }, gitSourceReference: "C:/controlled/subscription-agent", now: "2026-09-02T09:00:00.000Z" });
    harness.setRepositoryCenterView(saved.id, view);
    expect(view.git.observation.status).toBe("unavailable");
    expect(view.git.observation.sourceReference).toBe("C:/controlled/subscription-agent");
    expect(view.git.worker).toMatchObject({ availability: "unknown", dirty: null, dirtyFiles: null });
    const server = await harness.startDashboard([{ actorId: "ceo:ming", workspaceId: "workspace:real-ming", accessToken: "dashboard-token" }]);
    try {
      const html = await (await fetch(server.origin, { headers: { Authorization: "Bearer dashboard-token" } })).text();
      expect(html).toContain("unavailable");
      expect(html).toContain("unknown");
    } finally {
      await server.close();
    }
  });

  it("keeps the GitHub owner/name reference separate from the local Git checkout at the production boundary", async () => {
    const references: string[] = [];
    const githubAdapter = {
      identity: () => ({ provider: "github", workspaceId: "workspace:real-ming", accountReference: "github:account:real-ming" }),
      capabilities: () => ["read" as const],
      read: async (request: { readonly reference: string }) => { references.push(`github:${request.reference}`); return result("github", github); },
      write: async () => ({ kind: "failed" as const, failure: { class: "unsupported-capability" as const, retryable: false, message: "read-only" } }),
    };
    const gitAdapter = {
      identity: () => ({ provider: "git", workspaceId: "workspace:real-ming", accountReference: "git:account:real-ming" }),
      capabilities: () => ["read" as const],
      read: async (request: { readonly reference: string }) => { references.push(`git:${request.reference}`); return result("git", git); },
      write: async () => ({ kind: "failed" as const, failure: { class: "unsupported-capability" as const, retryable: false, message: "read-only" } }),
    };
    const environment = Object.fromEntries(tracerCredentials.map((credential) => [credential.name, `controlled-${credential.name.toLowerCase()}`]));
    const controlPlane = await createProductionControlPlane({
      environment,
      statePath: join(directory, "production.sqlite"),
      notionLedgerPath: join(directory, "production-notion.sqlite"),
      portfolioProjects: [project],
      repositoryCenterAdapters: new Map([[project.id, { github: githubAdapter, git: gitAdapter, gitReference: "C:/controlled/subscription-agent" }]]),
      fetch: async () => { throw new Error("unexpected controlled provider call"); },
      dashboardPort: 0,
      now: () => "2026-09-02T09:00:00.000Z",
    });
    try {
      const response = await fetch(`${controlPlane.dashboardOrigin}/api/overview`, { headers: { Authorization: `Bearer ${environment["REAL_MING_DASHBOARD_TOKEN"]}` } });
      expect(response.ok).toBe(true);
      expect(references).toEqual(["github:github:pmgwee/subscription-agent", "git:C:/controlled/subscription-agent"]);
      const body = await response.json() as { readonly projectPortfolio: readonly { readonly repositoryCenter: unknown }[] };
      expect(body.projectPortfolio[0]?.repositoryCenter).toBeDefined();
      const second = await fetch(`${controlPlane.dashboardOrigin}/api/overview`, { headers: { Authorization: `Bearer ${environment["REAL_MING_DASHBOARD_TOKEN"]}` } });
      expect(second.ok).toBe(true);
      expect(references).toHaveLength(4);
    } finally {
      await controlPlane.close();
    }
  });
});
