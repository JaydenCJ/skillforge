import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CLI_PATH, EXAMPLE_SKILL_DIR, tempDir } from "./helpers.js";

const execFileAsync = promisify(execFile);

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function cli(args: string[], cwd: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as CliResult & { code: number | string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

describe("skillforge CLI (built binary)", () => {
  it("init scaffolds a skill that immediately passes lint", async () => {
    const cwd = await tempDir();
    const init = await cli(
      ["init", "release-scribe", "-d", "Draft release announcements. Use when the user asks about release scribe work."],
      cwd,
    );
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("created");

    const lint = await cli(["lint"], path.join(cwd, "release-scribe"));
    expect(lint.code).toBe(0);
    expect(lint.stdout).toContain("no issues found");
  });

  it("lint exits non-zero on a broken skill", async () => {
    const cwd = await tempDir();
    const root = path.join(cwd, "broken");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "SKILL.md"), "---\nname: Broken Name\n---\nshort\n");
    const lint = await cli(["lint"], root);
    expect(lint.code).toBe(1);
    expect(lint.stdout).toContain("name-format");
    expect(lint.stdout).toContain("description-required");
  });

  it("matrix --json reports the documented compatibility levels for the example", async () => {
    const matrix = await cli(["matrix", "--json"], EXAMPLE_SKILL_DIR);
    expect(matrix.code).toBe(0);
    const data = JSON.parse(matrix.stdout) as {
      skillName: string;
      reports: { client: string; level: string }[];
    };
    expect(data.skillName).toBe("commit-poet");
    const levels = Object.fromEntries(data.reports.map((r) => [r.client, r.level]));
    expect(levels).toEqual({
      "claude-code": "compatible",
      codex: "partial",
      "gemini-cli": "partial",
    });
  });

  it("test surfaces the cross-client behavior diff and exits non-zero", async () => {
    const result = await cli(["test"], EXAMPLE_SKILL_DIR);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("DIVERGES");
    expect(result.stdout).toContain("2 case(s) diverge across clients");
    expect(result.stdout).toContain("5-7-5");
  });

  it("test passes when scoped to a client that sees the full description", async () => {
    const result = await cli(["test", "-c", "claude-code"], EXAMPLE_SKILL_DIR);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/6 passed, 0 failed/);
  });

  it("version bumps SKILL.md frontmatter in place", async () => {
    const cwd = await tempDir();
    await cli(["init", "bump-me", "-d", "Bump things. Use when the user asks about bump me."], cwd);
    const root = path.join(cwd, "bump-me");
    const result = await cli(["version", "minor"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("0.1.0");
    expect(result.stdout).toContain("0.2.0");
    const raw = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
    expect(raw).toContain("version: 0.2.0");
  });

  it("lock + verify catch tampering", async () => {
    const cwd = await tempDir();
    await cli(["init", "tamper-check", "-d", "Check things. Use when the user asks about tamper check."], cwd);
    const root = path.join(cwd, "tamper-check");
    expect((await cli(["lock"], root)).code).toBe(0);
    expect((await cli(["verify"], root)).code).toBe(0);
    await fs.appendFile(path.join(root, "SKILL.md"), "\ntampered\n");
    const verify = await cli(["verify"], root);
    expect(verify.code).toBe(1);
    expect(verify.stdout).toContain("modified SKILL.md");
  });

  it("pack writes a real gzip archive with the expected name", async () => {
    const cwd = await tempDir();
    await cli(["init", "packable", "-d", "Pack things. Use when the user asks about packable stuff."], cwd);
    const root = path.join(cwd, "packable");
    const result = await cli(["pack"], root);
    expect(result.code).toBe(0);
    const archive = path.join(root, "dist", "packable-0.1.0.skill.tgz");
    const buf = await fs.readFile(archive);
    expect(buf[0]).toBe(0x1f); // gzip magic
    expect(buf[1]).toBe(0x8b);
  });

  it("publish stages artifacts for all three marketplaces", async () => {
    const cwd = await tempDir();
    await cli(["init", "publishable", "-d", "Publish things. Use when the user asks about publishable stuff."], cwd);
    const root = path.join(cwd, "publishable");
    const result = await cli(["publish"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("3 target(s) staged");

    const pluginJson = JSON.parse(
      await fs.readFile(
        path.join(root, "dist/publish/claude-code/publishable/.claude-plugin/plugin.json"),
        "utf8",
      ),
    ) as { name: string; version: string };
    expect(pluginJson).toMatchObject({ name: "publishable", version: "0.1.0" });

    const geminiManifest = JSON.parse(
      await fs.readFile(
        path.join(root, "dist/publish/gemini-cli/publishable/gemini-extension.json"),
        "utf8",
      ),
    ) as { contextFileName: string };
    expect(geminiManifest.contextFileName).toBe("GEMINI.md");
    await fs.access(path.join(root, "dist/publish/codex/publishable/SKILL.md"));
    await fs.access(path.join(root, "dist/publish/gemini-cli/publishable/GEMINI.md"));
  });

  it("clients lists the dialect table", async () => {
    const cwd = await tempDir();
    const result = await cli(["clients"], cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Claude Code");
    expect(result.stdout).toContain("1024");
    expect(result.stdout).toContain("256");
  });
});
