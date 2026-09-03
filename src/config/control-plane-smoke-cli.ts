import { createAzureKeyVaultReader } from "../providers/azure-key-vault-reader.js";
import { resolveControlPlaneCredentials } from "../runtime/credential-resolver.js";
import { verifyControlPlaneDashboard } from "../runtime/control-plane-smoke.js";

function configured(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    process.stdout.write(
      "Control-plane live smoke skipped; pass --live explicitly.\n",
    );
    return;
  }

  const vaultName = configured("REAL_MING_AZURE_KEY_VAULT_NAME");
  const resolved = await resolveControlPlaneCredentials({
    environment: process.env,
    ...(vaultName === undefined
      ? {}
      : { vault: createAzureKeyVaultReader({ vaultName }) }),
  });
  if (!resolved.ready) {
    throw new Error(`Control-plane live smoke cannot resolve credentials.\n${resolved.report}`);
  }
  const dashboardToken = resolved.values.get("REAL_MING_DASHBOARD_TOKEN");
  if (dashboardToken === undefined || dashboardToken.length === 0) {
    throw new Error("The dashboard credential is unresolved.");
  }
  const result = await verifyControlPlaneDashboard({
    origin: configured(
      "REAL_MING_DASHBOARD_ORIGIN",
      "http://127.0.0.1:8787",
    )!,
    dashboardToken,
  });
  if (result.kind === "failed") {
    throw new Error(`Control-plane live smoke failed (${result.reason}).`);
  }
  process.stdout.write("Control-plane live smoke passed.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Control-plane live smoke failed."}\n`,
  );
  process.exitCode = 1;
});
