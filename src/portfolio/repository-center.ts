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

export interface RepositoryProviderObservation {
  readonly provider: string;
  readonly status: ProviderObservationStatus;
  readonly sourceReference: string;
  readonly asOf: string | null;
  readonly retrievedAt: string;
  readonly failureClass: string | null;
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
  /** Local Git checkout reference used for truthful degraded provenance. */
  readonly gitSourceReference?: string;
  readonly now: string;
}): RepositoryCenterView {
  const githubReference = options.project.repository ?? "unknown";
  const gitReference = options.gitSourceReference?.trim() || "local-git:unconfigured";
  const githubObservation = observationFor(githubRepositoryProvider, githubReference, options.github, options.now);
  const gitObservation = observationFor(gitLineageProvider, gitReference, options.git, options.now);
  const githubValue = options.github.kind === "failed" ? undefined : options.github.value;
  const gitValue = options.git.kind === "failed" ? undefined : options.git.value;
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
  };
}
