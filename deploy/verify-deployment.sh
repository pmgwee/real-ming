#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run check
npm audit --audit-level=high
docker build --tag real-ming:tracer-1 .
docker run --rm real-ming:tracer-1 \
  node dist/config/control-plane-smoke-cli.js
systemd-analyze verify \
  "$(pwd)/deploy/systemd/real-ming.service" \
  "$(pwd)/deploy/systemd/real-ming-backup.service" \
  "$(pwd)/deploy/systemd/real-ming-backup.timer"
docker image inspect real-ming:tracer-1 --format '{{.Id}}'
