#!/usr/bin/env bash
set -euo pipefail

# Export the reviewed Phase 4 image and the exact deployment assets from the
# source VM to the private recovery container. No credential material is
# included; Azure Managed Identity is used only in memory for each upload.

readonly image_ref="${REAL_MING_SOURCE_IMAGE:-real-ming:phase4-af75e3c}"
readonly expected_image_id="${REAL_MING_EXPECTED_IMAGE_ID:-sha256:6b4bef97bfadb79e34fbe1af9a76f4f2d6e33ba2ab135640084e7db13ca2b5a4}"
readonly expected_commit="${REAL_MING_EXPECTED_COMMIT:-af75e3c53e6a3befee56595eeee557dc5ddb5dd4}"
readonly release_repo="${REAL_MING_RELEASE_REPO:-/opt/real-ming-af75e3c}"
readonly storage_account="${REAL_MING_BACKUP_STORAGE_ACCOUNT:-realmingbk09041708}"
readonly storage_container="${REAL_MING_BACKUP_STORAGE_CONTAINER:-real-ming-backups}"
readonly blob_prefix="${REAL_MING_MIGRATION_BLOB_PREFIX:-migration/phase4-af75e3c}"
readonly work_directory="${REAL_MING_MIGRATION_WORK_DIRECTORY:-/var/lib/real-ming/migration/phase4-af75e3c}"
readonly backup_helper="/usr/local/libexec/real-ming-backup"
readonly unit_directory="/etc/systemd/system"

readonly image_archive="${work_directory}/real-ming-phase4-af75e3c.tar.gz"
readonly bundle_archive="${work_directory}/real-ming-deploy-af75e3c.tar.gz"
readonly migration_manifest="${work_directory}/migration-manifest.json"

metadata_token() {
  local resource="$1"
  curl --fail --silent --show-error \
    -H Metadata:true \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${resource}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}

upload_blob() {
  local source_path="$1"
  local blob_name="$2"
  local content_type="$3"
  local token request_date

  token="$(metadata_token 'https%3A%2F%2Fstorage.azure.com%2F')"
  request_date="$(LC_ALL=C TZ=GMT date '+%a, %d %b %Y %H:%M:%S GMT')"
  curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --request PUT \
    --upload-file "${source_path}" \
    -H "Authorization: Bearer ${token}" \
    -H "x-ms-date: ${request_date}" \
    -H 'x-ms-version: 2023-11-03' \
    -H 'x-ms-blob-type: BlockBlob' \
    -H "Content-Type: ${content_type}" \
    "https://${storage_account}.blob.core.windows.net/${storage_container}/${blob_name}"
  unset token
}

