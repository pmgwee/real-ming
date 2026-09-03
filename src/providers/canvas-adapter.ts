import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  providerFailure,
  providerStalenessThresholdMs,
  type ProviderAdapter,
  type ProviderFailureClass,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadResult,
  type ProviderWriteResult,
} from "./adapter-contract.js";

export const canvasProvider = "canvas";

export interface CanvasCourseFile {
  readonly id: string;
  readonly courseId: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly sourceReference: string;
}

export interface CanvasAnnouncement {
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  readonly body: string;
  readonly postedAt: string;
  readonly sourceReference: string;
}

export interface CanvasCourseEvidence {
  readonly files: readonly CanvasCourseFile[];
  readonly announcements: readonly CanvasAnnouncement[];
}

/**
 * Canvas is read-only for Real-Ming. `write` and `submitAssignment` exist so the
 * refusal is part of the contract rather than an absent method some caller could
 * work around, and both refuse before any request is made: telling Canvas that
 * Ming intended to submit is itself the thing the spec excludes.
 */
export interface CanvasAdapter extends ProviderAdapter<CanvasCourseEvidence> {
  readCourse(request: {
    readonly courseId: string;
  }): Promise<ProviderReadResult<CanvasCourseEvidence>>;
  submitAssignment(request: {
    readonly courseId: string;
    readonly assignmentId: string;
  }): Promise<ProviderWriteResult>;
  providerCallCount(): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureClassForStatus(status: number): ProviderFailureClass {
  if (status === 401) return "authentication-failed";
  if (status === 403) return "permission-denied";
  if (status === 404) return "invalid-input";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "provider-error";
}

const submissionExcluded = providerFailure(
  "unsupported-capability",
  "Canvas is read-only for Real-Ming; submitting an assignment or examination is excluded.",
);

export function createCanvasAdapter(options: {
  readonly accessToken: string;
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}): CanvasAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const identity: ProviderIdentity = {
    provider: canvasProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  let providerCalls = 0;

  const provenanceFor = (
    reference: string,
    asOf: string,
    retrievedAt: string,
  ): ProviderProvenance => ({
    sourceIdentity: canvasProvider,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs
        ? "stale"
        : "current",
  });

  const get = async (path: string): Promise<readonly unknown[]> => {
    providerCalls += 1;
    const response = await request(`${options.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Canvas read failed with HTTP ${response.status}.`), {
        failureClass: failureClassForStatus(response.status),
      });
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw Object.assign(new Error("Canvas returned an unreadable list."), {
        failureClass: "provider-error" as ProviderFailureClass,
      });
    }
    return body;
  };

  const readCourse: CanvasAdapter["readCourse"] = async ({ courseId }) => {
    const retrievedAt = now();
    try {
      const [rawFiles, rawAnnouncements] = await Promise.all([
        get(`/api/v1/courses/${encodeURIComponent(courseId)}/files`),
        get(
          `/api/v1/courses/${encodeURIComponent(courseId)}/discussion_topics?only_announcements=true`,
        ),
      ]);

      const files: CanvasCourseFile[] = [];
      for (const entry of rawFiles) {
        if (!isRecord(entry) || entry["id"] === undefined) continue;
        const id = String(entry["id"]);
        files.push({
          id,
          courseId,
          name: typeof entry["display_name"] === "string" ? entry["display_name"] : "",
          updatedAt:
            typeof entry["updated_at"] === "string" ? entry["updated_at"] : retrievedAt,
          sourceReference: `canvas:${courseId}:file:${id}`,
        });
      }

      const announcements: CanvasAnnouncement[] = [];
      for (const entry of rawAnnouncements) {
        if (!isRecord(entry) || entry["id"] === undefined) continue;
        const id = String(entry["id"]);
        const title = typeof entry["title"] === "string" ? entry["title"] : "";
        const body = typeof entry["message"] === "string" ? entry["message"] : "";
        // An announcement can quote a dial-in PIN or a reset link. Redact
        // rather than carry it into a Work Item or an Outcome Report.
        const sensitive = detectSensitiveFields({ title, body }).length > 0;
        announcements.push({
          id,
          courseId,
          title: sensitive ? "[redacted]" : title,
          body: sensitive ? "[redacted]" : body,
          postedAt:
            typeof entry["posted_at"] === "string" ? entry["posted_at"] : retrievedAt,
          sourceReference: `canvas:${courseId}:announcement:${id}`,
        });
      }

      // A read has to be datable, so the newest thing Canvas reported is the
      // as-of. Dating it by the retrieval time would let a stale course read as
      // current.
      const asOf = [
        ...files.map((file) => file.updatedAt),
        ...announcements.map((announcement) => announcement.postedAt),
      ].reduce((latest, candidate) => (candidate > latest ? candidate : latest), "");
      if (asOf === "") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Canvas returned no as-of time, so the course state cannot be dated.",
            [options.accessToken],
          ),
        };
      }

      const provenance = provenanceFor(`canvas:${courseId}`, asOf, retrievedAt);
      const value: CanvasCourseEvidence = { files, announcements };
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value }
        : { kind: "ok", identity, provenance, value };
    } catch (error) {
      const failureClass =
        isRecord(error) && typeof error["failureClass"] === "string"
          ? (error["failureClass"] as ProviderFailureClass)
          : "provider-error";
      return {
        kind: "failed",
        failure: providerFailure(
          failureClass,
          error instanceof Error ? error.message : "Canvas read failed.",
          [options.accessToken],
        ),
      };
    }
  };

  return {
    identity: () => identity,
    capabilities: () => ["read"],
    read: (readRequest) => readCourse({ courseId: readRequest.reference }),
    // Refused here, with no request made.
    write: async () => ({ kind: "failed", failure: submissionExcluded }),
    readCourse,
    submitAssignment: async () => ({ kind: "failed", failure: submissionExcluded }),
    providerCallCount: () => providerCalls,
  };
}
