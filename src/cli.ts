#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { ALL_CLIENTS, buildMatrix, getProfile, isClientId } from "./core/clients.js";
import { setFrontmatterKey } from "./core/frontmatter.js";
import { hasErrors, lintSkill } from "./core/lint.js";
import { verifyLockfile, writeLockfile } from "./core/lockfile.js";
import { packSkill } from "./core/pack.js";
import { publishTargets } from "./core/publish.js";
import { scaffoldSkill } from "./core/scaffold.js";
import { bumpSemver, isValidSemver } from "./core/semver.js";
import { loadSkill } from "./core/skill.js";
import { loadTestCases, runSuite } from "./core/testrunner.js";
import type { ClientId, Finding } from "./core/types.js";
import { bold, cyan, dim, green, red, yellow } from "./util/colors.js";
import { renderTable } from "./util/table.js";

const program = new Command();

program
  .name("skillforge")
  .description(
    "npm + jest for agent skills: scaffold, lint, cross-client test, version, pack and publish SKILL.md packages",
  )
  .version("0.1.0");

function fail(message: string): never {
  process.stderr.write(`${red("error")} ${message}\n`);
  process.exit(1);
}

function parseClients(value: string | undefined): ClientId[] {
  if (!value) return ALL_CLIENTS;
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  const out: ClientId[] = [];
  for (const id of ids) {
    if (!isClientId(id)) fail(`unknown client "${id}" (known: ${ALL_CLIENTS.join(", ")})`);
    out.push(id);
  }
  return out;
}

function printFindings(findings: Finding[]): void {
  for (const f of findings) {
    const badge =
      f.severity === "error" ? red("error") : f.severity === "warn" ? yellow("warn ") : dim("info ");
    const loc = f.file ? dim(` [${f.file}]`) : "";
    process.stdout.write(`  ${badge} ${dim(f.rule)}${loc}\n        ${f.message}\n`);
  }
}

