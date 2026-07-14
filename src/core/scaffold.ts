import { promises as fs } from "node:fs";
import path from "node:path";
import { hasTriggerHint, NAME_RE } from "./lint.js";
import { scoreTrigger, tokenize } from "./trigger.js";

export interface ScaffoldOptions {
  name: string;
  description?: string;
  /** Parent directory in which `<name>/` is created. */
  cwd: string;
  withScript?: boolean;
}

export interface ScaffoldResult {
  root: string;
  files: string[];
}

/** Create a new skill directory with SKILL.md, a behavior test suite and (optionally) a script. */
export async function scaffoldSkill(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!NAME_RE.test(opts.name)) {
    throw new Error(
      `invalid skill name "${opts.name}" — use lowercase letters/digits separated by hyphens`,
    );
  }
  const root = path.join(opts.cwd, opts.name);
  try {
    await fs.access(root);
    throw new Error(`directory already exists: ${root}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("directory already exists")) throw err;
    // ENOENT — good, we can create it.
  }

  const nameWords = opts.name.replace(/-/g, " ");
  let description: string;
  if (opts.description === undefined) {
    description =
      `Replace this sentence with one paragraph describing what this skill does. ` +
      `Use when the user asks about ${nameWords}.`;
  } else {
    // Keep the author's text, but make sure the scaffold stays lint-clean:
    // append trigger guidance when the description has none.
    description = opts.description.trim();
    if (!hasTriggerHint(description)) {
      const sep = /[.!?]$/.test(description) ? "" : ".";
      description = `${description}${sep} Use when the user asks about ${nameWords}.`;
    }
  }

  // The "triggers" case must pass on every client out of the box. For a
  // custom description the skill name may share no words with it, so derive
  // the prompt from the description itself; the default description always
  // contains the name words.
  const keywords = opts.description !== undefined ? extractKeywords(description) : [];
  const triggerPrompt =
    keywords.length > 0 ? `help me ${keywords.join(" ")}` : `help me with ${nameWords}`;
  // The "stays quiet" case must share no words with the description.
  const quietPrompt =
    UNRELATED_PROMPTS.find((p) => scoreTrigger(description, p).score === 0) ??
    UNRELATED_PROMPTS[0];

  const files: string[] = [];
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.mkdir(path.join(root, "references"), { recursive: true });

  const skillMd = `---
name: ${opts.name}
description: >-
  ${description}
version: 0.1.0
license: MIT
---

# ${titleCase(opts.name)}

## Instructions

Describe step by step how the agent should perform this skill.

1. Understand the user's request.
2. Consult [references/notes.md](references/notes.md) for details.
3. Produce the result.

## Edge cases

- Document known pitfalls here so the model avoids them.
`;
  await fs.writeFile(path.join(root, "SKILL.md"), skillMd);
  files.push("SKILL.md");

  await fs.writeFile(
    path.join(root, "references", "notes.md"),
    `# ${titleCase(opts.name)} — reference notes\n\nPut deeper reference material here; it is loaded on demand.\n`,
  );
  files.push("references/notes.md");

  const testsYaml = `# Behavior tests run by \`skillforge test\`.
# Prompt cases simulate the client's skill-matching step against each
# client's effective description (see \`skillforge matrix\`).
cases:
  - name: triggers on a matching request
    prompt: "${triggerPrompt}"
    expect:
      triggered: true

  - name: stays quiet on an unrelated request
    prompt: "${quietPrompt}"
    expect:
      triggered: false
`;
  await fs.writeFile(path.join(root, "tests", "cases.yaml"), testsYaml);
  files.push("tests/cases.yaml");

  if (opts.withScript) {
    await fs.mkdir(path.join(root, "scripts"), { recursive: true });
    const script = `#!/usr/bin/env node
// Example bundled script. Clients that support script execution can run it;
// \`skillforge test\` exercises it via script cases in tests/cases.yaml.
const input = process.argv.slice(2).join(" ") || "world";
process.stdout.write(\`hello \${input}\\n\`);
`;
    const scriptPath = path.join(root, "scripts", "example.mjs");
    await fs.writeFile(scriptPath, script);
    await fs.chmod(scriptPath, 0o755);
    files.push("scripts/example.mjs");
  }

  files.sort();
  return { root, files };
}

/** Unrelated prompts for the scaffolded "stays quiet" case; the first one
 * with zero lexical overlap against the description is used, so the case
 * passes even when the description happens to mention e.g. "capital". */
const UNRELATED_PROMPTS = [
  "what is the capital of France",
  "how tall is Mount Everest",
  "who painted the Mona Lisa",
  "translate good morning into Spanish",
];

/** Keep derived keywords within every client's description budget: the
 * smallest profile truncates at 256 chars (see clients.ts). */
const TRUNCATION_SAFE_CHARS = 240;
const KEYWORD_LIMIT = 4;

/**
 * First few significant words of the description (stopwords dropped,
 * stem-deduplicated). Taken from the head of the text so they survive every
 * client's truncation, which guarantees the scaffolded trigger case scores
 * well above the threshold on all clients.
 */
function extractKeywords(description: string, limit = KEYWORD_LIMIT): string[] {
  const head =
    description.length > TRUNCATION_SAFE_CHARS
      ? description.slice(0, TRUNCATION_SAFE_CHARS).replace(/\S+$/, "")
      : description;
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of head.split(/\s+/)) {
    const tokens = tokenize(raw);
    if (tokens.length === 0 || tokens.every((t) => seen.has(t))) continue;
    for (const t of tokens) seen.add(t);
    const word = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (word.length === 0) continue;
    keywords.push(word);
    if (keywords.length >= limit) break;
  }
  return keywords;
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
