import { defineConfig } from "vitest/config";

/**
 * The pinned-Hermes isolation tests intentionally launch real local Python
 * subprocesses and apply disposable ACLs. A single fork keeps those tests
 * deterministic on the supported Windows/Linux service hosts and avoids
 * exhausting worker resources; it does not skip or weaken any assertion.
 */
export default defineConfig({
  test: {
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
