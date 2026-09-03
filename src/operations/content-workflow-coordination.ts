import type { OperationsGateway } from "./operations-gateway.js";
import type { WorkItem } from "./contracts.js";
import { detectSensitiveFields } from "./sensitive-secret.js";
import type { ProjectPortfolio } from "../portfolio/project-portfolio.js";
import type {
  ProjectEvidenceBroker,
  ProjectEvidenceResult,
} from "../evidence/evidence-broker.js";

export const contentWorkflowEffectKind = "content-workflow-coordination";

export const contentWorkflowTasks = [
  "selection",
  "research",
  "production",
  "distribution",
] as const;
export type ContentWorkflowTask = (typeof contentWorkflowTasks)[number];

/**
 * How fresh the project evidence behind this coordination was. `unavailable`
 * is deliberately one of the answers: coordinating as though Agent Brain had
 * simply returned nothing would present a degraded read as a healthy one.
 */
export type ContentEvidenceFreshness = "current" | "stale" | "unavailable";

export interface ContentWorkflowRequest {
  readonly projectId: string;
  readonly workflowRecord: string;
  readonly task: ContentWorkflowTask;
  readonly intent: string;
}

export type ContentWorkflowResult =
  | {
      readonly kind: "coordinated";
      readonly workItem: WorkItem;
      /** The workflow record this Work Item points at. Never its contents. */
      readonly workflowLink: string;
      readonly evidence: ProjectEvidenceResult | undefined;
      readonly evidenceFreshness: ContentEvidenceFreshness;
      /**
       * Freshness of the workflow source link itself. The workflow stays the
       * authority, so a link the portfolio already considers stale must be
       * reported rather than coordinated against as though it were current.
       */
      readonly workflowFreshness: "current" | "stale";
    }
  | {
      readonly kind: "denied";
      readonly reason:
        | "project-not-in-portfolio"
        | "project-not-cmo"
        | "workflow-source-missing"
        | "unbounded-content-intent";
    };

export interface ContentWorkflowCoordinator {
  coordinate(request: ContentWorkflowRequest): Promise<ContentWorkflowResult>;
}

function freshnessOf(
  evidence: ProjectEvidenceResult | undefined,
): ContentEvidenceFreshness {
  if (evidence === undefined) return "unavailable";
  if (evidence.kind === "served") return "current";
  if (evidence.kind === "stale") return "stale";
  return "unavailable";
}

export function createContentWorkflowCoordinator(options: {
  readonly portfolio: ProjectPortfolio;
  readonly gateway: OperationsGateway;
  readonly evidenceBroker: ProjectEvidenceBroker | undefined;
  readonly actorId: string;
  readonly workspaceId: string;
}): ContentWorkflowCoordinator {
  return {
    async coordinate(request): Promise<ContentWorkflowResult> {
      const project = options.portfolio.project(request.projectId);
      if (project === undefined) {
        return { kind: "denied", reason: "project-not-in-portfolio" };
      }
      if (!project.responsibleRoles.includes("CMO")) {
        return { kind: "denied", reason: "project-not-cmo" };
      }
      // The workflow stays authoritative, so a content project without one has
      // nothing for Real-Ming to link to and must not be coordinated blind.
      const workflowSource = project.sourceLinks.find(
        (link) => link.kind === "content-workflow",
      );
      if (workflowSource === undefined) {
        return { kind: "denied", reason: "workflow-source-missing" };
      }

      const intent = request.intent.replace(/\s+/gu, " ").trim();
      if (
        intent.length === 0 ||
        intent.length > 240 ||
        detectSensitiveFields({ intent }).length > 0
      ) {
        return { kind: "denied", reason: "unbounded-content-intent" };
      }

      // The effect names the task and the workflow record, and nothing else.
      // Snapshotting any of the record's own state here would leave a copy that
      // goes stale the moment the workflow moves on, which is exactly what
      // "source updates remain authoritative" forbids.
      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey: `content-workflow:${request.projectId}:${request.workflowRecord}:${request.task}`,
        intent,
        expectedEffect: {
          kind: contentWorkflowEffectKind,
          value: `${request.task} for ${request.workflowRecord}`,
        },
        workstream: "Content Creation",
      });
      let workItem = acknowledgement.workItem;

      let evidence: ProjectEvidenceResult | undefined;
      if (options.evidenceBroker !== undefined) {
        options.evidenceBroker.bind({
          actorId: options.actorId,
          workspaceId: options.workspaceId,
          workItemId: workItem.id,
          portfolioProjectId: request.projectId,
        });
        evidence = await options.evidenceBroker.serve({
          workspaceId: options.workspaceId,
          executive: "CMO",
          workItemId: workItem.id,
          purpose: `content ${request.task}`,
          portfolioProjectId: request.projectId,
        });
      }

      const executed = await options.gateway.executeWorkItem(workItem.id);
      workItem = executed.workItem;

      return {
        kind: "coordinated",
        workItem,
        workflowLink: request.workflowRecord,
        evidence,
        evidenceFreshness: freshnessOf(evidence),
        workflowFreshness: workflowSource.freshness,
      };
    },
  };
}
