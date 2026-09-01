import {
  createCipheriv,
  createDecipheriv,
  createHash,
  scryptSync,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  executiveRoles,
  trustDomains,
  type ExecutiveRole,
  type TrustDomain,
} from "../operations/contracts.js";
import { isCeoActor } from "../operations/actor-identity.js";

export type PersonalContextSensitivity = "general" | "private" | "sensitive";
export type PersonalContextAuthority =
  | "authoritative fact"
  | "personal plan"
  | "reflection"
  | "historical record";
export type PersonalContextMode = "snapshot" | "pointer";
export type PersonalContextFreshness = "current" | "stale";
export type PersonalContextSourceSystem = "local-file" | "notion";
export type PersonalContextCandidateState =
  | "verified-ingestion"
  | "quarantined";
export type PersonalContextPurgeState = "retained" | "purge-eligible" | "purged";

export interface PersonalContextManifestEntry {
  readonly manifestId: string;
  readonly title: string;
  readonly purpose: string;
  readonly trustDomain: TrustDomain;
  readonly sensitivity: PersonalContextSensitivity;
  readonly allowedRoles: readonly ExecutiveRole[];
  readonly authority: PersonalContextAuthority;
  readonly freshnessPolicy: string;
  readonly sourceSystem: PersonalContextSourceSystem;
  readonly sourceReference: string;
  readonly mode: PersonalContextMode;
  readonly retentionClass: string;
}

/**
 * A provider adapter or controlled source supplies content and provenance in
 * this neutral shape. The ingestion boundary never reaches into a provider
 * directly, so local files and allowlisted Notion pages use the same workflow.
 */
export interface PersonalContextSourceValue {
  readonly content: string;
  readonly asOf: string;
  readonly freshness: PersonalContextFreshness;
  readonly sourceVersion?: string;
}

export interface PersonalContextSourceReader {
  read(entry: PersonalContextManifestEntry): Promise<PersonalContextSourceValue>;
}

/**
 * A provider-specific reader used by the composition root. The ingestion
 * workflow remains identical for local files and Notion; only this adapter is
 * responsible for reading the selected Source of Record.
 */
export type PersonalContextSourceAdapter = (
  entry: PersonalContextManifestEntry,
) => Promise<PersonalContextSourceValue> | PersonalContextSourceValue;

/** Route a manifest entry to its source-system adapter. */
export function createPersonalContextSourceReader(options: {
  readonly localFile: PersonalContextSourceAdapter;
  readonly notion: PersonalContextSourceAdapter;
}): PersonalContextSourceReader {
  return {
    read: async (entry) =>
      entry.sourceSystem === "local-file"
        ? options.localFile(entry)
        : options.notion(entry),
  };
}

/**
 * Concrete local-file adapter for the production composition root. The file
 * remains the Source of Record; RM-17 captures an encrypted snapshot and
 * records the file mtime as its effective `as of` value.
 */
export function createLocalFilePersonalContextSourceAdapter(options: {
  readonly now?: () => string;
  readonly staleAfterDays?: number;
} = {}): PersonalContextSourceAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const staleAfterDays = options.staleAfterDays ?? 30;
  if (!Number.isFinite(staleAfterDays) || staleAfterDays <= 0) {
    throw new Error("Personal Context local-file staleAfterDays must be positive.");
  }
  return (entry) => {
    if (entry.sourceSystem !== "local-file") {
      throw new Error("The local-file adapter cannot read a Notion source.");
    }
    const stats = statSync(entry.sourceReference);
    const asOf = stats.mtime.toISOString();
    const age = Date.parse(now()) - stats.mtime.getTime();
    return {
      content: readFileSync(entry.sourceReference, "utf8"),
      asOf,
      freshness:
        age > staleAfterDays * 24 * 60 * 60 * 1000 ? "stale" : "current",
      sourceVersion: `${stats.size}:${stats.mtimeMs}`,
    };
  };
}

export interface PersonalContextAllowlistEntry {
  readonly manifestId: string;
  readonly sourceSystem: PersonalContextSourceSystem;
  readonly sourceReference: string;
  /** SHA-256 of the complete manifest policy approved by the CEO. */
  readonly manifestDigest: string;
  readonly approvedBy: string;
}

