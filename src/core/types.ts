/** Shared types for the skillforge toolchain. */

/** Severity of a finding produced by lint or compat checks. */
export type Severity = "error" | "warn" | "info";

/** A single finding from a lint rule or compatibility rule. */
export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Optional file the finding refers to, relative to the skill root. */
  file?: string;
}

/** Parsed SKILL.md frontmatter. Unknown keys are preserved in `extra`. */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  "allowed-tools"?: unknown;
  metadata?: unknown;
  /** Keys that are not part of the recognized set. */
  extra: Record<string, unknown>;
}

/** A fully loaded skill: frontmatter + body + file inventory. */
export interface Skill {
  /** Absolute path of the skill root directory. */
  root: string;
  /** Raw SKILL.md contents. */
  raw: string;
  frontmatter: SkillFrontmatter;
  /** Markdown body after the frontmatter block. */
  body: string;
  /** All distributable files, relative POSIX paths, sorted. Includes SKILL.md. */
  files: string[];
}

/** Identifier of a supported client target. */
export type ClientId = "claude-code" | "codex" | "gemini-cli";

/** Data-driven description of one client's SKILL.md dialect. */
export interface ClientProfile {
  id: ClientId;
  displayName: string;
  /** Frontmatter keys the client understands. Anything else is dropped. */
  supportedFields: string[];
  /** Hard limit on `name` length (characters). */
  nameLimit: number;
  /** The client truncates descriptions longer than this. */
  descriptionLimit: number;
  /** Whether bundled `scripts/` are executable by the client. */
  supportsScripts: boolean;
  /** Whether the `allowed-tools` frontmatter key is honored. */
  supportsAllowedTools: boolean;
  /** Short note shown in matrix output. */
  notes: string;
}

/** Result of checking one skill against one client profile. */
export type CompatLevel = "compatible" | "partial" | "incompatible";

export interface CompatReport {
  client: ClientId;
  level: CompatLevel;
  findings: Finding[];
}

/** One row of the cross-client compatibility matrix. */
export interface MatrixResult {
  skillName: string;
  reports: CompatReport[];
}

/** A behavior test case loaded from tests/*.yaml. */
export type TestCase = PromptCase | ScriptCase;

export interface PromptCase {
  kind: "prompt";
  name: string;
  prompt: string;
  expect: {
    triggered: boolean;
    minScore?: number;
  };
}

export interface ScriptCase {
  kind: "script";
  name: string;
  /** Path relative to the skill root, e.g. scripts/format.mjs */
  script: string;
  args?: string[];
  stdin?: string;
  expect: {
    exitCode?: number;
    stdoutContains?: string[];
    stdoutEquals?: string;
  };
}

/** Outcome of one test case on one client. */
export interface CaseResult {
  caseName: string;
  client: ClientId | "local";
  passed: boolean;
  triggered?: boolean;
  score?: number;
  detail: string;
}

/** Lockfile format (skillforge.lock). */
export interface Lockfile {
  lockfileVersion: 1;
  name: string;
  version: string;
  /** sha256 over the sorted `<path>\n<sha256>\n` lines — a whole-tree integrity hash. */
  integrity: string;
  files: Record<string, { sha256: string; size: number }>;
}
