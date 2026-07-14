import { describe, expect, it } from "vitest";
import { hasErrors, lintSkill } from "../src/core/lint.js";
import { makeSkill, validSkillMd } from "./helpers.js";

function rules(findings: { rule: string }[]): string[] {
  return findings.map((f) => f.rule);
}

describe("lintSkill", () => {
  it("passes a well-formed skill with no findings", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    const findings = await lintSkill(skill);
    expect(findings).toEqual([]);
  });

  it("errors when name is missing", async () => {
    const skill = await makeSkill({
      "SKILL.md": "---\ndescription: Something. Use when needed for testing purposes.\nversion: 1.0.0\n---\n\nA body long enough to pass the body-length rule easily.\n",
    });
    const findings = await lintSkill(skill);
    expect(rules(findings)).toContain("name-required");
    expect(hasErrors(findings)).toBe(true);
  });

  it("errors on an invalid name format", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd({ name: "My_Skill" }) });
    expect(rules(await lintSkill(skill))).toContain("name-format");
  });

  it("warns when the directory name differs from the skill name", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd({ name: "other-name" }) }, "test-skill");
    const findings = await lintSkill(skill);
    const f = findings.find((x) => x.rule === "name-dir-mismatch");
    expect(f?.severity).toBe("warn");
  });

  it("errors when the description is missing and warns when trigger guidance is absent", async () => {
    const noDesc = await makeSkill({
      "SKILL.md": "---\nname: test-skill\nversion: 1.0.0\n---\n\nA body long enough to pass the body-length rule easily.\n",
    });
    expect(rules(await lintSkill(noDesc))).toContain("description-required");

    const noTriggers = await makeSkill({
      "SKILL.md": validSkillMd({ description: "Calibrates widgets and reports drift measurements." }),
    });
    expect(rules(await lintSkill(noTriggers))).toContain("description-triggers");
  });

  it("errors when the description exceeds 1024 characters", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd({ description: `Use when testing. ${"x".repeat(1030)}` }),
    });
    expect(rules(await lintSkill(skill))).toContain("description-length");
  });

  it("flags invalid semver as an error but a missing version only as a warning", async () => {
    const bad = await makeSkill({ "SKILL.md": validSkillMd({ version: "1.0" }) });
    const badFindings = await lintSkill(bad);
    expect(rules(badFindings)).toContain("version-valid");
    expect(hasErrors(badFindings)).toBe(true);

    const missing = await makeSkill({
      "SKILL.md": "---\nname: test-skill\ndescription: Use when testing widgets and calibration.\n---\n\nA body long enough to pass the body-length rule easily.\n",
    });
    const missingFindings = await lintSkill(missing);
    const f = missingFindings.find((x) => x.rule === "version-missing");
    expect(f?.severity).toBe("warn");
    expect(hasErrors(missingFindings)).toBe(false);
  });

  it("errors when allowed-tools is not an array of strings", async () => {
    const skill = await makeSkill({
      "SKILL.md": "---\nname: test-skill\ndescription: Use when testing widgets.\nversion: 1.0.0\nallowed-tools: Read\n---\n\nA body long enough to pass the body-length rule easily.\n",
    });
    expect(rules(await lintSkill(skill))).toContain("allowed-tools-format");
  });

  it("warns on unknown frontmatter keys", async () => {
    const skill = await makeSkill({
      "SKILL.md": "---\nname: test-skill\ndescription: Use when testing widgets.\nversion: 1.0.0\nauthor: someone\n---\n\nA body long enough to pass the body-length rule easily.\n",
    });
    const f = (await lintSkill(skill)).find((x) => x.rule === "frontmatter-unknown-key");
    expect(f?.severity).toBe("warn");
    expect(f?.message).toContain("author");
  });

  it("errors on an essentially empty body", async () => {
    const skill = await makeSkill({
      "SKILL.md": "---\nname: test-skill\ndescription: Use when testing widgets.\nversion: 1.0.0\n---\n\nshort\n",
    });
    expect(rules(await lintSkill(skill))).toContain("body-empty");
  });

  it("errors on references to files that do not exist", async () => {
    const md = `${validSkillMd()}
See [the notes](references/missing.md) and run scripts/gone.sh for details.
`;
    const skill = await makeSkill({ "SKILL.md": md });
    const findings = await lintSkill(skill);
    const broken = findings.filter((f) => f.rule === "broken-reference");
    expect(broken).toHaveLength(2);
    expect(broken.map((f) => f.message).join(" ")).toContain("references/missing.md");
    expect(broken.map((f) => f.message).join(" ")).toContain("scripts/gone.sh");
  });

  it("accepts references to files that do exist and skips URLs", async () => {
    const md = `${validSkillMd()}
See [notes](references/notes.md) and [docs](https://example.com/x) plus scripts/run.sh here.
`;
    const skill = await makeSkill({
      "SKILL.md": md,
      "references/notes.md": "# notes\n",
      "scripts/run.sh": "#!/usr/bin/env bash\necho ok\n",
    });
    const findings = await lintSkill(skill);
    expect(findings.filter((f) => f.rule === "broken-reference")).toEqual([]);
  });

  it("warns when a shell script lacks a shebang", async () => {
    const skill = await makeSkill({
      "SKILL.md": `${validSkillMd()}\nRun scripts/tool.sh to do the thing.\n`,
      "scripts/tool.sh": "echo no shebang\n",
    });
    const f = (await lintSkill(skill)).find((x) => x.rule === "script-shebang");
    expect(f?.severity).toBe("warn");
    expect(f?.file).toBe("scripts/tool.sh");
  });
});
