import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const packRoot = `${repositoryRoot}hermes/`;
const skillRoot = `${packRoot}skills/ming/`;

const rolePlaybooks = ["coo", "cto", "personal-cfo", "cao", "cmo"] as const;
const everySkill = ["real-ming", ...rolePlaybooks] as const;

function skillFile(name: string): string {
  return readFileSync(`${skillRoot}${name}/SKILL.md`, "utf8");
}

function frontmatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (match === null) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const field = /^([a-z_]+):\s*(.+)$/.exec(line);
    if (field !== null) fields[field[1]!] = field[2]!.trim();
  }
  return fields;
}

describe("Ming's Hermes configuration pack", () => {
  it.each(everySkill)("publishes the %s skill in native form", (name) => {
    const fields = frontmatter(skillFile(name));

    expect(fields.name).toBe(name);
    expect(fields.description ?? "").not.toBe("");
    expect(fields.version ?? "").not.toBe("");
  });

  it.each(everySkill)("scopes when %s applies, so it loads on merit", (name) => {
    // A skill with no stated trigger is effectively ambient. Five ambient role
    // playbooks would put every reply through every role, which is the
    // ceremony Revision 6 exists to remove.
    const description = frontmatter(skillFile(name)).description ?? "";

    expect(description.toLowerCase()).toMatch(/use (when|for)/);
  });

  it("keeps the role playbooks out of the always-loaded layer", () => {
    // SOUL.md is the only file loaded on every turn. If a role name appears in
    // it as an instruction to adopt, ordinary chat starts announcing roles.
    const soul = readFileSync(`${packRoot}SOUL.md`, "utf8");

    expect(soul).toMatch(/[Oo]rdinary conversation is ordinary/);
    expect(soul).toMatch(/only when the work genuinely sits/);
    for (const role of rolePlaybooks) {
      expect(soul.toLowerCase()).not.toContain(`act as the ${role}`);
    }
  });

  it("states the money boundary where it cannot be missed", () => {
    // The one rule with no exception. It belongs in the always-loaded layer,
    // not only in the CFO playbook a request might never load.
    const soul = readFileSync(`${packRoot}SOUL.md`, "utf8");

    expect(soul).toMatch(/[Nn]ever move money or place a trade/);
    expect(skillFile("personal-cfo")).toMatch(/never initiate Money Movement/i);
  });

  it("keeps the Real-Ming extension additive to native Hermes execution", () => {
    const skill = skillFile("real-ming");

    expect(skill).toMatch(/real_ming_list_work_items/);
    expect(skill).toMatch(/real_ming_link_execution_task/);
    expect(skill).toMatch(/normal question[\s\S]*creates no Work Item/i);
    expect(skill).toMatch(/do not write Notion or the Real-Ming SQLite[\s\S]*files directly/i);
    expect(skill).toMatch(/do not replace Hermes commands, plugins, MCP/i);
  });

  it("carries no configuration values, only names", () => {
    // Values live in the protected Hermes .env and Key Vault. A pack that
    // carries one puts a credential into Git the moment someone copies the
    // pattern for a real setting.
    const assignment = /^(?:REAL_MING_|TELEGRAM_|HERMES_)[A-Z_]+=\S/m;

    for (const entry of ["README.md", "SOUL.md"]) {
      expect(readFileSync(`${packRoot}${entry}`, "utf8")).not.toMatch(assignment);
    }
    for (const name of everySkill) {
      expect(skillFile(name)).not.toMatch(assignment);
    }
  });

  it("leaves Hermes memory alone and keeps the Obsidian writers apart", () => {
    const config = readFileSync(`${packRoot}config.native-first.example.yaml`, "utf8");
    // Assert on settings, not prose: the fragment explains why the memory block
    // was removed, and that explanation necessarily names the keys it removed.
    const settings = config.replace(/^\s*#.*$/gm, "");

    // Memory is a native Hermes feature and Real-Ming states no opinion about
    // it. A memory block here would be applied to the host and could gate the
    // agent's own working memory, which costs quality and buys no safety.
    expect(settings).not.toMatch(/^\s*memory:/mu);
    expect(settings).not.toMatch(/write_approval/u);
    expect(settings).not.toMatch(/memory_char_limit/u);
    expect(config).toContain("OBSIDIAN_VAULT_PATH=/var/lib/hermes-real-ming/obsidian-vault");
    expect(config).toContain("/var/lib/real-ming/obsidian");
    expect(config).toMatch(/do not[\s\S]*replace the file/i);
    expect(config).not.toMatch(/(?:REAL_MING_|TELEGRAM_|HERMES_)[A-Z_]+=\S/m);
  });

  it("ships nothing beyond the declared skills", () => {
    expect(readdirSync(skillRoot).sort()).toEqual([...everySkill].sort());
  });
});
