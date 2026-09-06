import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  renderCredentialInventory,
  tracerCredentials,
} from "../../src/config/tracer-secrets.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function officeFile(name: string): string {
  return readFileSync(`${repositoryRoot}CEO-Office/${name}`, "utf8");
}

const officeFiles = [
  "README.md",
  "phase-4-ceo-action.md",
  "GATE-1-provisioning-runbook.md",
  "GATE-2-pilot-selection-runbook.md",
  "CREDENTIAL-INVENTORY.md",
] as const;

function agentFile(name: string): string {
  return readFileSync(`${repositoryRoot}docs/agents/${name}`, "utf8");
}

describe("CEO Office", () => {
  it.each(officeFiles)("publishes %s", (name) => {
    expect(existsSync(`${repositoryRoot}CEO-Office/${name}`)).toBe(true);
    expect(officeFile(name).length).toBeGreaterThan(0);
  });

  it("keeps every CEO instruction out of docs/", () => {
    for (const stray of ["docs/CEO-ACTIONS.md", "docs/CREDENTIAL-INVENTORY.md"]) {
      expect(existsSync(`${repositoryRoot}${stray}`)).toBe(false);
    }
  });

  it("gives every open gate a runbook the status board links to", () => {
    const board = officeFile("README.md");

    for (const gate of ["RM-06", "RM-24"]) {
      expect(board).toContain(gate);
    }
    for (const runbook of [
      "GATE-1-provisioning-runbook.md",
      "GATE-2-pilot-selection-runbook.md",
      "CREDENTIAL-INVENTORY.md",
    ]) {
      expect(board).toContain(runbook);
    }
  });

  it("keeps engineering output out of the CEO's folder", () => {
    // The folder is where Ming looks when work stops on him. Milestone
    // reports, evidence, plans and agent handoffs drown that signal, so they
    // live under docs/ and only what needs his hand stays here.
    for (const misfiled of [
      "CEO-Office/RM-40-v6-requirement-ledger.md",
      "CEO-Office/RM-40-v6-milestone-1-native-runtime-evidence.md",
      "CEO-Office/RM-40-v6-milestone-3-cutover-evidence.md",
      "CEO-Office/LESSONS-LEARNED-build-alignment.md",
      "CEO-Office/RESUME-PROMPT.md",
      "CEO-Office/RM-38-claude-handoff.md",
    ]) {
      expect(existsSync(`${repositoryRoot}${misfiled}`)).toBe(false);
    }
    for (const filed of [
      "docs/planning/RM-40-v6-requirement-ledger.md",
      "docs/evidence/RM-40-v6-milestone-1-native-runtime-evidence.md",
      "docs/evidence/RM-40-v6-milestone-3-cutover-evidence.md",
      "docs/architecture/RM-40-v6-architecture-review.md",
      "docs/agents/LESSONS-LEARNED-build-alignment.md",
      "docs/agents/RESUME-PROMPT.md",
      "docs/agents/RM-38-claude-handoff.md",
    ]) {
      expect(existsSync(`${repositoryRoot}${filed}`)).toBe(true);
    }
  });

  it("surfaces every open decision on the status board", () => {
    const board = officeFile("README.md");

    expect(board).toContain("Decisions awaiting you");
    expect(board).toContain(
      "GitHub shares one number space between issues and pull requests",
    );
  });

  it("tells the next run to announce pull requests and branch per milestone", () => {
    const prompt = agentFile("RESUME-PROMPT.md");

    expect(prompt).toContain("Never let a PR appear that I have to discover");
    expect(prompt).toContain("one PR per milestone");
    expect(prompt).toContain("feat/tracer-1-daily-operations");
  });

  it("carries a prompt for each agent in the rotation", () => {
    const prompt = agentFile("RESUME-PROMPT.md");

    expect(prompt).toContain("Claude Code continuation prompt");
    expect(prompt).toContain("Codex Goal continuation prompt");
    expect(prompt).toContain(
      "Ordinary ticket completion is a checkpoint, not permission to stop",
    );
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("CONTEXT.md");
  });

  it("keeps the working agreement in AGENTS.md where any agent will read it", () => {
    const agents = readFileSync(`${repositoryRoot}AGENTS.md`, "utf8");

    for (const convention of [
      "npm run graph:status",
      "CEO-Office/",
      "one pull request per milestone",
      "Real-Ming System Harness",
      "npm run secrets:preflight",
      "Real-Ming v1.1",
    ]) {
      expect(agents).toContain(convention);
    }
  });

  it("carries a resume prompt that drives the scheduler, not ticket numbers", () => {
    const prompt = agentFile("RESUME-PROMPT.md");

    expect(prompt).toContain("npm run graph:status");
    expect(prompt).toContain("never select from memory");
    expect(prompt).toContain("main remains unmerged");
  });

  it("keeps the credential inventory in step with the code", () => {
    const inventory = officeFile("CREDENTIAL-INVENTORY.md");

    for (const row of renderCredentialInventory().split("\n").slice(2)) {
      expect(inventory).toContain(row);
    }
    expect(tracerCredentials.length).toBeGreaterThan(0);
  });

  it("records no credential value anywhere in the office", () => {
    for (const name of officeFiles) {
      const contents = officeFile(name);
      for (const credential of tracerCredentials) {
        expect(contents).not.toMatch(
          new RegExp(`${credential.name}\\s*=\\s*\\S`),
        );
      }
    }
  });
});
