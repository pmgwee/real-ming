import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  providerFailure,
  type ProviderAdapter,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadRequest,
  type ProviderReadResult,
  type ProviderWriteRequest,
  type ProviderWriteResult,
} from "./adapter-contract.js";

export const gitLineageProvider = "git";

export interface GitLineageBranch {
  readonly name: string;
  readonly sha: string;
  readonly ahead: number;
  readonly behind: number;
  readonly divergence: "same" | "ahead" | "behind" | "diverged";
}

export interface GitLineageTag {
  readonly name: string;
  readonly sha: string;
}

export interface GitDeploymentAssociation {
  readonly provider: string;
  readonly reference: string;
  readonly commitSha: string;
}

export type GitWorkerState =
  | {
      readonly availability: "online";
      readonly branch: string;
      readonly headSha: string;
      readonly dirty: boolean;
      readonly dirtyFiles: number;
    }
  | {
      readonly availability: "offline" | "unknown";
      readonly branch: string | null;
      readonly headSha: string | null;
      readonly dirty: null;
      readonly dirtyFiles: null;
    };

export interface GitLineageSnapshot {
  readonly repositoryPath: string;
  readonly productionBranch: string;
  readonly productionHeadSha: string;
  readonly currentBranch: string;
  readonly currentHeadSha: string;
  readonly branches: readonly GitLineageBranch[];
  readonly tags: readonly GitLineageTag[];
  readonly deploymentAssociations: readonly GitDeploymentAssociation[];
  readonly worker: GitWorkerState;
}

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type GitCommandRunner = (
  args: readonly string[],
) => Promise<GitCommandResult>;

const execFileAsync = promisify(execFile);

const defaultRunner: GitCommandRunner = async (args) => {
  try {
    const result = await execFileAsync("git", [...args], { encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
    return {
      stdout: typeof record["stdout"] === "string" ? record["stdout"] : "",
      stderr: typeof record["stderr"] === "string" ? record["stderr"] : "git command failed",
      exitCode: typeof record["code"] === "number" ? record["code"] : 1,
    };
  }
};

class GitCommandFailure extends Error {}

export function parseGitStatusPorcelain(value: string): {
  readonly branch: string;
  readonly dirtyFiles: number;
} {
  const lines = value.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines.find((line) => line.startsWith("## ")) ?? "";
  const branch = header.slice(3).split("...")[0]?.split(" ")[0] ?? "";
  return {
    branch: branch === "HEAD" || branch.length === 0 ? "(detached)" : branch,
    dirtyFiles: lines.filter((line) => !line.startsWith("## ")).length,
  };
}

export function parseGitRefs(value: string): readonly { readonly name: string; readonly sha: string }[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, sha] = line.split("\t");
      if (name === undefined || sha === undefined || name.length === 0 || sha.length === 0) {
        throw new Error("Git returned an unreadable ref.");
      }
      return { name, sha };
    });
}

export function parseGitAheadBehind(value: string): { readonly ahead: number; readonly behind: number } {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error("Git returned an unreadable ahead/behind count.");
  }
  return { ahead: parts[1]!, behind: parts[0]! };
}

function divergence(ahead: number, behind: number): GitLineageBranch["divergence"] {
  if (ahead > 0 && behind > 0) return "diverged";
  if (ahead > 0) return "ahead";
  if (behind > 0) return "behind";
  return "same";
}

export interface GitLineageAdapterOptions {
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly productionBranch: string;
  readonly deploymentAssociations?:
    | readonly GitDeploymentAssociation[]
    | ((productionHeadSha: string) => readonly GitDeploymentAssociation[]);
  readonly runner?: GitCommandRunner;
  readonly now?: () => string;
}

export interface GitLineageAdapter extends ProviderAdapter<GitLineageSnapshot> {}

export function createGitLineageAdapter(options: GitLineageAdapterOptions): GitLineageAdapter {
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => new Date().toISOString());
  const identity: ProviderIdentity = {
    provider: gitLineageProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  const read = async (request: ProviderReadRequest): Promise<ProviderReadResult<GitLineageSnapshot>> => {
    const path = request.reference.trim();
    if (path.length === 0) return { kind: "failed", failure: providerFailure("unavailable", "Git repository checkout is not configured; worker state is unavailable.") };
    const run = async (...args: string[]): Promise<string> => {
      const result = await runner(["-C", path, ...args]);
      if (result.exitCode !== 0) throw new GitCommandFailure(result.stderr || "Git command failed.");
      return result.stdout;
    };
    const retrievedAt = now();
    try {
      const statusText = await run("status", "--porcelain=v1", "--branch");
      const status = parseGitStatusPorcelain(statusText);
      const currentHeadSha = (await run("rev-parse", "HEAD")).trim();
      if (currentHeadSha.length === 0) throw new Error("Git did not return HEAD.");
      const refs = parseGitRefs(await run("for-each-ref", "--format=%(refname:short)\t%(objectname)", "refs/heads"));
      const production = refs.find((ref) => ref.name === options.productionBranch);
      if (production === undefined) throw new Error("Git did not return the production branch.");
      const branches: GitLineageBranch[] = [];
      for (const ref of refs) {
        const counts = parseGitAheadBehind(await run("rev-list", "--left-right", "--count", `${options.productionBranch}...${ref.name}`));
        branches.push({ ...ref, ...counts, divergence: divergence(counts.ahead, counts.behind) });
      }
      const tags = parseGitRefs(await run("for-each-ref", "--format=%(refname:short)\t%(objectname)", "refs/tags"));
      const provenance: ProviderProvenance = {
        sourceIdentity: gitLineageProvider,
        sourceReference: path,
        asOf: retrievedAt,
        retrievedAt,
        freshness: "current",
      };
      const snapshot: GitLineageSnapshot = {
        repositoryPath: path,
        productionBranch: options.productionBranch,
        productionHeadSha: production.sha,
        currentBranch: status.branch,
        currentHeadSha,
        branches,
        tags,
        deploymentAssociations:
          typeof options.deploymentAssociations === "function"
            ? options.deploymentAssociations(production.sha)
            : options.deploymentAssociations ?? [],
        worker: {
          availability: "online",
          branch: status.branch,
          headSha: currentHeadSha,
          dirty: status.dirtyFiles > 0,
          dirtyFiles: status.dirtyFiles,
        },
      };
      return { kind: "ok", identity, provenance, value: snapshot };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          error instanceof GitCommandFailure ? "unavailable" : "provider-error",
          error instanceof GitCommandFailure
            ? "Git repository is unavailable; worker state was not inferred."
            : "Git returned an unreadable lineage response; worker state was not inferred.",
        ),
      };
    }
  };
  return {
    identity: () => identity,
    capabilities: () => ["read"],
    read,
    write: async (_request: ProviderWriteRequest): Promise<ProviderWriteResult> => ({
      kind: "failed",
      failure: providerFailure("unsupported-capability", "Git lineage adapter is read-only."),
    }),
  };
}
