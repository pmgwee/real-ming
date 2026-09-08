import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const probe = join(repositoryRoot, "hermes", "scripts", "verify-native-knowledge-isolation.py");
const wrapper = join(repositoryRoot, "hermes", "scripts", "run-native-knowledge-consolidation.py");
const hermesPython = join(
  process.env.LOCALAPPDATA ?? "",
  "hermes",
  "hermes-agent",
  "venv",
  "Scripts",
  "python.exe",
);
const python = process.env.REAL_MING_PYTHON ?? hermesPython;

type IsolationProbeResult = {
  readonly hermesCommit: string;
  readonly runtimeHead?: string;
  readonly skipMemory: boolean;
  readonly enabledToolsets: readonly string[];
  readonly effectiveMcpTools: readonly string[];
  readonly deniedMcpTools: readonly string[];
  readonly authMode: string;
  readonly writableRoots: readonly string[];
  readonly deniedTargets: readonly string[];
  readonly fallbackDetected: boolean;
  readonly eligible: boolean;
  readonly reason?: string;
};

function runProbe(scenario = "valid"): { readonly status: number; readonly result: IsolationProbeResult } {
  expect(existsSync(probe)).toBe(true);
  const child = spawnSync(
    python,
    [probe, "--scenario", scenario, "--json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HERMES_HOME: join(repositoryRoot, ".tmp", "task0-hermes-home"),
        REAL_MING_NETWORK_DISABLED: "1",
        REAL_MING_NO_CREDENTIALS: "1",
      },
    },
  );
  expect(child.error).toBeUndefined();
  return {
    status: child.status ?? -1,
    result: JSON.parse(String(child.stdout)) as IsolationProbeResult,
  };
}

describe("native Hermes knowledge-job isolation hard gate", () => {
  it("proves the pinned runtime and exact callable set without accepting a fallback", () => {
    const { status, result } = runProbe();

    expect(status).toBe(0);
    expect(result.hermesCommit).toBe(
      "561b053f794a1781868bb032029d589c67708119",
    );
    expect(result.skipMemory).toBe(true);
    expect(result.enabledToolsets).toEqual(["file"]);
    expect(result.effectiveMcpTools).toEqual([
      "real_ming_knowledge_list_candidates",
      "real_ming_read_knowledge_source",
      "real_ming_stage_knowledge_generation",
      "real_ming_wiki_retrieve",
    ]);
    expect(result.deniedMcpTools).toEqual([
      "real_ming_list_work_items",
      "real_ming_run_scheduled_report",
      "real_ming_list_calendar_events",
      "real_ming_search_mail",
      "real_ming_draft_email",
      "real_ming_create_calendar_event",
    ]);
    expect(result.authMode).toBe("offline-fake-local-no-credentials");
    expect(result.fallbackDetected).toBe(false);
    expect(result.eligible).toBe(true);
  });

  it.each([
    "missing-skip-memory",
    "unsupported-include",
    "extra-tool",
    "default-toolset",
    "missing-auth-separation",
    "os-escape",
  ])("rejects an ineligible isolation configuration: %s", (scenario) => {
    const { status, result } = runProbe(scenario);
    expect(status).toBe(78);
    expect(result.eligible).toBe(false);
    expect(result.reason).toEqual(expect.any(String));
  });

  it("keeps the proposed wrapper inactive unless controlled flags and a named auth profile are explicit", () => {
    expect(existsSync(wrapper)).toBe(true);
    const child = spawnSync(
      python,
      [wrapper, "--controlled"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HERMES_HOME: join(repositoryRoot, ".tmp", "task6-wrapper-hermes-home"),
          HERMES_SKIP_MEMORY: "1",
          HERMES_MCP_TOOLS: [
            "real_ming_knowledge_list_candidates",
            "real_ming_read_knowledge_source",
            "real_ming_stage_knowledge_generation",
            "real_ming_wiki_retrieve",
          ].join(","),
          HERMES_KNOWLEDGE_AUTH_PROFILE: "controlled-profile-name",
          REAL_MING_NETWORK_DISABLED: "1",
          REAL_MING_NO_CREDENTIALS: "1",
        },
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(String(child.stdout))).toMatchObject({
      eligible: true,
      mode: "controlled",
      commit: "561b053f794a1781868bb032029d589c67708119",
    });
  });
});
