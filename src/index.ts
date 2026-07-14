/** Public programmatic API of skillforge. */

export * from "./core/types.js";
export { parseFrontmatter, setFrontmatterKey, knownFrontmatterKeys } from "./core/frontmatter.js";
export {
  parseSemver,
  isValidSemver,
  formatSemver,
  compareSemver,
  bumpSemver,
  type BumpKind,
  type SemVer,
} from "./core/semver.js";
export { loadSkill, listSkillFiles } from "./core/skill.js";
export { lintSkill, hasErrors, NAME_RE, NAME_LIMIT, DESCRIPTION_LIMIT } from "./core/lint.js";
export {
  CLIENT_PROFILES,
  ALL_CLIENTS,
  getProfile,
  isClientId,
  checkCompat,
  buildMatrix,
  effectiveFrontmatter,
} from "./core/clients.js";
export { tokenize, stem, scoreTrigger, DEFAULT_THRESHOLD, type TriggerResult } from "./core/trigger.js";
export {
  loadTestCases,
  runPromptCase,
  runScriptCase,
  runSuite,
  type TestRunSummary,
} from "./core/testrunner.js";
export {
  computeLockfile,
  writeLockfile,
  readLockfile,
  verifyLockfile,
  sha256Hex,
  LOCKFILE_NAME,
  type VerifyResult,
} from "./core/lockfile.js";
export { packSkill, buildTar, tarHeader, type PackResult, type TarEntry } from "./core/pack.js";
export {
  publishTargets,
  publishClaudeCode,
  publishCodex,
  publishGemini,
  transformationWarnings,
  type PublishArtifact,
} from "./core/publish.js";
export { scaffoldSkill, type ScaffoldOptions, type ScaffoldResult } from "./core/scaffold.js";