main() {
  install -d -m 0700 "${work_directory}"

  local actual_image_id actual_commit bundle_root image_sha bundle_sha
  actual_image_id="$(docker image inspect "${image_ref}" --format '{{.Id}}')"
  if [[ "${actual_image_id}" != "${expected_image_id}" ]]; then
    printf 'Candidate image mismatch: expected %s, found %s\n' \
      "${expected_image_id}" "${actual_image_id}" >&2
    exit 1
  fi

  actual_commit="$(git -c safe.directory="${release_repo}" -C "${release_repo}" rev-parse HEAD)"
  if [[ "${actual_commit}" != "${expected_commit}" ]]; then
    printf 'Release checkout mismatch: expected %s, found %s\n' \
      "${expected_commit}" "${actual_commit}" >&2
    exit 1
  fi

  cat <<'EOF' | sha256sum --check --strict
ecadb877ab6efd422428baf2f062e24c38b1b1ff3df8e7452ceee947e4feb369  /usr/local/libexec/real-ming-backup
e559348bf1061eb17b1b66c35781d38885ce4f1a42d9f64673781ed26f3a5444  /etc/systemd/system/hermes.service
765c725f9358c673aecfd5c985e6713fd68e94d80e43b8b87bd6c7a4393f5ab8  /etc/systemd/system/real-ming.service
4953bf99050ba56411708041c54a10d3133c730e0fadbd9c7c26f45eb6a3b106  /etc/systemd/system/real-ming-backup.service
eb912a338a5048602a03cbfdd6e7653c34583bf85c2298085b7572e526bcf861  /etc/systemd/system/real-ming-backup.timer
EOF

  rm -f -- "${image_archive}.partial" "${bundle_archive}.partial"
  docker save "${image_ref}" | gzip -1 > "${image_archive}.partial"
  gzip -t "${image_archive}.partial"
  mv -f -- "${image_archive}.partial" "${image_archive}"

  bundle_root="$(mktemp -d)"
  install -d "${bundle_root}/deploy/systemd"
  install -m 0755 "${backup_helper}" \
    "${bundle_root}/deploy/backup-control-plane.sh"
  install -m 0644 "${unit_directory}/hermes.service" \
    "${bundle_root}/deploy/systemd/hermes.service"
  install -m 0644 "${unit_directory}/real-ming.service" \
    "${bundle_root}/deploy/systemd/real-ming.service"
  install -m 0644 "${unit_directory}/real-ming-backup.service" \
    "${bundle_root}/deploy/systemd/real-ming-backup.service"
  install -m 0644 "${unit_directory}/real-ming-backup.timer" \
    "${bundle_root}/deploy/systemd/real-ming-backup.timer"
  printf '%s\n' "${actual_commit}" > "${bundle_root}/commit.txt"
  (
    cd "${bundle_root}"
    sha256sum \
      deploy/backup-control-plane.sh \
      deploy/systemd/hermes.service \
      deploy/systemd/real-ming.service \
      deploy/systemd/real-ming-backup.service \
      deploy/systemd/real-ming-backup.timer \
      > assets-sha256.txt
  )
  tar -C "${bundle_root}" -czf "${bundle_archive}.partial" .
  mv -f -- "${bundle_archive}.partial" "${bundle_archive}"
  rm -rf -- "${bundle_root}"

  image_sha="$(sha256sum "${image_archive}" | awk '{print $1}')"
  bundle_sha="$(sha256sum "${bundle_archive}" | awk '{print $1}')"
  python3 - "${migration_manifest}" "${expected_commit}" \
    "${expected_image_id}" "${image_sha}" "${bundle_sha}" <<'PY'
import json
import sys

path, commit, image_id, image_sha, bundle_sha = sys.argv[1:]
with open(path, "w", encoding="utf-8") as handle:
    json.dump(
        {
            "schemaVersion": 1,
            "commit": commit,
            "imageId": image_id,
            "imageArchive": "real-ming-phase4-af75e3c.tar.gz",
            "imageArchiveSha256": image_sha,
            "deploymentBundle": "real-ming-deploy-af75e3c.tar.gz",
            "deploymentBundleSha256": bundle_sha,
        },
        handle,
        indent=2,
        sort_keys=True,
    )
    handle.write("\n")
PY

  upload_blob "${image_archive}" "${blob_prefix}/$(basename "${image_archive}")" \
    application/gzip
  upload_blob "${bundle_archive}" "${blob_prefix}/$(basename "${bundle_archive}")" \
    application/gzip
  # Publish the manifest last so a visible manifest always represents a
  # complete, checksum-addressable migration generation.
  upload_blob "${migration_manifest}" "${blob_prefix}/migration-manifest.json" \
    application/json

  printf 'MIGRATION_EXPORT_STATUS=complete\n'
  printf 'COMMIT=%s\n' "${actual_commit}"
  printf 'IMAGE_ID=%s\n' "${actual_image_id}"
  printf 'IMAGE_ARCHIVE_SHA256=%s\n' "${image_sha}"
  printf 'DEPLOYMENT_BUNDLE_SHA256=%s\n' "${bundle_sha}"
}

main "$@"
