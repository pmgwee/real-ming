#!/usr/bin/env bash
set -euo pipefail

# Deploy Ming's Hermes configuration pack to the control plane.
#
# Copies only version-controlled, secret-free files. It never reads or writes
# .env, auth.json, or any credential material, so it is safe to re-run.

readonly hermes_home="${HERMES_HOME:-/var/lib/hermes-real-ming}"
readonly service_account="${HERMES_SERVICE_ACCOUNT:-real-ming}"
readonly source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -d "${hermes_home}" ]]; then
  echo "Hermes home ${hermes_home} not found." >&2
  exit 1
fi

# The shipped SOUL.md is replaced, not appended to: Ming's version already
# carries the upstream guidance plus his own. Keep the previous one once, so a
# bad edit is one copy away from being undone.
if [[ -f "${hermes_home}/SOUL.md" && ! -f "${hermes_home}/SOUL.md.pre-ming" ]]; then
  cp -p "${hermes_home}/SOUL.md" "${hermes_home}/SOUL.md.pre-ming"
fi
install -o "${service_account}" -g "${service_account}" -m 0644 \
  "${source_root}/SOUL.md" "${hermes_home}/SOUL.md"

# Ming's skills live in their own namespace so a Hermes update that refreshes
# the bundled skill tree cannot overwrite them, and so `hermes skills
# list-modified` never reports them as edited upstream skills.
for skill_path in "${source_root}"/skills/ming/*/; do
  skill_name="$(basename "${skill_path}")"
  destination="${hermes_home}/skills/ming/${skill_name}"
  install -d -o "${service_account}" -g "${service_account}" -m 0755 "${destination}"
  install -o "${service_account}" -g "${service_account}" -m 0644 \
    "${skill_path}SKILL.md" "${destination}/SKILL.md"
  echo "deployed skill: ming/${skill_name}"
done

echo "deployed SOUL.md and $(find "${source_root}/skills/ming" -name SKILL.md | wc -l) skill(s) to ${hermes_home}"
