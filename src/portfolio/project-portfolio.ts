import { DatabaseSync } from "node:sqlite";

import { executiveRoles, type ExecutiveRole } from "../operations/contracts.js";
import { providerStalenessThresholdMs } from "../providers/adapter-contract.js";

export const portfolioStates = [
  "owned production",
  "owned active",
  "prototype",
  "archived",
  "collaborative",
  "reference",
] as const;
export type PortfolioState = (typeof portfolioStates)[number];

export const portfolioSensitivities = [
  "public",
  "internal",
  "sensitive",
] as const;
export type PortfolioSensitivity = (typeof portfolioSensitivities)[number];

export const portfolioHealthStates = ["healthy", "degraded", "unknown"] as const;
export type PortfolioHealth = (typeof portfolioHealthStates)[number];

export const portfolioSourceKinds = [
  "github",
  "vercel",
  "agent-brain",
  "operating-instructions",
] as const;
export type PortfolioSourceKind = (typeof portfolioSourceKinds)[number];

export interface PortfolioSourceLinkInput {
  readonly kind: PortfolioSourceKind;
  readonly reference: string;
  readonly asOf: string;
}

export interface PortfolioSourceLink extends PortfolioSourceLinkInput {
  readonly freshness: "current" | "stale";
}

export interface PortfolioProjectInput {
  readonly id: string;
  readonly name: string;
  readonly portfolioState: PortfolioState;
  readonly repository: string | null;
  readonly productionBranch: string | null;
  readonly deploymentIdentifiers: {
    readonly github: string | null;
    readonly vercel: string | null;
  };
  readonly evidenceIdentity: string | null;
  readonly responsibleRoles: readonly ExecutiveRole[];
  readonly sensitivity: PortfolioSensitivity;
  readonly health: PortfolioHealth;
  readonly operatingInstructions: string | null;
  readonly sourceLinks: readonly PortfolioSourceLinkInput[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RemoteReadyAssessment {
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

export interface PortfolioProject extends Omit<PortfolioProjectInput, "sourceLinks"> {
  readonly sourceLinks: readonly PortfolioSourceLink[];
  readonly remoteReady: RemoteReadyAssessment;
}

export type PortfolioReconciliationIssueCode =
  | "missing-github-repository"
  | "missing-github-deployment"
  | "missing-vercel-deployment"
  | "missing-agent-brain-evidence"
  | "missing-github-source-link"
  | "missing-vercel-source-link"
  | "missing-agent-brain-source-link"
  | "missing-operating-instructions-source-link"
  | "conflicting-github-identifier"
  | "conflicting-vercel-identifier"
  | "conflicting-agent-brain-identifier";

export interface PortfolioReconciliationIssue {
  readonly code: PortfolioReconciliationIssueCode;
  readonly references: readonly string[];
}

export interface PortfolioReconciliation {
  readonly projectId: string;
  readonly reconciled: boolean;
  readonly checkedAt: string;
  readonly issues: readonly PortfolioReconciliationIssue[];
}

function isOneOf<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value);
}

function requiredText(value: string | null, field: string): string {
  if (value === null || value.trim().length === 0) {
    throw new Error(`Portfolio ${field} is required.`);
  }
  return value.trim();
}

function freshnessFor(asOf: string, now: string): "current" | "stale" {
  const asOfMs = Date.parse(asOf);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(nowMs)) {
    throw new Error("Portfolio source links require valid asOf and now timestamps.");
  }
  return nowMs - asOfMs > providerStalenessThresholdMs ? "stale" : "current";
}

function normalizeGithubReference(reference: string): string {
  return reference.replace(/^github:/i, "").replace(/\.git$/i, "");
}

function assessRemoteReady(input: PortfolioProjectInput): RemoteReadyAssessment {
  const reasons: string[] = [];
  if (input.repository === null || input.repository.trim().length === 0) {
    reasons.push("repository-missing");
  }
  if (input.productionBranch === null || input.productionBranch.trim().length === 0) {
    reasons.push("production-branch-missing");
  }
  if (
    input.deploymentIdentifiers.github === null ||
    input.deploymentIdentifiers.github.trim().length === 0
  ) {
    reasons.push("github-deployment-missing");
  }
  if (
    input.deploymentIdentifiers.vercel === null ||
    input.deploymentIdentifiers.vercel.trim().length === 0
  ) {
    reasons.push("vercel-deployment-missing");
  }
  if (input.evidenceIdentity === null || input.evidenceIdentity.trim().length === 0) {
    reasons.push("agent-brain-evidence-missing");
  }
  if (
    input.operatingInstructions === null ||
    input.operatingInstructions.trim().length === 0
  ) {
    reasons.push("operating-instructions-missing");
  } else if (!input.sourceLinks.some((source) => source.kind === "operating-instructions")) {
    reasons.push("operating-instructions-source-link-missing");
  }
  if (!input.sourceLinks.some((source) => source.kind === "github")) {
    reasons.push("github-source-link-missing");
  }
  if (!input.sourceLinks.some((source) => source.kind === "vercel")) {
    reasons.push("vercel-source-link-missing");
  }
  if (!input.sourceLinks.some((source) => source.kind === "agent-brain")) {
    reasons.push("agent-brain-source-link-missing");
  }
  return { ready: reasons.length === 0, reasons };
}

