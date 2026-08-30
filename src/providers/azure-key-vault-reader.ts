import type {
  VaultFailure,
  VaultReadResult,
  VaultSecretReader,
} from "../runtime/credential-resolver.js";

/**
 * The Azure Instance Metadata Service. It answers only from the machine itself
 * on a link-local address, which is why this adapter holds no credential: the
 * VM's identity is proven by where the request comes from.
 */
const instanceMetadataTokenEndpoint =
  "http://169.254.169.254/metadata/identity/oauth2/token" +
  "?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net";

const keyVaultApiVersion = "7.4";

/** Key Vault permits lowercase alphanumerics and hyphens, 1-127 characters. */
const storableSecretName = /^[0-9a-z][0-9a-z-]{0,126}$/;

type TokenResult =
  | { readonly kind: "ok"; readonly token: string }
  | { readonly kind: "failed"; readonly failure: VaultFailure };

/**
 * Read secrets from Azure Key Vault using the host's managed identity.
 *
 * Nothing here stores or receives a credential: the bearer token is fetched
 * from the metadata service at run time and never leaves this module. Response
 * bodies are deliberately never read on a failure path, because Key Vault
 * echoes the request in its error payloads and that payload would otherwise
 * reach a log line.
 */
export function createAzureKeyVaultReader(options: {
  readonly vaultName: string;
  readonly fetch?: typeof fetch;
}): VaultSecretReader {
  const request = options.fetch ?? fetch;
  let cachedToken: string | null = null;

  async function acquireToken(): Promise<TokenResult> {
    // Ten credentials must not mean ten token round trips on a cold start.
    if (cachedToken !== null) return { kind: "ok", token: cachedToken };

    let response: Response;
    try {
      response = await request(instanceMetadataTokenEndpoint, {
        headers: { Metadata: "true" },
      });
    } catch {
      return { kind: "failed", failure: "unavailable" };
    }

    if (response.status === 401 || response.status === 403) {
      return { kind: "failed", failure: "forbidden" };
    }
    if (!response.ok) return { kind: "failed", failure: "unavailable" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "failed", failure: "unavailable" };
    }

    const token = (body as { readonly access_token?: unknown }).access_token;
    if (typeof token !== "string" || token.trim().length === 0) {
      return { kind: "failed", failure: "unavailable" };
    }
    cachedToken = token;
    return { kind: "ok", token };
  }

  return {
    async read(secretName: string): Promise<VaultReadResult> {
      // Reject locally rather than spend a round trip being told what the
      // naming rules already say.
      if (!storableSecretName.test(secretName)) return { kind: "absent" };

      const acquired = await acquireToken();
      if (acquired.kind === "failed") {
        return { kind: "failed", failure: acquired.failure };
      }

      let response: Response;
      try {
        response = await request(
          `https://${options.vaultName}.vault.azure.net/secrets/` +
            `${secretName}?api-version=${keyVaultApiVersion}`,
          { headers: { Authorization: `Bearer ${acquired.token}` } },
        );
      } catch {
        return { kind: "failed", failure: "unavailable" };
      }

      // A secret the vault does not hold is absent, not a fault: the
      // environment is expected to supply it instead.
      if (response.status === 404) return { kind: "absent" };
      if (response.status === 401 || response.status === 403) {
        // What a missing Key Vault Secrets User role assignment looks like.
        return { kind: "failed", failure: "forbidden" };
      }
      if (!response.ok) return { kind: "failed", failure: "unavailable" };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: "failed", failure: "unavailable" };
      }

      const value = (body as { readonly value?: unknown }).value;
      return typeof value === "string"
        ? { kind: "found", value }
        : { kind: "failed", failure: "unavailable" };
    },
  };
}
