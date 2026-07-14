#!/usr/bin/env node
/**
 * Validate that stdin (or arguments) form a 5-7-5 haiku.
 *
 * Usage:
 *   echo "line one\nline two\nline three" | node scripts/check-haiku.mjs
 *   node scripts/check-haiku.mjs "line one" "line two" "line three"
 *
 * Exit code 0 when the syllable pattern is 5-7-5, 1 otherwise.
 * Counting rules are documented in references/syllable-rules.md.
 */

export function syllablesInWord(word) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length === 0) return 0;
  const groups = clean.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 0;
  if (count > 1 && clean.endsWith("e") && !clean.endsWith("le")) count -= 1;
  return Math.max(1, count);
}

export function syllablesInLine(line) {
  return line
    .split(/[\s-]+/)
    .filter((w) => w.length > 0)
    .reduce((sum, w) => sum + syllablesInWord(w), 0);
}

function main(input) {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 3) {
    process.stdout.write(`expected 3 lines, got ${lines.length}\n`);
    process.exit(1);
  }
  const counts = lines.map(syllablesInLine);
  for (const [i, line] of lines.entries()) {
    process.stdout.write(`line ${i + 1}: ${counts[i]} syllables (${line})\n`);
  }
  if (counts[0] === 5 && counts[1] === 7 && counts[2] === 5) {
    process.stdout.write("5-7-5 OK\n");
  } else {
    process.stdout.write(`expected 5-7-5, got ${counts.join("-")}\n`);
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (process.argv.length > 2) {
    main(process.argv.slice(2).join("\n"));
  } else {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => main(data));
  }
}
