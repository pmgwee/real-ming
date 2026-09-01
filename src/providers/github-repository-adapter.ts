import {
  providerFailure,
  providerStalenessThresholdMs,
  type ProviderAdapter,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadRequest,
  type ProviderReadResult,
  type ProviderWriteRequest,
  type ProviderWriteResult,
} from "./adapter-contract.js";

export const githubRepositoryProvider = "github";

export interface GitHubRepositoryBranch {
  readonly name: string;
  readonly sha: string;
  readonly protected: boolean;
}

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly draft: boolean;
  readonly url: string;
  readonly head: { readonly branch: string; readonly sha: string };
  readonly base: { readonly branch: string; readonly sha: string };
  readonly reviewDecision: string | null;
}

export interface GitHubCheck {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly sha: string;
  readonly url: string | null;
}

export interface GitHubReview {
  readonly pullRequestNumber: number;
  readonly reviewer: string;
  readonly state: string;
  readonly commitSha: string;
  readonly submittedAt: string | null;
}

export interface GitHubRelease {
  readonly tag: string;
  readonly targetSha: string;
  readonly url: string;
  readonly publishedAt: string | null;
}

export interface GitHubIncidentLink {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly openedAt: string | null;
}

export interface GitHubRepositorySnapshot {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly url: string;
  readonly productionBranch: string;
  readonly productionHeadSha: string;
  readonly branches: readonly GitHubRepositoryBranch[];
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly checks: readonly GitHubCheck[];
  readonly reviews: readonly GitHubReview[];
  readonly releases: readonly GitHubRelease[];
  readonly incidents: readonly GitHubIncidentLink[];
}

export interface GitHubRepositoryAdapter extends ProviderAdapter<GitHubRepositorySnapshot> {}

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function failureClass(status: number) {
  if (status === 401) return "authentication-failed" as const;
  if (status === 403) return "permission-denied" as const;
  if (status === 404) return "invalid-input" as const;
  if (status === 429) return "rate-limited" as const;
  if (status >= 500) return "unavailable" as const;
  return "provider-error" as const;
}

function repositoryReference(reference: string): { owner: string; name: string } | undefined {
  const normalized = reference.trim().replace(/^github:/i, "").replace(/\.git$/i, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))
    ? { owner: parts[0]!, name: parts[1]! }
    : undefined;
}

function dateCandidates(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return ["updated_at", "pushed_at", "published_at", "submitted_at", "created_at"]
    .map((key) => value[key])
    .filter((candidate): candidate is string => typeof candidate === "string");
}

function latestDate(values: readonly unknown[], fallback: string): string {
  const dates = values.flatMap(dateCandidates).filter((value) => Number.isFinite(Date.parse(value)));
  return dates.sort().at(-1) ?? fallback;
}

function normalizeBranch(value: unknown): GitHubRepositoryBranch {
  if (!isRecord(value)) throw new Error("GitHub returned an unreadable branch.");
  const commit = isRecord(value["commit"]) ? value["commit"] : {};
  const name = text(value["name"]);
  const sha = text(commit["sha"]);
  if (name.length === 0 || sha.length === 0) throw new Error("GitHub returned an incomplete branch.");
  return { name, sha, protected: value["protected"] === true };
}

function normalizePullRequest(value: unknown): GitHubPullRequest {
  if (!isRecord(value)) throw new Error("GitHub returned an unreadable pull request.");
  const head = isRecord(value["head"]) ? value["head"] : {};
  const base = isRecord(value["base"]) ? value["base"] : {};
  const numberValue = number(value["number"], -1);
  const headRef = text(head["ref"]);
  const headSha = text(head["sha"]);
  const baseRef = text(base["ref"]);
  const baseSha = text(base["sha"]);
  if (numberValue < 0 || headRef.length === 0 || headSha.length === 0 || baseRef.length === 0 || baseSha.length === 0) {
    throw new Error("GitHub returned an incomplete pull request.");
  }
  return {
    number: numberValue,
    title: text(value["title"]),
    state: value["state"] === "closed" ? "closed" : "open",
    draft: value["draft"] === true,
    url: text(value["html_url"]),
    head: { branch: headRef, sha: headSha },
    base: { branch: baseRef, sha: baseSha },
    reviewDecision: typeof value["review_decision"] === "string" ? value["review_decision"] : null,
  };
}

function normalizeCheck(value: unknown, sha: string): GitHubCheck {
  if (!isRecord(value)) throw new Error("GitHub returned an unreadable check.");
  return {
    name: text(value["name"], "unnamed check"),
    status: text(value["status"], "unknown"),
    conclusion: typeof value["conclusion"] === "string" ? value["conclusion"] : null,
    sha,
    url: typeof value["html_url"] === "string" ? value["html_url"] : null,
  };
}

function normalizeReview(value: unknown, pullRequestNumber: number): GitHubReview {
  if (!isRecord(value)) throw new Error("GitHub returned an unreadable review.");
  const user = isRecord(value["user"]) ? value["user"] : {};
  return {
    pullRequestNumber,
    reviewer: text(user["login"], "unknown reviewer"),
    state: text(value["state"], "unknown"),
    commitSha: text(value["commit_id"]),
    submittedAt: typeof value["submitted_at"] === "string" ? value["submitted_at"] : null,
  };
}

function normalizeRelease(value: unknown): GitHubRelease {
  if (!isRecord(value)) throw new Error("GitHub returned an unreadable release.");
  return {
    tag: text(value["tag_name"]),
    targetSha: text(value["target_commitish"], "unknown target"),
    url: text(value["html_url"]),
    publishedAt: typeof value["published_at"] === "string" ? value["published_at"] : null,
  };
}