export interface PersonalContextCandidate {
  readonly id: string;
  readonly manifestId: string;
  readonly title: string;
  readonly purpose: string;
  readonly trustDomain: TrustDomain;
  readonly sensitivity: PersonalContextSensitivity;
  readonly allowedRoles: readonly ExecutiveRole[];
  readonly authority: PersonalContextAuthority;
  readonly freshnessPolicy: string;
  readonly sourceSystem: PersonalContextSourceSystem;
  readonly sourceReference: string;
  readonly sourceVersion: string | null;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly contentHash: string;
  readonly freshness: PersonalContextFreshness;
  readonly staleLabel: string | null;
  readonly retentionClass: string;
  readonly supersedesCandidateId: string | null;
  readonly mode: PersonalContextMode;
  /** Explains why a snapshot is not the Source of Record. */
  readonly provenanceLabel: string;
  readonly payloadPath: string | null;
  readonly state: PersonalContextCandidateState;
  readonly quarantineReasons: readonly string[];
  readonly purgeEligibleAt: string;
  readonly purgeState: PersonalContextPurgeState;
}

export type PersonalContextIngestionResult =
  | {
      readonly kind: "verified-ingestion";
      readonly candidate: PersonalContextCandidate;
    }
  | {
      readonly kind: "quarantined";
      readonly candidate: PersonalContextCandidate;
      readonly reasons: readonly string[];
    };

export interface PersonalContextRead {
  readonly candidate: PersonalContextCandidate;
  readonly content: string;
}

export interface PersonalContextIngestion {
  ingest(entry: PersonalContextManifestEntry): Promise<PersonalContextIngestionResult>;
  candidates(): readonly PersonalContextCandidate[];
  read(candidateId: string, executive: ExecutiveRole): PersonalContextRead;
  stagingFiles(): readonly string[];
  purgeExpired(at?: string): readonly string[];
  close(): void;
}

const staleLabel = "STALE — recheck source before treating as current";
const quarantineRetentionDays = 30;
const candidateRetentionDays = 30;
export const maxPersonalContextSnapshotChars = 64_000;

