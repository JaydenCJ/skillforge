import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { ALL_CLIENTS, effectiveFrontmatter, getProfile } from "./clients.js";
import { DEFAULT_THRESHOLD, scoreTrigger } from "./trigger.js";
import type { CaseResult, ClientId, PromptCase, ScriptCase, Skill, TestCase } from "./types.js";

const execFileAsync = promisify(execFile);

/** Load behavior test cases from `tests/*.yaml` under the skill root. */
export async function loadTestCases(skillRoot: string): Promise<TestCase[]> {
  const testsDir = path.join(skillRoot, "tests");
  let entries: string[];
  try {
    entries = (await fs.readdir(testsDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    return [];
  }
  const cases: TestCase[] = [];
  for (const file of entries) {
    const raw = await fs.readFile(path.join(testsDir, file), "utf8");
    const doc: unknown = parseYaml(raw);
    if (doc === null || typeof doc !== "object") continue;
    const list = (doc as { cases?: unknown }).cases;
    if (!Array.isArray(list)) {
      throw new Error(`${file}: expected a top-level \`cases:\` list`);
    }
    for (const [i, item] of list.entries()) {
      cases.push(normalizeCase(item, `${file}#${i}`));
    }
  }
  return cases;
}

function normalizeCase(item: unknown, where: string): TestCase {
  if (item === null || typeof item !== "object") {
    throw new Error(`${where}: test case must be a mapping`);
  }
  const rec = item as Record<string, unknown>;
  const name = typeof rec["name"] === "string" ? rec["name"] : where;
  if (typeof rec["prompt"] === "string") {
    const expect = (rec["expect"] ?? {}) as Record<string, unknown>;
    const c: PromptCase = {
      kind: "prompt",
      name,
      prompt: rec["prompt"],
      expect: {
        triggered: expect["triggered"] !== false,
        ...(typeof expect["min_score"] === "number" ? { minScore: expect["min_score"] } : {}),
      },
    };
    return c;
  }
  if (typeof rec["script"] === "string") {
    const expect = (rec["expect"] ?? {}) as Record<string, unknown>;
    const c: ScriptCase = {
      kind: "script",
      name,
      script: rec["script"],
      ...(Array.isArray(rec["args"]) ? { args: rec["args"].map(String) } : {}),
      ...(typeof rec["stdin"] === "string" ? { stdin: rec["stdin"] } : {}),
      expect: {
        ...(typeof expect["exit_code"] === "number" ? { exitCode: expect["exit_code"] } : {}),
        ...(Array.isArray(expect["stdout_contains"])
          ? { stdoutContains: expect["stdout_contains"].map(String) }
          : {}),
        ...(typeof expect["stdout_equals"] === "string"
          ? { stdoutEquals: expect["stdout_equals"] }
          : {}),
      },
    };
    return c;
  }
  throw new Error(`${where}: test case needs either \`prompt\` or \`script\``);
}

/**
 * Run a prompt case against every client's *effective* view of the skill.
 * The per-client description transformation (truncation, dropped fields) is
 * what produces genuine behavior differences.
 */
export function runPromptCase(
  skill: Skill,
  testCase: PromptCase,
  clients: ClientId[] = ALL_CLIENTS,
): CaseResult[] {
  return clients.map((clientId) => {
    const profile = getProfile(clientId);
    const eff = effectiveFrontmatter(skill.frontmatter, profile);
    const description = eff.description ?? "";
    const threshold = testCase.expect.minScore ?? DEFAULT_THRESHOLD;
    const result = scoreTrigger(description, testCase.prompt, threshold);
    const passed = result.triggered === testCase.expect.triggered;
    const detail = passed
      ? `score ${result.score.toFixed(2)} (threshold ${threshold})`
      : `expected triggered=${testCase.expect.triggered}, got ${result.triggered} (score ${result.score.toFixed(2)}, threshold ${threshold}; missed: ${result.missed.slice(0, 4).join(", ") || "-"})`;
    return {
      caseName: testCase.name,
      client: clientId,
      passed,
      triggered: result.triggered,
      score: result.score,
      detail,
    };
  });
}

/** Execute a bundled script and assert on its output. Runs once (client-independent). */
export async function runScriptCase(skill: Skill, testCase: ScriptCase): Promise<CaseResult> {
  const rel = path.posix.normalize(testCase.script);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      caseName: testCase.name,
      client: "local",
      passed: false,
      detail: `script path "${testCase.script}" escapes the skill root`,
    };
  }
  const abs = path.join(skill.root, rel);
  const interpreter = pickInterpreter(rel);
  if (!interpreter) {
    return {
      caseName: testCase.name,
      client: "local",
      passed: false,
      detail: `no interpreter known for "${rel}"`,
    };
  }
  try {
    await fs.access(abs);
  } catch {
    return {
      caseName: testCase.name,
      client: "local",
      passed: false,
      detail: `script not found: ${rel}`,
    };
  }

  let stdout = "";
  let exitCode = 0;
  try {
    const child = execFileAsync(interpreter, [abs, ...(testCase.args ?? [])], {
      cwd: skill.root,
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (testCase.stdin !== undefined && child.child.stdin) {
      child.child.stdin.write(testCase.stdin);
      child.child.stdin.end();
    }
    const res = await child;
    stdout = res.stdout;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    exitCode = typeof e.code === "number" ? e.code : 1;
    stdout = e.stdout ?? "";
  }

  const problems: string[] = [];
  const wantExit = testCase.expect.exitCode ?? 0;
  if (exitCode !== wantExit) problems.push(`exit code ${exitCode} != ${wantExit}`);
  for (const needle of testCase.expect.stdoutContains ?? []) {
    if (!stdout.includes(needle)) problems.push(`stdout missing "${needle}"`);
  }
  if (testCase.expect.stdoutEquals !== undefined && stdout.trim() !== testCase.expect.stdoutEquals.trim()) {
    problems.push(`stdout differs from expected`);
  }
  return {
    caseName: testCase.name,
    client: "local",
    passed: problems.length === 0,
    detail: problems.length === 0 ? `exit ${exitCode}` : problems.join("; "),
  };
}

function pickInterpreter(rel: string): string | null {
  if (/\.(mjs|js|cjs)$/.test(rel)) return process.execPath;
  if (/\.(sh|bash)$/.test(rel)) return "bash";
  if (/\.py$/.test(rel)) return "python3";
  return null;
}

export interface TestRunSummary {
  results: CaseResult[];
  /** Case names where clients disagree on triggering — the behavior diff. */
  diverging: string[];
  passed: number;
  failed: number;
}

/** Run the whole suite: prompt cases across clients, script cases locally. */
export async function runSuite(
  skill: Skill,
  cases: TestCase[],
  clients: ClientId[] = ALL_CLIENTS,
): Promise<TestRunSummary> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    if (c.kind === "prompt") {
      results.push(...runPromptCase(skill, c, clients));
    } else {
      results.push(await runScriptCase(skill, c));
    }
  }
  const diverging: string[] = [];
  for (const c of cases) {
    if (c.kind !== "prompt") continue;
    const rows = results.filter((r) => r.caseName === c.name && r.client !== "local");
    const outcomes = new Set(rows.map((r) => String(r.triggered)));
    if (outcomes.size > 1) diverging.push(c.name);
  }
  const passed = results.filter((r) => r.passed).length;
  return { results, diverging, passed, failed: results.length - passed };
}