function validateInput(input: PortfolioProjectInput): void {
  requiredText(input.id, "id");
  requiredText(input.name, "name");
  if (!isOneOf(portfolioStates, input.portfolioState)) {
    throw new Error(`Unknown Portfolio State: ${String(input.portfolioState)}.`);
  }
  if (!isOneOf(portfolioSensitivities, input.sensitivity)) {
    throw new Error(`Unknown Portfolio sensitivity: ${String(input.sensitivity)}.`);
  }
  if (!isOneOf(portfolioHealthStates, input.health)) {
    throw new Error(`Unknown Portfolio health: ${String(input.health)}.`);
  }
  if (input.responsibleRoles.length === 0) {
    throw new Error("A Portfolio Project requires at least one responsible Executive Role.");
  }
  for (const role of input.responsibleRoles) {
    if (!isOneOf(executiveRoles, role)) {
      throw new Error(`Unknown responsible Executive Role: ${String(role)}.`);
    }
  }
  if (new Set(input.responsibleRoles).size !== input.responsibleRoles.length) {
    throw new Error("Portfolio responsible Executive Roles must be unique.");
  }
  if (!Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.updatedAt))) {
    throw new Error("Portfolio projects require valid createdAt and updatedAt timestamps.");
  }
  const seen = new Set<string>();
  for (const source of input.sourceLinks) {
    requiredText(source.reference, `${source.kind} source reference`);
    if (!isOneOf(portfolioSourceKinds, source.kind)) {
      throw new Error(`Unknown Portfolio source kind: ${String(source.kind)}.`);
    }
    if (!Number.isFinite(Date.parse(source.asOf))) {
      throw new Error("Portfolio source links require a valid asOf timestamp.");
    }
    const key = `${source.kind}:${source.reference}`;
    if (seen.has(key)) throw new Error(`Duplicate Portfolio source link: ${key}.`);
    seen.add(key);
  }
}

function projectFrom(input: PortfolioProjectInput, now: string): PortfolioProject {
  validateInput(input);
  return {
    ...input,
    sourceLinks: input.sourceLinks.map((source) => ({
      ...source,
      reference: source.reference.trim(),
      freshness: freshnessFor(source.asOf, now),
    })),
    remoteReady: assessRemoteReady(input),
  };
}

function parseProject(value: string): PortfolioProject {
  return JSON.parse(value) as PortfolioProject;
}

function refreshProject(project: PortfolioProject, now: string): PortfolioProject {
  const { remoteReady: _remoteReady, sourceLinks, ...input } = project;
  return projectFrom(
    {
      ...input,
      sourceLinks: sourceLinks.map(({ freshness: _freshness, ...source }) => source),
    },
    now,
  );
}

/**
 * Real-Ming's canonical project catalogue. It stores references and
 * reconciliation state only; GitHub, Vercel and Agent Brain remain their own
 * Sources of Record.
 */
export class ProjectPortfolio {
  readonly #database: DatabaseSync;
  readonly #now: () => string;

