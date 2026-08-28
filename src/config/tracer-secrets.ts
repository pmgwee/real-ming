export type SecretEnvironment = "control-plane" | "private-worker";

export interface TracerCredential {
  readonly name: string;
  readonly owner: string;
  readonly purpose: string;
  readonly environment: SecretEnvironment;
  readonly revocation: string;
  readonly producedBy?: string;
}

export const tracerCredentials: readonly TracerCredential[] = [
  {
    name: "REAL_MING_TELEGRAM_BOT_TOKEN",
    owner: "CEO",
    purpose: "Authenticate the private Telegram front door.",
    environment: "control-plane",
    revocation: "Revoke with /revoke in BotFather, then issue a new token.",
  },
  {
    name: "REAL_MING_TELEGRAM_CEO_ID",
    owner: "CEO",
    purpose: "Allowlist the single numeric Telegram identity that may command Real-Ming.",
    environment: "control-plane",
    revocation: "Replace the allowlisted identity and redeploy configuration.",
  },
  {
    name: "REAL_MING_NOTION_TOKEN",
    owner: "CEO",
    purpose: "Read and write Master Tasks and the linked Work Views.",
    environment: "control-plane",
    revocation: "Delete the internal integration in Notion settings.",
  },
  {
    name: "REAL_MING_NOTION_MASTER_TASKS_ID",
    owner: "CEO",
    purpose: "Identify the canonical Master Tasks data source.",
    environment: "control-plane",
    revocation: "Unshare the data source from the integration.",
    producedBy: "RM-09",
  },
  {
    name: "REAL_MING_GOOGLE_CLIENT_ID",
    owner: "CEO",
    purpose: "Identify the Google authorization client for Calendar.",
    environment: "control-plane",
    revocation: "Delete the OAuth client in the Google Cloud console.",
  },
  {
    name: "REAL_MING_GOOGLE_CLIENT_SECRET",
    owner: "CEO",
    purpose: "Authorize the Google Calendar client.",
    environment: "control-plane",
    revocation: "Rotate the client secret in the Google Cloud console.",
  },
  {
    name: "REAL_MING_GOOGLE_REFRESH_TOKEN",
    owner: "CEO",
    purpose:
      "Maintain delegated Calendar access without re-consent, scoped to calendar.events and calendar.calendarlist.readonly only.",
    environment: "control-plane",
    revocation: "Revoke access from the Google Account permissions page.",
  },
  {
    name: "REAL_MING_DASHBOARD_TOKEN",
    owner: "CEO",
    purpose: "Authenticate the CEO to the operations dashboard.",
    environment: "control-plane",
    revocation: "Replace the stored token; sessions fail closed immediately.",
  },
  {
    name: "REAL_MING_VAULT_KEY",
    owner: "CEO",
    purpose: "Derive the Knowledge Vault encryption key.",
    environment: "control-plane",
    revocation: "Re-key the vault and republish each root generation.",
  },
  {
    name: "REAL_MING_WORKER_SHARED_SECRET",
    owner: "CEO",
    purpose: "Authenticate the Lenovo private worker to the control plane.",
    environment: "private-worker",
    revocation: "Rotate the shared secret on both the worker and control plane.",
  },
];

export interface DeferredCredential {
  readonly name: string;
  readonly producedBy: string;
}

export interface SecretPreflight {
  readonly ready: boolean;
  readonly present: readonly string[];
  readonly missing: readonly string[];
  readonly deferred: readonly DeferredCredential[];
}

export function preflightTracerSecrets(
  environment: Readonly<Record<string, string | undefined>>,
  credentials: readonly TracerCredential[] = tracerCredentials,
): SecretPreflight {
  const present: string[] = [];
  const missing: string[] = [];
  const deferred: DeferredCredential[] = [];

  for (const credential of credentials) {
    const supplied = (environment[credential.name] ?? "").trim();
    if (supplied.length > 0) {
      present.push(credential.name);
    } else if (credential.producedBy === undefined) {
      missing.push(credential.name);
    } else {
      deferred.push({
        name: credential.name,
        producedBy: credential.producedBy,
      });
    }
  }

  return { ready: missing.length === 0, present, missing, deferred };
}

export function renderCredentialInventory(
  credentials: readonly TracerCredential[] = tracerCredentials,
): string {
  const rows = credentials
    .map((credential) => {
      const provisioning =
        credential.producedBy === undefined
          ? "Provision during Gate 1"
          : `Produced by ${credential.producedBy}; leave empty until then`;
      return `| \`${credential.name}\` | ${credential.owner} | ${credential.purpose} | ${provisioning} | ${credential.environment} | ${credential.revocation} |`;
    })
    .join("\n");

  return [
    "| Variable | Owner | Purpose | When | Environment | Revocation |",
    "| --- | --- | --- | --- | --- | --- |",
    rows,
  ].join("\n");
}
