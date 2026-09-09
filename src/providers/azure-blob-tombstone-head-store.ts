import type { TombstoneHead, TombstoneHeadStore, TombstoneRecord } from "../knowledge/native-consolidation/contracts.js";

const storageTokenEndpoint =
  "http://169.254.169.254/metadata/identity/oauth2/token" +
  "?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F";
const storageApiVersion = "2025-05-05";
const accountNamePattern = /^[a-z0-9]{3,24}$/u;
const containerNamePattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;

function validVersion(value: string): boolean {
  // Local fixtures use vN; Azure returns an opaque quoted ETag (optionally
  // weak, W/"..."). Preserve the token exactly for the next If-Match.
  return value === "v0" || /^v[1-9][0-9]*$/u.test(value) || /^"[^"]+"$/u.test(value) || /^W\/"[^"]+"$/u.test(value);
}

function parseHead(value: unknown, response: Response): TombstoneHead | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<TombstoneHead>;
  if (
    !Number.isSafeInteger(candidate.epoch) ||
    (candidate.epoch as number) < 0 ||
    !Array.isArray(candidate.entries) ||
    typeof candidate.complete !== "boolean" ||
    candidate.complete !== true ||
    typeof candidate.version !== "string"
  ) return undefined;
  const epoch = candidate.epoch as number;
  const etag = response.headers.get("etag");
  const version = etag !== null && validVersion(etag) ? etag : candidate.version;
  if (!validVersion(version)) return undefined;
  const entries = candidate.entries.filter((entry): entry is TombstoneHead["entries"][number] =>
    typeof entry === "object" && entry !== null &&
    typeof entry.tombstoneId === "string" && typeof entry.subject === "string" &&
    Number.isSafeInteger(entry.localEpoch) && entry.localEpoch >= 0,
  );
  if (entries.length !== candidate.entries.length) return undefined;
  return { epoch, entries, complete: true, version };
}

/** Azure Blob implementation for the independent protected tombstone head. */
export function createAzureBlobTombstoneHeadStore(options: {
  readonly accountName: string;
  readonly containerName: string;
  readonly blobName?: string;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly now?: () => string;
}): TombstoneHeadStore {
  if (!accountNamePattern.test(options.accountName)) throw new Error("Azure tombstone account name is invalid.");
  if (!containerNamePattern.test(options.containerName)) throw new Error("Azure tombstone container name is invalid.");
  const blobName = options.blobName ?? ".real-ming/tombstone-head.json";
  const segments = blobName.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) throw new Error("Azure tombstone blob name is unsafe.");
  const request = options.fetch ?? fetch;
  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  const now = options.now ?? (() => new Date().toUTCString());
  let token: string | undefined;
  const url = `https://${options.accountName}.blob.core.windows.net/${options.containerName}/${segments.map(encodeURIComponent).join("/")}`;

  async function authToken(): Promise<string | undefined> {
    if (token !== undefined) return token;
    let response: Response;
    try {
      response = await request(storageTokenEndpoint, { headers: { Metadata: "true" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch { return undefined; }
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => undefined) as { readonly access_token?: unknown } | undefined;
    if (typeof body?.access_token !== "string" || body.access_token.length === 0) return undefined;
    token = body.access_token;
    return token;
  }

  async function readHead(): Promise<Awaited<ReturnType<TombstoneHeadStore["readHead"]>>> {
    const bearer = await authToken();
    if (bearer === undefined) return { kind: "unavailable", reason: "managed identity token unavailable" };
    let response: Response;
    try {
      response = await request(url, { headers: { Authorization: `Bearer ${bearer}`, "x-ms-version": storageApiVersion }, signal: AbortSignal.timeout(timeoutMs) });
    } catch { return { kind: "unavailable", reason: "tombstone head read unavailable" }; }
    if (response.status === 404) return { kind: "ok", head: { epoch: 0, entries: [], complete: true, version: "v0" } };
    if (response.status === 401 || response.status === 403) return { kind: "unavailable", reason: "tombstone head read forbidden" };
    if (!response.ok) return { kind: "unavailable", reason: "tombstone head read unavailable" };
    const head = parseHead(await response.json().catch(() => undefined), response);
    return head === undefined ? { kind: "unavailable", reason: "tombstone head is invalid" } : { kind: "ok", head };
  }

  return {
    readHead,
    async appendIfVersion(input) {
      const bearer = await authToken();
      if (bearer === undefined) return { kind: "unavailable", reason: "managed identity token unavailable" };
      const current = await readHead();
      if (current.kind !== "ok") return current;
      if (current.head.version !== input.expectedVersion) return { kind: "conflict", head: current.head };
      const existing = current.head.entries.find((entry) => entry.tombstoneId === input.tombstone.tombstoneId);
      if (existing !== undefined) {
        if (existing.subject !== input.tombstone.subject || existing.localEpoch !== input.tombstone.localEpoch) {
          return { kind: "conflict", head: current.head };
        }
        // Retries after an acknowledged PUT are idempotent and must not
        // append a duplicate entry or advance the independent head again.
        return { kind: "appended", head: current.head };
      }
      const head: TombstoneHead = {
        epoch: current.head.epoch + 1,
        entries: [...current.head.entries, {
          tombstoneId: input.tombstone.tombstoneId,
          subject: input.tombstone.subject,
          localEpoch: input.tombstone.localEpoch,
        }],
        complete: true,
        version: `v${current.head.epoch + 1}`,
      };
      const headers: Record<string, string> = {
        Authorization: `Bearer ${bearer}`,
        "x-ms-blob-type": "BlockBlob",
        "x-ms-date": now(),
        "x-ms-version": storageApiVersion,
        "content-type": "application/json",
        ...(input.expectedVersion === "v0"
          ? { "If-None-Match": "*" }
          : { "If-Match": input.expectedVersion }),
      };
      let response: Response;
      try {
        response = await request(url, { method: "PUT", headers, body: JSON.stringify(head), signal: AbortSignal.timeout(timeoutMs) });
      } catch { return { kind: "unavailable", reason: "tombstone head append unavailable" }; }
      if (response.status === 401 || response.status === 403) return { kind: "unavailable", reason: "tombstone head append forbidden" };
      if (response.status === 409 || response.status === 412) {
        const refreshed = await readHead();
        return refreshed.kind === "ok" ? { kind: "conflict", head: refreshed.head } : { kind: "unavailable", reason: "tombstone head conflict could not be read" };
      }
      if (!response.ok) return { kind: "unavailable", reason: "tombstone head append unavailable" };
      // Azure's response ETag is the opaque concurrency token for the next
      // update. Never replace it with the locally predicted epoch label: a
      // successful PUT without a valid ETag cannot be safely followed.
      const responseEtag = response.headers.get("etag");
      if (responseEtag === null || !validVersion(responseEtag)) {
        return { kind: "unavailable", reason: "tombstone head append returned invalid version" };
      }
      return { kind: "appended", head: { ...head, version: responseEtag } };
    },
  };
}
