#!/usr/bin/env bash
set -euo pipefail

control_plane_was_active=false

restart_control_plane() {
  if [[ "${control_plane_was_active}" == "true" ]]; then
    systemctl start real-ming.service
  fi
}

# EXIT alone is not enough: bash skips an EXIT trap when it dies on an
# untrapped signal, so a systemd timeout would kill this script and leave the
# control plane stopped. Trapping the signals makes the restart unconditional.
trap restart_control_plane EXIT INT TERM

if systemctl is-active --quiet real-ming.service; then
  control_plane_was_active=true
  systemctl stop real-ming.service
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
  --env REAL_MING_LOCAL_BACKUP_DIRECTORY=/var/lib/real-ming/backups \
  --env REAL_MING_BACKUP_STORAGE_ACCOUNT \
  --env REAL_MING_BACKUP_STORAGE_CONTAINER \
  "${REAL_MING_IMAGE}" \
  node dist/config/control-plane-backup-cli.js --live
