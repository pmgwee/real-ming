import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = join(repositoryRoot, "hermes", "scripts", "run-native-knowledge-consolidation.py");
const python = process.env.REAL_MING_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const pythonProbe = spawnSync(python, ["--version"], { encoding: "utf8" });
const pythonSpawnAvailable = pythonProbe.error === undefined && pythonProbe.status === 0;
const permitted = [
  "real_ming_knowledge_list_candidates",
  "real_ming_read_knowledge_source",
  "real_ming_stage_knowledge_generation",
  "real_ming_wiki_retrieve",
].join(",");

function runWrapper(env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  // Exercise the same principle as production: pass only explicitly safe
  // process variables. Never spread the interactive parent environment into
  // the wrapper test process.
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LOCALAPPDATA",
    "REAL_MING_PYTHON",
  ]) {
    const value = process.env[name];
    if (value !== undefined) childEnvironment[name] = value;
  }
  return spawnSync(python, [wrapper, "--controlled"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      HERMES_SKIP_MEMORY: "1",
      HERMES_MCP_TOOLS: permitted,
      HERMES_KNOWLEDGE_AUTH_PROFILE: "controlled-local-profile",
      REAL_MING_NETWORK_DISABLED: "1",
      REAL_MING_NO_CREDENTIALS: "1",
      ...childEnvironment,
      ...env,
    },
  });
}

const wrapperSuite = pythonSpawnAvailable ? describe : describe.skip;

wrapperSuite("native knowledge installed wrapper", () => {
  it("does not treat the offline fixture as a native-Hermes production run", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-wrapper-e2e-"));
    try {
      const result = runWrapper({
        REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE: "1",
        REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH: join(directory, "knowledge.sqlite"),
        REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT: join(directory, "vault", ".real-ming", "generated"),
        REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT: join(directory, "vault", ".real-ming", "staging"),
        REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE: join(directory, "sources.json"),
        REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE: join(directory, "candidates.json"),
        REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE: "true",
        ...(process.platform === "win32" && process.env.LOCALAPPDATA !== undefined
          ? { REAL_MING_PYTHON: join(process.env.LOCALAPPDATA, "hermes", "hermes-agent", "venv", "Scripts", "python.exe") }
          : {}),
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      const payload = JSON.parse(String(result.stdout)) as { readonly eligible: boolean; readonly executed: boolean; readonly activated: boolean; readonly reason?: string };
      expect(payload).toMatchObject({ eligible: false, executed: false, activated: false });
      expect(payload.reason).toEqual(expect.any(String));
      expect(payload.reason).not.toMatch(/controlled synthetic fixture/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    ["job", "source-unavailable"],
    ["publication", "publication fence changed"],
    ["timeout", "wall-clock budget exceeded"],
  ] as const)("returns non-zero and redacted diagnostics for a %s failure", (failureMode, _expectedReason) => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-wrapper-failure-"));
    try {
      const result = runWrapper({
        REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE: "1",
        REAL_MING_KNOWLEDGE_FIXTURE_FAILURE: failureMode,
        REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH: join(directory, "knowledge.sqlite"),
        REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT: join(directory, "vault", ".real-ming", "generated"),
        REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT: join(directory, "vault", ".real-ming", "staging"),
        REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE: "true",
        ...(process.platform === "win32" && process.env.LOCALAPPDATA !== undefined
          ? { REAL_MING_PYTHON: join(process.env.LOCALAPPDATA, "hermes", "hermes-agent", "venv", "Scripts", "python.exe") }
          : {}),
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(String(result.stdout)).not.toMatch(/token|secret|password|api[_-]?key/i);
      const payload = JSON.parse(String(result.stdout)) as { readonly eligible: boolean; readonly reason: string };
      expect(payload.eligible).toBe(false);
      expect(payload.reason).toEqual(expect.any(String));
      expect(payload.reason).not.toMatch(/controlled synthetic fixture/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("reports a successful no-op without fabricating a generation", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-wrapper-noop-"));
    try {
      const result = runWrapper({
        REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE: "1",
        REAL_MING_KNOWLEDGE_FIXTURE_FAILURE: "no-op",
        REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH: join(directory, "knowledge.sqlite"),
        REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT: join(directory, "vault", ".real-ming", "generated"),
        REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT: join(directory, "vault", ".real-ming", "staging"),
        REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE: join(directory, "sources.json"),
        REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE: join(directory, "candidates.json"),
        REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE: "true",
        ...(process.platform === "win32" && process.env.LOCALAPPDATA !== undefined
          ? { REAL_MING_PYTHON: join(process.env.LOCALAPPDATA, "hermes", "hermes-agent", "venv", "Scripts", "python.exe") }
          : {}),
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(JSON.parse(String(result.stdout))).toMatchObject({ eligible: false });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("fails preflight before launching the job when memory isolation is not declared", () => {
    const result = runWrapper({ HERMES_SKIP_MEMORY: "0" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(78);
    expect(JSON.parse(String(result.stdout))).toMatchObject({ eligible: false, reason: expect.stringContaining("HERMES_SKIP_MEMORY") });
  });
});

if (!pythonSpawnAvailable) {
  it("reports the unavailable Python prerequisite instead of fabricating wrapper evidence", () => {
    expect((pythonProbe.error as NodeJS.ErrnoException | undefined)?.code ?? pythonProbe.status).toBeTruthy();
  });
}
