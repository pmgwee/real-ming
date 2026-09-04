#!/usr/bin/env bash
set -euo pipefail

npm ci

# AGENTS.md: npm run check runs a real browser test for the CEO dashboard and
# fails rather than skips when Chromium cannot launch. That is deliberate, but
# it means a freshly provisioned Ubuntu Server image -- which has none of the
# shared libraries Chromium needs -- halts this script at the first gate with
# what looks like a code failure. Install the browser rather than weakening the
# test.
npx playwright install --with-deps chromium

npm run check
npm audit --audit-level=high
docker build --tag real-ming:tracer-1 .

# Load the production composition inside the image. The previous line here ran
# the smoke CLI without --live, so it printed "skipped" and exited 0 whatever
# the image contained: it proved the file was present, not that it could load.
# A broken import, or a dependency removed by `npm prune --omit=dev`, would
# have reached Step 6B undetected. Importing the composition exercises the real
# module graph without starting the service or touching a provider.
docker run --rm real-ming:tracer-1 \
  node -e "import('./dist/runtime/production-control-plane.js').then(() => console.log('production composition loaded'), (error) => { console.error(error.message); process.exit(1); })"

# The live smoke test stays opt-in and is not run here; it needs credentials
# and an explicitly approved activation.
docker run --rm real-ming:tracer-1 \
  node dist/config/control-plane-smoke-cli.js

systemd-analyze verify \
  "$(pwd)/deploy/systemd/hermes.service" \
  "$(pwd)/deploy/systemd/real-ming.service" \
  "$(pwd)/deploy/systemd/real-ming-backup.service" \
  "$(pwd)/deploy/systemd/real-ming-backup.timer"
docker image inspect real-ming:tracer-1 --format '{{.Id}}'
