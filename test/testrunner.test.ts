import { describe, expect, it } from "vitest";
import { loadTestCases, runPromptCase, runScriptCase, runSuite } from "../src/core/testrunner.js";
import type { PromptCase, ScriptCase } from "../src/core/types.js";
import { EXAMPLE_SKILL_DIR, makeSkill, validSkillMd } from "./helpers.js";
import { loadSkill } from "../src/core/skill.js";

describe("loadTestCases", () => {
  it("parses prompt and script cases from tests/*.yaml", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "tests/cases.yaml": `cases:
  - name: a prompt case
    prompt: "calibrate my widget"
    expect:
      triggered: true
  - name: a script case
    script: scripts/run.mjs
    args: ["x"]
    expect:
      exit_code: 0
      stdout_contains: ["x"]
`,
    });
    const cases = await loadTestCases(skill.root);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({ kind: "prompt", name: "a prompt case" });
    expect(cases[1]).toMatchObject({ kind: "script", script: "scripts/run.mjs", args: ["x"] });
  });

  it("returns an empty list when there is no tests directory", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    expect(await loadTestCases(skill.root)).toEqual([]);
  });

  it("rejects files without a cases list and cases without prompt/script", async () => {
    const noList = await makeSkill({
      "SKILL.md": validSkillMd(),
      "tests/cases.yaml": "not_cases: true\n",
    });
    await expect(loadTestCases(noList.root)).rejects.toThrow(/cases/);

    const badCase = await makeSkill({
      "SKILL.md": validSkillMd(),
      "tests/cases.yaml": "cases:\n  - name: broken\n",
    });
    await expect(loadTestCases(badCase.root)).rejects.toThrow(/prompt.*script|script.*prompt/);
  });
});

describe("runPromptCase", () => {
  it("evaluates the same case against each client's effective description", async () => {
    // Trigger phrase placed past Gemini CLI's 256-char budget but inside
    // Codex's 500-char budget.
    const padding = "Calibrate widgets and report drift for laboratory equipment owners. ".repeat(4);
    const description = `Use when calibrating widgets. ${padding}Also convert changelog sections into poem cycles.`;
    expect(description.length).toBeGreaterThan(256);
    expect(description.length).toBeLessThanOrEqual(500);
    const skill = await makeSkill({ "SKILL.md": validSkillMd({ description }) });

    const testCase: PromptCase = {
      kind: "prompt",
      name: "changelog",
      prompt: "convert this changelog into a poem cycle",
      expect: { triggered: true },
    };
    const results = runPromptCase(skill, testCase);
    const byClient = Object.fromEntries(results.map((r) => [r.client, r]));
    expect(byClient["claude-code"]?.triggered).toBe(true);
    expect(byClient["codex"]?.triggered).toBe(true);
    expect(byClient["gemini-cli"]?.triggered).toBe(false);
    expect(byClient["claude-code"]?.passed).toBe(true);
    expect(byClient["gemini-cli"]?.passed).toBe(false);
  });
});

describe("runScriptCase", () => {
  it("runs a bundled node script and checks stdout and exit code", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "scripts/echo.mjs": "process.stdout.write(`got ${process.argv.slice(2).join(' ')}\\n`);\n",
    });
    const testCase: ScriptCase = {
      kind: "script",
      name: "echo",
      script: "scripts/echo.mjs",
      args: ["hello"],
      expect: { exitCode: 0, stdoutContains: ["got hello"] },
    };
    const result = await runScriptCase(skill, testCase);
    expect(result.passed).toBe(true);
  });

  it("fails with a clear detail when expectations are not met", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "scripts/fail.mjs": "process.exit(3);\n",
    });
    const result = await runScriptCase(skill, {
      kind: "script",
      name: "boom",
      script: "scripts/fail.mjs",
      expect: { exitCode: 0 },
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("exit code 3 != 0");
  });

  it("rejects scripts that escape the skill root", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    const result = await runScriptCase(skill, {
      kind: "script",
      name: "escape",
      script: "../../etc/passwd",
      expect: {},
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("escapes the skill root");
  });

  it("reports missing scripts instead of crashing", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    const result = await runScriptCase(skill, {
      kind: "script",
      name: "missing",
      script: "scripts/nope.mjs",
      expect: {},
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("not found");
  });
});

describe("runSuite on the shipped example", () => {
  it("detects the documented cross-client divergences in commit-poet", async () => {
    const skill = await loadSkill(EXAMPLE_SKILL_DIR);
    const cases = await loadTestCases(skill.root);
    const summary = await runSuite(skill, cases);
    expect(summary.diverging).toEqual([
      "changelog request (lost on Gemini CLI at 256 chars)",
      "release notes request (lost past 500 chars, Claude Code only)",
    ]);
    // 4 prompt cases x 3 clients + 2 script cases = 14 results.
    expect(summary.results).toHaveLength(14);
    // The three documented truncation losses are the only failures.
    expect(summary.failed).toBe(3);
    const scriptResults = summary.results.filter((r) => r.client === "local");
    expect(scriptResults.every((r) => r.passed)).toBe(true);
  });
});
