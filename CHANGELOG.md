# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-08

### Added

- `skillforge init`: scaffold a new skill (SKILL.md with frontmatter, references/,
  a behavior test suite, and an optional bundled example script).
- `skillforge lint`: structural validation of SKILL.md against the open format —
  name/description/version rules, trigger-guidance check, unknown frontmatter keys,
  broken reference detection (markdown links and bare `scripts|references|assets/` paths),
  script shebang checks.
- `skillforge matrix`: cross-client compatibility matrix for Claude Code, Codex CLI
  and Gemini CLI, driven by versioned client dialect profiles (field support,
  name/description budgets, script execution). `--json` for machine consumption.
- `skillforge test`: behavior tests from `tests/*.yaml` — prompt cases evaluated
  against each client's *effective* description (truncation and field-dropping
  simulated per profile) with a deterministic lexical trigger scorer, plus script
  cases that actually execute bundled scripts and assert on stdout/exit code.
  Divergence across clients is detected and flagged per case.
- `skillforge version`: npm-style semver bumping (`major`/`minor`/`patch`/
  `prerelease` with `--preid`, or an explicit version) edited in place in the
  SKILL.md frontmatter.
- `skillforge lock` / `skillforge verify`: `skillforge.lock` with per-file sha256,
  sizes and a whole-tree integrity hash; verify reports added/removed/modified files.
- `skillforge pack`: deterministic (byte-reproducible) `.skill.tgz` archives via a
  built-in USTAR writer — sorted entries, fixed mtime, normalized modes, sha256 output.
- `skillforge publish`: stage marketplace-ready artifacts per target — Claude Code
  plugin layout (`.claude-plugin/plugin.json` + `skills/`), Codex CLI skill directory,
  Gemini CLI extension (`gemini-extension.json` + generated `GEMINI.md`) — with
  explicit warnings for lossy transformations.
- `skillforge clients`: print the client dialect table.
- Programmatic TypeScript API exported from the package root.
- Example skill `examples/commit-poet` demonstrating a real cross-client
  truncation bug caught by the test runner, plus `examples/demo.sh`.
- `scripts/smoke.sh`: self-asserting end-to-end smoke test of the built CLI
  (scaffold, lint, matrix, behavior diff, semver, lockfile, reproducible pack,
  publish staging, error handling).
- Test suite: 94 vitest tests including end-to-end tests against the built CLI.

[0.1.0]: https://github.com/JaydenCJ/skillforge/releases/tag/v0.1.0
