import type {
  ClientId,
  ClientProfile,
  CompatLevel,
  CompatReport,
  Finding,
  MatrixResult,
  Skill,
  SkillFrontmatter,
} from "./types.js";

/**
 * Client dialect profiles.
 *
 * These are versioned data, not code: when a client changes its limits or
 * field support, only this table needs an update. Limits reflect each
 * client's documented or observed behavior as of 2026-07; conservative
 * values are chosen where a client does not document a hard limit.
 */
export const CLIENT_PROFILES: Record<ClientId, ClientProfile> = {
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    supportedFields: ["name", "description", "license", "allowed-tools", "metadata", "version"],
    nameLimit: 64,
    descriptionLimit: 1024,
    supportsScripts: true,
    supportsAllowedTools: true,
    notes: "reference implementation of the SKILL.md format",
  },
  codex: {
    id: "codex",
    displayName: "Codex CLI",
    supportedFields: ["name", "description", "license", "metadata", "version"],
    nameLimit: 64,
    descriptionLimit: 500,
    supportsScripts: true,
    supportsAllowedTools: false,
    notes: "adopts SKILL.md; no allowed-tools; shorter description budget",
  },
  "gemini-cli": {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    supportedFields: ["name", "description", "version"],
    nameLimit: 30,
    descriptionLimit: 256,
    supportsScripts: false,
    supportsAllowedTools: false,
    notes: "maps to extensions (gemini-extension.json); scripts not auto-executed",
  },
};

export const ALL_CLIENTS: ClientId[] = ["claude-code", "codex", "gemini-cli"];

export function getProfile(id: ClientId): ClientProfile {
  return CLIENT_PROFILES[id];
}

export function isClientId(value: string): value is ClientId {
  return value in CLIENT_PROFILES;
}

/**
 * Check one skill against one client profile.
 * Errors mean the skill will not load; warnings mean degraded behavior.
 */
export function checkCompat(skill: Skill, profile: ClientProfile): CompatReport {
  const findings: Finding[] = [];
  const fm = skill.frontmatter;

  if (fm.name && fm.name.length > profile.nameLimit) {
    findings.push({
      rule: "compat/name-length",
      severity: "error",
      message: `name is ${fm.name.length} chars; ${profile.displayName} allows ${profile.nameLimit}`,
    });
  }

  if (fm.description && fm.description.length > profile.descriptionLimit) {
    findings.push({
      rule: "compat/description-truncated",
      severity: "warn",
      message: `description is ${fm.description.length} chars; ${profile.displayName} truncates at ${profile.descriptionLimit} — trigger phrases past that point are lost`,
    });
  }

  if (fm["allowed-tools"] !== undefined && !profile.supportsAllowedTools) {
    findings.push({
      rule: "compat/allowed-tools-dropped",
      severity: "warn",
      message: `\`allowed-tools\` is not honored by ${profile.displayName} — the skill runs without tool restrictions there`,
    });
  }

  if (fm.metadata !== undefined && !profile.supportedFields.includes("metadata")) {
    findings.push({
      rule: "compat/metadata-dropped",
      severity: "warn",
      message: `\`metadata\` is ignored by ${profile.displayName}`,
    });
  }

  const hasScripts = skill.files.some((f) => f.startsWith("scripts/"));
  if (hasScripts && !profile.supportsScripts) {
    findings.push({
      rule: "compat/scripts-unsupported",
      severity: "warn",
      message: `skill bundles scripts/ but ${profile.displayName} does not auto-execute bundled scripts`,
    });
  }

  for (const key of Object.keys(fm.extra)) {
    findings.push({
      rule: "compat/unknown-field-dropped",
      severity: "info",
      message: `frontmatter key "${key}" is dropped by ${profile.displayName}`,
    });
  }

  return { client: profile.id, level: levelOf(findings), findings };
}

function levelOf(findings: Finding[]): CompatLevel {
  if (findings.some((f) => f.severity === "error")) return "incompatible";
  if (findings.some((f) => f.severity === "warn")) return "partial";
  return "compatible";
}

/** Build the full cross-client compatibility matrix for a skill. */
export function buildMatrix(skill: Skill, clients: ClientId[] = ALL_CLIENTS): MatrixResult {
  return {
    skillName: skill.frontmatter.name ?? "(unnamed)",
    reports: clients.map((c) => checkCompat(skill, CLIENT_PROFILES[c])),
  };
}

/**
 * Compute the *effective* frontmatter a given client actually sees:
 * unsupported fields dropped, description truncated to the client budget.
 * This is what makes cross-client behavior diffs observable.
 */
export function effectiveFrontmatter(fm: SkillFrontmatter, profile: ClientProfile): SkillFrontmatter {
  const out: SkillFrontmatter = { extra: {} };
  if (fm.name !== undefined && profile.supportedFields.includes("name")) {
    out.name = fm.name.slice(0, profile.nameLimit);
  }
  if (fm.description !== undefined && profile.supportedFields.includes("description")) {
    out.description = fm.description.slice(0, profile.descriptionLimit);
  }
  if (fm.version !== undefined && profile.supportedFields.includes("version")) {
    out.version = fm.version;
  }
  if (fm.license !== undefined && profile.supportedFields.includes("license")) {
    out.license = fm.license;
  }
  if (fm["allowed-tools"] !== undefined && profile.supportsAllowedTools) {
    out["allowed-tools"] = fm["allowed-tools"];
  }
  if (fm.metadata !== undefined && profile.supportedFields.includes("metadata")) {
    out.metadata = fm.metadata;
  }
  return out;
}
