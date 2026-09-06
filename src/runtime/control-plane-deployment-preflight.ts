import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type DeploymentPreflightResult =
  | { readonly kind: "passed"; readonly failures: readonly [] }
  | { readonly kind: "failed"; readonly failures: readonly string[] };

type RequiredFragment = readonly [name: string, fragment: string];

async function inspect(
  root: string,
  path: string,
  requirements: readonly RequiredFragment[],
  failures: string[],
): Promise<void> {
  let content: string;
  try {
    content = await readFile(join(root, path), "utf8");
  } catch {
    failures.push(`${path}:missing`);
    return;
  }
  for (const [name, fragment] of requirements) {
    if (!content.includes(fragment)) failures.push(`${path}:${name}`);
  }
}

/**
 * Configuration the composition reads from the environment but that is
 * deliberately not passed into the container yet. Each entry needs a reason,
 * because the alternative -- silence -- is what let a live option exist in the
 * code and in `release.env` while never reaching the process that reads it.
 */
const undeployedRuntimeEnvironment: ReadonlyMap<string, string> = new Map([
  ["REAL_MING_GITHUB_READ_TOKEN", "Repository Center adapters are supplied by the composition root, not the cloud unit."],
  ["REAL_MING_VERCEL_READ_TOKEN", "Same as the GitHub read token."],
  ["REAL_MING_GIT_REPOSITORY_PATH", "Local checkout path; meaningless inside the container."],
  ["REAL_MING_PORTFOLIO_PROJECTS_JSON", "Portfolio records are seeded by the composition root, not the unit."],
  ["REAL_MING_GOOGLE_CALENDAR_ID", "Not deployed; the composition falls back to the primary calendar."],
]);

/**
 * Every `REAL_MING_*` name the deployed composition reads must either reach the
 * container or be listed above. A `--env` flag that was never added is
 * invisible: the option parses, the operator sets it in `release.env`, and the
 * process silently uses the default. That happened once with the Revision 6
 * Telegram ownership switch, which left a second Telegram consumer polling.
 */
async function verifyContainerEnvironmentPassthrough(
  repositoryRoot: string,
  failures: string[],
): Promise<void> {
  const sources = [
    "src/runtime/production-control-plane.ts",
    "src/config/control-plane-cli.ts",
  ];
  const names = new Set<string>();
  for (const source of sources) {
    let content: string;
    try {
      content = await readFile(join(repositoryRoot, source), "utf8");
    } catch {
      failures.push(`${source}:missing`);
      return;
    }
    for (const match of content.matchAll(/(?:environment|process\.env)\["(REAL_MING_[A-Z_]+)"\]/g)) {
      names.add(match[1]!);
    }
  }
  let unit: string;
  try {
    unit = await readFile(
      join(repositoryRoot, "deploy/systemd/real-ming.service"),
      "utf8",
    );
  } catch {
    return; // Already reported by the unit inspection.
  }
  for (const name of [...names].sort()) {
    if (undeployedRuntimeEnvironment.has(name)) continue;
    if (unit.includes(`--env ${name}`)) continue;
    failures.push(`deploy/systemd/real-ming.service:unpassed-env:${name}`);
  }
}