const sensitiveContentPatterns: readonly {
  readonly reason: string;
  readonly pattern: RegExp;
}[] = [
  {
    reason: "credential",
    pattern:
      /\b(?:password|passphrase|credential|api[- ]?key|access[- ]?token|secret|private[- ]?key)\b/i,
  },
  {
    reason: "recovery-data",
    pattern: /\b(?:recovery|backup)\s+(?:code|key|phrase)|seed\s+phrase\b/i,
  },
  {
    reason: "identity-document",
    pattern:
      /\b(?:passport|identity\s+(?:card|document)|national\s+id|driver(?:'s)?\s+licen[cs]e|ic\s*(?:number|no))\b/i,
  },
  {
    reason: "payment-card",
    pattern: /\b(?:credit|debit|payment)\s+card(?:\s+(?:number|details))?\b|\b(?:cvv|cvc)\b/i,
  },
  {
    reason: "token",
    pattern:
      /\bgh[pousr]_[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9-]{16,}\b|\bxox[abposr]-[A-Za-z0-9-]{10,}\b|\b\d{5,12}:[A-Za-z0-9_-]{20,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    reason: "payment-card",
    pattern: /\b(?:\d[ -]?){13,19}\b/,
  },
];

export function detectPersonalContextSensitiveContent(
  content: string,
): readonly string[] {
  return sensitiveContentPatterns
    .filter(({ pattern }) => pattern.test(content))
    .map(({ reason }) => reason)
    .filter((reason, index, reasons) => reasons.indexOf(reason) === index);
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalManifest(entry: PersonalContextManifestEntry): string {
  return JSON.stringify({
    manifestId: entry.manifestId,
    title: entry.title,
    purpose: entry.purpose,
    trustDomain: entry.trustDomain,
    sensitivity: entry.sensitivity,
    allowedRoles: [...entry.allowedRoles].sort(),
    authority: entry.authority,
    freshnessPolicy: entry.freshnessPolicy,
    sourceSystem: entry.sourceSystem,
    sourceReference: entry.sourceReference,
    mode: entry.mode,
    retentionClass: entry.retentionClass,
  });
}

/** Stable digest that binds CEO approval to every manifest policy field. */
export function personalContextManifestDigest(
  entry: PersonalContextManifestEntry,
): string {
  return hash(canonicalManifest(entry));
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`The Personal Context ${label} could not be read.`);
  }
}

interface CandidateRow {
  id: string;
  manifest_id: string;
  title: string;
  purpose: string;
  trust_domain: TrustDomain;
  sensitivity: PersonalContextSensitivity;
  allowed_roles_json: string;
  authority: PersonalContextAuthority;
  freshness_policy: string;
  source_system: PersonalContextSourceSystem;
  source_reference: string;
  source_version: string | null;
  captured_at: string;
  as_of: string;
  content_hash: string;
  freshness: PersonalContextFreshness;
  retention_class: string;
  supersedes_candidate_id: string | null;
  mode: PersonalContextMode;
  payload_path: string | null;
  state: PersonalContextCandidateState;
  quarantine_reasons_json: string;
  purge_eligible_at: string;
}

function assertManifest(entry: PersonalContextManifestEntry): void {
  const required: readonly [string, string][] = [
    ["manifestId", entry.manifestId],
    ["title", entry.title],
    ["purpose", entry.purpose],
    ["freshnessPolicy", entry.freshnessPolicy],
    ["sourceReference", entry.sourceReference],
    ["retentionClass", entry.retentionClass],
  ];
  for (const [field, value] of required) {
    if (value.trim().length === 0) {
      throw new Error(`Personal Context ${field} is required.`);
    }
  }
  if (entry.allowedRoles.length === 0) {
    throw new Error("Personal Context allowedRoles must not be empty.");
  }
  if (!trustDomains.includes(entry.trustDomain)) {
    throw new Error(`Unknown Personal Context Trust Domain ${entry.trustDomain}.`);
  }
  if (entry.allowedRoles.some((role) => !executiveRoles.includes(role))) {
    throw new Error("Personal Context allowedRoles contains an unknown role.");
  }
  if (!(entry.sensitivity === "general" || entry.sensitivity === "private" || entry.sensitivity === "sensitive")) {
    throw new Error(`Unknown Personal Context sensitivity ${entry.sensitivity}.`);
  }
  if (
    !(
      entry.authority === "authoritative fact" ||
      entry.authority === "personal plan" ||
      entry.authority === "reflection" ||
      entry.authority === "historical record"
    )
  ) {
    throw new Error(`Unknown Personal Context authority ${entry.authority}.`);
  }
  if (!(["local-file", "notion"] as const).includes(entry.sourceSystem)) {
    throw new Error(`Unknown Personal Context source ${entry.sourceSystem}.`);
  }
  if (!(entry.mode === "snapshot" || entry.mode === "pointer")) {
    throw new Error(`Unknown Personal Context mode ${entry.mode}.`);
  }
  if (entry.sensitivity === ("secret" as PersonalContextSensitivity)) {
    throw new Error("Personal Context secrets are never ingested.");
  }
  retentionDuration(entry.retentionClass);
}

interface RetentionDuration {
  readonly count: number;
  readonly unit: "days" | "weeks" | "months" | "years";
}

/**
 * Retention classes are policy names ending in a finite duration, for example
 * `personal-context-30d` or a stricter `finance-7d`. Parsing the duration here
 * prevents a new Trust-Domain policy from being silently ignored.
 */
function retentionDuration(retentionClass: string): RetentionDuration {
  const match = /^(?:[a-z0-9]+-)+(\d+)(d|w|m|y)$/i.exec(retentionClass);
  if (match === null) {
    throw new Error(
      "Personal Context retentionClass must end in a finite duration such as 30d, 4w, 12m, or 1y.",
    );
  }
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Personal Context retentionClass duration must be positive.");
  }
  const unitToken = match[2];
  if (unitToken === undefined) {
    throw new Error("Personal Context retentionClass duration is incomplete.");
  }
  const unit =
    unitToken.toLowerCase() === "d"
      ? "days"
      : unitToken.toLowerCase() === "w"
        ? "weeks"
        : unitToken.toLowerCase() === "m"
          ? "months"
          : "years";
  return { count, unit };
}

function addRetention(iso: string, retentionClass: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Personal Context timestamps must be valid ISO dates.");
  }
  const duration = retentionDuration(retentionClass);
  const date = new Date(timestamp);
  if (duration.unit === "days") {
    date.setUTCDate(date.getUTCDate() + duration.count);
  } else if (duration.unit === "weeks") {
    date.setUTCDate(date.getUTCDate() + duration.count * 7);
  } else if (duration.unit === "months") {
    date.setUTCMonth(date.getUTCMonth() + duration.count);
  } else {
    date.setUTCFullYear(date.getUTCFullYear() + duration.count);
  }
  if (date.getTime() - timestamp > 30 * 24 * 60 * 60 * 1000) {
    throw new Error(
      "Personal Context retentionClass exceeds the 30-day raw staging maximum.",
    );
  }
  return date.toISOString();
}