function normalizeIncident(value: unknown): GitHubIncidentLink {
  if (!isRecord(value)) throw new Error("GitHub returned an unreadable incident.");
  const numberValue = number(value["number"], -1);
  if (numberValue < 0) throw new Error("GitHub returned an incident without a number.");
  return {
    number: numberValue,
    title: text(value["title"]),
    url: text(value["html_url"]),
    openedAt: typeof value["created_at"] === "string" ? value["created_at"] : null,
  };
}

export interface GitHubRepositoryAdapterOptions {
  readonly token: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  /** Canonical branch from the Portfolio Project; falls back to GitHub's default. */
  readonly productionBranch?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}

export function createGitHubRepositoryAdapter(options: GitHubRepositoryAdapterOptions): GitHubRepositoryAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const identity: ProviderIdentity = {
    provider: githubRepositoryProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (options.token.trim().length > 0) headers.Authorization = `Bearer ${options.token}`;
  const get = async (url: string): Promise<unknown> => {
    const response = await request(url, { headers });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      throw providerFailure(
        failureClass(response.status),
        `GitHub read failed with HTTP ${response.status}.`,
        [options.token],
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }
    return response.json();
  };
  const read = async (requestInput: ProviderReadRequest): Promise<ProviderReadResult<GitHubRepositorySnapshot>> => {
    const parsed = repositoryReference(requestInput.reference);
    if (parsed === undefined) {
      return { kind: "failed", failure: providerFailure("invalid-input", "GitHub repository reference must be owner/name.") };
    }
    const retrievedAt = now();
    const base = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`;
    try {
      const repository = await get(base);
      if (!isRecord(repository)) throw new Error("GitHub returned an unreadable repository.");
      const productionBranch = options.productionBranch ?? text(repository["default_branch"], "main");
      const branchValues = await get(`${base}/branches?per_page=100`);
      const branches = Array.isArray(branchValues) ? branchValues.map(normalizeBranch) : (() => { throw new Error("GitHub returned an unreadable branch list."); })();
      const pullValues = await get(`${base}/pulls?state=open&per_page=100`);
      const pullRequests = Array.isArray(pullValues) ? pullValues.map(normalizePullRequest) : (() => { throw new Error("GitHub returned an unreadable pull request list."); })();
      const releaseValues = await get(`${base}/releases?per_page=100`);
      const releases = Array.isArray(releaseValues) ? releaseValues.map(normalizeRelease) : (() => { throw new Error("GitHub returned an unreadable release list."); })();
      const incidentValues = await get(`${base}/issues?state=open&labels=incident&per_page=100`);
      const incidents = Array.isArray(incidentValues) ? incidentValues.filter((value) => isRecord(value) && value["pull_request"] === undefined).map(normalizeIncident) : (() => { throw new Error("GitHub returned an unreadable incident list."); })();
      const production = branches.find((branch) => branch.name === productionBranch);
      if (production === undefined) throw new Error("GitHub did not return the production branch.");
      const checkShas = [...new Set([production.sha, ...pullRequests.map((pull) => pull.head.sha)])];
      const checks: GitHubCheck[] = [];
      const reviews: GitHubReview[] = [];
      for (const sha of checkShas) {
        const value = await get(`${base}/commits/${encodeURIComponent(sha)}/check-runs`);
        const runs = isRecord(value) && Array.isArray(value["check_runs"]) ? value["check_runs"] : (() => { throw new Error("GitHub returned an unreadable check list."); })();
        checks.push(...runs.map((run) => normalizeCheck(run, sha)));
      }
      for (const pull of pullRequests) {
        const value = await get(`${base}/pulls/${pull.number}/reviews`);
        if (!Array.isArray(value)) throw new Error("GitHub returned an unreadable review list.");
        reviews.push(...value.map((review) => normalizeReview(review, pull.number)));
      }
      const asOf = latestDate([repository, ...branches, ...pullRequests, ...releases, ...incidents], retrievedAt);
      const provenance: ProviderProvenance = {
        sourceIdentity: githubRepositoryProvider,
        sourceReference: `${parsed.owner}/${parsed.name}`,
        asOf,
        retrievedAt,
        freshness: Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs ? "stale" : "current",
      };
      const snapshot: GitHubRepositorySnapshot = {
        owner: parsed.owner,
        name: parsed.name,
        fullName: text(repository["full_name"], `${parsed.owner}/${parsed.name}`),
        url: text(repository["html_url"], `https://github.com/${parsed.owner}/${parsed.name}`),
        productionBranch,
        productionHeadSha: production.sha,
        branches,
        pullRequests,
        checks,
        reviews,
        releases,
        incidents,
      };
      return provenance.freshness === "stale" ? { kind: "stale", identity, provenance, value: snapshot } : { kind: "ok", identity, provenance, value: snapshot };
    } catch (error) {
      if (typeof error === "object" && error !== null && "class" in error && "message" in error) {
        return { kind: "failed", failure: error as ReturnType<typeof providerFailure> };
      }
      return { kind: "failed", failure: providerFailure("provider-error", "GitHub returned an unreadable repository response.", [options.token]) };
    }
  };
  return {
    identity: () => identity,
    capabilities: () => ["read"],
    read,
    write: async (_request: ProviderWriteRequest): Promise<ProviderWriteResult> => ({
      kind: "failed",
      failure: providerFailure("unsupported-capability", "GitHub repository adapter is read-only.", [options.token]),
    }),
  };
}
