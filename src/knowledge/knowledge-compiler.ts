import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import type { CandidateEnvelope } from "../evidence/evidence-broker.js";
import type { CompiledKnowledgePage } from "./hermes-projection.js";
import type {
  KnowledgeVault,
  VaultGeneration,
  VaultRoot,
} from "./knowledge-vault.js";
import { vaultRoots } from "./knowledge-vault.js";

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
  /**
   * What has actually been published, in the shape a projection can serve. It
   * lives here rather than in the caller so a served brief cannot describe a
   * page the compiler never wrote, or claim a page is uncontested while its
   * contradiction sits in quarantine beside it.
   */
  pages(): readonly CompiledKnowledgePage[];
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
  const projectionIndexPath = "projection-index.json";
  const publishedPages = new Map<string, Map<string, string>>();
  const publishedHashes = new Map<string, string>();
  const logLines = new Map<string, string[]>();
  const pageRecords = new Map<string, CompiledKnowledgePage>();
  const loadedRoots = new Set<VaultRoot>();

  type PersistedPageRecord = Omit<CompiledKnowledgePage, "text">;

  const readProjectionIndex = (
    root: VaultRoot,
    raw: string | undefined,
    files: Readonly<Record<string, string>>,
  ): void => {
    if (raw === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("pages" in parsed) ||
      !Array.isArray(parsed.pages)
    ) {
      return;
    }
    for (const value of parsed.pages) {
      if (typeof value !== "object" || value === null) continue;
      const record = value as Partial<PersistedPageRecord>;
      if (
        record.root !== root ||
        typeof record.path !== "string" ||
        !record.path.startsWith("wiki/") ||
        typeof record.sourceIdentity !== "string" ||
        record.sourceIdentity.trim().length === 0 ||
        !Array.isArray(record.allowedRoles) ||
        record.allowedRoles.some((role) => typeof role !== "string") ||
        typeof record.contentHash !== "string" ||
        record.contentHash.trim().length === 0 ||
        !Array.isArray(record.citations) ||
        record.citations.some((citation) => typeof citation !== "string") ||
        typeof record.asOf !== "string" ||
        typeof record.generation !== "number" ||
        !Number.isSafeInteger(record.generation) ||
        (record.freshness !== "current" && record.freshness !== "stale") ||
        typeof record.contested !== "boolean"
      ) {
        continue;
      }
      const text = files[record.path];
      if (text === undefined) continue;
      const generation = record.generation;
      const page: CompiledKnowledgePage = {
        root,
        path: record.path,
        sourceIdentity: record.sourceIdentity,
        allowedRoles: [...record.allowedRoles] as CompiledKnowledgePage["allowedRoles"],
        contentHash: record.contentHash,
        text,
        citations: [...record.citations],
        asOf: record.asOf,
        generation,
        freshness: record.freshness,
        contested: record.contested,
      };
      pageRecords.set(`${root}:${page.path}`, page);
      publishedHashes.set(`${root}:${page.path}`, page.contentHash);
    }
  };

  const ensureLoaded = (root: VaultRoot): void => {
    if (loadedRoots.has(root)) return;
    loadedRoots.add(root);
    const files = options.vault.readCurrentFiles(root, options.actorId);
    publishedPages.set(root, new Map(Object.entries(files)));
    const persistedLog = files["log.md"]
      ?.split(/\r?\n/u)
      .filter((line) => line.startsWith("- generation "));
    const log =
      persistedLog === undefined
        ? options.vault.log(root).map(
            (entry) =>
              `- generation ${entry.sequence} (published) ${entry.occurredAt} ${entry.actorId} ${entry.contentHash}`,
          )
        : persistedLog;
    logLines.set(root, [...log]);
    readProjectionIndex(root, files[projectionIndexPath], files);
  };

  const recordsForGeneration = (
    root: VaultRoot,
    generation: number,
    replacement?: CompiledKnowledgePage,
    contestedPath?: string,
  ): CompiledKnowledgePage[] => {
    const records = [...pageRecords.values()]
      .filter((page) => page.root === root && page.path !== replacement?.path)
      .map((page) => ({
        ...page,
        generation,
        ...(contestedPath === page.path ? { contested: true } : {}),
      }));
    if (replacement !== undefined) records.push(replacement);
    return records.sort((left, right) => left.path.localeCompare(right.path));
  };

  const serializeProjectionIndex = (
    records: readonly CompiledKnowledgePage[],
  ): string =>
    `${JSON.stringify(
      {
        version: 1,
        pages: records.map(({ text: _text, ...metadata }) => metadata),
      },
      null,
      2,
    )}\n`;

  const applyPageRecords = (
    root: VaultRoot,
    records: readonly CompiledKnowledgePage[],
  ): void => {
    for (const [key, page] of pageRecords) {
      if (page.root === root) pageRecords.delete(key);
    }
    for (const page of records) {
      pageRecords.set(`${root}:${page.path}`, page);
      publishedHashes.set(`${root}:${page.path}`, page.contentHash);
    }
  };

  return {
    compile(candidate): KnowledgeCompilationResult {
      const root = trustDomainRoot(candidate);
      const name = pageNameFor(candidate);
      // A source already under wiki/ keeps its section, because the section is
      // what separates one role's task-scoped slice from another's inside the
      // same Trust Domain.
      const pagePath = candidate.sourceReference.startsWith("wiki/")
        ? candidate.sourceReference
        : `wiki/${name}.md`;

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

      ensureLoaded(root);
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
          const generationNumber = (logLines.get(root)?.length ?? 0) + 1;
          const records = recordsForGeneration(
            root,
            generationNumber,
            undefined,
            pageRecords.has(`${root}:${pagePath}`) ? pagePath : undefined,
          );
          next.set(projectionIndexPath, serializeProjectionIndex(records));
          const generation = this.publishFiles(root, next, candidate, "quarantine");
          publishedPages.set(root, next);
          applyPageRecords(root, records.map((page) => ({
            ...page,
            generation: generation.sequence,
          })));
          return {
            kind: "quarantined",
            reason: "contradicts-published-page",
            quarantinePath,
          };
        }
      }

      const next = new Map(pages);
      const renderedPage = renderPage(candidate, name);
      next.set(pagePath, renderedPage);
      const wikiPages = [...next.keys()]
        .filter((path) => path.startsWith("wiki/"))
        .map((path) => (path.split("/").at(-1) ?? path).replace(/\.md$/u, ""))
        .sort();
      next.set("index.md", renderIndex(wikiPages));

      const generationNumber = (logLines.get(root)?.length ?? 0) + 1;
      const replacement: CompiledKnowledgePage = {
        root,
        path: pagePath,
        sourceIdentity: candidate.sourceIdentity,
        allowedRoles: [...candidate.allowedRoles],
        contentHash: candidate.contentHash,
        text: renderedPage,
        citations: [...candidate.citations],
        asOf: candidate.asOf,
        generation: generationNumber,
        freshness: candidate.freshness,
        // A fresh compile of a page supersedes whatever dispute preceded it:
        // the newer evidence is what the reader is now being shown.
        contested: false,
      };
      const records = recordsForGeneration(root, generationNumber, replacement);
      next.set(projectionIndexPath, serializeProjectionIndex(records));
      const generation = this.publishFiles(root, next, candidate, "compiled");
      publishedPages.set(root, next);
      applyPageRecords(root, records.map((page) => ({
        ...page,
        generation: generation.sequence,
      })));
      return { kind: "compiled", generation, pagePath };
    },

    pages(): readonly CompiledKnowledgePage[] {
      for (const root of vaultRoots) ensureLoaded(root);
      return [...pageRecords.values()];
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