function mapCandidate(
  row: CandidateRow,
  purgeState: PersonalContextPurgeState,
): PersonalContextCandidate {
  const stale = row.freshness === "stale";
  return {
    id: row.id,
    manifestId: row.manifest_id,
    title: row.title,
    purpose: row.purpose,
    trustDomain: row.trust_domain,
    sensitivity: row.sensitivity,
    allowedRoles: parseJson<readonly ExecutiveRole[]>(
      row.allowed_roles_json,
      "allowed roles",
    ),
    authority: row.authority,
    freshnessPolicy: row.freshness_policy,
    sourceSystem: row.source_system,
    sourceReference: row.source_reference,
    sourceVersion: row.source_version,
    capturedAt: row.captured_at,
    asOf: row.as_of,
    contentHash: row.content_hash,
    freshness: row.freshness,
    staleLabel: stale ? staleLabel : null,
    retentionClass: row.retention_class,
    supersedesCandidateId: row.supersedes_candidate_id,
    mode: row.mode,
    provenanceLabel:
      row.mode === "snapshot"
        ? "SNAPSHOT — Source of Record remains authoritative"
        : "POINTER — Source of Record remains authoritative",
    payloadPath: row.payload_path,
    state: row.state,
    quarantineReasons: parseJson<readonly string[]>(
      row.quarantine_reasons_json,
      "quarantine reasons",
    ),
    purgeEligibleAt: row.purge_eligible_at,
    purgeState,
  };
}

