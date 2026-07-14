import { promises as fs } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { effectiveFrontmatter, getProfile } from "./clients.js";
import type { ClientId, Skill } from "./types.js";

/**
 * Multi-marketplace publish: transform one skill into the on-disk layout
 * each client ecosystem expects, ready to push to its marketplace.
 *
 * skillforge stages artifacts locally (a "dry-run publish") because each
 * marketplace has its own upload transport; the staged output is exactly
 * what you commit to a plugin marketplace repo / extensions registry.
 */

export interface PublishArtifact {
  target: ClientId;
  /** Absolute directory containing the staged artifact. */
  dir: string;
  /** Files written, relative to `dir`. */
  files: string[];
  /** Lossy-transformation warnings (dropped fields, truncations). */
  warnings: string[];
}

async function copySkillFiles(skill: Skill, destRoot: string, skipSkillMd: boolean): Promise<string[]> {
  const written: string[] = [];
  for (const rel of skill.files) {
    if (skipSkillMd && rel === "SKILL.md") continue;
    const dest = path.join(destRoot, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(skill.root, rel), dest);
    written.push(rel);
  }
  return written;
}

function renderSkillMd(fm: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (v !== undefined && k !== "extra") clean[k] = v;
  }
  return `---\n${stringifyYaml(clean).trimEnd()}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}

/**
 * Claude Code: stage a plugin directory —
 * `.claude-plugin/plugin.json` + `skills/<name>/SKILL.md` (+ bundled files).
 */
export async function publishClaudeCode(skill: Skill, outDir: string): Promise<PublishArtifact> {
  const profile = getProfile("claude-code");
  const name = requireName(skill);
  const version = skill.frontmatter.version ?? "0.0.0";
  const warnings = transformationWarnings(skill, "claude-code");
  const dir = path.join(outDir, "claude-code", name);
  const skillDir = path.join(dir, "skills", name);

  const files: string[] = [];
  const pluginJson = {
    name,
    version,
    description: (skill.frontmatter.description ?? "").slice(0, profile.descriptionLimit),
    ...(skill.frontmatter.license ? { license: skill.frontmatter.license } : {}),
  };
  await fs.mkdir(path.join(dir, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(pluginJson, null, 2)}\n`,
  );
  files.push(".claude-plugin/plugin.json");

  await fs.mkdir(skillDir, { recursive: true });
  const eff = effectiveFrontmatter(skill.frontmatter, profile);
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    renderSkillMd(eff as unknown as Record<string, unknown>, skill.body),
  );
  files.push(`skills/${name}/SKILL.md`);
  for (const rel of await copySkillFiles(skill, skillDir, true)) {
    files.push(`skills/${name}/${rel}`);
  }
  return { target: "claude-code", dir, files, warnings };
}

/**
 * Codex CLI: stage `<name>/SKILL.md` with the Codex-effective frontmatter
 * (allowed-tools stripped, description within budget) plus bundled files.
 */
export async function publishCodex(skill: Skill, outDir: string): Promise<PublishArtifact> {
  const profile = getProfile("codex");
  const name = requireName(skill);
  const warnings = transformationWarnings(skill, "codex");
  const dir = path.join(outDir, "codex", name);
  await fs.mkdir(dir, { recursive: true });

  const eff = effectiveFrontmatter(skill.frontmatter, profile);
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    renderSkillMd(eff as unknown as Record<string, unknown>, skill.body),
  );
  const files = ["SKILL.md", ...(await copySkillFiles(skill, dir, true))];
  return { target: "codex", dir, files, warnings };
}

/**
 * Gemini CLI: stage an extension — `gemini-extension.json` + `GEMINI.md`
 * generated from the skill body (Gemini loads context files, not SKILL.md).
 */
export async function publishGemini(skill: Skill, outDir: string): Promise<PublishArtifact> {
  const profile = getProfile("gemini-cli");
  const name = requireName(skill);
  const version = skill.frontmatter.version ?? "0.0.0";
  const warnings = transformationWarnings(skill, "gemini-cli");
  const dir = path.join(outDir, "gemini-cli", name);
  await fs.mkdir(dir, { recursive: true });

  const manifest = {
    name: name.slice(0, profile.nameLimit),
    version,
    description: (skill.frontmatter.description ?? "").slice(0, profile.descriptionLimit),
    contextFileName: "GEMINI.md",
  };
  await fs.writeFile(path.join(dir, "gemini-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const header = `# ${name}\n\n> ${manifest.description}\n\n`;
  await fs.writeFile(path.join(dir, "GEMINI.md"), header + skill.body.trimStart());

  const files = ["gemini-extension.json", "GEMINI.md", ...(await copySkillFiles(skill, dir, true))];
  return { target: "gemini-cli", dir, files, warnings };
}

export async function publishTargets(
  skill: Skill,
  targets: ClientId[],
  outDir: string,
): Promise<PublishArtifact[]> {
  const artifacts: PublishArtifact[] = [];
  for (const target of targets) {
    switch (target) {
      case "claude-code":
        artifacts.push(await publishClaudeCode(skill, outDir));
        break;
      case "codex":
        artifacts.push(await publishCodex(skill, outDir));
        break;
      case "gemini-cli":
        artifacts.push(await publishGemini(skill, outDir));
        break;
    }
  }
  return artifacts;
}

function requireName(skill: Skill): string {
  const name = skill.frontmatter.name;
  if (!name) throw new Error("cannot publish: skill has no `name` in frontmatter");
  return name;
}

/** Human-readable list of what a target's transformation loses. */
export function transformationWarnings(skill: Skill, target: ClientId): string[] {
  const profile = getProfile(target);
  const fm = skill.frontmatter;
  const warnings: string[] = [];
  if (fm.description && fm.description.length > profile.descriptionLimit) {
    warnings.push(
      `description truncated ${fm.description.length} → ${profile.descriptionLimit} chars`,
    );
  }
  if (fm.name && fm.name.length > profile.nameLimit) {
    warnings.push(`name truncated ${fm.name.length} → ${profile.nameLimit} chars`);
  }
  if (fm["allowed-tools"] !== undefined && !profile.supportsAllowedTools) {
    warnings.push("allowed-tools dropped (not supported)");
  }
  if (fm.metadata !== undefined && !profile.supportedFields.includes("metadata")) {
    warnings.push("metadata dropped (not supported)");
  }
  if (skill.files.some((f) => f.startsWith("scripts/")) && !profile.supportsScripts) {
    warnings.push("bundled scripts are not auto-executed by this client");
  }
  return warnings;
}
