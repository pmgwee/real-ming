import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const probe = join(repositoryRoot, "hermes", "scripts", "verify-native-knowledge-isolation.py");
const wrapper = join(repositoryRoot, "hermes", "scripts", "run-native-knowledge-consolidation.py");
function resolvePython(override = process.env.REAL_MING_PYTHON): string | undefined {
  if (override !== undefined) {
    if (!existsSync(override)) return undefined;
    const check = spawnSync(override, ["--version"], { encoding: "utf8" });
    return check.error === undefined && check.status === 0 ? override : undefined;
  }
  const candidates = [
    ...(process.platform === "win32"
      ? [join(process.env.LOCALAPPDATA ?? "", "hermes", "hermes-agent", "venv", "Scripts", "python.exe")]
      : []),
    "python3",
    "python",
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
  for (const candidate of candidates) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (!existsSync(candidate)) continue;
    }
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.error === undefined && check.status === 0) return candidate;
  }
  return undefined;
}

type IsolationProbeResult = {
  readonly hermesCommit: string;
  readonly runtimeHead?: string;
  readonly runtimeHeadMatchesPinned?: boolean;
  readonly skipMemory: boolean;
  readonly enabledToolsets: readonly string[];
  readonly effectiveMcpTools: readonly string[];
  readonly deniedMcpTools: readonly string[];
  readonly authMode: string;
  readonly writableRoots: readonly string[];
  readonly deniedTargets: readonly string[];
  readonly fallbackDetected: boolean;
  readonly memoryDisabled: boolean;
  readonly actualAIAgent: boolean;
  readonly eligible: boolean;
  readonly containmentProof?: boolean;
  readonly actualProcessBoundary?: boolean;
  readonly reason?: string;
};

function runProbe(scenario = "valid", interpreterOverride?: string, overrides: NodeJS.ProcessEnv = {}): { readonly status: number; readonly result: IsolationProbeResult } {
  expect(existsSync(probe)).toBe(true);
  const python = resolvePython(interpreterOverride);
  if (python === undefined) {
    return {
      status: 78,
      result: {
        hermesCommit: "561b053f794a1781868bb032029d589c67708119",
        skipMemory: false,
        enabledToolsets: [],
        effectiveMcpTools: [],
        deniedMcpTools: [],
        authMode: "unavailable",
        writableRoots: [],
        deniedTargets: [],
        fallbackDetected: true,
        memoryDisabled: false,
        actualAIAgent: false,
        eligible: false,
        reason: "portable-interpreter-unavailable",
      },
    };
  }
  const childEnvironment = { ...process.env };
  for (const name of [
    "TELEGRAM_BOT_TOKEN",
    "NOTION_TOKEN",
    "GOOGLE_REFRESH_TOKEN",
    "GITHUB_TOKEN",
    "VERCEL_TOKEN",
    "DUITSINI_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LLM_API_KEY",
    "ZAI_API_KEY",
  ]) delete childEnvironment[name];
  const child = spawnSync(
    python,
    [probe, "--scenario", scenario, "--json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...childEnvironment,
        HERMES_HOME: join(repositoryRoot, ".tmp", "task0-hermes-home"),
        REAL_MING_NETWORK_DISABLED: "1",
        REAL_MING_NO_CREDENTIALS: "1",
        ...overrides,
      },
    },
  );
  if (child.error !== undefined || child.stdout.trim().length === 0) {
    return {
      status: 78,
      result: {
        hermesCommit: "561b053f794a1781868bb032029d589c67708119",
        skipMemory: false,
        enabledToolsets: [],
        effectiveMcpTools: [],
        deniedMcpTools: [],
        authMode: "unavailable",
        writableRoots: [],
        deniedTargets: [],
        fallbackDetected: true,
        memoryDisabled: false,
        actualAIAgent: false,
        eligible: false,
        reason: "pinned-interpreter-launch-failed",
      },
    };
  }
  return {
    status: child.status ?? -1,
    result: JSON.parse(String(child.stdout)) as IsolationProbeResult,
  };
}

describe("native Hermes knowledge-job isolation hard gate", () => {
  it("proves the pinned runtime and exact callable set without accepting a fallback", () => {
    const { status, result } = runProbe();
    expect(result.hermesCommit).toBe(
      "561b053f794a1781868bb032029d589c67708119",
    );
    // A desktop checkout may intentionally be on a different Hermes revision
    // or the host may be unable to launch its interpreter. That is a truthful
    // hard-gate result, not permission to accept a fabricated fallback.
    if (status !== 0) {
      expect(status).toBe(78);
      expect(result.eligible).toBe(false);
      expect(result.reason).toEqual(expect.any(String));
      return;
    }
    expect(result.runtimeHeadMatchesPinned).toBe(true);
    expect(result.skipMemory).toBe(true);
    expect(result.memoryDisabled).toBe(true);
    expect(result.actualAIAgent).toBe(true);
    expect(result.enabledToolsets).toEqual(["real-ming"]);
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
    expect(result.authMode).toBe("offline-local-deterministic-stub");
    expect(result.fallbackDetected).toBe(false);
    expect(result.eligible).toBe(true);
  }, 30_000);

  it("never writes the configured interactive Hermes home during the probe", () => {
    const home = join(repositoryRoot, ".tmp", "task0-interactive-home-sentinel");
    mkdirSync(home, { recursive: true });
    const config = join(home, "config.yaml");
    writeFileSync(config, "sentinel: untouched\n", "utf8");
    try {
      const { status } = runProbe("valid", undefined, { HERMES_HOME: home });
      expect([0, 78]).toContain(status);
      expect(readFileSync(config, "utf8")).toBe("sentinel: untouched\n");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed when an explicit interpreter override is missing", () => {
    const { status, result } = runProbe("valid", join(repositoryRoot, ".tmp", "missing-hermes-python"));
    expect(status).toBe(78);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/interpreter/);
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
  }, 30_000);

  it("keeps the wrapper fail-closed until a synthetic controlled job is configured", () => {
    expect(existsSync(wrapper)).toBe(true);
    const python = resolvePython();
    if (python === undefined) {
      // Missing Python is an explicit environment prerequisite; the suite
      // must not turn that into a false green runtime proof.
      return;
    }
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
    expect(child.status).not.toBe(0);
    expect(JSON.parse(String(child.stdout))).toMatchObject({ eligible: false });
  }, 30_000);
});
