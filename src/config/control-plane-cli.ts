import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { createProductionControlPlane } from "../runtime/production-control-plane.js";
import type { PortfolioProjectInput } from "../portfolio/project-portfolio.js";

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

  const controlPlane = await createProductionControlPlane({
    environment: process.env,
    statePath,
    notionLedgerPath,
    portfolioProjects: portfolioProjects(),
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
