import { describe, expect, it } from "vitest";
import { lintSkill } from "../src/core/lint.js";
import { scaffoldSkill } from "../src/core/scaffold.js";
import { loadSkill } from "../src/core/skill.js";
import { loadTestCases, runSuite } from "../src/core/testrunner.js";
import { tempDir } from "./helpers.js";

describe("scaffoldSkill", () => {
  it("creates a skill that passes lint out of the box", async () => {
    const cwd = await tempDir();
    const { root, files } = await scaffoldSkill({
      name: "pdf-wrangler",
      cwd,
      description:
        "Extract and reshape PDF content. Use when the user asks about pdf wrangler tasks.",
    });
    expect(files).toContain("SKILL.md");
    expect(files).toContain("tests/cases.yaml");
    const skill = await loadSkill(root);
    expect(skill.frontmatter.name).toBe("pdf-wrangler");
    expect(skill.frontmatter.version).toBe("0.1.0");
    const findings = await lintSkill(skill);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("creates a test suite that passes on every client", async () => {
    const cwd = await tempDir();
    const { root } = await scaffoldSkill({ name: "log-triage", cwd });
    const skill = await loadSkill(root);
    const summary = await runSuite(skill, await loadTestCases(root));
    expect(summary.failed).toBe(0);
    expect(summary.diverging).toEqual([]);
  });

  it("custom description sharing no words with the name still yields a passing, lint-clean scaffold", async () => {
    const cwd = await tempDir();
    // No trigger hint, no overlap with the skill name.
    const { root } = await scaffoldSkill({
      name: "pdf-tools",
      cwd,
      description: "Convert documents between formats and compress large archives",
    });
    const skill = await loadSkill(root);
    // Trigger guidance is appended so lint stays clean.
    expect(skill.frontmatter.description).toMatch(/Use when the user asks about pdf tools\.$/);
    const findings = await lintSkill(skill);
    expect(findings).toEqual([]);
    // The generated suite passes on every client.
    const summary = await runSuite(skill, await loadTestCases(root));
    expect(summary.failed).toBe(0);
    expect(summary.diverging).toEqual([]);
  });

  it("keeps a custom description's own trigger guidance untouched", async () => {
    const cwd = await tempDir();
    const description =
      "Summarize pull requests. Use when the user asks for a PR summary or review overview.";
    const { root } = await scaffoldSkill({ name: "pr-summarizer", cwd, description });
    const skill = await loadSkill(root);
    expect(skill.frontmatter.description).toBe(description);
    const summary = await runSuite(skill, await loadTestCases(root));
    expect(summary.failed).toBe(0);
  });

  it("picks an unrelated prompt that does not collide with the description", async () => {
    const cwd = await tempDir();
    const { root } = await scaffoldSkill({
      name: "capital-tracker",
      cwd,
      description: "Track capital gains across France-based portfolios",
    });
    const skill = await loadSkill(root);
    const summary = await runSuite(skill, await loadTestCases(root));
    expect(summary.failed).toBe(0);
    expect(summary.diverging).toEqual([]);
  });

  it("optionally includes a runnable example script", async () => {
    const cwd = await tempDir();
    const { files } = await scaffoldSkill({ name: "with-script", cwd, withScript: true });
    expect(files).toContain("scripts/example.mjs");
  });

  it("rejects invalid names and existing directories", async () => {
    const cwd = await tempDir();
    await expect(scaffoldSkill({ name: "Bad Name", cwd })).rejects.toThrow(/invalid skill name/);
    await scaffoldSkill({ name: "dupe", cwd });
    await expect(scaffoldSkill({ name: "dupe", cwd })).rejects.toThrow(/already exists/);
  });
});
