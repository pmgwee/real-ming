#!/usr/bin/env bash
set -euo pipefail

control_plane_was_active=false
hermes_was_active=false
hermes_dashboard_was_active=false
hermes_native_snapshot_path=/var/lib/real-ming/hermes-native.snapshot
hermes_vault_snapshot_path=/var/lib/real-ming/hermes-vault.snapshot

cleanup_and_restart() {
  rm -rf -- "${hermes_native_snapshot_path}"
  rm -rf -- "${hermes_vault_snapshot_path}"
  if [[ "${hermes_was_active}" == "true" ]]; then
    systemctl start hermes.service
  fi
  if [[ "${hermes_dashboard_was_active}" == "true" ]]; then
    systemctl start hermes-dashboard.service
  fi
  if [[ "${control_plane_was_active}" == "true" ]]; then
    systemctl start real-ming.service
  fi
}

# EXIT alone is not enough: bash skips an EXIT trap when it dies on an
# untrapped signal, so a systemd timeout would kill this script and leave the
# control plane stopped. Trapping the signals makes the restart unconditional.
trap cleanup_and_restart EXIT INT TERM

if systemctl is-active --quiet real-ming.service; then
  control_plane_was_active=true
  systemctl stop real-ming.service
fi

# The dashboard can mutate Hermes configuration through its authenticated UI.
# Quiesce it before taking the native state snapshot, then restore its prior
# state in the EXIT trap.
if systemctl is-active --quiet hermes-dashboard.service; then
  hermes_dashboard_was_active=true
  systemctl stop hermes-dashboard.service
fi

# Hermes owns a separate 0700 host directory so the container UID cannot read
# its OAuth material. Stop it briefly, then stage only its closed SQLite state
# inside the already-mounted Real-Ming directory for the backup container.
if systemctl is-active --quiet hermes.service; then
  hermes_was_active=true
  systemctl stop hermes.service
fi

# Hermes keeps more durable state than its conversation database. Checkpoint
# every whitelisted SQLite store while the service is stopped, then copy only
# those stores plus the profile/session documents. Never copy the whole
# HERMES_HOME: auth.json, .env, config, caches and logs contain credentials or
# machine-specific material that must not enter the recovery set.
install -d -o 1000 -g 1000 -m 0700 "${hermes_native_snapshot_path}"
hermes_native_sqlite_files=(
  state.db
  kanban.db
  cron/executions.db
  response_store.db
  verification_evidence.db
  runs_idempotency.db
  projects.db
)
hermes_native_document_files=(
  sessions/sessions.json
  memories/USER.md
  memories/MEMORY.md
)
for relative in "${hermes_native_sqlite_files[@]}"; do
  source_path="/var/lib/hermes-real-ming/${relative}"
  if [[ ! -e "${source_path}" ]]; then
    continue
  fi
  if [[ -L "${source_path}" || ! -f "${source_path}" ]]; then
    printf 'Unsupported native Hermes state entry: %s\n' "${relative}" >&2
    exit 1
  fi
  sqlite3 "${source_path}" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
  sqlite3 "${source_path}" 'PRAGMA quick_check;' | grep -qx ok
  destination_path="${hermes_native_snapshot_path}/${relative}"
  install -d -o 1000 -g 1000 -m 0700 "$(dirname -- "${destination_path}")"
  install -o 1000 -g 1000 -m 0600 "${source_path}" "${destination_path}"
done
for relative in "${hermes_native_document_files[@]}"; do
  source_path="/var/lib/hermes-real-ming/${relative}"
  if [[ ! -e "${source_path}" ]]; then
    continue
  fi
  if [[ -L "${source_path}" || ! -f "${source_path}" ]]; then
    printf 'Unsupported native Hermes state entry: %s\n' "${relative}" >&2
    exit 1
  fi
  destination_path="${hermes_native_snapshot_path}/${relative}"
  install -d -o 1000 -g 1000 -m 0700 "$(dirname -- "${destination_path}")"
  install -o 1000 -g 1000 -m 0600 "${source_path}" "${destination_path}"
done
if [[ ! -f "${hermes_native_snapshot_path}/state.db" ]]; then
  echo 'Hermes native state.db was not available for backup.' >&2
  exit 1
fi
if [[ -d /var/lib/hermes-real-ming/obsidian-vault ]]; then
  # Hermes is stopped above, so the snapshot cannot race an in-flight note
  # write. The backup container receives only this copy, never Hermes' home.
  cp -a --no-preserve=ownership \
    /var/lib/hermes-real-ming/obsidian-vault "${hermes_vault_snapshot_path}"
  chown -R 1000:1000 "${hermes_vault_snapshot_path}"
  chmod 0700 "${hermes_vault_snapshot_path}"
fi

# A bounded run, so a stalled upload cannot hold the service down all night.
timeout --signal=TERM --kill-after=60s 20m /usr/bin/docker run --rm \
  --network host \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --volume /var/lib/real-ming:/var/lib/real-ming \
  --env REAL_MING_STATE_PATH=/var/lib/real-ming/state.sqlite \
  --env REAL_MING_NOTION_LEDGER_PATH=/var/lib/real-ming/notion-write-ledger.sqlite \
  --env REAL_MING_HERMES_SESSIONS_PATH=/var/lib/real-ming/hermes.sqlite \
  --env REAL_MING_HERMES_NATIVE_STATE_PATH=/var/lib/real-ming/hermes-native.snapshot \
  --env REAL_MING_HERMES_VAULT_PATH=/var/lib/real-ming/hermes-vault.snapshot \
  --env REAL_MING_LOCAL_BACKUP_DIRECTORY=/var/lib/real-ming/backups \
  --env REAL_MING_BACKUP_STORAGE_ACCOUNT \
  --env REAL_MING_BACKUP_STORAGE_CONTAINER \
  "${REAL_MING_IMAGE}" \
  node dist/config/control-plane-backup-cli.js --live
