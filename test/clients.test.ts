import { describe, expect, it } from "vitest";
import {
  ALL_CLIENTS,
  buildMatrix,
  checkCompat,
  effectiveFrontmatter,
  getProfile,
  isClientId,
} from "../src/core/clients.js";
import { makeSkill, validSkillMd } from "./helpers.js";

describe("client profiles", () => {
  it("knows exactly the three launch clients", () => {
    expect(ALL_CLIENTS).toEqual(["claude-code", "codex", "gemini-cli"]);
    expect(isClientId("codex")).toBe(true);
    expect(isClientId("cursor")).toBe(false);
  });
});

describe("checkCompat", () => {
  it("reports a clean skill as compatible everywhere", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    for (const id of ALL_CLIENTS) {
      const report = checkCompat(skill, getProfile(id));
      expect(report.level, id).toBe("compatible");
      expect(report.findings).toEqual([]);
    }
  });

  it("flags description truncation only for clients with a smaller budget", async () => {
    const description = `Use when testing. ${"word ".repeat(80)}`.trim(); // ~415 chars
    const skill = await makeSkill({ "SKILL.md": validSkillMd({ description }) });
    expect(checkCompat(skill, getProfile("claude-code")).level).toBe("compatible");
    expect(checkCompat(skill, getProfile("codex")).level).toBe("compatible");
    const gemini = checkCompat(skill, getProfile("gemini-cli"));
    expect(gemini.level).toBe("partial");
    expect(gemini.findings.map((f) => f.rule)).toContain("compat/description-truncated");
  });

  it("marks a too-long name as incompatible where the limit is lower", async () => {
    const name = "a".repeat(40); // over gemini-cli's 30, under the others' 64
    const skill = await makeSkill({ "SKILL.md": validSkillMd({ name }) }, name);
    expect(checkCompat(skill, getProfile("claude-code")).level).toBe("compatible");
    const gemini = checkCompat(skill, getProfile("gemini-cli"));
    expect(gemini.level).toBe("incompatible");
    expect(gemini.findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("warns about allowed-tools on clients that drop it", async () => {
    const md = validSkillMd().replace(
      "license: MIT",
      "license: MIT\nallowed-tools:\n  - Read\n  - Bash(git log:*)",
    );
    const skill = await makeSkill({ "SKILL.md": md });
    expect(checkCompat(skill, getProfile("claude-code")).findings).toEqual([]);
    for (const id of ["codex", "gemini-cli"] as const) {
      const report = checkCompat(skill, getProfile(id));
      expect(report.level).toBe("partial");
      expect(report.findings.map((f) => f.rule)).toContain("compat/allowed-tools-dropped");
    }
  });

  it("warns about bundled scripts only on clients that cannot execute them", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "scripts/run.mjs": "console.log('hi');\n",
    });
    expect(checkCompat(skill, getProfile("claude-code")).level).toBe("compatible");
    const gemini = checkCompat(skill, getProfile("gemini-cli"));
    expect(gemini.findings.map((f) => f.rule)).toContain("compat/scripts-unsupported");
  });
});

describe("buildMatrix", () => {
  it("produces one report per requested client", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    const matrix = buildMatrix(skill, ["claude-code", "gemini-cli"]);
    expect(matrix.skillName).toBe("test-skill");
    expect(matrix.reports.map((r) => r.client)).toEqual(["claude-code", "gemini-cli"]);
  });
});

describe("effectiveFrontmatter", () => {
  it("truncates the description to the client budget", async () => {
    const description = `Use when testing. ${"x".repeat(600)}`;
    const skill = await makeSkill({ "SKILL.md": validSkillMd({ description }) });
    const eff = effectiveFrontmatter(skill.frontmatter, getProfile("gemini-cli"));
    expect(eff.description).toHaveLength(256);
    const full = effectiveFrontmatter(skill.frontmatter, getProfile("claude-code"));
    expect(full.description).toHaveLength(description.length);
  });

  it("drops unsupported fields per client", async () => {
    const md = validSkillMd().replace(
      "license: MIT",
      "license: MIT\nallowed-tools:\n  - Read\nmetadata:\n  team: docs",
    );
    const skill = await makeSkill({ "SKILL.md": md });
    const claude = effectiveFrontmatter(skill.frontmatter, getProfile("claude-code"));
    expect(claude["allowed-tools"]).toEqual(["Read"]);
    expect(claude.metadata).toEqual({ team: "docs" });

    const codex = effectiveFrontmatter(skill.frontmatter, getProfile("codex"));
    expect(codex["allowed-tools"]).toBeUndefined();
    expect(codex.metadata).toEqual({ team: "docs" });

    const gemini = effectiveFrontmatter(skill.frontmatter, getProfile("gemini-cli"));
    expect(gemini["allowed-tools"]).toBeUndefined();
    expect(gemini.metadata).toBeUndefined();
    expect(gemini.license).toBeUndefined();
  });
});
