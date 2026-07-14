import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { Skill } from "./types.js";

/** Directories never included in the distributable file set. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".build",
  "build",
  ".tmp",
]);

/** Files never included in the distributable file set. */
const EXCLUDED_FILES = new Set([".DS_Store", "skillforge.lock"]);

/**
 * Recursively list distributable files under a skill root.
 * Returns sorted, POSIX-style relative paths.
 */
export async function listSkillFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (EXCLUDED_FILES.has(entry.name)) continue;
        if (entry.name.endsWith(".log")) continue;
        out.push(relPath);
      }
    }
  }
  await walk(root, "");
  out.sort();
  return out;
}

/**
 * Load a skill from a directory containing SKILL.md.
 * Throws with a friendly message when the directory is not a skill.
 */
export async function loadSkill(dir: string): Promise<Skill> {
  const root = path.resolve(dir);
  const skillMd = path.join(root, "SKILL.md");
  let raw: string;
  try {
    raw = await fs.readFile(skillMd, "utf8");
  } catch {
    throw new Error(`no SKILL.md found in ${root} — is this a skill directory?`);
  }
  const { frontmatter, body } = parseFrontmatter(raw);
  const files = await listSkillFiles(root);
  return { root, raw, frontmatter, body, files };
}
