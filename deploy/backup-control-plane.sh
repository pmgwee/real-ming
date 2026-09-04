#!/usr/bin/env bash
set -euo pipefail

control_plane_was_active=false
hermes_was_active=false
hermes_snapshot_path=/var/lib/real-ming/hermes-state.snapshot.db

cleanup_and_restart() {
  rm -f -- "${hermes_snapshot_path}"
  if [[ "${hermes_was_active}" == "true" ]]; then
    systemctl start hermes.service
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

# Hermes owns a separate 0700 host directory so the container UID cannot read
# its OAuth material. Stop it briefly, then stage only its closed SQLite state
# inside the already-mounted Real-Ming directory for the backup container.
if systemctl is-active --quiet hermes.service; then
  hermes_was_active=true
  systemctl stop hermes.service
fi
if [[ -f /var/lib/hermes-real-ming/state.db ]]; then
  install -o 1000 -g 1000 -m 0600 \
    /var/lib/hermes-real-ming/state.db "${hermes_snapshot_path}"
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
  --env REAL_MING_HERMES_STATE_PATH=/var/lib/real-ming/hermes-state.snapshot.db \
  --env REAL_MING_LOCAL_BACKUP_DIRECTORY=/var/lib/real-ming/backups \
  --env REAL_MING_BACKUP_STORAGE_ACCOUNT \
  --env REAL_MING_BACKUP_STORAGE_CONTAINER \
  "${REAL_MING_IMAGE}" \
  node dist/config/control-plane-backup-cli.js --live