program
  .command("init")
  .argument("<name>", "skill name (lowercase, hyphen-separated)")
  .option("-d, --description <text>", "frontmatter description")
  .option("--script", "include an example bundled script", false)
  .description("scaffold a new skill directory with SKILL.md and a behavior test suite")
  .action(async (name: string, opts: { description?: string; script: boolean }) => {
    try {
      const result = await scaffoldSkill({
        name,
        cwd: process.cwd(),
        withScript: opts.script,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
      });
      process.stdout.write(`${green("created")} ${result.root}\n`);
      for (const f of result.files) process.stdout.write(`  ${dim("+")} ${f}\n`);
      process.stdout.write(`\nnext steps:\n  cd ${name}\n  skillforge lint\n  skillforge test\n`);
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("lint")
  .argument("[dir]", "skill directory", ".")
  .description("validate SKILL.md structure against the open format")
  .action(async (dir: string) => {
    try {
      const skill = await loadSkill(dir);
      const findings = await lintSkill(skill);
      const name = skill.frontmatter.name ?? path.basename(skill.root);
      if (findings.length === 0) {
        process.stdout.write(`${green("ok")} ${bold(name)}: no issues found\n`);
        return;
      }
      process.stdout.write(`${bold(name)} — ${findings.length} finding(s)\n`);
      printFindings(findings);
      const errors = findings.filter((f) => f.severity === "error").length;
      const warns = findings.filter((f) => f.severity === "warn").length;
      process.stdout.write(`\n${errors} error(s), ${warns} warning(s)\n`);
      if (hasErrors(findings)) process.exit(1);
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("matrix")
  .argument("[dir]", "skill directory", ".")
  .option("-c, --clients <list>", "comma-separated client ids")
  .option("--json", "machine-readable output", false)
  .description("cross-client compatibility matrix (Claude Code / Codex / Gemini CLI)")
  .action(async (dir: string, opts: { clients?: string; json: boolean }) => {
    try {
      const skill = await loadSkill(dir);
      const clients = parseClients(opts.clients);
      const matrix = buildMatrix(skill, clients);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
        return;
      }
      process.stdout.write(`compatibility matrix for ${bold(matrix.skillName)}\n\n`);
      const headers = ["client", "result", "errors", "warnings", "notes"];
      const rows = matrix.reports.map((r) => {
        const profile = getProfile(r.client);
        const level =
          r.level === "compatible"
            ? green("compatible")
            : r.level === "partial"
              ? yellow("partial")
              : red("incompatible");
        return [
          profile.displayName,
          level,
          String(r.findings.filter((f) => f.severity === "error").length),
          String(r.findings.filter((f) => f.severity === "warn").length),
          profile.notes,
        ];
      });
      process.stdout.write(`${renderTable(headers, rows)}\n`);
      for (const r of matrix.reports) {
        if (r.findings.length === 0) continue;
        process.stdout.write(`\n${bold(getProfile(r.client).displayName)}:\n`);
        printFindings(r.findings);
      }
      if (matrix.reports.some((r) => r.level === "incompatible")) process.exit(1);
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("test")
  .argument("[dir]", "skill directory", ".")
  .option("-c, --clients <list>", "comma-separated client ids")
  .option("--json", "machine-readable output", false)
  .description("run behavior tests (tests/*.yaml) across client profiles and report diffs")
  .action(async (dir: string, opts: { clients?: string; json: boolean }) => {
    try {
      const skill = await loadSkill(dir);
      const cases = await loadTestCases(skill.root);
      if (cases.length === 0) {
        fail(`no test cases found — add tests/cases.yaml (see \`skillforge init\` output for the format)`);
      }
      const clients = parseClients(opts.clients);
      const summary = await runSuite(skill, cases, clients);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        if (summary.failed > 0) process.exit(1);
        return;
      }

      // Prompt cases: one row per case, one column per client.
      const promptCases = cases.filter((c) => c.kind === "prompt");
      if (promptCases.length > 0) {
        const headers = ["case", ...clients.map((c) => getProfile(c).displayName), "diff"];
        const rows = promptCases.map((c) => {
          const cells = clients.map((client) => {
            const r = summary.results.find((x) => x.caseName === c.name && x.client === client);
            if (!r) return dim("-");
            const mark = r.passed ? green("pass") : red("FAIL");
            const trig = r.triggered ? "triggered" : "silent";
            return `${mark} ${dim(`${trig}@${(r.score ?? 0).toFixed(2)}`)}`;
          });
          const diff = summary.diverging.includes(c.name) ? yellow("DIVERGES") : dim("-");
          return [c.name, ...cells, diff];
        });
        process.stdout.write(`${renderTable(headers, rows)}\n`);
      }

      // Script cases.
      const scriptResults = summary.results.filter((r) => r.client === "local");
      if (scriptResults.length > 0) {
        process.stdout.write(`\nscript cases:\n`);
        for (const r of scriptResults) {
          const mark = r.passed ? green("pass") : red("FAIL");
          process.stdout.write(`  ${mark} ${r.caseName} ${dim(`(${r.detail})`)}\n`);
        }
      }

      process.stdout.write(
        `\n${summary.passed} passed, ${summary.failed} failed` +
          (summary.diverging.length > 0
            ? `; ${yellow(`${summary.diverging.length} case(s) diverge across clients`)}`
            : "") +
          "\n",
      );
      for (const r of summary.results.filter((x) => !x.passed)) {
        process.stdout.write(`  ${red("FAIL")} ${r.caseName} [${r.client}]: ${r.detail}\n`);
      }
      if (summary.failed > 0) process.exit(1);
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("version")
  .argument("[bump]", "major | minor | patch | prerelease | an explicit semver", "patch")
  .argument("[dir]", "skill directory", ".")
  .option("--preid <id>", "prerelease identifier", "beta")
  .description("bump the semver `version` in SKILL.md frontmatter")
  .action(async (bump: string, dir: string, opts: { preid: string }) => {
    try {
      const skill = await loadSkill(dir);
      const current = skill.frontmatter.version ?? "0.0.0";
      let next: string;
      if (["major", "minor", "patch", "prerelease"].includes(bump)) {
        next = bumpSemver(current, bump as "major" | "minor" | "patch" | "prerelease", opts.preid);
      } else if (isValidSemver(bump)) {
        next = bump.trim();
      } else {
        fail(`"${bump}" is neither a bump kind nor a valid semver`);
      }
      const updated = setFrontmatterKey(skill.raw, "version", next);
      await fs.writeFile(path.join(skill.root, "SKILL.md"), updated, "utf8");
      process.stdout.write(`${green("version")} ${current} ${dim("→")} ${bold(next)}\n`);
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("lock")
  .argument("[dir]", "skill directory", ".")
  .description("write skillforge.lock with sha256 hashes of every distributable file")
  .action(async (dir: string) => {
    try {
      const skill = await loadSkill(dir);
      const lock = await writeLockfile(skill);
      process.stdout.write(
        `${green("locked")} ${bold(lock.name)}@${lock.version} — ${Object.keys(lock.files).length} file(s)\n  ${dim(lock.integrity)}\n`,
      );
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("verify")
  .argument("[dir]", "skill directory", ".")
  .description("verify the working tree against skillforge.lock")
  .action(async (dir: string) => {
    try {
      const skill = await loadSkill(dir);
      const result = await verifyLockfile(skill);
      if (!result) fail("no skillforge.lock found — run `skillforge lock` first");
      if (result.ok) {
        process.stdout.write(`${green("ok")} working tree matches skillforge.lock\n`);
        return;
      }
      for (const p of result.modified) process.stdout.write(`  ${yellow("modified")} ${p}\n`);
      for (const p of result.added) process.stdout.write(`  ${cyan("added")}    ${p}\n`);
      for (const p of result.removed) process.stdout.write(`  ${red("removed")}  ${p}\n`);
      process.exit(1);
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("pack")
  .argument("[dir]", "skill directory", ".")
  .option("-o, --out <dir>", "output directory", "dist")
  .description("build a deterministic .skill.tgz archive")
  .action(async (dir: string, opts: { out: string }) => {
    try {
      const skill = await loadSkill(dir);
      const findings = await lintSkill(skill);
      if (hasErrors(findings)) {
        printFindings(findings.filter((f) => f.severity === "error"));
        fail("lint errors — fix them before packing");
      }
      const result = await packSkill(skill, path.resolve(skill.root, opts.out));
      process.stdout.write(
        `${green("packed")} ${result.archivePath}\n  ${result.fileCount} file(s), ${result.size} bytes\n  sha256 ${dim(result.sha256)}\n`,
      );
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("publish")
  .argument("[dir]", "skill directory", ".")
  .option("-t, --targets <list>", "comma-separated targets", ALL_CLIENTS.join(","))
  .option("-o, --out <dir>", "output directory", "dist/publish")
  .description("stage marketplace-ready artifacts for every target client")
  .action(async (dir: string, opts: { targets: string; out: string }) => {
    try {
      const skill = await loadSkill(dir);
      const findings = await lintSkill(skill);
      if (hasErrors(findings)) {
        printFindings(findings.filter((f) => f.severity === "error"));
        fail("lint errors — fix them before publishing");
      }
      const targets = parseClients(opts.targets);
      const artifacts = await publishTargets(skill, targets, path.resolve(skill.root, opts.out));
      for (const a of artifacts) {
        process.stdout.write(`${green("staged")} ${bold(getProfile(a.target).displayName)} → ${a.dir}\n`);
        for (const f of a.files) process.stdout.write(`  ${dim("+")} ${f}\n`);
        for (const w of a.warnings) process.stdout.write(`  ${yellow("warn")} ${w}\n`);
      }
      process.stdout.write(
        `\n${artifacts.length} target(s) staged — commit each directory to its marketplace repo to publish\n`,
      );
    } catch (err) {
      fail((err as Error).message);
    }
  });

program
  .command("clients")
  .description("list known client profiles and their SKILL.md dialects")
  .action(() => {
    const headers = ["client", "name limit", "description limit", "allowed-tools", "scripts", "notes"];
    const rows = ALL_CLIENTS.map((id) => {
      const p = getProfile(id);
      return [
        p.displayName,
        String(p.nameLimit),
        String(p.descriptionLimit),
        p.supportsAllowedTools ? "yes" : "no",
        p.supportsScripts ? "yes" : "no",
        p.notes,
      ];
    });
    process.stdout.write(`${renderTable(headers, rows)}\n`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail((err as Error).message);
});
