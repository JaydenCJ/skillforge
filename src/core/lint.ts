import { promises as fs } from "node:fs";
import path from "node:path";
import { knownFrontmatterKeys, parseFrontmatter } from "./frontmatter.js";
import { isValidSemver } from "./semver.js";
import type { Finding, Skill } from "./types.js";

export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_LIMIT = 64;
export const DESCRIPTION_LIMIT = 1024;
export const MIN_BODY_CHARS = 40;

/** Phrases that indicate the description tells the model *when* to trigger. */
const TRIGGER_HINTS = [
  "use when",
  "use this when",
  "use it when",
  "trigger",
  "invoke when",
  "when the user",
  "applies when",
];

/** True when the description contains trigger guidance (see `description-triggers`). */
export function hasTriggerHint(description: string): boolean {
  const lower = description.toLowerCase();
  return TRIGGER_HINTS.some((h) => lower.includes(h));
}

/**
 * Structural lint of a skill against the SKILL.md open format.
 * These rules are client-independent; per-client rules live in clients.ts.
 */
export async function lintSkill(skill: Skill): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fm = skill.frontmatter;
  const { hasBlock } = parseFrontmatter(skill.raw);

  if (!hasBlock) {
    findings.push({
      rule: "frontmatter-missing",
      severity: "error",
      message: "SKILL.md must start with a `---` YAML frontmatter block",
      file: "SKILL.md",
    });
  }

  // name
  if (!fm.name || fm.name.trim() === "") {
    findings.push({
      rule: "name-required",
      severity: "error",
      message: "frontmatter `name` is required",
      file: "SKILL.md",
    });
  } else {
    if (!NAME_RE.test(fm.name)) {
      findings.push({
        rule: "name-format",
        severity: "error",
        message: `name "${fm.name}" must be lowercase letters/digits separated by single hyphens`,
        file: "SKILL.md",
      });
    }
    if (fm.name.length > NAME_LIMIT) {
      findings.push({
        rule: "name-length",
        severity: "error",
        message: `name is ${fm.name.length} chars (limit ${NAME_LIMIT})`,
        file: "SKILL.md",
      });
    }
    const dirName = path.basename(skill.root);
    if (dirName !== fm.name) {
      findings.push({
        rule: "name-dir-mismatch",
        severity: "warn",
        message: `directory "${dirName}" does not match skill name "${fm.name}" — some clients resolve skills by directory name`,
        file: "SKILL.md",
      });
    }
  }

  // description
  if (!fm.description || fm.description.trim() === "") {
    findings.push({
      rule: "description-required",
      severity: "error",
      message: "frontmatter `description` is required — clients use it to decide when to load the skill",
      file: "SKILL.md",
    });
  } else {
    if (fm.description.length > DESCRIPTION_LIMIT) {
      findings.push({
        rule: "description-length",
        severity: "error",
        message: `description is ${fm.description.length} chars (limit ${DESCRIPTION_LIMIT})`,
        file: "SKILL.md",
      });
    }
    if (!hasTriggerHint(fm.description)) {
      findings.push({
        rule: "description-triggers",
        severity: "warn",
        message:
          'description has no trigger guidance (e.g. "Use when ..."); clients match skills to prompts through the description',
        file: "SKILL.md",
      });
    }
  }

  // version
  if (fm.version === undefined) {
    findings.push({
      rule: "version-missing",
      severity: "warn",
      message: "no `version` in frontmatter — required for pack/publish/lock (semver)",
      file: "SKILL.md",
    });
  } else if (!isValidSemver(fm.version)) {
    findings.push({
      rule: "version-valid",
      severity: "error",
      message: `version "${fm.version}" is not valid semver`,
      file: "SKILL.md",
    });
  }

  // allowed-tools
  const tools = fm["allowed-tools"];
  if (tools !== undefined) {
    const ok = Array.isArray(tools) && tools.every((t) => typeof t === "string");
    if (!ok) {
      findings.push({
        rule: "allowed-tools-format",
        severity: "error",
        message: "`allowed-tools` must be an array of strings",
        file: "SKILL.md",
      });
    }
  }

  // unknown frontmatter keys
  const known = knownFrontmatterKeys();
  for (const key of Object.keys(fm.extra)) {
    if (!known.has(key)) {
      findings.push({
        rule: "frontmatter-unknown-key",
        severity: "warn",
        message: `unknown frontmatter key "${key}" — clients silently ignore it`,
        file: "SKILL.md",
      });
    }
  }

  // body
  if (skill.body.trim().length < MIN_BODY_CHARS) {
    findings.push({
      rule: "body-empty",
      severity: "error",
      message: `SKILL.md body is ${skill.body.trim().length} chars — the body is the actual instructions the model reads`,
      file: "SKILL.md",
    });
  }

  // broken references: markdown links and bare scripts/references/assets paths
  findings.push(...checkReferences(skill));

  // script shebangs
  findings.push(...(await checkScripts(skill)));

  return findings;
}

function checkReferences(skill: Skill): Finding[] {
  const findings: Finding[] = [];
  const fileSet = new Set(skill.files);
  const seen = new Set<string>();
  const candidates: string[] = [];

  // [text](relative/path)
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const m of skill.body.matchAll(linkRe)) {
    candidates.push(m[1]!);
  }
  // bare mentions of bundled dirs: scripts/x.sh, references/y.md, assets/z.png
  const bareRe = /(?:^|[\s`'"(])((?:scripts|references|assets)\/[A-Za-z0-9_.\/-]+)/g;
  for (const m of skill.body.matchAll(bareRe)) {
    candidates.push(m[1]!);
  }

  for (let ref of candidates) {
    // Skip absolute URLs and anchors.
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("#") || ref.startsWith("/")) continue;
    ref = ref.replace(/[).,;:!?]+$/, "").split("#")[0]!;
    if (ref === "" || seen.has(ref)) continue;
    seen.add(ref);
    const normalized = path.posix.normalize(ref);
    if (normalized.startsWith("..")) continue; // outside the skill — not ours to check
    if (!fileSet.has(normalized)) {
      findings.push({
        rule: "broken-reference",
        severity: "error",
        message: `SKILL.md references "${ref}" but the file does not exist in the skill`,
        file: "SKILL.md",
      });
    }
  }
  return findings;
}

async function checkScripts(skill: Skill): Promise<Finding[]> {
  const findings: Finding[] = [];
  const scriptFiles = skill.files.filter(
    (f) => f.startsWith("scripts/") && /\.(sh|bash|py|mjs|js|rb)$/.test(f),
  );
  for (const rel of scriptFiles) {
    try {
      const head = (await fs.readFile(path.join(skill.root, rel), "utf8")).slice(0, 120);
      if (/\.(sh|bash|py|rb)$/.test(rel) && !head.startsWith("#!")) {
        findings.push({
          rule: "script-shebang",
          severity: "warn",
          message: `${rel} has no shebang line — clients execute bundled scripts directly`,
          file: rel,
        });
      }
    } catch {
      // unreadable script counts as broken
      findings.push({
        rule: "script-unreadable",
        severity: "error",
        message: `cannot read ${rel}`,
        file: rel,
      });
    }
  }
  return findings;
}

/** True when any finding is an error. */
export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
