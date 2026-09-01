import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { createProductionControlPlane } from "../runtime/production-control-plane.js";
import type { PortfolioProjectInput } from "../portfolio/project-portfolio.js";
import { createGitHubRepositoryAdapter } from "../providers/github-repository-adapter.js";
import { createGitLineageAdapter } from "../providers/git-lineage-adapter.js";
import { createVercelDeploymentAdapter } from "../providers/vercel-deployment-adapter.js";

function configuredPath(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function dashboardPort(): number {
  const raw = process.env["REAL_MING_DASHBOARD_PORT"]?.trim() ?? "8787";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("REAL_MING_DASHBOARD_PORT must be an integer from 1 to 65535.");
  }
  return parsed;
}

function portfolioProjects(): readonly PortfolioProjectInput[] {
  const raw = process.env["REAL_MING_PORTFOLIO_PROJECTS_JSON"]?.trim();
  if (raw === undefined || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("REAL_MING_PORTFOLIO_PROJECTS_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("REAL_MING_PORTFOLIO_PROJECTS_JSON must be a JSON array.");
  }
  return parsed as readonly PortfolioProjectInput[];
}

function repositoryCenterAdapters(projects: readonly PortfolioProjectInput[]) {
  const githubToken = process.env["REAL_MING_GITHUB_READ_TOKEN"]?.trim() ?? "";
  const vercelToken = process.env["REAL_MING_VERCEL_READ_TOKEN"]?.trim() ?? "";
  const defaultGitPath = process.env["REAL_MING_GIT_REPOSITORY_PATH"]?.trim() ?? "";
  const adapters = new Map<string, {
    readonly github: ReturnType<typeof createGitHubRepositoryAdapter>;
    readonly git: ReturnType<typeof createGitLineageAdapter>;
    readonly vercel: ReturnType<typeof createVercelDeploymentAdapter>;
    readonly gitReference: string;
  }>();
  for (const project of projects) {
    if (project.repository === null || project.productionBranch === null) continue;
    const projectSlug = project.id.replace(/^project:/, "").replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
    const gitPath = process.env[`REAL_MING_${projectSlug}_GIT_PATH`]?.trim() ?? defaultGitPath;
    adapters.set(project.id, {
      github: createGitHubRepositoryAdapter({
        token: githubToken,
        workspaceId: "workspace:real-ming",
        accountReference: "github:real-ming",
        productionBranch: project.productionBranch,
      }),
      git: createGitLineageAdapter({
        workspaceId: "workspace:real-ming",
        accountReference: "git:real-ming",
        productionBranch: project.productionBranch,
        deploymentAssociations: (commitSha) =>
          project.deploymentIdentifiers.github === null
            ? []
            : [{
                provider: "github",
                reference: project.deploymentIdentifiers.github,
                commitSha,
              }],
      }),
      gitReference: gitPath,
      vercel: createVercelDeploymentAdapter({
        token: vercelToken,
        workspaceId: "workspace:real-ming",
        accountReference: "vercel:real-ming",
      }),
    });
  }
  return adapters;
}

async function main(): Promise<void> {
  const statePath = configuredPath(
    "REAL_MING_STATE_PATH",
    join(process.cwd(), "var", "state.sqlite"),
  );
  const notionLedgerPath = configuredPath(
    "REAL_MING_NOTION_LEDGER_PATH",
    join(dirname(statePath), "notion-write-ledger.sqlite"),
  );
  mkdirSync(dirname(statePath), { recursive: true });
  mkdirSync(dirname(notionLedgerPath), { recursive: true });

  const projects = portfolioProjects();
  const controlPlane = await createProductionControlPlane({
    environment: process.env,
    statePath,
    notionLedgerPath,
    portfolioProjects: projects,
    repositoryCenterAdapters: repositoryCenterAdapters(projects),
    dashboardHost: "127.0.0.1",
    dashboardPort: dashboardPort(),
  });
  let stopping = false;
  const requestStop = (): void => {
    if (stopping) return;
    stopping = true;
    controlPlane.stop();
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  process.stdout.write(
    `Real-Ming control plane ready; dashboard ${controlPlane.dashboardOrigin}.\n`,
  );
  try {
    await controlPlane.run();
  } finally {
    await controlPlane.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Control plane failed."}\n`,
  );
  process.exitCode = 1;
});
