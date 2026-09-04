import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  preflightTracerSecrets,
  renderCredentialInventory,
  tracerCredentials,
} from "../../src/config/tracer-secrets.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("RM-06 credential inventory and preflight", () => {
  it("records owner, purpose, environment and revocation for every credential", () => {
    expect(tracerCredentials.length).toBeGreaterThan(0);
    for (const credential of tracerCredentials) {
      expect(credential.name).toMatch(/^REAL_MING_[A-Z0-9_]+$/);
      expect(credential.owner.length).toBeGreaterThan(0);
      expect(credential.purpose.length).toBeGreaterThan(0);
      expect(credential.revocation.length).toBeGreaterThan(0);
      expect(["control-plane", "private-worker"]).toContain(
        credential.environment,
      );
    }
    expect(new Set(tracerCredentials.map((entry) => entry.name)).size).toBe(
      tracerCredentials.length,
    );
  });

  it("reports what is missing without ever reporting a value", () => {
    const value = "provisioned-secret-value-must-never-be-reported";
    const preflight = preflightTracerSecrets({
      REAL_MING_TELEGRAM_BOT_TOKEN: value,
      REAL_MING_NOTION_TOKEN: "   ",
    });

    expect(preflight.ready).toBe(false);
    expect(preflight.present).toEqual(["REAL_MING_TELEGRAM_BOT_TOKEN"]);
    expect(preflight.missing).toContain("REAL_MING_NOTION_TOKEN");
    expect(JSON.stringify(preflight)).not.toContain(value);
  });

  it("is ready only when every credential is supplied", () => {
    const supplied = Object.fromEntries(
      tracerCredentials.map((credential) => [credential.name, "supplied"]),
    );

    expect(preflightTracerSecrets(supplied)).toMatchObject({
      ready: true,
      missing: [],
      deferred: [],
    });
    expect(preflightTracerSecrets({}).ready).toBe(false);
    expect(preflightTracerSecrets({}).missing).toEqual(
      tracerCredentials
        .filter((credential) => credential.producedBy === undefined)
        .map((credential) => credential.name),
    );
  });

  it("does not let a value produced by a later ticket block Gate 1", () => {
    const provisioned = Object.fromEntries(
      tracerCredentials
        .filter((credential) => credential.producedBy === undefined)
        .map((credential) => [credential.name, "supplied"]),
    );
    const preflight = preflightTracerSecrets(provisioned);

    expect(preflight.ready).toBe(true);
    expect(preflight.missing).toEqual([]);
    expect(preflight.deferred).toEqual([
      { name: "REAL_MING_NOTION_MASTER_TASKS_ID", producedBy: "RM-09" },
    ]);
  });

  it("counts a deferred value as supplied once it is filled in", () => {
    const everything = Object.fromEntries(
      tracerCredentials.map((credential) => [credential.name, "supplied"]),
    );

    expect(preflightTracerSecrets(everything).deferred).toEqual([]);
    expect(preflightTracerSecrets(everything).present).toContain(
      "REAL_MING_NOTION_MASTER_TASKS_ID",
    );
  });

  it("renders an inventory that names variables but holds no values", () => {
    const inventory = renderCredentialInventory();

    for (const credential of tracerCredentials) {
      expect(inventory).toContain(credential.name);
      expect(inventory).toContain(credential.revocation);
    }
  });

  it("publishes an example environment file with names but no values", () => {
    const example = readFileSync(`${repositoryRoot}.env.example`, "utf8");

    for (const credential of tracerCredentials) {
      expect(example).toContain(`${credential.name}=`);
      expect(example).not.toMatch(
        new RegExp(`^${credential.name}=.+$`, "m"),
      );
    }
  });

  it("keeps the real environment file out of version control", () => {
    const ignored = readFileSync(`${repositoryRoot}.gitignore`, "utf8");
    expect(ignored).toMatch(/^\.env$/m);
    expect(ignored).toMatch(/^\.env\.\*$/m);
    expect(ignored).toMatch(/^!\.env\.example$/m);
  });
});

const credentialValuePatterns: readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] = [
  { label: "GitHub token", pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { label: "OpenAI key", pattern: /sk-[A-Za-z0-9]{32,}/ },
  { label: "Slack token", pattern: /xox[abposr]-[A-Za-z0-9]{10,}-[A-Za-z0-9]{10,}/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "Telegram bot token", pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
  { label: "PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ico"];

describe("RM-06 repository credential leak guard", () => {
  it("contains no credential or recovery material in any tracked file", () => {
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .split("\n")
      .map((entry) => entry.trim())
      .filter(
        (entry) =>
          entry.length > 0 &&
          !binaryExtensions.some((extension) => entry.endsWith(extension)),
      );

    expect(tracked.length).toBeGreaterThan(0);

    const findings: string[] = [];
    for (const relative of tracked) {
      const absolute = `${repositoryRoot}${relative}`;
      // A deleted tracked path remains in the index until the current ticket
      // is committed. It is not content that can leak a credential, so skip
      // it while the working tree is in that transitional state.
      if (!existsSync(absolute)) continue;
      if (statSync(absolute).size > 2_000_000) {
        continue;
      }
      const contents = readFileSync(absolute, "utf8");
      for (const candidate of credentialValuePatterns) {
        if (candidate.pattern.test(contents)) {
          findings.push(`${relative}: ${candidate.label}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
