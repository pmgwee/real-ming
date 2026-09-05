#!/usr/bin/env bash
set -euo pipefail

# Prepare the Malaysia West replacement host without starting either Telegram
# owner. The script restores a verified state generation, imports the exact
# reviewed image, installs the pinned Hermes release, and stages systemd.

readonly expected_image_id="${REAL_MING_EXPECTED_IMAGE_ID:-sha256:6b4bef97bfadb79e34fbe1af9a76f4f2d6e33ba2ab135640084e7db13ca2b5a4}"
readonly expected_commit="${REAL_MING_EXPECTED_COMMIT:-af75e3c53e6a3befee56595eeee557dc5ddb5dd4}"
readonly hermes_commit="${REAL_MING_HERMES_COMMIT:-561b053f794a1781868bb032029d589c67708119}"
readonly hermes_install_directory="/opt/hermes-agent-561b053f"
readonly hermes_home="/var/lib/hermes-real-ming"
readonly storage_account="${REAL_MING_BACKUP_STORAGE_ACCOUNT:-realmingbk09041708}"
readonly storage_container="${REAL_MING_BACKUP_STORAGE_CONTAINER:-real-ming-backups}"
readonly blob_prefix="${REAL_MING_MIGRATION_BLOB_PREFIX:-migration/phase4-af75e3c}"
readonly backup_generation="${REAL_MING_RESTORE_GENERATION:-2026-09-04T17-11-44.756Z}"
readonly work_directory="/var/lib/real-ming/migration/phase4-af75e3c"
readonly release_directory="/opt/real-ming-release-af75e3c"

metadata_token() {
  local resource="$1"
  curl --fail --silent --show-error \
    -H Metadata:true \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${resource}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}

download_blob() {
  local blob_name="$1"
  local destination="$2"
  local token request_date

  token="$(metadata_token 'https%3A%2F%2Fstorage.azure.com%2F')"
  request_date="$(LC_ALL=C TZ=GMT date '+%a, %d %b %Y %H:%M:%S GMT')"
  curl --fail --silent --show-error --retry 5 --retry-all-errors \
    -H "Authorization: Bearer ${token}" \
    -H "x-ms-date: ${request_date}" \
    -H 'x-ms-version: 2023-11-03' \
    "https://${storage_account}.blob.core.windows.net/${storage_container}/${blob_name}" \
    --output "${destination}.partial"
  unset token
  mv -f -- "${destination}.partial" "${destination}"
}

install_host_dependencies() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl docker.io git gzip jq libffi-dev \
    libssl-dev python3 python3-dev sqlite3 tar
  systemctl enable --now docker.service
}

install_hermes() {
  if id real-ming >/dev/null 2>&1; then
    usermod --home "${hermes_home}" real-ming
  else
    useradd --system --create-home --home-dir "${hermes_home}" real-ming
  fi
  install -d -o real-ming -g real-ming -m 0700 "${hermes_home}"

  if [[ ! -x "${hermes_install_directory}/venv/bin/hermes" ]]; then
    if [[ -e "${hermes_install_directory}" && ! -d "${hermes_install_directory}/.git" ]]; then
      mv "${hermes_install_directory}" \
        "${hermes_install_directory}.incomplete-$(date -u +%Y%m%d-%H%M%S)"
    fi
    rm -f /tmp/hermes-install.sh
    curl --fail --silent --show-error --location \
      https://hermes-agent.nousresearch.com/install.sh \
      --output /tmp/hermes-install.sh
    UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python \
    UV_PYTHON_BIN_DIR=/usr/local/share/uv/bin \
    bash /tmp/hermes-install.sh \
      --skip-setup \
      --skip-computer-use \
      --dir "${hermes_install_directory}" \
      --hermes-home "${hermes_home}" \
      --branch main \
      --commit "${hermes_commit}"
  fi

  local actual_hermes_commit
  actual_hermes_commit="$(git -c safe.directory="${hermes_install_directory}" \
    -C "${hermes_install_directory}" rev-parse HEAD)"
  if [[ "${actual_hermes_commit}" != "${hermes_commit}" ]]; then
    printf 'Hermes checkout mismatch: expected %s, found %s\n' \
      "${hermes_commit}" "${actual_hermes_commit}" >&2
    exit 1
  fi
  chown -R real-ming:real-ming "${hermes_install_directory}" "${hermes_home}"
  ln -sfn "${hermes_install_directory}/venv/bin/hermes" /usr/local/bin/hermes
  sudo -u real-ming env HOME="${hermes_home}" HERMES_HOME="${hermes_home}" \
    /usr/local/bin/hermes --version
  sudo -u real-ming env HOME="${hermes_home}" HERMES_HOME="${hermes_home}" \
    /usr/local/bin/hermes gateway run --help >/dev/null
}

