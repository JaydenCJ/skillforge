---
name: commit-poet
description: >-
  Write git commit messages as haiku. Use when the user asks for a commit
  message, wants a diff summarized in 5-7-5 verse, or needs help phrasing a
  commit. Keeps the summary accurate and specific while making it memorable
  for reviewers and history readers. Also handles changelogs: convert a
  changelog section or a list of merged pull requests into a short poem
  cycle, one stanza per change, keeping dates, numbers and identifiers
  intact so the reader can still trace each entry back to its source in
  repository history. Finally, use it to draft poetic release notes: given
  a tagged version it writes release notes where every shipped feature
  becomes a verse.
version: 0.1.0
license: MIT
allowed-tools:
  - Read
  - Bash(git log:*)
  - Bash(git diff:*)
---

# Commit Poet

Turn version-control prose into 5-7-5 haiku without losing information.

## Instructions

1. Read the staged diff or the text the user provides.
2. Identify the single most important change; secondary changes go into the
   commit body, not the haiku subject line.
3. Compose a haiku that names the component and the action. Vague poetry is
   worse than no poetry: "fix parser crash on empty input" must stay
   recognizable.
4. Validate the syllable structure with the bundled checker before replying:
   pipe the three lines to [scripts/check-haiku.mjs](scripts/check-haiku.mjs).
5. For changelogs and release notes, write one stanza per entry and keep
   every version number, date, and issue identifier verbatim.

## Syllable rules

The checker uses heuristic English syllable counting; see
[references/syllable-rules.md](references/syllable-rules.md) for the exact
rules and known limitations before arguing with its output.

## Edge cases

- Empty diff: refuse politely; a haiku about nothing helps nobody.
- Merge commits: summarize the branch purpose, not the merge mechanics.
- Non-English identifiers: keep them verbatim; count their syllables as
  written in the checker's output rather than guessing.
