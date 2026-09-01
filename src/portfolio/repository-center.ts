import type { PortfolioProject } from "./project-portfolio.js";
import {
  providerObservationFromRead,
  type ProviderObservationInput,
  type ProviderObservationStatus,
} from "../providers/provider-health.js";
import type { ProviderReadResult } from "../providers/adapter-contract.js";
import {
  githubRepositoryProvider,
  type GitHubRepositorySnapshot,
} from "../providers/github-repository-adapter.js";
import {
  gitLineageProvider,
  type GitLineageSnapshot,
} from "../providers/git-lineage-adapter.js";
import type {
  VercelDeployment,
  VercelDeploymentSnapshot,
} from "../providers/vercel-deployment-adapter.js";

export interface RepositoryProviderObservation {
  readonly provider: string;
  readonly status: ProviderObservationStatus;
  readonly sourceReference: string;
  readonly asOf: string | null;
  readonly retrievedAt: string;
  readonly failureClass: string | null;
}

export interface DeploymentVerificationRecord {
  readonly reference: string;
  readonly asOf: string;
}

export function vercelDeploymentLineageStatus(
  commitSha: string | null,
  githubPullRequestHeads: readonly string[],
  gitBranchHeads: readonly string[],
): "matched" | "mismatched" | "unknown" {
  if (commitSha === null) return "unknown";
  return githubPullRequestHeads.includes(commitSha) || gitBranchHeads.includes(commitSha)
    ? "matched"
    : "mismatched";
}

export interface RepositoryCenterView {
  readonly projectId: string;
  readonly repository: {
    readonly reference: string | null;
    readonly fullName: string | null;
    readonly url: string | null;
    readonly productionBranch: string | null;
    readonly productionHeadSha: string | null;
  };
  readonly github: {
    readonly observation: RepositoryProviderObservation;
    readonly branches: readonly GitHubRepositorySnapshot["branches"][number][];
    readonly pullRequests: readonly GitHubRepositorySnapshot["pullRequests"][number][];
    readonly checks: readonly GitHubRepositorySnapshot["checks"][number][];
    readonly reviews: readonly GitHubRepositorySnapshot["reviews"][number][];
    readonly releases: readonly GitHubRepositorySnapshot["releases"][number][];
    readonly incidents: readonly GitHubRepositorySnapshot["incidents"][number][];
  };
  readonly git: {
    readonly observation: RepositoryProviderObservation;
    readonly productionHeadSha: string | null;
    readonly currentBranch: string | null;
    readonly currentHeadSha: string | null;
    readonly branches: readonly GitLineageSnapshot["branches"][number][];
    readonly tags: readonly GitLineageSnapshot["tags"][number][];
    readonly deploymentAssociations: readonly GitLineageSnapshot["deploymentAssociations"][number][];
    readonly worker: GitLineageSnapshot["worker"];
  };
  readonly vercel: {
    readonly observation: RepositoryProviderObservation;
    readonly deployments: readonly (VercelDeployment & {
      readonly verificationStatus: "unverified" | "verified";
      /** Evidence is intentionally separate from Vercel's deployment status. */
      readonly verificationEvidence: DeploymentVerificationRecord | null;
      readonly rollbackCandidate: boolean;
      readonly lineageStatus: "matched" | "mismatched" | "unknown";
    })[];
  } | null;
}

function observationFor<T>(
  provider: string,
  sourceReference: string,
  result: ProviderReadResult<T>,
  now: string,
): RepositoryProviderObservation {
  const identity = {
    provider,
    accountReference: `${provider}:real-ming`,
  };
  const input: ProviderObservationInput = providerObservationFromRead(
    identity,
    result.kind === "failed" ? sourceReference : result.provenance.sourceReference,
    result,
    now,
  );
  return {
    provider: input.provider,
    status: input.status,
    sourceReference: input.sourceReference,
    asOf: result.kind === "failed" ? null : result.provenance.asOf,
    retrievedAt: result.kind === "failed" ? now : result.provenance.retrievedAt,
    failureClass: input.failureClass ?? null,
  };
}

