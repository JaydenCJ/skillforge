import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Lockfile, Skill } from "./types.js";

export const LOCKFILE_NAME = "skillforge.lock";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Compute the lockfile for a skill from its current on-disk contents. */
export async function computeLockfile(skill: Skill): Promise<Lockfile> {
  const files: Lockfile["files"] = {};
  for (const rel of skill.files) {
    const buf = await fs.readFile(path.join(skill.root, rel));
    files[rel] = { sha256: sha256Hex(buf), size: buf.length };
  }
  const integrityInput = Object.entries(files)
    .map(([p, meta]) => `${p}\n${meta.sha256}\n`)
    .join("");
  return {
    lockfileVersion: 1,
    name: skill.frontmatter.name ?? path.basename(skill.root),
    version: skill.frontmatter.version ?? "0.0.0",
    integrity: `sha256-${sha256Hex(integrityInput)}`,
    files,
  };
}

export async function writeLockfile(skill: Skill): Promise<Lockfile> {
  const lock = await computeLockfile(skill);
  const json = `${JSON.stringify(lock, null, 2)}\n`;
  await fs.writeFile(path.join(skill.root, LOCKFILE_NAME), json, "utf8");
  return lock;
}

export async function readLockfile(root: string): Promise<Lockfile | null> {
  try {
    const raw = await fs.readFile(path.join(root, LOCKFILE_NAME), "utf8");
    const data = JSON.parse(raw) as Lockfile;
    if (data.lockfileVersion !== 1 || typeof data.files !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  ok: boolean;
  added: string[];
  removed: string[];
  modified: string[];
}

/** Compare the current tree against the recorded lockfile. */
export async function verifyLockfile(skill: Skill): Promise<VerifyResult | null> {
  const lock = await readLockfile(skill.root);
  if (!lock) return null;
  const current = await computeLockfile(skill);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const p of Object.keys(current.files)) {
    if (!(p in lock.files)) added.push(p);
    else if (lock.files[p]!.sha256 !== current.files[p]!.sha256) modified.push(p);
  }
  for (const p of Object.keys(lock.files)) {
    if (!(p in current.files)) removed.push(p);
  }
  return {
    ok: added.length === 0 && removed.length === 0 && modified.length === 0,
    added,
    removed,
    modified,
  };
}
