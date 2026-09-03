import type { TrustDomain } from "./contracts.js";

/**
 * Retention classes which may be purged by the v1 retention job.  The payload
 * is intentionally absent from both the candidate and the evidence shape:
 * retention proves deletion without making the purge ledger another memory
 * store.
 */
export type RetentionPurgeKind =
  | "raw-candidate"
  | "personal-context-payload"
  | "compiled-generation"
  | "context-vault-backup"
  | "knowledge-vault-backup";

export const retentionPurgeKinds: readonly RetentionPurgeKind[] = [
  "raw-candidate",
  "personal-context-payload",
  "compiled-generation",
  "context-vault-backup",
  "knowledge-vault-backup",
];

export interface RetentionPurgeCandidate {
  readonly kind: RetentionPurgeKind;
  readonly recordId: string;
  readonly trustDomain: TrustDomain;
  readonly contentHash: string | null;
  readonly eligibleAt: string;
  readonly policy: string;
}

export interface RetentionPurgeEvidence extends RetentionPurgeCandidate {
  /** Stable key makes a repeated sweep a no-op. */
  readonly idempotencyKey: string;
  readonly purgedAt: string;
}

/** A backup adapter must prove deletion before the control plane records it. */
export interface RetentionBackupPurgeResult {
  readonly candidate: RetentionPurgeCandidate;
  readonly deleted: boolean;
  readonly verified: boolean;
}

/** Payload-free metadata retained after a Candidate Envelope leaves staging. */
export interface KnowledgeCandidateRetentionRecord {
  readonly candidateId: string;
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly canonicalEvidenceId: string;
  readonly trustDomain: TrustDomain;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly contentHash: string;
  readonly retentionClass: string;
}

/** The v1 policy in one place; a domain may supply a stricter raw policy. */
export const retentionPolicy = {
  personalContextPayloadDays: 30,
  personalSupersededProjectionMonths: 12,
  defaultCompiledGenerationDays: 30,
} as const;

/**
 * Compiled generations are retained per Trust Domain, not by an implicit
 * global default.  The v1 policy keeps the Personal projection for a year
 * and the other domain projections for thirty days; each entry is explicit so
 * a later domain-specific policy change cannot silently broaden another root.
 */
export const compiledGenerationRetentionByDomain: Readonly<
  Record<TrustDomain, { readonly days?: number; readonly months?: number }>
> = {
  Personal: { months: retentionPolicy.personalSupersededProjectionMonths },
  "Ming Creatives": { days: retentionPolicy.defaultCompiledGenerationDays },
  Academic: { days: retentionPolicy.defaultCompiledGenerationDays },
  Entertainment: { days: retentionPolicy.defaultCompiledGenerationDays },
  Finance: { days: retentionPolicy.defaultCompiledGenerationDays },
};

function parseIso(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO date.`);
  return parsed;
}

export function addRetentionDuration(
  capturedAt: string,
  duration: { readonly days?: number; readonly months?: number },
): string {
  const date = new Date(parseIso(capturedAt, "Retention timestamp"));
  if (duration.days !== undefined) date.setUTCDate(date.getUTCDate() + duration.days);
  if (duration.months !== undefined) date.setUTCMonth(date.getUTCMonth() + duration.months);
  return date.toISOString();
}

export function retentionCutoff(
  now: string,
  duration: { readonly days?: number; readonly months?: number },
): string {
  const date = new Date(parseIso(now, "Retention clock"));
  if (duration.days !== undefined) date.setUTCDate(date.getUTCDate() - duration.days);
  if (duration.months !== undefined) date.setUTCMonth(date.getUTCMonth() - duration.months);
  return date.toISOString();
}

/**
 * Candidate retention classes end in a finite duration (for example 7d or
 * 30d). Unknown classes are deliberately rejected rather than silently
 * treated as indefinite.
 */
export function retentionClassDuration(retentionClass: string): {
  readonly days?: number;
  readonly months?: number;
} {
  const match = /(?:^|[-_])(\d+)(d|w|m|y)$/iu.exec(retentionClass.trim());
  if (match === null) throw new Error("Retention class must end in a finite duration.");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("Retention duration must be positive.");
  const unit = match[2]?.toLowerCase();
  if (unit === "d") return { days: count };
  if (unit === "w") return { days: count * 7 };
  if (unit === "m") return { months: count };
  return { months: count * 12 };
}
