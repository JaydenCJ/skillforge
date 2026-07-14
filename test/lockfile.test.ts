import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeLockfile,
  readLockfile,
  verifyLockfile,
  writeLockfile,
} from "../src/core/lockfile.js";
import { loadSkill } from "../src/core/skill.js";
import { makeSkill, validSkillMd } from "./helpers.js";

describe("lockfile", () => {
  it("records every distributable file with its sha256 and size", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "references/notes.md": "# notes\n",
    });
    const lock = await computeLockfile(skill);
    expect(lock.lockfileVersion).toBe(1);
    expect(lock.name).toBe("test-skill");
    expect(lock.version).toBe("1.0.0");
    expect(Object.keys(lock.files)).toEqual(["SKILL.md", "references/notes.md"]);
    expect(lock.files["references/notes.md"]!.size).toBe(8);
    expect(lock.files["references/notes.md"]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it("is deterministic for identical content", async () => {
    const files = { "SKILL.md": validSkillMd(), "references/a.md": "same\n" };
    const a = await computeLockfile(await makeSkill(files));
    const b = await computeLockfile(await makeSkill(files));
    expect(a.integrity).toBe(b.integrity);
  });

  it("round-trips through write + read and excludes itself from the file list", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    const written = await writeLockfile(skill);
    const read = await readLockfile(skill.root);
    expect(read).toEqual(written);
    // Re-loading must not include skillforge.lock in the distributable set.
    const reloaded = await loadSkill(skill.root);
    expect(reloaded.files).not.toContain("skillforge.lock");
    const verify = await verifyLockfile(reloaded);
    expect(verify?.ok).toBe(true);
  });

  it("detects modified, added and removed files", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "references/keep.md": "keep\n",
      "references/gone.md": "bye\n",
    });
    await writeLockfile(skill);
    await fs.writeFile(path.join(skill.root, "references/keep.md"), "changed\n");
    await fs.rm(path.join(skill.root, "references/gone.md"));
    await fs.writeFile(path.join(skill.root, "references/new.md"), "hello\n");
    const result = await verifyLockfile(await loadSkill(skill.root));
    expect(result?.ok).toBe(false);
    expect(result?.modified).toEqual(["references/keep.md"]);
    expect(result?.removed).toEqual(["references/gone.md"]);
    expect(result?.added).toEqual(["references/new.md"]);
  });

  it("returns null when no lockfile exists", async () => {
    const skill = await makeSkill({ "SKILL.md": validSkillMd() });
    expect(await verifyLockfile(skill)).toBeNull();
  });
});