  constructor(path: string, now: () => string = () => new Date().toISOString()) {
    this.#database = new DatabaseSync(path);
    this.#now = now;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS project_portfolio (
        id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_work_item_bindings (
        work_item_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES project_portfolio(id)
      );
    `);
  }

  close(): void {
    this.#database.close();
  }

  upsert(input: PortfolioProjectInput): PortfolioProject {
    const project = projectFrom(input, this.#now());
    this.#database
      .prepare(
        `INSERT INTO project_portfolio (id, record_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json,
                                       updated_at = excluded.updated_at`,
      )
      .run(project.id, JSON.stringify(project), project.updatedAt);
    return project;
  }

  project(id: string): PortfolioProject | undefined {
    const row = this.#database
      .prepare("SELECT record_json FROM project_portfolio WHERE id = ?")
      .get(id) as unknown as { record_json: string } | undefined;
    return row === undefined ? undefined : refreshProject(parseProject(row.record_json), this.#now());
  }

  projects(): readonly PortfolioProject[] {
    const rows = this.#database
      .prepare("SELECT record_json FROM project_portfolio ORDER BY rowid ASC")
      .all() as unknown as { record_json: string }[];
    return rows.map((row) => refreshProject(parseProject(row.record_json), this.#now()));
  }

  bindWorkItem(workItemId: string, projectId: string): void {
    if (workItemId.trim().length === 0) throw new Error("A Work Item binding requires an id.");
    if (this.project(projectId) === undefined) {
      throw new Error(`Portfolio Project ${projectId} was not found.`);
    }
    this.#database
      .prepare(
        `INSERT INTO project_work_item_bindings (work_item_id, project_id)
         VALUES (?, ?)
         ON CONFLICT(work_item_id) DO UPDATE SET project_id = excluded.project_id`,
      )
      .run(workItemId, projectId);
  }

  projectForWorkItem(workItemId: string): string | undefined {
    const row = this.#database
      .prepare("SELECT project_id FROM project_work_item_bindings WHERE work_item_id = ?")
      .get(workItemId) as unknown as { project_id: string } | undefined;
    return row?.project_id;
  }

  reconcile(id: string): PortfolioReconciliation {
    const project = this.project(id);
    if (project === undefined) throw new Error(`Portfolio Project ${id} was not found.`);
    const issues: PortfolioReconciliationIssue[] = [];
    const byKind = new Map<PortfolioSourceKind, PortfolioSourceLink[]>();
    for (const source of project.sourceLinks) {
      const values = byKind.get(source.kind) ?? [];
      values.push(source);
      byKind.set(source.kind, values);
    }
    const referencesFor = (kind: PortfolioSourceKind): readonly string[] =>
      (byKind.get(kind) ?? []).map((source) => source.reference);
    const github = referencesFor("github");
    const vercel = referencesFor("vercel");
    const evidence = referencesFor("agent-brain");
    const canonicalGithub = [project.repository, project.deploymentIdentifiers.github].filter(
      (reference): reference is string => reference !== null && reference.trim().length > 0,
    );
    const normalizedCanonicalGithub = canonicalGithub.map(normalizeGithubReference);
    if (project.repository === null || project.repository.trim().length === 0) {
      issues.push({ code: "missing-github-repository", references: [] });
    }
    if (
      project.deploymentIdentifiers.github === null ||
      project.deploymentIdentifiers.github.trim().length === 0
    ) {
      issues.push({ code: "missing-github-deployment", references: [] });
    }
    if (project.deploymentIdentifiers.vercel === null || project.deploymentIdentifiers.vercel.trim().length === 0) {
      issues.push({ code: "missing-vercel-deployment", references: [] });
    }
    if (project.evidenceIdentity === null || project.evidenceIdentity.trim().length === 0) {
      issues.push({ code: "missing-agent-brain-evidence", references: [] });
    }
    if (github.length === 0) issues.push({ code: "missing-github-source-link", references: [] });
    if (vercel.length === 0) issues.push({ code: "missing-vercel-source-link", references: [] });
    if (evidence.length === 0) issues.push({ code: "missing-agent-brain-source-link", references: [] });
    if (!byKind.has("operating-instructions")) {
      issues.push({ code: "missing-operating-instructions-source-link", references: [] });
    }
    if (
      new Set(normalizedCanonicalGithub).size > 1 ||
      github.some(
        (reference) =>
          !canonicalGithub.some(
            (canonical) => normalizeGithubReference(canonical) === normalizeGithubReference(reference),
          ),
      )
    ) {
      issues.push({
        code: "conflicting-github-identifier",
        references: [...new Set(
          [...canonicalGithub, ...github].filter(
            (reference): reference is string => reference !== null,
          ),
        )],
      });
    }
    if (vercel.some((reference) => reference !== project.deploymentIdentifiers.vercel)) {
      issues.push({
        code: "conflicting-vercel-identifier",
        references: [...new Set(
          [project.deploymentIdentifiers.vercel, ...vercel].filter(
            (reference): reference is string => reference !== null,
          ),
        )],
      });
    }
    if (evidence.some((reference) => reference !== project.evidenceIdentity)) {
      issues.push({
        code: "conflicting-agent-brain-identifier",
        references: [...new Set(
          [project.evidenceIdentity, ...evidence].filter(
            (reference): reference is string => reference !== null,
          ),
        )],
      });
    }
    return {
      projectId: id,
      reconciled: issues.length === 0,
      checkedAt: this.#now(),
      issues,
    };
  }

  reconcileAll(): readonly PortfolioReconciliation[] {
    return this.projects().map((project) => this.reconcile(project.id));
  }
}
