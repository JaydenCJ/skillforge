#!/usr/bin/env bash
# skillforge headline demo: scaffold → lint → compatibility matrix →
# cross-client behavior test (with divergence) → version → lock → pack →
# multi-marketplace publish.
#
# Run from the repo root after `npm install && npm run build`:
#   bash examples/demo.sh          (or: npm run demo)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$HERE")"
CLI="node $REPO_ROOT/dist/cli.js"
EXAMPLE="$HERE/commit-poet"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n\033[1;36m== %s\033[0m\n\033[2m$ %s\033[0m\n' "$1" "$2"; }

step "1. Scaffold a brand-new skill" "skillforge init pr-summarizer --script"
(cd "$WORK" && $CLI init pr-summarizer --script \
  -d "Summarize pull requests. Use when the user asks for a PR summary or review overview.")

step "2. Lint it against the SKILL.md open format" "skillforge lint"
(cd "$WORK/pr-summarizer" && $CLI lint)

step "3. Compatibility matrix for the shipped example (commit-poet)" "skillforge matrix"
(cd "$EXAMPLE" && $CLI matrix)

step "4. Behavior tests across Claude Code / Codex / Gemini CLI" "skillforge test"
echo "   (cases 3-4 are EXPECTED to diverge: their trigger phrases sit past"
echo "    the 500/256-char description budgets in the Codex / Gemini CLI profiles)"
(cd "$EXAMPLE" && $CLI test) || true

step "5. Same suite, scoped to a client that sees the full description" "skillforge test -c claude-code"
(cd "$EXAMPLE" && $CLI test -c claude-code)

step "6. Semver bump the scaffolded skill" "skillforge version minor"
(cd "$WORK/pr-summarizer" && $CLI version minor)

step "7. Write the integrity lockfile" "skillforge lock && skillforge verify"
(cd "$WORK/pr-summarizer" && $CLI lock && $CLI verify)

step "8. Build a deterministic archive" "skillforge pack"
(cd "$WORK/pr-summarizer" && $CLI pack)

step "9. Stage marketplace artifacts for all three clients" "skillforge publish"
(cd "$WORK/pr-summarizer" && $CLI publish)

step "10. Staged layout" "find dist/publish -type f"
(cd "$WORK/pr-summarizer" && find dist/publish -type f | sort)

printf '\n\033[1;32mDemo complete.\033[0m One skill, linted, tested on three clients, versioned, locked, packed and staged for three marketplaces.\n'
