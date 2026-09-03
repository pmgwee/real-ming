import { createHash } from "node:crypto";
import { posix as posixPath } from "node:path";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import type { CandidateEnvelope } from "../evidence/evidence-broker.js";
import type { TrustDomain } from "../operations/contracts.js";
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
      readonly reason: "sensitive-secret" | "uncited" | "invalid-provenance";
    };

export interface KnowledgeOperationalOutput {
  readonly idempotencyKey: string;
  readonly root: VaultRoot;
  readonly path: string;
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly canonicalEvidenceId: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly contentHash: string;
  readonly content: string;
  readonly citations: readonly string[];
  readonly recordKind: "daily-note" | "filed-output";
}

export type KnowledgeOperationalOutputResult =
  | { readonly kind: "filed"; readonly generation: VaultGeneration; readonly path: string }
  | { readonly kind: "unchanged"; readonly path: string }
  | { readonly kind: "rejected"; readonly reason: "sensitive-secret" | "uncited" | "unsafe-path" | "invalid-provenance" };

export interface KnowledgeOperationalRecord {
  readonly idempotencyKey: string;
  readonly root: VaultRoot;
  readonly path: string;
  readonly state: "candidate";
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly canonicalEvidenceId: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly contentHash: string;
  readonly citations: readonly string[];
  readonly recordKind: KnowledgeOperationalOutput["recordKind"];
}

export interface KnowledgeCompiler {
  compile(candidate: CandidateEnvelope): KnowledgeCompilationResult;
  fileOperationalOutput(output: KnowledgeOperationalOutput): KnowledgeOperationalOutputResult;
  operationalOutputs(): readonly KnowledgeOperationalRecord[];
  /**
   * What has actually been published, in the shape a projection can serve. It
   * lives here rather than in the caller so a served brief cannot describe a
   * page the compiler never wrote, or claim a page is uncontested while its
   * contradiction sits in quarantine beside it.
   */
  pages(): readonly CompiledKnowledgePage[];
}

interface PublicationRecord {
  readonly canonicalEvidenceId: string;
  readonly contentHash: string;
}

function pageNameFor(candidate: CandidateEnvelope): string {
  const base = candidate.sourceReference.split("/").at(-1) ?? candidate.id;
  return base.replace(/\.md$/u, "");
}

function trustDomainRoot(candidate: CandidateEnvelope): VaultRoot {
  return candidate.trustDomain;
}

const sourceIdentityRegistry: Readonly<Record<string, TrustDomain>> = {
  "agent-brain:personal": "Personal",
  "agent-brain:ming-creatives": "Ming Creatives",
  "agent-brain:ming-creatives-content": "Ming Creatives",
  "agent-brain:duitsini": "Ming Creatives",
  "agent-brain:dashboard": "Ming Creatives",
  "agent-brain:portfolio": "Ming Creatives",
  "agent-brain:real-ming": "Ming Creatives",
  "agent-brain:academic": "Academic",
  "agent-brain:entertainment": "Entertainment",
  "agent-brain:finance": "Finance",
};

/** Canonical Agent Brain identity-to-domain binding used by every ingest path. */
export function sourceIdentityTrustDomain(sourceIdentity: string): TrustDomain | undefined {
  const normalized = sourceIdentity.trim().toLowerCase();
  const exact = sourceIdentityRegistry[normalized];
  if (exact !== undefined) return exact;
  // A registered Ming Creatives namespace may contain project-specific leaves,
  // while reserved domain names never match by loose substring.
  if (normalized.startsWith("agent-brain:ming-creatives:")) return "Ming Creatives";
  return undefined;
}

function sourceMatchesRoot(sourceIdentity: string, root: VaultRoot): boolean {
  return sourceIdentityTrustDomain(sourceIdentity) === root;
}