import_candidate_and_assets() {
  install -d -m 0700 "${work_directory}"
  download_blob "${blob_prefix}/migration-manifest.json" \
    "${work_directory}/migration-manifest.json"

  local image_name bundle_name image_sha bundle_sha manifest_commit manifest_image_id
  readarray -t migration_values < <(python3 - "${work_directory}/migration-manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for key in (
    "imageArchive",
    "deploymentBundle",
    "imageArchiveSha256",
    "deploymentBundleSha256",
    "commit",
    "imageId",
):
    print(data[key])
PY
  )
  image_name="${migration_values[0]}"
  bundle_name="${migration_values[1]}"
  image_sha="${migration_values[2]}"
  bundle_sha="${migration_values[3]}"
  manifest_commit="${migration_values[4]}"
  manifest_image_id="${migration_values[5]}"

  if [[ "${manifest_commit}" != "${expected_commit}" ]] || \
     [[ "${manifest_image_id}" != "${expected_image_id}" ]]; then
    echo 'Migration manifest does not identify the approved candidate.' >&2
    exit 1
  fi

  download_blob "${blob_prefix}/${image_name}" "${work_directory}/${image_name}"
  download_blob "${blob_prefix}/${bundle_name}" "${work_directory}/${bundle_name}"
  printf '%s  %s\n' "${image_sha}" "${work_directory}/${image_name}" | sha256sum --check --strict
  printf '%s  %s\n' "${bundle_sha}" "${work_directory}/${bundle_name}" | sha256sum --check --strict
  gzip -t "${work_directory}/${image_name}"

  rm -rf -- "${release_directory}.staging"
  install -d "${release_directory}.staging"
  tar -C "${release_directory}.staging" -xzf "${work_directory}/${bundle_name}"
  if [[ "$(tr -d '\r\n' < "${release_directory}.staging/commit.txt")" != "${expected_commit}" ]]; then
    echo 'Deployment bundle commit marker mismatch.' >&2
    exit 1
  fi
  (
    cd "${release_directory}.staging"
    sha256sum --check --strict assets-sha256.txt
  )
  rm -rf -- "${release_directory}"
  mv "${release_directory}.staging" "${release_directory}"

  gzip -dc "${work_directory}/${image_name}" | docker load
  docker tag "${expected_image_id}" real-ming:phase4-af75e3c
  local actual_image_id
  actual_image_id="$(docker image inspect real-ming:phase4-af75e3c --format '{{.Id}}')"
  if [[ "${actual_image_id}" != "${expected_image_id}" ]]; then
    printf 'Imported image mismatch: expected %s, found %s\n' \
      "${expected_image_id}" "${actual_image_id}" >&2
    exit 1
  fi
}

restore_state() {
  local restore_directory="${work_directory}/restore-${backup_generation}"
  rm -rf -- "${restore_directory}"
  install -d -m 0700 "${restore_directory}"
  download_blob "${backup_generation}/manifest.json" "${restore_directory}/manifest.json"

  mapfile -t backup_files < <(python3 - "${restore_directory}/manifest.json" "${backup_generation}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
if data.get("backupId") != sys.argv[2]:
    raise SystemExit("Backup generation mismatch")
allowed = {"state.sqlite", "notion-write-ledger.sqlite", "hermes.sqlite", "hermes-state.db"}
if not data.get("files"):
    raise SystemExit("Backup manifest has no files")
for item in data["files"]:
    if item.get("name") not in allowed:
        raise SystemExit(f'Unexpected backup member: {item.get("name")}')
    print(f'{item["name"]}\t{item["sha256"]}')
PY
  )

  local row name expected_sha
  for row in "${backup_files[@]}"; do
    IFS=$'\t' read -r name expected_sha <<< "${row}"
    download_blob "${backup_generation}/${name}" "${restore_directory}/${name}"
    printf '%s  %s\n' "${expected_sha}" "${restore_directory}/${name}" | \
      sha256sum --check --strict
    sqlite3 "${restore_directory}/${name}" 'PRAGMA quick_check;' | grep -qx ok
  done

  install -d -o 1000 -g 1000 -m 0700 \
    /var/lib/real-ming /var/lib/real-ming/backups /var/lib/real-ming/obsidian
  for row in "${backup_files[@]}"; do
    IFS=$'\t' read -r name expected_sha <<< "${row}"
    if [[ "${name}" == "hermes-state.db" ]]; then
      # The backup manifest uses a neutral artifact name, but Hermes must own
      # its native database inside its isolated 0700 home. Never place it in
      # the container-mounted Real-Ming directory beside the projection map.
      install -o real-ming -g real-ming -m 0600 \
        "${restore_directory}/${name}" "${hermes_home}/state.db"
    else
      install -o 1000 -g 1000 -m 0600 \
        "${restore_directory}/${name}" "/var/lib/real-ming/${name}"
    fi
  done
  install -o 1000 -g 1000 -m 0600 \
    "${restore_directory}/manifest.json" \
    "/var/lib/real-ming/backups/restored-${backup_generation}-manifest.json"
}

