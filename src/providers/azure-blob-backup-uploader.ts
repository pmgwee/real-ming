const storageTokenEndpoint =
  "http://169.254.169.254/metadata/identity/oauth2/token" +
  "?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F";

const storageApiVersion = "2025-05-05";
const storageAccountName = /^[a-z0-9]{3,24}$/;
const containerName = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export type AzureBlobBackupUploadResult =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly reason: "forbidden" | "unavailable" };

export interface AzureBlobBackupUploader {
  upload(request: {
    readonly blobName: string;
    readonly content: Uint8Array;
  }): Promise<AzureBlobBackupUploadResult>;
}

/** Upload immutable backup objects using the VM's managed identity. */
export function createAzureBlobBackupUploader(options: {
  readonly accountName: string;
  readonly containerName: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}): AzureBlobBackupUploader {
  if (!storageAccountName.test(options.accountName)) {
    throw new Error("Azure backup storage account name is invalid.");
  }
  if (!containerName.test(options.containerName)) {
    throw new Error("Azure backup container name is invalid.");
  }
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toUTCString());
  let token: string | null = null;

  async function managedIdentityToken(): Promise<AzureBlobBackupUploadResult | string> {
    if (token !== null) return token;
    let response: Response;
    try {
      response = await request(storageTokenEndpoint, {
        headers: { Metadata: "true" },
      });
    } catch {
      return { kind: "failed", reason: "unavailable" };
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: "failed", reason: "forbidden" };
    }
    if (!response.ok) return { kind: "failed", reason: "unavailable" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "failed", reason: "unavailable" };
    }
    const value = (body as { readonly access_token?: unknown }).access_token;
    if (typeof value !== "string" || value.trim().length === 0) {
      return { kind: "failed", reason: "unavailable" };
    }
    token = value;
    return token;
  }

  return {
    async upload(upload): Promise<AzureBlobBackupUploadResult> {
      const segments = upload.blobName.split("/");
      if (
        segments.length === 0 ||
        segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
      ) {
        return { kind: "failed", reason: "forbidden" };
      }
      const acquired = await managedIdentityToken();
      if (typeof acquired !== "string") return acquired;
      const blob = segments.map(encodeURIComponent).join("/");
      let response: Response;
      try {
        response = await request(
          `https://${options.accountName}.blob.core.windows.net/${options.containerName}/${blob}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${acquired}`,
              "x-ms-blob-type": "BlockBlob",
              "x-ms-date": now(),
              "x-ms-version": storageApiVersion,
              "content-type": "application/vnd.sqlite3",
            },
            body: new Blob([Uint8Array.from(upload.content)]),
          },
        );
      } catch {
        return { kind: "failed", reason: "unavailable" };
      }
      if (response.status === 401 || response.status === 403) {
        return { kind: "failed", reason: "forbidden" };
      }
      return response.ok
        ? { kind: "ok" }
        : { kind: "failed", reason: "unavailable" };
    },
  };
}
