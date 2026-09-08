import type { TrustDomain } from "../../operations/contracts.js";

export const NATIVE_KNOWLEDGE_LIMITS = {
  maxCandidatesPerRun: 12,
  maxCandidateEnvelopeBytes: 64 * 1024,
  maxSourceBytes: 256 * 1024,
  maxRunSourceBytes: 2 * 1024 * 1024,
  maxModelCalls: 1,
  maxToolCalls: 48,
  maxPagesPerGeneration: 128,
  maxPageBytes: 128 * 1024,
  maxActiveSnapshotBytes: 16 * 1024 * 1024,
  maxGeneratedRootBytes: 64 * 1024 * 1024,
  maxRetainedGenerations: 3,
  maxWallClockMs: 10 * 60 * 1000,
  maxRetries: 2,
} as const;

export type CandidateKind =
  | "decision"
  | "correction"
  | "project-artifact"
  | "research-artifact";

export type ClaimClass = "decision" | "project" | "research";

export type CandidateSensitivity = "normal" | "sensitive";

export type RetentionClass = "decision" | "project-90d" | "research-30d";

export type CandidateStatus =
  | "staged"
  | "published"
  | "quarantined"
  | "superseded"
  | "forgotten"
  | "rejected";

export type EvidenceDisposition =
  | "supported"
  | "unsupported"
  | "conflicting"
  | "unavailable"
  | "stale"
  | "quarantined";

export type RunStatus = "running" | "succeeded" | "failed" | "fenced";

export type RepairState = "healthy" | "needs-repair" | "head_sync_pending";

export interface NativeKnowledgeCandidate {
  readonly candidateId: string;
  readonly kind: CandidateKind;
  readonly claimClass: ClaimClass;
  /** Prose is accepted at the boundary but is never stored in the registry. */
  readonly claim: string;
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly sourceVersion: string;
  readonly excerpt: string;
  readonly contentHash: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly trustDomain: TrustDomain;
  readonly sensitivity: CandidateSensitivity;
  readonly retentionClass: RetentionClass;
  readonly dependencies: readonly string[];
}

