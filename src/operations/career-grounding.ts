import type { OperationsGateway } from "./operations-gateway.js";
import type { ExecutiveRole, WorkItem } from "./contracts.js";
import { detectSensitiveFields } from "./sensitive-secret.js";
import type { PrivateWorker } from "../workers/private-worker.js";
import type { ProjectEvidenceBroker } from "../evidence/evidence-broker.js";

export const careerGroundingEffectKind = "career-grounding";

/**
 * Where a user-facing career claim is allowed to come from. Project Evidence is
 * deliberately absent: history can support a claim, but it can never be the
 * thing that makes one true.
 */
export type CareerClaimProvenanceKind =
  | "career-file"
  | "ceo-confirmed"
  | "project-evidence";

export interface CareerClaimProvenance {
  readonly kind: CareerClaimProvenanceKind;
  readonly reference: string;
}

export interface CareerClaimRequest {
  readonly text: string;
  readonly provenance: CareerClaimProvenance;
  /**
   * Optional historical support. It is cited beside the claim, never in place
   * of it: the claim still has to stand on a career file or CEO confirmation.
   */
  readonly corroboration?: { readonly portfolioProjectId: string };
}

export interface CareerClaimCorroboration {
  readonly canonicalEvidenceId: string;
  readonly sourceIdentity: string;
  readonly freshness: "current" | "stale";
}

export interface GroundedCareerClaim {
  readonly text: string;
  readonly provenance: CareerClaimProvenance;
  readonly corroboration: CareerClaimCorroboration | undefined;
}

export interface CareerFile {
  readonly reference: string;
  readonly localOnly: boolean;
  readonly claims: readonly string[];
}

/**
 * What another Executive may see of career work for a bounded contribution:
 * that it exists, who owns it, and how many claims it makes. Never the claims
 * themselves, and never a local-only source reference.
 */
export interface CareerCollaboratorProjection {
  readonly kind: "approved-projection";
  readonly workItemId: string;
  readonly executive: ExecutiveRole;
  readonly workstream: "Career Job";
  readonly claimCount: number;
  readonly asOf: string;
}

export interface CareerGroundingRequest {
  readonly intent: string;
  readonly claims: readonly CareerClaimRequest[];
  readonly collaborator?: {
    readonly executive: ExecutiveRole;
    readonly contribution: string;
  };
}

export type CareerGroundingResult =
  | {
      readonly kind: "grounded";
      readonly workItem: WorkItem;
      readonly claims: readonly GroundedCareerClaim[];
      readonly localOnlyReads: readonly string[];
      readonly collaboratorProjection: CareerCollaboratorProjection | undefined;
    }
  | {
      readonly kind: "refused";
      readonly reason:
        | "claim-not-in-source"
        | "evidence-is-not-a-claim"
        | "unknown-career-file"
        | "unbounded-career-claim";
      readonly claim: string;
    }
  | {
      readonly kind: "waiting";
      readonly reason: "private-worker-unavailable";
      readonly sourceReference: string;
    };

export interface CareerGroundingCoordinator {
  ground(request: CareerGroundingRequest): Promise<CareerGroundingResult>;
}

