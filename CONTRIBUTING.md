# Contributing to skillforge

Thanks for your interest in improving skillforge. This document explains how to
get a development environment running and what we expect from contributions.
If you are looking for a place to start, check the
[good first issue](https://github.com/JaydenCJ/skillforge/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
label or open a [discussion](https://github.com/JaydenCJ/skillforge/discussions).

## Development setup

Requirements: Node.js >= 20.

```bash
git clone https://github.com/JaydenCJ/skillforge.git
cd skillforge
npm install
npm run build
npm test
```

`npm test` builds first (via `pretest`) and then runs the vitest suite,
including end-to-end tests that execute the built CLI from `dist/cli.js`.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Build + run the full test suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run demo` | Run the headline demo end to end |
| `bash scripts/smoke.sh` | End-to-end smoke test of the built CLI |

## Project layout

```
src/cli.ts          command wiring (commander)
src/core/           all real logic, one module per concern
src/util/           table renderer, ANSI colors
test/               vitest suites (unit + CLI e2e)
examples/           commit-poet example skill + demo.sh
```

## Guidelines

- **Client profiles are data.** Changes to what Claude Code / Codex / Gemini CLI
  support belong in `src/core/clients.ts` with a source (docs link or observed
  behavior) in the PR description. Please do not hardcode client behavior
  elsewhere.
- **Determinism is a feature.** `pack` output must stay byte-reproducible and
  the trigger scorer must stay deterministic; tests enforce both.
- **Every behavior change needs a test.** Bug fixes should come with a test
  that fails before the fix.
- **No new runtime dependencies** without prior discussion in an issue —
  the CLI intentionally ships with only `commander` and `yaml`.
- Keep `strict` TypeScript happy; no `any` unless there is no alternative.

## Pull requests

1. Fork and create a topic branch.
2. Make your change with tests.
3. Ensure `npm test` passes.
4. Update `CHANGELOG.md` under an `Unreleased` heading.
5. Open a PR describing the motivation and the approach.

## Reporting bugs

Open an issue with:

- the skillforge version (`skillforge --version`),
- a minimal skill directory that reproduces the problem,
- what you expected vs. what happened.

For suspected client-profile drift (a client changed its limits or field
support), an issue with a link to the client's release notes is extremely
helpful even without a patch.

## Code of conduct

Be kind and assume good faith. Maintainers may edit or reject contributions
that don't fit the project's scope; that's a statement about fit, not about you.
