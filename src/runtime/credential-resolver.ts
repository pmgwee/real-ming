import { tracerCredentials, type TracerCredential } from "../config/tracer-secrets.js";

/**
 * Where a credential was found. The control plane records this so an operator
 * can tell a rotated environment value from a stale vault copy without ever
 * printing either.
 */
export type CredentialOrigin = "environment" | "azure-key-vault";

/**
 * Why a vault read did not produce a value. "unavailable" is a reachability
 * fault and "forbidden" is an authorization one; they have different fixes, so
 * collapsing them into "missing" would send the CEO to re-paste a credential
 * that is already stored.
 */
export type VaultFailure = "unavailable" | "forbidden";

export type VaultReadResult =
  | { readonly kind: "found"; readonly value: string }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly failure: VaultFailure };

export interface VaultSecretReader {
  read(secretName: string): Promise<VaultReadResult>;
}

export interface ResolvedCredentials {
  readonly ready: boolean;
  readonly values: ReadonlyMap<string, string>;
  readonly resolvedFrom: ReadonlyMap<string, CredentialOrigin>;
  readonly missing: readonly string[];
  readonly vaultFailure: VaultFailure | null;
  readonly report: string;
}

/**
 * `REAL_MING_NOTION_TOKEN` becomes `real-ming-notion-token`. Key Vault secret
 * names permit only alphanumerics and hyphens, so the mapping is mechanical
 * and must stay so: the CEO names the secrets by hand.
 */
export function vaultSecretNameFor(variable: string): string {
  return variable.toLowerCase().split("_").join("-");
}

function supplied(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve every tracer credential, preferring the environment and consulting
 * the vault only for what the environment does not carry.
 *
 * The environment wins deliberately. It keeps the vault optional, so the day-31
 * move to a host with no Key Vault is a redeploy rather than a rewrite, and it
 * means a credential rotated through the unit file is not silently reverted by
 * a stale copy in the vault.
 */
export async function resolveControlPlaneCredentials(options: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly vault?: VaultSecretReader;
  readonly credentials?: readonly TracerCredential[];
}): Promise<ResolvedCredentials> {
  const credentials = options.credentials ?? tracerCredentials;
  const values = new Map<string, string>();
  const resolvedFrom = new Map<string, CredentialOrigin>();
  const missing: string[] = [];
  let vaultFailure: VaultFailure | null = null;

  for (const credential of credentials) {
    const fromEnvironment = supplied(options.environment[credential.name]);
    if (fromEnvironment !== undefined) {
      values.set(credential.name, fromEnvironment);
      resolvedFrom.set(credential.name, "environment");
      continue;
    }

    // One outage means every subsequent read fails the same way. Stop asking so
    // a vault that is down costs one timeout rather than ten.
    if (options.vault !== undefined && vaultFailure === null) {
      const result = await options.vault.read(vaultSecretNameFor(credential.name));
      if (result.kind === "failed") {
        vaultFailure = result.failure;
      } else if (result.kind === "found") {
        const fromVault = supplied(result.value);
        if (fromVault !== undefined) {
          values.set(credential.name, fromVault);
          resolvedFrom.set(credential.name, "azure-key-vault");
          continue;
        }
      }
    }

    missing.push(credential.name);
  }

  return {
    ready: missing.length === 0,
    values,
    resolvedFrom,
    missing,
    vaultFailure,
    report: renderReport(credentials.length, resolvedFrom, missing, vaultFailure),
  };
}

/**
 * Names and counts only. This string is written to the service log on every
 * start, so a value reaching it would put a credential in the journal.
 */
function renderReport(
  total: number,
  resolvedFrom: ReadonlyMap<string, CredentialOrigin>,
  missing: readonly string[],
  vaultFailure: VaultFailure | null,
): string {
  const namesFrom = (origin: CredentialOrigin): readonly string[] =>
    [...resolvedFrom.entries()]
      .filter(([, from]) => from === origin)
      .map(([name]) => name);

  const lines = [
    `Control plane credentials: ${resolvedFrom.size} of ${total} resolved.`,
  ];
  const fromEnvironment = namesFrom("environment");
  if (fromEnvironment.length > 0) {
    lines.push(`From environment: ${fromEnvironment.join(", ")}`);
  }
  const fromVault = namesFrom("azure-key-vault");
  if (fromVault.length > 0) {
    lines.push(`From azure-key-vault: ${fromVault.join(", ")}`);
  }
  if (vaultFailure !== null) {
    lines.push(`Vault read stopped: the secret vault is ${vaultFailure}.`);
  }
  if (missing.length > 0) {
    lines.push(`Missing: ${missing.join(", ")}`);
  }
  return lines.join("\n");
}
