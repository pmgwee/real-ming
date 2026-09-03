import type { ExecutiveRole } from "./contracts.js";
import type {
  PortfolioProject,
  PortfolioSensitivity,
  ProjectPortfolio,
} from "../portfolio/project-portfolio.js";
import type { ProjectEvidenceBroker } from "../evidence/evidence-broker.js";
import type { OperationsGateway } from "./operations-gateway.js";

export interface EvidenceEnablementCandidate {
  readonly projectId: string;
  readonly name: string;
  readonly directSourceOwner: ExecutiveRole;
  readonly responsibleRoles: readonly ExecutiveRole[];
  readonly sensitivity: PortfolioSensitivity;
  readonly evidenceIdentity: string;
  readonly allowedEvidencePolicy: "cited-read-only";
}

export interface EvidenceEnablementVerification {
  readonly serviceRestarted: boolean;
  readonly healthy: boolean;
  readonly storageInspected: boolean;
  readonly citedQueryPassed: boolean;
}

export interface EnabledProject {
  readonly projectId: string;
  readonly project: PortfolioProject;
  readonly verification: EvidenceEnablementVerification;
}

export type EvidenceEnablementResult =
  | { readonly kind: "enabled"; readonly enabled: readonly EnabledProject[] }
  | {
      readonly kind: "stopped";
      readonly failedAt: string;
      readonly reason: "unhealthy" | "cited-query-failed" | "not-reconciled";
      readonly enabled: readonly EnabledProject[];
    };

/** Restart, health and storage checks for one project's evidence service. */
export interface EvidenceServiceInspector {
  restart(evidenceIdentity: string): Promise<boolean>;
  healthy(evidenceIdentity: string): Promise<boolean>;
  storageInspected(evidenceIdentity: string): Promise<boolean>;
}

export interface EvidenceEnablementCoordinator {
  enable(): Promise<EvidenceEnablementResult>;
}

export function createEvidenceEnablementCoordinator(options: {
  readonly candidates: readonly EvidenceEnablementCandidate[];
  readonly portfolio: ProjectPortfolio;
  readonly evidenceBroker: ProjectEvidenceBroker | undefined;
  readonly inspector: EvidenceServiceInspector;
  readonly gateway: OperationsGateway;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly now: () => string;
}): EvidenceEnablementCoordinator {
  return {
    async enable(): Promise<EvidenceEnablementResult> {
      const enabled: EnabledProject[] = [];

      for (const candidate of options.candidates) {
        // Reconciled first. Registering a project whose owner, roles,
        // sensitivity or evidence identity are not settled would put an
        // unbounded source behind the Evidence Broker.
        if (
          candidate.responsibleRoles.length === 0 ||
          candidate.evidenceIdentity.trim().length === 0
        ) {
          return {
            kind: "stopped",
            failedAt: candidate.projectId,
            reason: "not-reconciled",
            enabled,
          };
        }

        const at = options.now();
        const project = options.portfolio.upsert({
          id: candidate.projectId,
          name: candidate.name,
          portfolioState: "owned active",
          repository: null,
          productionBranch: null,
          deploymentIdentifiers: { github: null, vercel: null },
          evidenceIdentity: candidate.evidenceIdentity,
          responsibleRoles: candidate.responsibleRoles,
          sensitivity: candidate.sensitivity,
          health: "healthy",
          operatingInstructions: `${candidate.evidenceIdentity}:operating-instructions`,
          sourceLinks: [
            {
              kind: "agent-brain",
              reference: candidate.evidenceIdentity,
              asOf: at,
            },
          ],
          createdAt: at,
          updatedAt: at,
        });

        const serviceRestarted = await options.inspector.restart(
          candidate.evidenceIdentity,
        );
        const healthy = await options.inspector.healthy(
          candidate.evidenceIdentity,
        );
        const storageInspected = await options.inspector.storageInspected(
          candidate.evidenceIdentity,
        );
        if (!serviceRestarted || !healthy || !storageInspected) {
          // One project's failure stops the sequence. Continuing would enable
          // later projects on the strength of an unverified earlier one.
          return {
            kind: "stopped",
            failedAt: candidate.projectId,
            reason: "unhealthy",
            enabled,
          };
        }

        // The verification is itself work: it gets a Work Item so the cited
        // query passes through the Broker's real authorization and leaves an
        // audit trail, rather than being asserted from outside the system.
        const acknowledgement = await options.gateway.acknowledgeCeoAction({
          actorId: options.actorId,
          workspaceId: options.workspaceId,
          idempotencyKey: `evidence-enablement:${candidate.projectId}`,
          intent: `Verify evidence enablement for ${candidate.name}`,
          expectedEffect: {
            kind: "evidence-enablement",
            value: `${candidate.projectId} via ${candidate.evidenceIdentity}`,
          },
          // The direct-source owner is accountable for proving their own
          // project's identity and boundary, which is also what lets the
          // Broker authorize the cited query below.
          accountableExecutive: candidate.directSourceOwner,
        });
        options.evidenceBroker?.bind({
          actorId: options.actorId,
          workspaceId: options.workspaceId,
          workItemId: acknowledgement.workItem.id,
          portfolioProjectId: candidate.projectId,
        });
        // A cited query is the real proof: the identity resolves and returns
        // evidence that carries citations, not merely that a service answers.
        const cited = await options.evidenceBroker?.serve({
          workspaceId: options.workspaceId,
          executive: candidate.directSourceOwner,
          workItemId: acknowledgement.workItem.id,
          purpose: "evidence enablement verification",
          portfolioProjectId: candidate.projectId,
        });
        const citedQueryPassed =
          cited?.kind === "served" || cited?.kind === "stale";
        if (!citedQueryPassed) {
          return {
            kind: "stopped",
            failedAt: candidate.projectId,
            reason: "cited-query-failed",
            enabled,
          };
        }

        enabled.push({
          projectId: candidate.projectId,
          project,
          verification: {
            serviceRestarted,
            healthy,
            storageInspected,
            citedQueryPassed,
          },
        });
      }

      return { kind: "enabled", enabled };
    },
  };
}