export function buildRepositoryCenterView(options: {
  readonly project: PortfolioProject;
  readonly github: ProviderReadResult<GitHubRepositorySnapshot>;
  readonly git: ProviderReadResult<GitLineageSnapshot>;
  readonly vercel?: ProviderReadResult<VercelDeploymentSnapshot>;
  /** Optional live/synthetic verification records supplied by a later tracer. */
  readonly verificationEvidence?: ReadonlyMap<string, DeploymentVerificationRecord>;
  /** Local Git checkout reference used for truthful degraded provenance. */
  readonly gitSourceReference?: string;
  readonly now: string;
}): RepositoryCenterView {
  const githubReference = options.project.repository ?? "unknown";
  const gitReference = options.gitSourceReference?.trim() || "local-git:unconfigured";
  const githubObservation = observationFor(githubRepositoryProvider, githubReference, options.github, options.now);
  const gitObservation = observationFor(gitLineageProvider, gitReference, options.git, options.now);
  const vercelReference = options.project.deploymentIdentifiers.vercel ?? "vercel:unconfigured";
  const vercelObservation = options.vercel === undefined
    ? undefined
    : observationFor("vercel", vercelReference, options.vercel, options.now);
  const githubValue = options.github.kind === "failed" ? undefined : options.github.value;
  const gitValue = options.git.kind === "failed" ? undefined : options.git.value;
  const vercelValue = options.vercel === undefined || options.vercel.kind === "failed" ? undefined : options.vercel.value;
  const productionDeployments = vercelValue?.deployments.filter((deployment) => deployment.environment === "production" && deployment.status === "ready") ?? [];
  const newestProduction = [...productionDeployments].sort((left, right) => Date.parse(right.readyAt ?? right.createdAt ?? "") - Date.parse(left.readyAt ?? left.createdAt ?? ""))[0];
  const githubPulls = githubValue?.pullRequests ?? [];
  const gitShas = new Set((gitValue?.branches ?? []).map((branch) => branch.sha));
  const vercelDeployments = (vercelValue?.deployments ?? []).map((deployment) => {
    const verificationEvidence = deployment.status === "ready"
      ? options.verificationEvidence?.get(deployment.id) ?? null
      : null;
    const lineageStatus = vercelDeploymentLineageStatus(
      deployment.commitSha,
      githubPulls.map((pull) => pull.head.sha),
      [...gitShas],
    );
    return {
      ...deployment,
      verificationStatus: verificationEvidence === null ? "unverified" as const : "verified" as const,
      verificationEvidence,
      rollbackCandidate: deployment.environment === "production" && deployment.status === "ready" && newestProduction !== undefined && deployment.id !== newestProduction.id && verificationEvidence !== null && lineageStatus === "matched",
      lineageStatus,
    };
  });
  return {
    projectId: options.project.id,
    repository: {
      reference: options.project.repository,
      fullName: githubValue?.fullName ?? null,
      url: githubValue?.url ?? null,
      productionBranch: githubValue?.productionBranch ?? gitValue?.productionBranch ?? options.project.productionBranch,
      productionHeadSha: githubValue?.productionHeadSha ?? gitValue?.productionHeadSha ?? null,
    },
    github: {
      observation: githubObservation,
      branches: githubValue?.branches ?? [],
      pullRequests: githubValue?.pullRequests ?? [],
      checks: githubValue?.checks ?? [],
      reviews: githubValue?.reviews ?? [],
      releases: githubValue?.releases ?? [],
      incidents: githubValue?.incidents ?? [],
    },
    git: {
      observation: gitObservation,
      productionHeadSha: gitValue?.productionHeadSha ?? null,
      currentBranch: gitValue?.currentBranch ?? null,
      currentHeadSha: gitValue?.currentHeadSha ?? null,
      branches: gitValue?.branches ?? [],
      tags: gitValue?.tags ?? [],
      deploymentAssociations: gitValue?.deploymentAssociations ?? [],
      worker: gitValue?.worker ?? {
        availability: "unknown",
        branch: null,
        headSha: null,
        dirty: null,
        dirtyFiles: null,
      },
    },
    vercel: vercelObservation === undefined
      ? null
      : { observation: vercelObservation, deployments: vercelDeployments },
  };
}