/** Verify the deployment package that `npm run check` is about to ship. */
export async function verifyControlPlaneDeployment(
  repositoryRoot: string,
): Promise<DeploymentPreflightResult> {
  const failures: string[] = [];
  await inspect(
    repositoryRoot,
    "Dockerfile",
    [
      ["non-root-runtime", "USER node"],
      ["production-entrypoint", 'CMD ["node", "dist/config/control-plane-cli.js"]'],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/systemd/hermes.service",
    [
      ["api-server-command", "gateway run --external-supervisor --quiet"],
      ["hermes-home", "Environment=HERMES_HOME=/var/lib/hermes-real-ming"],
      ["isolated-hermes-state", "StateDirectory=hermes-real-ming"],
      ["loopback-only", "Environment=API_SERVER_HOST=127.0.0.1"],
      ["api-server-port", "Environment=API_SERVER_PORT=8642"],
      ["native-obsidian-vault", "Environment=OBSIDIAN_VAULT_PATH=/var/lib/hermes-real-ming/obsidian-vault"],
      ["api-key-file", "EnvironmentFile=/etc/real-ming/hermes.env"],
      ["restart-policy", "Restart=always"],
      ["unprivileged", "User=real-ming"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/systemd/hermes-dashboard.service",
    [
      ["dashboard-command", "hermes dashboard --host 127.0.0.1 --port 9119 --skip-build --no-open"],
      ["dashboard-loopback-only", "--host 127.0.0.1"],
      ["dashboard-port", "--port 9119"],
      ["hermes-home", "Environment=HERMES_HOME=/var/lib/hermes-real-ming"],
      ["native-obsidian-vault", "Environment=OBSIDIAN_VAULT_PATH=/var/lib/hermes-real-ming/obsidian-vault"],
      ["requires-gateway", "Requires=hermes.service"],
      ["restart-policy", "Restart=always"],
      ["unprivileged", "User=real-ming"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "hermes/config.native-first.example.yaml",
    [
      ["native-memory-enabled", "memory_enabled: true"],
      ["user-profile-enabled", "user_profile_enabled: true"],
      ["memory-write-approval", "write_approval: true"],
      ["native-vault-path", "/var/lib/hermes-real-ming/obsidian-vault"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "hermes/deploy-skills.sh",
    [
      ["native-vault-absolute-check", "OBSIDIAN_VAULT_PATH must be an absolute path."],
      ["native-vault-directory", "obsidian_vault_path"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/systemd/real-ming.service",
    [
      ["restart-policy", "Restart=always"],
      ["persistent-state", "--volume /var/lib/real-ming:/var/lib/real-ming"],
      ["obsidian-state", "/var/lib/real-ming/obsidian"],
      ["vault-identity", "REAL_MING_AZURE_KEY_VAULT_NAME=real-ming-vault"],
      ["immutable-release", "${REAL_MING_IMAGE}"],
      ["release-binding", "EnvironmentFile=/etc/real-ming/release.env"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/systemd/real-ming-backup.service",
    [
      ["boot-ordering", "After=hermes.service hermes-dashboard.service real-ming.service"],
      ["root-owned-helper", "/usr/local/libexec/real-ming-backup"],
      ["release-binding", "EnvironmentFile=/etc/real-ming/release.env"],
      // The backup stops the control plane. These two are what guarantee it
      // comes back: a bounded start, and a restart that runs however the
      // backup ended -- including killed on timeout.
      ["bounded-start", "TimeoutStartSec="],
      ["unconditional-restart", "ExecStopPost=-/usr/bin/systemctl --no-block start hermes.service hermes-dashboard.service real-ming.service"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/backup-control-plane.sh",
    [
      ["detect-running-service", "systemctl is-active --quiet real-ming.service"],
      ["quiesce-writes", "systemctl stop real-ming.service"],
      // Bash skips an EXIT trap when it dies on an untrapped signal, so the
      // signals must be named or a systemd timeout strands the service.
      ["restart-on-exit", "trap cleanup_and_restart EXIT INT TERM"],
      ["bounded-container-run", "timeout --signal=TERM"],
      ["run-live-backup", "control-plane-backup-cli.js --live"],
      ["immutable-release", "${REAL_MING_IMAGE}"],
      ["operations-state", "REAL_MING_STATE_PATH=/var/lib/real-ming/state.sqlite"],
      ["notion-ledger", "REAL_MING_NOTION_LEDGER_PATH=/var/lib/real-ming/notion-write-ledger.sqlite"],
      ["hermes-session-store", "REAL_MING_HERMES_SESSIONS_PATH=/var/lib/real-ming/hermes.sqlite"],
      ["quiesce-hermes-writes", "systemctl stop hermes.service"],
      ["quiesce-dashboard-writes", "systemctl stop hermes-dashboard.service"],
      ["stage-hermes-native-state", "hermes-native.snapshot"],
      ["hermes-native-state", "REAL_MING_HERMES_NATIVE_STATE_PATH=/var/lib/real-ming/hermes-native.snapshot"],
      ["native-state-whitelist", "hermes_native_sqlite_files=("],
      ["native-profile-whitelist", "hermes_native_document_files=("],
      ["native-state-checkpoint", "PRAGMA wal_checkpoint(TRUNCATE)"],
      ["native-state-integrity", "PRAGMA quick_check"],
      ["native-state-required", "Hermes native state.db was not available for backup."],
      ["stage-hermes-native-vault", "hermes-vault.snapshot"],
      ["hermes-native-vault", "REAL_MING_HERMES_VAULT_PATH=/var/lib/real-ming/hermes-vault.snapshot"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/azure/prepare-malaysia-host.sh",
    [
      ["native-restore-whitelist", "allowed_native = {"],
      ["native-restore-integrity-scope", "hermes-native/state.db|hermes-native/kanban.db"],
      ["native-restore-safe-destination", "destination=\"${hermes_home}/${relative}\""],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/verify-deployment.sh",
    [
      ["repository-gates", "npm run check"],
      ["container-build", "docker build"],
      // The smoke CLI without --live only proves the file exists. What must be
      // asserted is that the production composition actually loads in the image.
      ["container-composition-load", "production-control-plane.js"],
      ["browser-dependency", "playwright install --with-deps chromium"],
      ["unit-validation", "systemd-analyze verify"],
      ["immutable-image-evidence", "docker image inspect"],
    ],
    failures,
  );
  await inspect(
    repositoryRoot,
    "deploy/systemd/real-ming-backup.timer",
    [
      ["daily-schedule", "OnCalendar=*-*-* 03:15:00 Asia/Kuala_Lumpur"],
      ["missed-run-recovery", "Persistent=true"],
    ],
    failures,
  );
  await verifyContainerEnvironmentPassthrough(repositoryRoot, failures);
  return failures.length === 0
    ? { kind: "passed", failures: [] }
    : { kind: "failed", failures };
}
