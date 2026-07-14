import { parse as parseYaml } from "yaml";
import type { SkillFrontmatter } from "./types.js";

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "version",
  "license",
  "allowed-tools",
  "metadata",
]);

export interface FrontmatterParseResult {
  frontmatter: SkillFrontmatter;
  body: string;
  /** True when a `---` frontmatter block was found at the top of the file. */
  hasBlock: boolean;
  /** Raw text between the delimiters (without them). */
  rawBlock: string;
}

/**
 * Extract the YAML frontmatter block from a SKILL.md document.
 *
 * The block must start on the very first line with `---` and end with a
 * matching `---` line. Everything after the closing delimiter is the body.
 */
export function parseFrontmatter(source: string): FrontmatterParseResult {
  const empty: SkillFrontmatter = { extra: {} };
  // Normalize BOM but keep everything else byte-for-byte.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: empty, body: text, hasBlock: false, rawBlock: "" };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: empty, body: text, hasBlock: false, rawBlock: "" };
  }
  const rawBlock = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");
  let data: unknown;
  try {
    data = parseYaml(rawBlock);
  } catch {
    data = undefined;
  }
  if (data === null || data === undefined || typeof data !== "object" || Array.isArray(data)) {
    return { frontmatter: empty, body, hasBlock: true, rawBlock };
  }
  const record = data as Record<string, unknown>;
  const fm: SkillFrontmatter = { extra: {} };
  for (const [key, value] of Object.entries(record)) {
    switch (key) {
      case "name":
        if (typeof value === "string") fm.name = value;
        else fm.extra[key] = value;
        break;
      case "description":
        if (typeof value === "string") fm.description = value;
        else fm.extra[key] = value;
        break;
      case "version":
        // Tolerate YAML parsing `version: 1.0` as a number.
        if (typeof value === "string") fm.version = value;
        else if (typeof value === "number") fm.version = String(value);
        else fm.extra[key] = value;
        break;
      case "license":
        if (typeof value === "string") fm.license = value;
        else fm.extra[key] = value;
        break;
      case "allowed-tools":
        fm["allowed-tools"] = value;
        break;
      case "metadata":
        fm.metadata = value;
        break;
      default:
        fm.extra[key] = value;
    }
  }
  return { frontmatter: fm, body, hasBlock: true, rawBlock };
}

/** Keys recognized by the SKILL.md open format (plus skillforge's `version`). */
export function knownFrontmatterKeys(): ReadonlySet<string> {
  return KNOWN_KEYS;
}

/**
 * Rewrite (or insert) a single scalar frontmatter key in-place, preserving
 * the rest of the document byte-for-byte. Used by `skillforge version`.
 */
export function setFrontmatterKey(source: string, key: string, value: string): string {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    // No frontmatter block: create one at the top.
    return `---\n${key}: ${value}\n---\n${text}`;
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return `---\n${key}: ${value}\n---\n${text}`;
  }
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line !== undefined && keyRe.test(line)) {
      // Preserve a CRLF line ending so Windows-authored files stay byte-consistent.
      const cr = line.endsWith("\r") ? "\r" : "";
      lines[i] = `${key}: ${value}${cr}`;
      return lines.join("\n");
    }
  }
  // Key absent: insert just before the closing delimiter, matching its EOL style.
  const cr = lines[end]?.endsWith("\r") ? "\r" : "";
  lines.splice(end, 0, `${key}: ${value}${cr}`);
  return lines.join("\n");
}