write_protected_configuration() {
  install -d -o root -g root -m 0700 /etc/real-ming
  local vault_token secret_value
  vault_token="$(metadata_token 'https%3A%2F%2Fvault.azure.net')"
  secret_value="$(curl --fail --silent --show-error \
    -H "Authorization: Bearer ${vault_token}" \
    'https://real-ming-vault.vault.azure.net/secrets/real-ming-hermes-api-key?api-version=7.4' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])')"
  unset vault_token
  if [[ "${#secret_value}" -lt 16 ]]; then
    echo 'Hermes bridge key was unavailable or too short.' >&2
    exit 1
  fi
  umask 077
  printf 'API_SERVER_KEY=%s\n' "${secret_value}" > /etc/real-ming/hermes.env
  unset secret_value

  cat > /etc/real-ming/release.env <<'EOF'
REAL_MING_IMAGE=real-ming:phase4-af75e3c
REAL_MING_HERMES_ENABLED=true
REAL_MING_HERMES_BASE_URL=http://127.0.0.1:8642
REAL_MING_HERMES_MODEL=gpt-5.6-sol
REAL_MING_HERMES_PROVIDER=openai-codex
REAL_MING_HERMES_REASONING=medium
REAL_MING_HERMES_SESSIONS_PATH=/var/lib/real-ming/hermes.sqlite
REAL_MING_OBSIDIAN_DIRECTORY=/var/lib/real-ming/obsidian
REAL_MING_OBSIDIAN_ROOTS=CEO
EOF
  cat > /etc/real-ming/backup.env <<EOF
REAL_MING_BACKUP_STORAGE_ACCOUNT=${storage_account}
REAL_MING_BACKUP_STORAGE_CONTAINER=${storage_container}
EOF
  chmod 0600 /etc/real-ming/hermes.env /etc/real-ming/release.env /etc/real-ming/backup.env
}

stage_services() {
  install -d -m 0755 /usr/local/libexec
  install -d -o root -g root -m 0755 /etc/systemd/system
  install -m 0755 "${release_directory}/deploy/backup-control-plane.sh" \
    /usr/local/libexec/real-ming-backup
  install -m 0644 "${release_directory}/deploy/systemd/hermes.service" \
    /etc/systemd/system/hermes.service
  install -m 0644 "${release_directory}/deploy/systemd/real-ming.service" \
    /etc/systemd/system/real-ming.service
  install -m 0644 "${release_directory}/deploy/systemd/real-ming-backup.service" \
    /etc/systemd/system/real-ming-backup.service
  # Stage the timer under a temporary regular filename before replacing the
  # final unit name. This also recovers cleanly from a dangling enablement
  # symlink left by a partially provisioned host.
  install -m 0644 "${release_directory}/deploy/systemd/real-ming-backup.timer" \
    /etc/systemd/system/real-ming-backup.timer.staged
  mv -f /etc/systemd/system/real-ming-backup.timer.staged \
    /etc/systemd/system/real-ming-backup.timer
  systemctl daemon-reload
  # Do not arm boot-time startup before OAuth and Telegram ownership cutover.
  # Activation enables these units only after the candidate is proven.
  systemctl disable hermes.service real-ming.service real-ming-backup.timer || true
  systemctl stop real-ming.service hermes.service || true
}

verify_prepared_host() {
  local listen_addresses
  listen_addresses="$(ss -H -lnt | awk '{print $4}' | grep -E '(:8642|:8787)$' || true)"
  if [[ -n "${listen_addresses}" ]]; then
    printf 'Unexpected pre-cutover listener:\n%s\n' "${listen_addresses}" >&2
    exit 1
  fi
  printf 'MALAYSIA_HOST_STATUS=prepared\n'
  printf 'COMMIT=%s\n' "${expected_commit}"
  printf 'IMAGE_ID=%s\n' "$(docker image inspect real-ming:phase4-af75e3c --format '{{.Id}}')"
  printf 'HERMES_COMMIT=%s\n' \
    "$(git -c safe.directory="${hermes_install_directory}" -C "${hermes_install_directory}" rev-parse HEAD)"
  printf 'RESTORE_GENERATION=%s\n' "${backup_generation}"
  printf 'REAL_MING_ACTIVE=%s\n' "$(systemctl is-active real-ming.service || true)"
  printf 'HERMES_ACTIVE=%s\n' "$(systemctl is-active hermes.service || true)"
}

main() {
  install_host_dependencies
  install_hermes
  import_candidate_and_assets
  restore_state
  write_protected_configuration
  stage_services
  verify_prepared_host
}

main "$@"
