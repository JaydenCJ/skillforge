import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildTar, packSkill, tarHeader } from "../src/core/pack.js";
import { makeSkill, tempDir, validSkillMd } from "./helpers.js";

/** Minimal tar reader used to verify our writer against the ustar format. */
function readTarEntries(tar: Buffer): { name: string; mode: number; data: Buffer }[] {
  const entries: { name: string; mode: number; data: Buffer }[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // trailer
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const mode = parseInt(header.subarray(100, 108).toString("utf8").replace(/\0.*$/, "").trim(), 8);
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(), 8);
    // Verify the header checksum like tar implementations do.
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    const stored = parseInt(header.subarray(148, 156).toString("utf8").replace(/[\0 ].*$/, ""), 8);
    if (sum !== stored) throw new Error(`checksum mismatch for ${name}`);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    entries.push({ name, mode, data: Buffer.from(data) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

describe("tar writer", () => {
  it("produces headers with valid ustar checksums", () => {
    const header = tarHeader("dir/file.txt", 5, 0o644);
    const entries = readTarEntries(Buffer.concat([header, Buffer.alloc(512 * 3)]));
    expect(entries[0]?.name).toBe("dir/file.txt");
    expect(entries[0]?.mode).toBe(0o644);
  });

  it("pads file data to 512-byte blocks and appends a two-block trailer", () => {
    const tar = buildTar([{ name: "a.txt", data: Buffer.from("hello"), mode: 0o644 }]);
    // header (512) + data padded (512) + trailer (1024)
    expect(tar.length).toBe(512 + 512 + 1024);
    expect(tar.subarray(tar.length - 1024).every((b) => b === 0)).toBe(true);
  });

  it("rejects entry names over 100 bytes", () => {
    expect(() => tarHeader(`${"x".repeat(101)}`, 0, 0o644)).toThrow(/too long/);
  });

  it("round-trips multi-file content", () => {
    const files = [
      { name: "skill/SKILL.md", data: Buffer.from("# hi\n"), mode: 0o644 },
      { name: "skill/scripts/run.sh", data: Buffer.from("#!/bin/sh\necho ok\n"), mode: 0o755 },
    ];
    const entries = readTarEntries(buildTar(files));
    expect(entries.map((e) => e.name)).toEqual(["skill/SKILL.md", "skill/scripts/run.sh"]);
    expect(entries[0]?.data.toString()).toBe("# hi\n");
    expect(entries[1]?.mode).toBe(0o755);
  });
});

describe("packSkill", () => {
  it("packs into <name>-<version>.skill.tgz with scripts marked executable", async () => {
    const skill = await makeSkill({
      "SKILL.md": validSkillMd(),
      "scripts/run.mjs": "console.log('ok');\n",
      "references/notes.md": "# notes\n",
    });
    const out = await tempDir();
    const result = await packSkill(skill, out);
    expect(path.basename(result.archivePath)).toBe("test-skill-1.0.0.skill.tgz");
    expect(result.fileCount).toBe(3);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const entries = readTarEntries(gunzipSync(await fs.readFile(result.archivePath)));
    expect(entries.map((e) => e.name)).toEqual([
      "test-skill/SKILL.md",
      "test-skill/references/notes.md",
      "test-skill/scripts/run.mjs",
    ]);
    expect(entries.find((e) => e.name.endsWith("run.mjs"))?.mode).toBe(0o755);
    expect(entries.find((e) => e.name.endsWith("SKILL.md"))?.mode).toBe(0o644);
  });

  it("is byte-for-byte deterministic for identical input", async () => {
    const files = { "SKILL.md": validSkillMd(), "references/a.md": "same\n" };
    const out1 = await tempDir();
    const out2 = await tempDir();
    const r1 = await packSkill(await makeSkill(files), out1);
    const r2 = await packSkill(await makeSkill(files), out2);
    expect(r1.sha256).toBe(r2.sha256);
    const b1 = await fs.readFile(r1.archivePath);
    const b2 = await fs.readFile(r2.archivePath);
    expect(b1.equals(b2)).toBe(true);
  });

  it("refuses to pack without a name or version", async () => {
    const noVersion = await makeSkill({
      "SKILL.md": "---\nname: test-skill\ndescription: Use when testing widgets.\n---\n\nA body long enough to pass the rules.\n",
    });
    await expect(packSkill(noVersion, await tempDir())).rejects.toThrow(/version/);
  });
});
