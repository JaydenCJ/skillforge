#!/usr/bin/env bash
# Smoke test for skillforge: drives the built CLI end to end against a fresh
# scaffolded skill and the shipped example, asserting on real outputs.
#
# Requirements honored here:
#   - no network access (everything runs on local files),
#   - self-asserting (any failed check exits non-zero),
#   - idempotent (work happens in a fresh temp dir, cleaned on exit),
#   - prints "SMOKE OK" as the last line on success.
#
# Run from the project root after `npm install && npm run build`:
#   bash scripts/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/dist/cli.js"
EXAMPLE="$ROOT/examples/commit-poet"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

[ -f "$CLI" ] || fail "dist/cli.js not found — run 'npm install && npm run build' first"

run() { node "$CLI" "$@"; }

# 1. --version matches package.json
pkg_version="$(node -p "require('$ROOT/package.json').version")"
cli_version="$(run --version)"
[ "$cli_version" = "$pkg_version" ] || fail "--version printed '$cli_version', expected '$pkg_version'"
echo "[smoke] 1. --version = $cli_version"

# 2. --help lists the core commands
help_out="$(run --help)"
for cmd in init lint matrix test version lock verify pack publish; do
  echo "$help_out" | grep -q "$cmd" || fail "--help does not mention '$cmd'"
done
echo "[smoke] 2. --help lists all core commands"

# 3. Scaffold a fresh skill (real input, not the shipped example)
cd "$WORK"
run init smoke-probe --script \
  -d "Check deployment health. Use when the user asks for a smoke probe or a health check summary." >/dev/null
[ -f "$WORK/smoke-probe/SKILL.md" ] || fail "init did not create SKILL.md"
cd "$WORK/smoke-probe"
echo "[smoke] 3. init scaffolded smoke-probe/"

# 4. Lint passes on the scaffold
run lint >/dev/null || fail "lint failed on a fresh scaffold"
echo "[smoke] 4. lint clean on the scaffold"

# 5. Matrix (JSON) reports all three clients
matrix_json="$(run matrix --json)"
node -e "
const m = JSON.parse(process.argv[1]);
if (m.reports.length !== 3) throw new Error('expected 3 client reports, got ' + m.reports.length);
const ids = m.reports.map(r => r.client).sort().join(',');
if (ids !== 'claude-code,codex,gemini-cli') throw new Error('unexpected client ids: ' + ids);
" "$matrix_json" || fail "matrix --json did not report the three expected clients"
echo "[smoke] 5. matrix --json covers claude-code, codex, gemini-cli"

# 6. Behavior tests pass on the scaffold (all clients)
test_out="$(run test)"
echo "$test_out" | grep -q "0 failed" || fail "scaffold behavior tests reported failures"
echo "[smoke] 6. behavior tests pass on the scaffold"

# 7. The shipped example must reproduce its documented cross-client divergence
diverge_rc=0
diverge_out="$(cd "$EXAMPLE" && run test)" || diverge_rc=$?
[ "$diverge_rc" -eq 1 ] || fail "example divergence run exited $diverge_rc, expected 1"
echo "$diverge_out" | grep -q "2 case(s) diverge across clients" \
  || fail "example did not report the documented 2 diverging cases"
scoped_out="$(cd "$EXAMPLE" && run test -c claude-code)" \
  || fail "example test scoped to claude-code should exit 0"
echo "$scoped_out" | grep -q "0 failed" || fail "claude-code-scoped run reported failures"
echo "[smoke] 7. example reproduces the documented divergence (and passes scoped)"

# 8. Semver bump edits the frontmatter in place
run version minor >/dev/null
grep -q "^version: 0.2.0" SKILL.md || fail "version minor did not bump 0.1.0 -> 0.2.0"
echo "[smoke] 8. version minor bumped to 0.2.0"

# 9. Lock and verify round-trip
run lock >/dev/null && run verify >/dev/null || fail "lock/verify round-trip failed"
[ -f skillforge.lock ] || fail "skillforge.lock was not written"
echo "[smoke] 9. lock + verify round-trip OK"

# 10. Pack is byte-reproducible and readable by system tar
run pack >/dev/null
first_tgz="$WORK/first.skill.tgz"
mv dist/smoke-probe-0.2.0.skill.tgz "$first_tgz"
run pack >/dev/null
cmp -s "$first_tgz" dist/smoke-probe-0.2.0.skill.tgz || fail "two pack runs were not byte-identical"
tar -tzf dist/smoke-probe-0.2.0.skill.tgz | grep -q "SKILL.md" || fail "system tar cannot list SKILL.md in the archive"
echo "[smoke] 10. pack is byte-reproducible and tar-readable"

# 11. Publish stages artifacts for all three marketplaces
run publish >/dev/null
for f in \
  dist/publish/claude-code/smoke-probe/.claude-plugin/plugin.json \
  dist/publish/codex/smoke-probe/SKILL.md \
  dist/publish/gemini-cli/smoke-probe/gemini-extension.json; do
  [ -f "$f" ] || fail "publish did not stage $f"
done
echo "[smoke] 11. publish staged claude-code, codex and gemini-cli artifacts"

# 12. Errors are human-readable and exit non-zero
err_rc=0
err_out="$(cd "$WORK" && mkdir -p empty-dir && cd empty-dir && run lint 2>&1)" || err_rc=$?
[ "$err_rc" -ne 0 ] || fail "lint in a directory without SKILL.md should exit non-zero"
echo "$err_out" | grep -qi "SKILL.md" || fail "lint error message does not mention SKILL.md"
echo "[smoke] 12. missing SKILL.md fails with a readable error"

echo "SMOKE OK"
