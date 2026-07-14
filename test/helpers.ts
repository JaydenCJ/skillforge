import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { loadSkill } from "../src/core/skill.js";
import type { Skill } from "../src/core/types.js";

const created: string[] = [];

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Create a temp directory that is removed after the test. */
export async function tempDir(prefix = "skillforge-test-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/**
 * Materialize a skill on disk from a map of relative path → contents and
 * load it. The skill lives in `<tmp>/<dirName>`.
 */
export async function makeSkill(
  files: Record<string, string>,
  dirName = "test-skill",
): Promise<Skill> {
  const parent = await tempDir();
  const root = path.join(parent, dirName);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contents, "utf8");
  }
  return loadSkill(root);
}

/** A minimal valid SKILL.md used across suites. */
export function validSkillMd(overrides: Partial<Record<string, string>> = {}): string {
  const name = overrides["name"] ?? "test-skill";
  const description =
    overrides["description"] ??
    "Answer questions about widget calibration. Use when the user asks about widgets, calibration, or measurement drift.";
  const version = overrides["version"] ?? "1.0.0";
  return `---
name: ${name}
description: >-
  ${description}
version: ${version}
license: MIT
---

# Test Skill

## Instructions

1. Look at the widget.
2. Calibrate it carefully and report measurement drift.
`;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_SKILL_DIR = path.resolve(HERE, "..", "examples", "commit-poet");
export const CLI_PATH = path.resolve(HERE, "..", "dist", "cli.js");
