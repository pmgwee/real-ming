import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import type { CandidateEnvelope } from "../evidence/evidence-broker.js";
import type {
  KnowledgeVault,
  VaultGeneration,
  VaultRoot,
} from "./knowledge-vault.js";

export type KnowledgeCompilationResult =
  | {
      readonly kind: "compiled";
      readonly generation: VaultGeneration;
      readonly pagePath: string;
    }
  | { readonly kind: "unchanged"; readonly pagePath: string }
  | {
      readonly kind: "quarantined";
      readonly reason: "contradicts-published-page";
      readonly quarantinePath: string;
    }
  | {
      readonly kind: "rejected";
      readonly reason: "sensitive-secret" | "uncited";
    };

export interface KnowledgeCompiler {
  compile(candidate: CandidateEnvelope): KnowledgeCompilationResult;
}

function pageNameFor(candidate: CandidateEnvelope): string {
  const base = candidate.sourceReference.split("/").at(-1) ?? candidate.id;
  return base.replace(/\.md$/u, "");
}

function trustDomainRoot(candidate: CandidateEnvelope): VaultRoot {
  return candidate.trustDomain;
}

/**
 * A compiled page is a citation of its source, never a copy that stands alone.
 * The hash and the canonical evidence id travel with it so a reader can always
 * get back to what it was compiled from.
 */
function renderPage(candidate: CandidateEnvelope, name: string): string {
  return [
    `# ${name}`,
    "",
    candidate.freshness === "stale"
      ? `> STALE as of ${candidate.asOf}. Compiled from a candidate the broker labelled stale.`
      : `> Compiled from evidence as of ${candidate.asOf}.`,
    "",
    candidate.content,
    "",
    "## Provenance",
    "",
    `- Source: [[${name}]] (${candidate.sourceReference})`,
    `- Canonical evidence: ${candidate.canonicalEvidenceId}`,
    `- Content hash: ${candidate.contentHash}`,
    `- Captured: ${candidate.capturedAt}`,
    ...candidate.citations.map((citation) => `- Citation: ${citation}`),
    "",
  ].join("\n");
}

function renderIndex(pages: readonly string[]): string {
  return [
    "# Personal index",
    "",
    ...pages.map((name) => `- [[${name}]]`),
    "",
  ].join("\n");
}

export function createKnowledgeCompiler(options: {
  readonly vault: KnowledgeVault;
  readonly actorId: string;
  readonly now: () => string;
}): KnowledgeCompiler {
  // Mirrors what has been published, so a compile can compare against the
  // current page without decrypting the vault for every candidate.
  const publishedPages = new Map<string, Map<string, string>>();
  const publishedHashes = new Map<string, string>();
  const logLines = new Map<string, string[]>();

  return {
    compile(candidate): KnowledgeCompilationResult {
      const root = trustDomainRoot(candidate);
      const name = pageNameFor(candidate);
      const pagePath = `wiki/${name}.md`;

      // Checked before anything is written. A rejected candidate must not leave
      // a partial generation behind for someone to find later.
      if (
        detectSensitiveFields({ content: candidate.content }).length > 0 ||
        candidate.citations.length === 0
      ) {
        return {
          kind: "rejected",
          reason:
            candidate.citations.length === 0 ? "uncited" : "sensitive-secret",
        };
      }

      const pages = publishedPages.get(root) ?? new Map<string, string>();
      const priorHash = publishedHashes.get(`${root}:${pagePath}`);
      if (priorHash === candidate.contentHash) {
        return { kind: "unchanged", pagePath };
      }

      const existing = pages.get(pagePath);
      if (existing !== undefined) {
        // A candidate that neither repeats nor extends the published page is a
        // contradiction. Merging it would silently pick a winner, so it goes to
        // quarantine where the disagreement stays visible.
        const extendsExisting = candidate.content.startsWith(
          existing
            .split("\n\n")[2]
            ?.trim()
            .slice(0, 40) ?? candidate.content,
        );
        if (!extendsExisting) {
          const quarantinePath = `quarantine/${name}.md`;
          const next = new Map(pages);
          next.set(
            quarantinePath,
            [
              `# ${name} (quarantined)`,
              "",
              `> Contradicts the published page. Not merged; only Ming can resolve it.`,
              "",
              candidate.content,
              "",
              `- Content hash: ${candidate.contentHash}`,
              `- Canonical evidence: ${candidate.canonicalEvidenceId}`,
              "",
            ].join("\n"),
          );
          publishedPages.set(root, next);
          this.publishFiles(root, next, candidate, "quarantine");
          return {
            kind: "quarantined",
            reason: "contradicts-published-page",
            quarantinePath,
          };
        }
      }

      const next = new Map(pages);
      next.set(pagePath, renderPage(candidate, name));
      const wikiPages = [...next.keys()]
        .filter((path) => path.startsWith("wiki/"))
        .map((path) => path.slice("wiki/".length).replace(/\.md$/u, ""))
        .sort();
      next.set("index.md", renderIndex(wikiPages));

      const generation = this.publishFiles(root, next, candidate, "compiled");
      publishedPages.set(root, next);
      publishedHashes.set(`${root}:${pagePath}`, candidate.contentHash);
      return { kind: "compiled", generation, pagePath };
    },

    /**
     * One atomic generation per compile. The log is regenerated as part of the
     * same publish so a reader never sees a page without its log entry.
     */
    publishFiles(
      root: VaultRoot,
      files: Map<string, string>,
      candidate: CandidateEnvelope,
      outcome: "compiled" | "quarantine",
    ): VaultGeneration {
      const lines = logLines.get(root) ?? [];
      const sequence = lines.length + 1;
      lines.push(
        `- generation ${sequence} (${outcome}) ${options.now()} ${candidate.canonicalEvidenceId} ${candidate.contentHash}`,
      );
      logLines.set(root, lines);
      const withLog = new Map(files);
      withLog.set("log.md", ["# Personal log", "", ...lines, ""].join("\n"));
      files.set("log.md", withLog.get("log.md") ?? "");
      return options.vault.publishGeneration({
        root,
        actorId: options.actorId,
        files: Object.fromEntries(withLog),
      });
    },
  } as KnowledgeCompiler & {
    publishFiles(
      root: VaultRoot,
      files: Map<string, string>,
      candidate: CandidateEnvelope,
      outcome: "compiled" | "quarantine",
    ): VaultGeneration;
  };
}
