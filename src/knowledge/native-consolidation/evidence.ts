import { createHash } from "node:crypto";

import { detectSensitiveFields } from "../../operations/sensitive-secret.js";
import {
  NATIVE_KNOWLEDGE_LIMITS,
  type CaptureRequest,
  type CaptureResult,
  type EvidenceCheckRequest,
  type EvidenceCheckResult,
  type FreshnessPolicy,
  type FreshnessResult,
  type NativeKnowledgeCandidate,
  type NativeKnowledgeRegistry,
} from "./contracts.js";

export const firstSliceFreshnessPolicy: FreshnessPolicy = {
  decisionDays: null,
  projectDays: 90,
  researchDays: 30,
};

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Evaluate freshness at the point a claim is used.  A decision has no
 * automatic expiry; it becomes invalid only when superseded or forgotten.
 */
export function isFresh(input: {
  readonly claimClass: NativeKnowledgeCandidate["claimClass"];
  readonly asOf: string;
  readonly now: string;
  readonly policy?: FreshnessPolicy;
}): FreshnessResult {
  const policy = input.policy ?? firstSliceFreshnessPolicy;
  const asOfMs = Date.parse(input.asOf);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(nowMs)) {
    return { fresh: false, expiresAt: null, reason: "invalid-timestamp" };
  }
  const days =
    input.claimClass === "project"
      ? policy.projectDays
      : input.claimClass === "research"
        ? policy.researchDays
        : policy.decisionDays;
  if (days === null) {
    return { fresh: true, expiresAt: null, reason: "decision-remains-valid-until-superseded-or-forgotten" };
  }
  const expiresAt = addDays(input.asOf, days);
  return nowMs <= Date.parse(expiresAt)
    ? { fresh: true, expiresAt, reason: "within-versioned-freshness-window" }
    : { fresh: false, expiresAt, reason: "freshness-window-expired" };
}

/**
 * Deliberate capture is the only admission path.  A normal turn has no mark
 * and therefore never enters a nightly sweep or the native memory store.
 */
export async function captureCandidate(input: CaptureRequest & {
  readonly registry: NativeKnowledgeRegistry;
}): Promise<CaptureResult> {
  if (!input.explicit && !input.marked) {
    return { kind: "ignored", reason: "not-explicit" };
  }
  if (Buffer.byteLength(JSON.stringify(input.candidate), "utf8") > NATIVE_KNOWLEDGE_LIMITS.maxCandidateEnvelopeBytes) {
    return { kind: "denied", reason: "candidate-envelope-too-large" };
  }
  const admission = input.registry.admitCandidate(input.candidate);
  return admission.kind === "accepted" || admission.kind === "duplicate"
    ? { kind: "accepted", admission }
    : { kind: "denied", reason: admission.reason };
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/**
 * Verify identity, bounded source support and claim-appropriate freshness.
 * The source hash establishes byte identity only; semantic support remains an
 * explicit model/human disposition and can quarantine a misleading claim.
 */
export async function verifyEvidence(
  input: EvidenceCheckRequest,
): Promise<EvidenceCheckResult> {
  const source = input.source;
  if (source === undefined) {
    return {
      disposition: "unavailable",
      support: "uncertain",
      fresh: false,
      identityMatches: false,
      sourceReference: null,
      reason: "source-route-unavailable",
    };
  }
  if (
    detectSensitiveFields({
      sourceIdentity: source.sourceIdentity,
      sourceReference: source.sourceReference,
      content: source.content,
    }).length > 0
  ) {
    return {
      disposition: "quarantined",
      support: "uncertain",
      fresh: false,
      identityMatches: false,
      sourceReference: source.sourceReference,
      reason: "source-contains-sensitive-field",
    };
  }
  const identityMatches =
    source.sourceIdentity === input.candidate.sourceIdentity &&
    source.sourceReference === input.candidate.sourceReference &&
    source.sourceVersion === input.candidate.sourceVersion &&
    source.contentHash === input.candidate.contentHash;
  if (!identityMatches) {
    return {
      disposition: "conflicting",
      support: "uncertain",
      fresh: false,
      identityMatches: false,
      sourceReference: source.sourceReference,
      reason: "source-identity-version-or-hash-mismatch",
    };
  }
  const excerptPresent = source.content.includes(input.candidate.excerpt);
  const declaredHashIsPlausible =
    source.contentHash.startsWith("sha256:") || contentHash(source.content) === source.contentHash;
  const freshness = isFresh({
    claimClass: input.candidate.claimClass,
    asOf: input.candidate.asOf,
    now: input.now,
  });
  if (!freshness.fresh) {
    return {
      disposition: "stale",
      support: "supported",
      fresh: false,
      identityMatches: true,
      sourceReference: source.sourceReference,
      reason: freshness.reason,
    };
  }
  const semanticSupport = input.semanticSupport ?? "uncertain";
  if (!excerptPresent || !declaredHashIsPlausible || semanticSupport !== "supported") {
    return {
      disposition: "quarantined",
      support: semanticSupport,
      fresh: true,
      identityMatches: true,
      sourceReference: source.sourceReference,
      reason: !excerptPresent
        ? "candidate-excerpt-not-present-in-source"
        : semanticSupport !== "supported"
          ? "semantic-support-not-established-by-hash"
          : "source-hash-format-invalid",
    };
  }
  return {
    disposition: "supported",
    support: "supported",
    fresh: true,
    identityMatches: true,
    sourceReference: source.sourceReference,
    reason: "source-excerpt-and-explicit-support-verified",
  };
}
