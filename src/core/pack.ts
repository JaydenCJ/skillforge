import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { sha256Hex } from "./lockfile.js";
import type { Skill } from "./types.js";

/**
 * Deterministic USTAR archive writer.
 *
 * skillforge packs skills into plain `.skill.tgz` archives readable by any
 * `tar` implementation. Determinism matters: the same skill contents must
 * produce byte-identical archives so lockfile integrity and registry
 * checksums are stable. We therefore fix mtime to 0, sort entries, and
 * normalize modes (0644 files, 0755 scripts).
 */

const BLOCK = 512;

function padOctal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function writeString(buf: Buffer, str: string, offset: number, length: number): void {
  buf.write(str.slice(0, length), offset, "utf8");
}

export function tarHeader(name: string, size: number, mode: number): Buffer {
  if (Buffer.byteLength(name, "utf8") > 100) {
    throw new Error(`tar entry name too long (>100 bytes): ${name}`);
  }
  const buf = Buffer.alloc(BLOCK, 0);
  writeString(buf, name, 0, 100);
  writeString(buf, padOctal(mode, 8), 100, 8);
  writeString(buf, padOctal(0, 8), 108, 8); // uid
  writeString(buf, padOctal(0, 8), 116, 8); // gid
  writeString(buf, padOctal(size, 12), 124, 12);
  writeString(buf, padOctal(0, 12), 136, 12); // mtime = 0 (deterministic)
  writeString(buf, "        ", 148, 8); // checksum field starts as spaces per USTAR spec
  buf.write("0", 156); // typeflag: regular file
  writeString(buf, "ustar\0", 257, 6);
  writeString(buf, "00", 263, 2);
  writeString(buf, "skillforge", 265, 32); // uname
  writeString(buf, "skillforge", 297, 32); // gname
  let checksum = 0;
  for (const byte of buf) checksum += byte;
  writeString(buf, checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return buf;
}

export interface TarEntry {
  name: string;
  data: Buffer;
  mode: number;
}

/** Serialize entries into a complete tar stream (with the two-block trailer). */
export function buildTar(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.name, entry.data.length, entry.mode));
    chunks.push(entry.data);
    const remainder = entry.data.length % BLOCK;
    if (remainder !== 0) chunks.push(Buffer.alloc(BLOCK - remainder, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}

export interface PackResult {
  /** Absolute path of the written archive. */
  archivePath: string;
  sha256: string;
  size: number;
  fileCount: number;
}

/**
 * Pack a skill into `<outDir>/<name>-<version>.skill.tgz`.
 * Entries are prefixed with `<name>/` so extraction is self-contained.
 */
export async function packSkill(skill: Skill, outDir: string): Promise<PackResult> {
  const name = skill.frontmatter.name;
  const version = skill.frontmatter.version;
  if (!name) throw new Error("cannot pack: skill has no `name` in frontmatter");
  if (!version) throw new Error("cannot pack: skill has no `version` in frontmatter (run `skillforge version`)");

  const entries: TarEntry[] = [];
  for (const rel of skill.files) {
    const data = await fs.readFile(path.join(skill.root, rel));
    const isScript = rel.startsWith("scripts/");
    entries.push({ name: `${name}/${rel}`, data, mode: isScript ? 0o755 : 0o644 });
  }
  const tar = buildTar(entries);
  // level + mtime-free gzip: Node's gzip writes MTIME=0 by default, keeping output deterministic.
  const gz = gzipSync(tar, { level: 9 });
  await fs.mkdir(outDir, { recursive: true });
  const archivePath = path.join(outDir, `${name}-${version}.skill.tgz`);
  await fs.writeFile(archivePath, gz);
  return {
    archivePath,
    sha256: sha256Hex(gz),
    size: gz.length,
    fileCount: entries.length,
  };
}