export function createCareerGroundingCoordinator(options: {
  readonly gateway: OperationsGateway;
  readonly files: Readonly<Record<string, CareerFile>>;
  readonly privateWorker: PrivateWorker | undefined;
  readonly evidenceBroker: ProjectEvidenceBroker | undefined;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly now: () => string;
}): CareerGroundingCoordinator {
  return {
    async ground(request): Promise<CareerGroundingResult> {
      const intent = request.intent.replace(/\s+/gu, " ").trim();
      if (intent.length === 0 || intent.length > 240) {
        return {
          kind: "refused",
          reason: "unbounded-career-claim",
          claim: intent,
        };
      }

      const grounded: GroundedCareerClaim[] = [];
      const localOnlyReads: string[] = [];

      for (const claim of request.claims) {
        const text = claim.text.replace(/\s+/gu, " ").trim();
        if (
          text.length === 0 ||
          text.length > 240 ||
          detectSensitiveFields({ claim: text }).length > 0
        ) {
          return { kind: "refused", reason: "unbounded-career-claim", claim: text };
        }

        // Cited history is support, not authorship. A claim resting only on
        // Project Evidence would let the Evidence Broker manufacture a fact
        // about Ming that no career file or CEO confirmation stands behind.
        if (claim.provenance.kind === "project-evidence") {
          return { kind: "refused", reason: "evidence-is-not-a-claim", claim: text };
        }

        if (claim.provenance.kind === "ceo-confirmed") {
          grounded.push({
            text,
            provenance: claim.provenance,
            corroboration: undefined,
          });
          continue;
        }

        const file = options.files[claim.provenance.reference];
        if (file === undefined) {
          return { kind: "refused", reason: "unknown-career-file", claim: text };
        }
        if (!file.claims.includes(text)) {
          return { kind: "refused", reason: "claim-not-in-source", claim: text };
        }
        if (file.localOnly) {
          // Local-only career context never leaves the laptop by another route.
          // With the worker asleep the honest answer is to wait, not to answer
          // from memory.
          if (options.privateWorker?.heartbeat().available !== true) {
            return {
              kind: "waiting",
              reason: "private-worker-unavailable",
              sourceReference: file.reference,
            };
          }
          localOnlyReads.push(file.reference);
        }
        grounded.push({
          text,
          provenance: { kind: "career-file", reference: file.reference },
          corroboration: undefined,
        });
      }

      // The effect records every user-facing claim's provenance, which is what
      // makes the Outcome Report auditable against invention.
      const provenanceList = grounded
        .map((claim) => `"${claim.text}" (${claim.provenance.reference})`)
        .join("; ");
      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey: `career-grounding:${intent}`,
        intent,
        ...(request.collaborator === undefined
          ? {}
          : {
              collaboratingExecutives: [
                {
                  executive: request.collaborator.executive,
                  contribution: request.collaborator.contribution,
                },
              ],
            }),
        expectedEffect: {
          // Grounding that needs a local-only file IS local work, so it runs on
          // the Lenovo worker as a local read rather than as a generic effect
          // the worker has no capability for.
          kind:
            localOnlyReads.length > 0 ? "local-file-read" : careerGroundingEffectKind,
          value: `${grounded.length} claims grounded in ${provenanceList}`,
        },
        workstream: "Career Job",
      });

      // The gateway routes execution through the private worker when one is
      // configured, so the local read happens there. Running it separately
      // here would perform the same read twice.
      // Corroboration goes through the Evidence Broker against this Work Item,
      // so its own role and project scoping applies and the citation lands in
      // the audit trail beside the claim it supports.
      const cited: GroundedCareerClaim[] = [];
      for (const [index, claim] of grounded.entries()) {
        const requested = request.claims[index]?.corroboration;
        if (requested === undefined || options.evidenceBroker === undefined) {
          cited.push(claim);
          continue;
        }
        options.evidenceBroker.bind({
          actorId: options.actorId,
          workspaceId: options.workspaceId,
          workItemId: acknowledgement.workItem.id,
          portfolioProjectId: requested.portfolioProjectId,
        });
        const evidence = await options.evidenceBroker.serve({
          workspaceId: options.workspaceId,
          executive: "COO",
          workItemId: acknowledgement.workItem.id,
          purpose: "career claim corroboration",
          portfolioProjectId: requested.portfolioProjectId,
        });
        cited.push(
          evidence.kind === "served" || evidence.kind === "stale"
            ? {
                ...claim,
                corroboration: {
                  canonicalEvidenceId: evidence.evidence.canonicalEvidenceId,
                  sourceIdentity: evidence.evidence.sourceIdentity,
                  freshness: evidence.evidence.freshness,
                },
              }
            : claim,
        );
      }

      const executed = await options.gateway.executeWorkItem(
        acknowledgement.workItem.id,
      );

      return {
        kind: "grounded",
        workItem: executed.workItem,
        claims: cited,
        localOnlyReads,
        // Built only for a collaborator the caller actually named. Inventing an
        // addressee would manufacture a projection nobody asked for.
        collaboratorProjection:
          request.collaborator === undefined
            ? undefined
            : {
                kind: "approved-projection",
                workItemId: executed.workItem.id,
                executive: request.collaborator.executive,
                workstream: "Career Job",
                claimCount: cited.length,
                asOf: options.now(),
              },
      };
    },
  };
}
