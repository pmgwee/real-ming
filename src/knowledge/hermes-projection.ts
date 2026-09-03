import type { ExecutiveRole, TrustDomain } from "../operations/contracts.js";
import type { OperationsState } from "../operations/operations-state.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import { routeTrustDomain } from "../operations/executive-role-router.js";
import { roleVaultViews, type VaultRoot } from "./knowledge-vault.js";

export const maxHermesBriefChars = 2_000;

export interface CompiledKnowledgeQuery {
  readonly workspaceId: string;
  readonly executive: ExecutiveRole;
  readonly workItemId: string;
  readonly purpose: string;
  readonly allowedTrustDomains: readonly (TrustDomain | "CEO")[];
}

/**
 * What Hermes loads: a bounded brief plus a pointer back into the vault. The
 * corpus itself stays where it was compiled, so nothing here needs to be copied
 * into Hot Runtime Memory, a prompt, a dashboard log or an audit payload.
 */
export interface CompiledKnowledgeBrief {
  readonly sourceIdentity: string;
  readonly contentHash: string;
  readonly vaultPointer: string;
  readonly text: string;
  readonly citations: readonly string[];
  readonly asOf: string;
  readonly generation: number;
  readonly freshness: "current" | "stale";
  readonly contested: boolean;
}

export type CompiledKnowledgeResult =
  | { readonly kind: "served"; readonly brief: CompiledKnowledgeBrief }
  | {
      readonly kind: "denied";
      readonly reason:
        | "incomplete-scope"
        | "not-authorized"
        | "ceo-root-is-projection-only";
    };

export interface CompiledKnowledgePage {
  readonly root: VaultRoot;
  readonly path: string;
  readonly sourceIdentity: string;
  readonly allowedRoles: readonly ExecutiveRole[];
  readonly contentHash: string;
  readonly text: string;
  readonly citations: readonly string[];
  readonly asOf: string;
  readonly generation: number;
  readonly freshness: "current" | "stale";
  readonly contested: boolean;
}

export interface HermesProjectionBroker {
  serve(query: CompiledKnowledgeQuery): CompiledKnowledgeResult;
}

export function createHermesProjectionBroker(options: {
  readonly state: OperationsState;
  readonly pages: () => readonly CompiledKnowledgePage[];
}): HermesProjectionBroker {
  const boundedBriefText = (text: string): string => {
    const normalized = text.trim();
    return normalized.length <= maxHermesBriefChars
      ? normalized
      : `${normalized.slice(0, maxHermesBriefChars - 1)}…`;
  };

  return {
    serve(query): CompiledKnowledgeResult {
      // Scope is established before anything is retrieved, not filtered
      // afterwards: a query that cannot say why it is asking has no business
      // reaching the corpus at all.
      if (
        query.workspaceId.trim().length === 0 ||
        query.workItemId.trim().length === 0 ||
        query.executive.trim().length === 0 ||
        query.purpose.trim().length === 0 ||
        detectSensitiveFields({ purpose: query.purpose }).length > 0 ||
        query.allowedTrustDomains.length === 0
      ) {
        return { kind: "denied", reason: "incomplete-scope" };
      }

      // The CEO root holds Approved Projections, Roll-Ups, decisions and
      // Outcome Reports. Serving it as a corpus would hand back exactly the
      // raw cross-domain material it exists to keep out.
      if (query.allowedTrustDomains.includes("CEO")) {
        return { kind: "denied", reason: "ceo-root-is-projection-only" };
      }

      const workItem = options.state.workItem(query.workItemId);
      if (
        workItem === undefined ||
        workItem.workspaceId !== query.workspaceId ||
        (workItem.accountableExecutive !== query.executive &&
          !workItem.collaboratingExecutives.some(
            (assignment) => assignment.executive === query.executive,
          ))
      ) {
        return { kind: "denied", reason: "not-authorized" };
      }

      // A collaborating role may be named on a Work Item, but that does not
      // grant it a raw view into an unrelated Trust Domain. Cross-domain work
      // must arrive as an explicit Approved Projection instead.
      if (
        !query.allowedTrustDomains.includes(
          routeTrustDomain(workItem.workstream, workItem.accountableExecutive),
        )
      ) {
        return { kind: "denied", reason: "not-authorized" };
      }

      const view = roleVaultViews().find(
        (candidate) => candidate.executive === query.executive,
      );
      if (view === undefined) {
        return { kind: "denied", reason: "not-authorized" };
      }
      // Intersecting first is what makes a cross-domain query fall through to
      // the same denial as an empty corpus: an empty intersection matches no
      // page, so there is no separate branch to answer it differently.
      const permittedRoots = view.roots.filter((root) =>
        query.allowedTrustDomains.includes(root),
      );
      if (
        query.allowedTrustDomains.some(
          (root) => !view.roots.includes(root as VaultRoot),
        )
      ) {
        return { kind: "denied", reason: "not-authorized" };
      }

      const page = options
        .pages()
        .find(
          (candidate) =>
            permittedRoots.includes(candidate.root) &&
            candidate.allowedRoles.includes(query.executive) &&
            // The role's sections are what separate the CTO from the CMO inside
            // one Trust Domain: same root, different task-scoped slice.
            view.sections.some((section) => candidate.path.startsWith(section)),
        );
      if (page === undefined) {
        // Indistinguishable from an unauthorized answer on purpose. A denial
        // that says "nothing here" still tells the caller what exists.
        return { kind: "denied", reason: "not-authorized" };
      }

      return {
        kind: "served",
        brief: {
          sourceIdentity: page.sourceIdentity,
          contentHash: page.contentHash,
          vaultPointer: `${page.root}:${page.path}`,
          text: boundedBriefText(page.text),
          citations: page.citations,
          asOf: page.asOf,
          generation: page.generation,
          freshness: page.freshness,
          contested: page.contested,
        },
      };
    },
  };
}