export interface NativeKnowledgeCandidateMetadata {
  readonly candidateId: string;
  readonly fingerprint: string;
  readonly kind: CandidateKind;
  readonly claimClass: ClaimClass;
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly sourceVersion: string;
  readonly contentHash: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly trustDomain: TrustDomain;
  readonly sensitivity: CandidateSensitivity;
  readonly retentionClass: RetentionClass;
  readonly dependencies: readonly string[];
  readonly status: CandidateStatus;
  readonly disposition: EvidenceDisposition | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AdmissionResult =
  | { readonly kind: "accepted"; readonly candidateId: string; readonly fingerprint: string }
  | { readonly kind: "duplicate"; readonly candidateId: string }
  | { readonly kind: "denied"; readonly reason: string };

export interface RunLease {
  readonly runId: string;
  readonly leaseToken: string;
  readonly leaseEpoch: number;
  readonly expiresAt: string;
  readonly operatingDate: string;
}

export type LeaseClaimResult =
  | ({ readonly kind: "claimed" } & RunLease)
  | { readonly kind: "busy"; readonly runId: string; readonly expiresAt: string }
  | { readonly kind: "denied"; readonly reason: string };

export type LeaseCheckResult =
  | { readonly kind: "valid" }
  | { readonly kind: "fenced" }
  | { readonly kind: "missing" };

export interface StagedPage {
  readonly pageId: string;
  readonly path: string;
  readonly content: string;
  readonly sourceCandidateIds: readonly string[];
  readonly claimClass: ClaimClass;
  readonly sourceReference: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly disposition: EvidenceDisposition;
  readonly uncertainty: "none" | "uncertain";
}

export interface GenerationPageMetadata {
  readonly pageId: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly sourceCandidateIds: readonly string[];
  readonly claimClass: ClaimClass;
  readonly sourceReference: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly disposition: EvidenceDisposition;
  readonly uncertainty: "none" | "uncertain";
}

export interface GenerationManifest {
  readonly schema: "real-ming.native-knowledge-generation.v1";
  readonly generationId: string;
  readonly runId: string;
  readonly previousGenerationId: string | null;
  readonly complete: boolean;
  readonly createdAt: string;
  readonly sourceEpoch: number;
  readonly tombstoneEpoch: number;
  readonly pages: readonly GenerationPageMetadata[];
  readonly indexSha256: string;
  readonly logSha256: string;
  readonly totalBytes: number;
}

export interface StagedGeneration {
  readonly generationId: string;
  readonly runId: string;
  readonly immutablePath: string;
  readonly manifest: GenerationManifest;
  readonly manifestHash: string;
}

export interface StageGenerationRequest {
  readonly run: RunLease;
  readonly generatedRoot: string;
  readonly stagingRoot: string;
  readonly pages: readonly StagedPage[];
  readonly previous?: GenerationManifest;
  readonly sourceEpoch: number;
  readonly tombstoneEpoch: number;
  readonly now: string;
}

export interface ActivationRequest {
  readonly generation: StagedGeneration;
  readonly lease: RunLease;
  readonly activePath: string;
  readonly now: string;
}

export type ActivationResult =
  | { readonly kind: "activated"; readonly generationId: string; readonly publicationEpoch: number }
  | { readonly kind: "fenced"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string };

export interface ActiveGeneration {
  readonly generationId: string;
  readonly runId: string;
  readonly path: string;
  readonly manifestHash: string;
  readonly sourceEpoch: number;
  readonly tombstoneEpoch: number;
  readonly publicationEpoch: number;
  readonly createdAt: string;
}

export interface CaptureRequest {
  readonly candidate: NativeKnowledgeCandidate;
  readonly explicit: boolean;
  readonly marked: boolean;
}

export type CaptureResult =
  | { readonly kind: "accepted"; readonly admission: AdmissionResult }
  | { readonly kind: "ignored"; readonly reason: "not-explicit" }
  | { readonly kind: "denied"; readonly reason: string };

export interface SourceSnapshot {
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly sourceVersion: string;
  readonly content: string;
  readonly contentHash: string;
  readonly asOf: string;
  readonly retrievedAt: string;
}

export interface EvidenceCheckRequest {
  readonly candidate: NativeKnowledgeCandidate;
  readonly source?: SourceSnapshot;
  readonly now: string;
  /** A bounded model/human assessment; a hash alone cannot establish this. */
  readonly semanticSupport?: "supported" | "unsupported" | "uncertain";
}

export interface EvidenceCheckResult {
  readonly disposition: EvidenceDisposition;
  readonly support: "supported" | "unsupported" | "uncertain";
  readonly fresh: boolean;
  readonly identityMatches: boolean;
  readonly sourceReference: string | null;
  readonly reason: string;
}

export interface FreshnessPolicy {
  readonly decisionDays: null;
  readonly projectDays: 90;
  readonly researchDays: 30;
}

export interface FreshnessResult {
  readonly fresh: boolean;
  readonly expiresAt: string | null;
  readonly reason: string;
}

export interface ForgetRequest {
  readonly subject: string;
  readonly aliases?: readonly string[];
  readonly reason: string;
  readonly requestedAt: string;
}

export interface TombstoneRecord {
  readonly tombstoneId: string;
  readonly subject: string;
  readonly aliases: readonly string[];
  readonly reason: string;
  readonly localEpoch: number;
  readonly status: "local-suppressed" | "head-sync-pending" | "restore-safe" | "cleanup-complete";
  readonly createdAt: string;
}

export type ForgetResult = TombstoneRecord & {
  readonly verifiedHeadEpoch: number | null;
};

export interface TombstoneHead {
  readonly epoch: number;
  readonly entries: readonly Pick<TombstoneRecord, "tombstoneId" | "subject" | "localEpoch">[];
  readonly complete: boolean;
  readonly version: string;
}

export interface TombstoneHeadStore {
  readHead(): Promise<{ readonly kind: "ok"; readonly head: TombstoneHead } | { readonly kind: "unavailable"; readonly reason: string }>;
  appendIfVersion(input: {
    readonly expectedVersion: string;
    readonly tombstone: TombstoneRecord;
  }): Promise<
    | { readonly kind: "appended"; readonly head: TombstoneHead }
    | { readonly kind: "conflict"; readonly head: TombstoneHead }
    | { readonly kind: "unavailable"; readonly reason: string }
  >;
}

export interface RestoreTombstoneRequest {
  readonly snapshotHighestLocalEpoch: number;
  readonly snapshotPendingTombstoneIds: readonly string[];
}

export type RestoreTombstoneResult =
  | { readonly kind: "safe"; readonly head: TombstoneHead }
  | { readonly kind: "needs-repair"; readonly reason: string; readonly head?: TombstoneHead };

export interface WikiRetrieveRequest {
  readonly query: string;
  readonly now: string;
  readonly role?: string;
  readonly maxResults?: number;
}

export interface WikiCitation {
  readonly sourceReference: string;
  readonly excerpt: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly generationId: string;
  readonly disposition: EvidenceDisposition;
  readonly uncertainty: "none" | "uncertain";
}

export type WikiRetrieveResult =
  | { readonly kind: "ok"; readonly results: readonly { readonly pageId: string; readonly path: string; readonly content: string; readonly citation: WikiCitation }[] }
  | { readonly kind: "wiki-unavailable" | "needs-repair" | "not-found"; readonly reason: string };

export interface NativeKnowledgeRunHealth {
  readonly runId: string | null;
  readonly lastSuccess: string | null;
  readonly lastFailureCode: string | null;
  readonly backlog: number;
  readonly activeGenerationId: string | null;
  readonly tombstoneHeadEpoch: number;
  readonly staleCount: number;
  readonly quarantinedCount: number;
  readonly repairState: RepairState;
  readonly isolationEligible: boolean;
}

export interface ConsolidationRunRequest {
  readonly operatingDate: string;
  readonly now: string;
  readonly generatedRoot: string;
  readonly stagingRoot: string;
  readonly synthesize: (input: {
    readonly candidates: readonly NativeKnowledgeCandidate[];
    readonly previous: GenerationManifest | undefined;
  }) => Promise<readonly StagedPage[]>;
  readonly maxWallClockMs?: number;
}

export interface ConsolidationRunResult {
  readonly kind: "succeeded" | "failed" | "busy" | "ineligible";
  readonly runId?: string;
  readonly generationId?: string;
  readonly reason?: string;
  readonly retryCount: number;
}
