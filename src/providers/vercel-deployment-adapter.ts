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

export const vercelDeploymentProvider = "vercel";

export type VercelDeploymentStatus = "building" | "ready" | "failed" | "cancelled" | "unknown";
export type VercelDeploymentEnvironment = "preview" | "production" | "development" | "unknown";

export interface VercelDeployment {
  readonly id: string;
  readonly status: VercelDeploymentStatus;
  readonly environment: VercelDeploymentEnvironment;
  readonly domain: string | null;
  readonly commitSha: string | null;
  readonly branch: string | null;
  readonly pullRequestNumber: number | null;
  readonly sourceReference: string;
  readonly createdAt: string | null;
  readonly readyAt: string | null;
}

export interface VercelDeploymentSnapshot {
  readonly projectReference: string;
  readonly deployments: readonly VercelDeployment[];
}

export interface VercelDeploymentAdapter extends ProviderAdapter<VercelDeploymentSnapshot> {}

interface JsonRecord { readonly [key: string]: unknown }
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isInteger(value) ? value : null; }
function timestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value))) return value;
  return null;
}

function statusFor(value: unknown): VercelDeploymentStatus {
  switch (value) {
    case "BUILDING": return "building";
    case "READY": return "ready";
    case "ERROR": return "failed";
    case "CANCELED":
    case "CANCELLED": return "cancelled";
    default: return "unknown";
  }
}

function environmentFor(value: unknown): VercelDeploymentEnvironment {
  // Vercel uses a null target for preview deployments.
  if (value === null || value === undefined) return "preview";
  if (value === "production" || value === "preview" || value === "development") return value;
  return "unknown";
}

function deploymentFrom(value: unknown): VercelDeployment {
  if (!isRecord(value)) throw new Error("Vercel returned an unreadable deployment.");
  const id = text(value["uid"]) ?? text(value["id"]);
  if (id === null) throw new Error("Vercel returned a deployment without an id.");
  const meta = isRecord(value["meta"]) ? value["meta"] : {};
  const domain = text(value["url"]) ?? (Array.isArray(value["alias"]) ? text(value["alias"][0]) : null);
  const target = value["target"];
  const pullRequest = number(meta["githubPrId"] ?? meta["githubPullRequestId"]);
  return {
    id,
    status: statusFor(value["state"]),
    environment: environmentFor(target),
    domain: domain === null ? null : domain.startsWith("http") ? domain : `https://${domain}`,
    commitSha: text(meta["githubCommitSha"] ?? meta["commitSha"]),
    branch: text(meta["githubCommitRef"] ?? meta["githubCommitBranch"] ?? value["gitSource"]),
    pullRequestNumber: pullRequest,
    sourceReference: `vercel:deployment:${id}`,
    createdAt: timestamp(value["createdAt"]),
    readyAt: timestamp(value["readyAt"]),
  };
}

function latestDate(deployments: readonly VercelDeployment[], fallback: string): string {
  return deployments
    .flatMap((deployment) => [deployment.readyAt, deployment.createdAt])
    .filter((value): value is string => value !== null && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? fallback;
}

function failureClass(status: number) {
  if (status === 401) return "authentication-failed" as const;
  if (status === 403) return "permission-denied" as const;
  if (status === 404) return "invalid-input" as const;
  if (status === 429) return "rate-limited" as const;
  if (status >= 500) return "unavailable" as const;
  return "provider-error" as const;
}

export interface VercelDeploymentAdapterOptions {
  readonly token: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly teamId?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}

export function createVercelDeploymentAdapter(options: VercelDeploymentAdapterOptions): VercelDeploymentAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const identity: ProviderIdentity = {
    provider: vercelDeploymentProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token.trim().length > 0) headers.Authorization = `Bearer ${options.token}`;
  const read = async (requestInput: ProviderReadRequest): Promise<ProviderReadResult<VercelDeploymentSnapshot>> => {
    const projectReference = requestInput.reference.trim();
    if (projectReference.length === 0) return { kind: "failed", failure: providerFailure("invalid-input", "Vercel project reference is required.") };
    const url = new URL("https://api.vercel.com/v6/deployments");
    url.searchParams.set("projectId", projectReference.replace(/^vercel:/i, ""));
    url.searchParams.set("limit", "100");
    if (options.teamId !== undefined && options.teamId.trim().length > 0) url.searchParams.set("teamId", options.teamId);
    const retrievedAt = now();
    try {
      const response = await request(url, { headers });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "");
        return { kind: "failed", failure: providerFailure(failureClass(response.status), `Vercel deployment read failed with HTTP ${response.status}.`, [options.token], Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined) };
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body["deployments"])) return { kind: "failed", failure: providerFailure("provider-error", "Vercel returned an unreadable deployment list.", [options.token]) };
      const deployments = body["deployments"].map(deploymentFrom);
      const asOf = latestDate(deployments, retrievedAt);
      const provenance: ProviderProvenance = {
        sourceIdentity: vercelDeploymentProvider,
        sourceReference: projectReference,
        asOf,
        retrievedAt,
        freshness: Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs ? "stale" : "current",
      };
      const result = { identity, provenance, value: { projectReference, deployments } };
      return provenance.freshness === "stale" ? { kind: "stale", ...result } : { kind: "ok", ...result };
    } catch (_error) {
      return { kind: "failed", failure: providerFailure("provider-error", "Vercel returned an unreadable deployment response.", [options.token]) };
    }
  };
  return {
    identity: () => identity,
    capabilities: () => ["read"],
    read,
    write: async (_request: ProviderWriteRequest): Promise<ProviderWriteResult> => ({ kind: "failed", failure: providerFailure("unsupported-capability", "Vercel deployment adapter is read-only.", [options.token]) }),
  };
}