function contentHashMatches(content: string, contentHash: string): boolean {
  return contentHash === `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
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
  const quarantineFingerprints = new Map<string, Set<string>>();
  const logLines = new Map<string, string[]>();
  const pageRecords = new Map<string, CompiledKnowledgePage>();
  const operationalRecords = new Map<string, KnowledgeOperationalRecord>();
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
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith("quarantine/")) continue;
      const contentHash = /- Content hash: (sha256:[^\s]+)\s*$/mu.exec(text)?.[1];
      const canonicalEvidenceId = /- Canonical evidence: ([^\n]+)$/mu.exec(text)?.[1]?.trim();
      if (contentHash !== undefined && canonicalEvidenceId !== undefined) {
        const key = `${root}:${path}`;
        const fingerprints = quarantineFingerprints.get(key) ?? new Set<string>();
        fingerprints.add(`${canonicalEvidenceId}:${contentHash}`);
        quarantineFingerprints.set(key, fingerprints);
      }
    }
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
    const rawOperational = files["operational-index.json"];
    if (rawOperational !== undefined) {
      try {
        const parsed = JSON.parse(rawOperational) as { records?: unknown };
        if (Array.isArray(parsed.records)) {
          for (const value of parsed.records) {
            if (typeof value !== "object" || value === null) continue;
            const record = value as Partial<KnowledgeOperationalRecord>;
            if (
              record.root === root &&
              typeof record.idempotencyKey === "string" &&
              typeof record.path === "string" &&
              record.state === "candidate" &&
              typeof record.sourceIdentity === "string" &&
              typeof record.sourceReference === "string" &&
              typeof record.canonicalEvidenceId === "string" &&
              typeof record.capturedAt === "string" &&
              typeof record.asOf === "string" &&
              typeof record.contentHash === "string" &&
              Array.isArray(record.citations) &&
              (record.recordKind === "daily-note" || record.recordKind === "filed-output")
            ) {
              operationalRecords.set(`${root}:${record.idempotencyKey}`, {
                idempotencyKey: record.idempotencyKey,
                root,
                path: record.path,
                state: "candidate",
                sourceIdentity: record.sourceIdentity,
                sourceReference: record.sourceReference,
                canonicalEvidenceId: record.canonicalEvidenceId,
                capturedAt: record.capturedAt,
                asOf: record.asOf,
                contentHash: record.contentHash,
                citations: [...record.citations] as string[],
                recordKind: record.recordKind,
              });
            }
          }
        }
      } catch {
        // A malformed optional index cannot manufacture a served page.
      }
    }
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
        detectSensitiveFields({
          content: candidate.content,
          sourceIdentity: candidate.sourceIdentity,
          sourceReference: candidate.sourceReference,
          canonicalEvidenceId: candidate.canonicalEvidenceId,
          citations: candidate.citations.join(" "),
        }).length > 0 ||
        candidate.citations.length === 0
      ) {
        return {
          kind: "rejected",
          reason:
            candidate.citations.length === 0 ? "uncited" : "sensitive-secret",
        };
      }
      if (!contentHashMatches(candidate.content, candidate.contentHash)) {
        return { kind: "rejected", reason: "invalid-provenance" };
      }
      if (!sourceMatchesRoot(candidate.sourceIdentity, root)) {
        return { kind: "rejected", reason: "invalid-provenance" };
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
          const fingerprint = `${candidate.canonicalEvidenceId}:${candidate.contentHash}`;
          const fingerprintSuffix = createHash("sha256")
            .update(fingerprint, "utf8")
            .digest("hex")
            .slice(0, 16);
          const quarantinePath = `quarantine/${name}-${fingerprintSuffix}.md`;
          const quarantineKey = `${root}:${quarantinePath}`;
          if (quarantineFingerprints.get(quarantineKey)?.has(fingerprint) === true) {
            return { kind: "unchanged", pagePath: quarantinePath };
          }
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
          const fingerprints = quarantineFingerprints.get(quarantineKey) ?? new Set<string>();
          fingerprints.add(fingerprint);
          quarantineFingerprints.set(quarantineKey, fingerprints);
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

    operationalOutputs(): readonly KnowledgeOperationalRecord[] {
      for (const root of vaultRoots) ensureLoaded(root);
      return [...operationalRecords.values()];
    },

    fileOperationalOutput(output): KnowledgeOperationalOutputResult {
      if (
        detectSensitiveFields({
          content: output.content,
          path: output.path,
          sourceIdentity: output.sourceIdentity,
          sourceReference: output.sourceReference,
          canonicalEvidenceId: output.canonicalEvidenceId,
          citations: output.citations.join(" "),
          idempotencyKey: output.idempotencyKey,
        }).length > 0 ||
        output.citations.length === 0 ||
        output.sourceIdentity.trim().length === 0 ||
        output.sourceReference.trim().length === 0 ||
        output.canonicalEvidenceId.trim().length === 0 ||
        output.contentHash.trim().length === 0 ||
        !contentHashMatches(output.content, output.contentHash) ||
        !Number.isFinite(Date.parse(output.capturedAt)) ||
        !Number.isFinite(Date.parse(output.asOf)) ||
        !output.citations.some(
          (citation) =>
            citation.includes(output.canonicalEvidenceId) ||
            citation.includes(output.sourceReference) ||
            citation.startsWith("agent-brain://"),
        )
      ) {
        return {
          kind: "rejected",
          reason: output.citations.length === 0 ? "uncited" : "invalid-provenance",
        };
      }
      const normalizedPath = posixPath.normalize(output.path);
      if (
        output.root === "CEO" ||
        normalizedPath !== output.path ||
        !normalizedPath.startsWith("daily/") &&
        !normalizedPath.startsWith("outputs/")
      ) {
        return { kind: "rejected", reason: "unsafe-path" };
      }
      if (!sourceMatchesRoot(output.sourceIdentity, output.root)) {
        return { kind: "rejected", reason: "invalid-provenance" };
      }
      const outputSegment = output.sourceIdentity.replace(/^agent-brain:/u, "");
      const outputPrefix = `agent-brain://${outputSegment}/`;
      if (
        !output.sourceReference.startsWith(outputPrefix) ||
        !output.citations.some(
          (citation) => citation.startsWith(outputPrefix) || citation.includes(output.canonicalEvidenceId),
        )
      ) {
        return { kind: "rejected", reason: "invalid-provenance" };
      }
      ensureLoaded(output.root);
      const priorRecord = operationalRecords.get(`${output.root}:${output.idempotencyKey}`);
      if (priorRecord !== undefined) {
        // An idempotency key names one logical occurrence. A redelivered or
        // mutated payload cannot create a second generation under that key.
        return { kind: "unchanged", path: priorRecord.path };
      }
      const files = publishedPages.get(output.root) ?? new Map<string, string>();
      const prior = files.get(output.path);
      if (prior?.includes(`- Content hash: ${output.contentHash}`) === true) {
        return { kind: "unchanged", path: output.path };
      }
      const rendered = [
        `# ${output.recordKind === "daily-note" ? "Daily note" : "Filed output"}`,
        "",
        "> Operational record — pending normal validation; not a stable fact.",
        "",
        output.content,
        "",
        "## Provenance",
        "",
        `- Source identity: ${output.sourceIdentity}`,
        `- Source: ${output.sourceReference}`,
        `- Canonical evidence: ${output.canonicalEvidenceId}`,
        `- Content hash: ${output.contentHash}`,
        `- Captured: ${output.capturedAt}`,
        `- As of: ${output.asOf}`,
        ...output.citations.map((citation) => `- Citation: ${citation}`),
        `- Idempotency key: ${output.idempotencyKey}`,
        "",
      ].join("\n");
      const next = new Map(files);
      next.set(output.path, rendered);
      const record: KnowledgeOperationalRecord = {
        idempotencyKey: output.idempotencyKey,
        root: output.root,
        path: output.path,
        state: "candidate",
        sourceIdentity: output.sourceIdentity,
        sourceReference: output.sourceReference,
        canonicalEvidenceId: output.canonicalEvidenceId,
        capturedAt: output.capturedAt,
        asOf: output.asOf,
        contentHash: output.contentHash,
        citations: [...output.citations],
        recordKind: output.recordKind,
      };
      const existingRecords = [...operationalRecords.values()].filter((entry) => entry.root === output.root && entry.idempotencyKey !== output.idempotencyKey);
      next.set("operational-index.json", `${JSON.stringify({ version: 1, records: [...existingRecords, record] }, null, 2)}\n`);
      const generation = this.publishFiles(
        output.root,
        next,
        output,
        "operational",
      );
      publishedPages.set(output.root, next);
      operationalRecords.set(`${output.root}:${output.idempotencyKey}`, record);
      for (const [key, page] of pageRecords) {
        if (page.root === output.root) {
          pageRecords.set(key, { ...page, generation: generation.sequence });
        }
      }
      return { kind: "filed", generation, path: output.path };
    },

    /**
     * One atomic generation per compile. The log is regenerated as part of the
     * same publish so a reader never sees a page without its log entry.
     */
    publishFiles(
      root: VaultRoot,
      files: Map<string, string>,
      candidate: PublicationRecord,
      outcome: "compiled" | "quarantine" | "operational",
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
      candidate: PublicationRecord,
      outcome: "compiled" | "quarantine" | "operational",
    ): VaultGeneration;
  };
}