export function createPersonalContextIngestion(options: {
  readonly statePath: string;
  readonly stagingDirectory: string;
  readonly repositoryRoot: string;
  readonly encryptionKey: string;
  readonly sourceReader: PersonalContextSourceReader;
  readonly allowlist: readonly PersonalContextAllowlistEntry[];
  readonly now?: () => string;
}): PersonalContextIngestion {
  if (!isAbsolute(options.stagingDirectory)) {
    throw new Error("Personal Context staging must use an absolute path.");
  }
  if (!isAbsolute(options.repositoryRoot)) {
    throw new Error("Personal Context repositoryRoot must use an absolute path.");
  }
  const stagingRelativeToRepository = relative(
    resolve(options.repositoryRoot),
    resolve(options.stagingDirectory),
  );
  if (
    stagingRelativeToRepository === "" ||
    (!stagingRelativeToRepository.startsWith("..") &&
      !stagingRelativeToRepository.includes(":"))
  ) {
    throw new Error("Personal Context staging must be outside the repository.");
  }
  if (options.encryptionKey.trim().length === 0) {
    throw new Error("Personal Context encryptionKey is required.");
  }

  const now = options.now ?? (() => new Date().toISOString());
  const database = new DatabaseSync(options.statePath);
  const stagingCandidatesDirectory = join(options.stagingDirectory, "candidates");
  const key = scryptSync(
    options.encryptionKey,
    "real-ming-personal-context",
    32,
  );

  database.exec(`
    CREATE TABLE IF NOT EXISTS personal_context_candidates (
      id TEXT PRIMARY KEY,
      manifest_id TEXT NOT NULL,
      title TEXT NOT NULL,
      purpose TEXT NOT NULL,
      trust_domain TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      allowed_roles_json TEXT NOT NULL,
      authority TEXT NOT NULL,
      freshness_policy TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      source_version TEXT,
      captured_at TEXT NOT NULL,
      as_of TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      freshness TEXT NOT NULL,
      retention_class TEXT NOT NULL,
      supersedes_candidate_id TEXT,
      mode TEXT NOT NULL,
      payload_path TEXT,
      state TEXT NOT NULL,
      quarantine_reasons_json TEXT NOT NULL,
      purge_eligible_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS personal_context_manifest_idx
      ON personal_context_candidates (manifest_id, source_system, source_reference);

    CREATE TABLE IF NOT EXISTS personal_context_purge_events (
      candidate_id TEXT PRIMARY KEY,
      purged_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS personal_context_purge_reject_update
    BEFORE UPDATE ON personal_context_purge_events
    BEGIN
      SELECT RAISE(ABORT, 'Personal Context purge evidence is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS personal_context_purge_reject_delete
    BEFORE DELETE ON personal_context_purge_events
    BEGIN
      SELECT RAISE(ABORT, 'Personal Context purge evidence is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS personal_context_reject_update
    BEFORE UPDATE ON personal_context_candidates
    BEGIN
      SELECT RAISE(ABORT, 'Personal Context Candidates are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS personal_context_reject_delete
    BEFORE DELETE ON personal_context_candidates
    BEGIN
      SELECT RAISE(ABORT, 'Personal Context Candidates are append-only');
    END;
  `);

  const encrypt = (content: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(content, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  };

  const decrypt = (sealed: string): string => {
    const [version, iv, tag, ciphertext] = sealed.split(".");
    if (
      version !== "v1" ||
      iv === undefined ||
      tag === undefined ||
      ciphertext === undefined
    ) {
      throw new Error("The Personal Context payload could not be decrypted.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  };

  const findRow = (id: string): CandidateRow | undefined =>
    database
      .prepare("SELECT * FROM personal_context_candidates WHERE id = ?")
      .get(id) as unknown as CandidateRow | undefined;

  const listRows = (): CandidateRow[] =>
    database
      .prepare(
        "SELECT * FROM personal_context_candidates ORDER BY rowid ASC",
      )
      .all() as unknown as CandidateRow[];

  const purgedCandidateIds = (): ReadonlySet<string> =>
    new Set(
      (
        database
          .prepare("SELECT candidate_id FROM personal_context_purge_events")
          .all() as unknown as { candidate_id: string }[]
      ).map((row) => row.candidate_id),
    );

  const mapStoredCandidate = (row: CandidateRow): PersonalContextCandidate => {
    const purged = purgedCandidateIds().has(row.id);
    return mapCandidate(
      row,
      purged
        ? "purged"
        : Date.parse(row.purge_eligible_at) <= Date.parse(now())
          ? "purge-eligible"
          : "retained",
    );
  };

  return {
    async ingest(entry): Promise<PersonalContextIngestionResult> {
      assertManifest(entry);
      const approved = options.allowlist.some(
        (candidate) =>
          candidate.manifestId === entry.manifestId &&
          candidate.sourceSystem === entry.sourceSystem &&
          candidate.sourceReference === entry.sourceReference &&
          candidate.manifestDigest === personalContextManifestDigest(entry) &&
          isCeoActor(candidate.approvedBy),
      );
      if (!approved) {
        throw new Error("Personal Context item is not CEO-allowlisted.");
      }
      const source = await options.sourceReader.read(entry);
      if (source.asOf.trim().length === 0) {
        throw new Error("Personal Context source asOf is required.");
      }
      if (!Number.isFinite(Date.parse(source.asOf))) {
        throw new Error("Personal Context source asOf must be a valid ISO date.");
      }
      if (
        !(source.freshness === "current" || source.freshness === "stale")
      ) {
        throw new Error("Personal Context source freshness is invalid.");
      }
      if (
        entry.mode === "snapshot" &&
        source.content.length > maxPersonalContextSnapshotChars
      ) {
        throw new Error("Personal Context snapshot exceeds the bounded size limit.");
      }
      const capturedAt = now();
      // The manifest identity includes policy and source identity; the source
      // content hash then makes unchanged re-ingestion idempotent and changed
      // content a new, append-only Candidate Envelope.
      const candidateId = `candidate:${hash(
        `${hash(canonicalManifest(entry))}:${hash(source.content)}:${source.asOf}:${source.freshness}:${source.sourceVersion ?? ""}`,
      ).slice("sha256:".length)}`;
      const existing = findRow(candidateId);
      if (existing !== undefined) {
        const candidate = mapStoredCandidate(existing);
        return candidate.state === "quarantined"
          ? { kind: "quarantined", candidate, reasons: candidate.quarantineReasons }
          : { kind: "verified-ingestion", candidate };
      }

      const contentHash = hash(source.content);
      const previous = database
        .prepare(
          `SELECT * FROM personal_context_candidates
           WHERE manifest_id = ? AND source_system = ? AND source_reference = ?
           ORDER BY rowid DESC LIMIT 1`,
        )
        .get(entry.manifestId, entry.sourceSystem, entry.sourceReference) as
        | CandidateRow
        | undefined;
      const reasons = detectPersonalContextSensitiveContent(source.content);
      const state: PersonalContextCandidateState =
        reasons.length > 0 ? "quarantined" : "verified-ingestion";
      const payloadPath =
        state === "verified-ingestion" && entry.mode === "snapshot"
          ? join(
              stagingCandidatesDirectory,
              `${candidateId.replaceAll(":", "-")}.enc`,
            )
          : null;
      const purgeEligibleAt = addRetention(capturedAt, entry.retentionClass);
      const candidate: PersonalContextCandidate = {
        id: candidateId,
        manifestId: entry.manifestId,
        title: entry.title,
        purpose: entry.purpose,
        trustDomain: entry.trustDomain,
        sensitivity: entry.sensitivity,
        allowedRoles: [...entry.allowedRoles],
        authority: entry.authority,
        freshnessPolicy: entry.freshnessPolicy,
        sourceSystem: entry.sourceSystem,
        sourceReference: entry.sourceReference,
        sourceVersion: source.sourceVersion ?? null,
        capturedAt,
        asOf: source.asOf,
        contentHash,
        freshness: source.freshness,
        staleLabel: source.freshness === "stale" ? staleLabel : null,
        retentionClass: entry.retentionClass,
        supersedesCandidateId: previous?.id ?? null,
        mode: entry.mode,
        provenanceLabel:
          entry.mode === "snapshot"
            ? "SNAPSHOT — Source of Record remains authoritative"
            : "POINTER — Source of Record remains authoritative",
        payloadPath,
        state,
        quarantineReasons: reasons,
        purgeEligibleAt,
        purgeState: "retained",
      };

      if (payloadPath !== null) {
        mkdirSync(stagingCandidatesDirectory, { recursive: true });
        writeFileSync(payloadPath, encrypt(source.content), {
          encoding: "utf8",
          mode: 0o600,
        });
      }

      try {
        database
          .prepare(
            `INSERT INTO personal_context_candidates (
              id, manifest_id, title, purpose, trust_domain, sensitivity,
              allowed_roles_json, authority, freshness_policy, source_system,
              source_reference, source_version, captured_at, as_of, content_hash,
              freshness, retention_class, supersedes_candidate_id, mode,
              payload_path, state, quarantine_reasons_json, purge_eligible_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            candidate.id,
            candidate.manifestId,
            candidate.title,
            candidate.purpose,
            candidate.trustDomain,
            candidate.sensitivity,
            JSON.stringify(candidate.allowedRoles),
            candidate.authority,
            candidate.freshnessPolicy,
            candidate.sourceSystem,
            candidate.sourceReference,
            candidate.sourceVersion,
            candidate.capturedAt,
            candidate.asOf,
            candidate.contentHash,
            candidate.freshness,
            candidate.retentionClass,
            candidate.supersedesCandidateId,
            candidate.mode,
            candidate.payloadPath,
            candidate.state,
            JSON.stringify(candidate.quarantineReasons),
            candidate.purgeEligibleAt,
          );
      } catch (error) {
        if (payloadPath !== null && existsSync(payloadPath)) unlinkSync(payloadPath);
        throw error;
      }

      return state === "quarantined"
        ? { kind: "quarantined", candidate, reasons }
        : { kind: "verified-ingestion", candidate };
    },

    candidates(): readonly PersonalContextCandidate[] {
      return listRows().map(mapStoredCandidate);
    },

    read(candidateId, executive): PersonalContextRead {
      const row = findRow(candidateId);
      if (row === undefined) {
        throw new Error(`Personal Context Candidate ${candidateId} was not found.`);
      }
      const candidate = mapStoredCandidate(row);
      if (!candidate.allowedRoles.includes(executive)) {
        throw new Error(
          `The ${executive} is not allowed to read this Personal Context item.`,
        );
      }
      if (candidate.state === "quarantined") {
        throw new Error("Quarantined Personal Context is not readable.");
      }
      if (candidate.mode === "pointer") {
        throw new Error(
          "This Candidate Envelope is a pointer; read the Source of Record through its adapter.",
        );
      }
      if (candidate.payloadPath === null) {
        throw new Error("This Personal Context Candidate has no payload.");
      }
      if (candidate.purgeState === "purged") {
        throw new Error("The Personal Context payload has been purged.");
      }
      return {
        candidate,
        content: decrypt(readFileSync(candidate.payloadPath, "utf8")),
      };
    },

    stagingFiles(): readonly string[] {
      if (!existsSync(stagingCandidatesDirectory)) return [];
      return readdirSync(stagingCandidatesDirectory)
        .filter((name) => name.endsWith(".enc"))
        .map((name) => join(stagingCandidatesDirectory, name))
        .sort();
    },

    purgeExpired(at = now()): readonly string[] {
      const timestamp = Date.parse(at);
      if (!Number.isFinite(timestamp)) {
        throw new Error("Personal Context purge time must be a valid ISO date.");
      }
      const purged: string[] = [];
      const rows = listRows();
      const referencedPayloads = new Set(
        rows.flatMap((row) => (row.payload_path === null ? [] : [row.payload_path])),
      );
      for (const row of rows) {
        if (
          row.payload_path === null ||
          Date.parse(row.purge_eligible_at) > timestamp ||
          database
            .prepare(
              "SELECT 1 FROM personal_context_purge_events WHERE candidate_id = ?",
            )
            .get(row.id) !== undefined
        ) {
          continue;
        }
        if (existsSync(row.payload_path)) unlinkSync(row.payload_path);
        database
          .prepare(
            "INSERT INTO personal_context_purge_events (candidate_id, purged_at) VALUES (?, ?)",
          )
          .run(row.id, at);
        purged.push(row.id);
      }
      if (existsSync(stagingCandidatesDirectory)) {
        for (const name of readdirSync(stagingCandidatesDirectory)) {
          if (!name.endsWith(".enc")) continue;
          const payloadPath = join(stagingCandidatesDirectory, name);
          if (referencedPayloads.has(payloadPath) || !existsSync(payloadPath)) {
            continue;
          }
          const modifiedAt = statSync(payloadPath).mtimeMs;
          if (modifiedAt + candidateRetentionDays * 24 * 60 * 60 * 1000 > timestamp) {
            continue;
          }
          unlinkSync(payloadPath);
          const orphanId = `orphan:${hash(payloadPath).slice("sha256:".length)}`;
          if (
            database
              .prepare("SELECT 1 FROM personal_context_purge_events WHERE candidate_id = ?")
              .get(orphanId) === undefined
          ) {
            database
              .prepare(
                "INSERT INTO personal_context_purge_events (candidate_id, purged_at) VALUES (?, ?)",
              )
              .run(orphanId, at);
          }
        }
      }
      return purged;
    },

    close(): void {
      database.close();
    },
  };
}

export const personalContextRetentionDays = {
  candidate: candidateRetentionDays,
  quarantine: quarantineRetentionDays,
} as const;
