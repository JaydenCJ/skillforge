/**
 * Deterministic skill-trigger simulation.
 *
 * Clients decide whether to load a skill by matching the user's prompt
 * against the skill's frontmatter `description`. skillforge models that
 * decision with a transparent lexical-overlap score so behavior tests are
 * reproducible offline (no model calls) and comparable across clients:
 * because each client sees a different *effective* description (truncation,
 * dropped fields — see clients.ts), the same prompt can trigger on one
 * client and not another. That difference is exactly what `skillforge test`
 * reports as a behavior diff.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for",
  "from", "has", "have", "how", "i", "in", "is", "it", "its", "me", "my", "of",
  "on", "or", "our", "please", "should", "so", "some", "that", "the", "their",
  "them", "then", "these", "they", "this", "to", "up", "us", "use", "user",
  "want", "we", "what", "when", "which", "will", "with", "you", "your",
]);

/** Lowercase, strip punctuation, drop stopwords, light suffix stemming. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Very light stemmer: enough to unify "commits/commit", "entries/entry". */
export function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  // Strip "es" only after sibilants ("boxes" → "box"), otherwise plain "s"
  // ("messages" → "message", not "messag").
  if (token.length > 4 && /(ss|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("ed") && !token.endsWith("eed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us")) {
    return token.slice(0, -1);
  }
  return token;
}

export interface TriggerResult {
  score: number;
  triggered: boolean;
  /** Prompt tokens found in the description (post-normalization). */
  matched: string[];
  /** Prompt tokens not found. */
  missed: string[];
}

export const DEFAULT_THRESHOLD = 0.3;

/**
 * Score how strongly `prompt` matches `description`.
 *
 * score = (matched unique prompt tokens + bigram bonus) / unique prompt tokens,
 * clamped to [0, 1]. A bigram match (two consecutive prompt words appearing
 * consecutively in the description) is strong evidence, so each one adds 0.5
 * of a token. Deterministic and order-independent for unigrams.
 */
export function scoreTrigger(
  description: string,
  prompt: string,
  threshold: number = DEFAULT_THRESHOLD,
): TriggerResult {
  const descTokens = tokenize(description);
  const promptTokens = tokenize(prompt);
  if (promptTokens.length === 0 || descTokens.length === 0) {
    return { score: 0, triggered: false, matched: [], missed: promptTokens };
  }
  const descSet = new Set(descTokens);
  const uniquePrompt = [...new Set(promptTokens)];
  const matched: string[] = [];
  const missed: string[] = [];
  for (const t of uniquePrompt) {
    (descSet.has(t) ? matched : missed).push(t);
  }

  // Bigram bonus.
  const descBigrams = new Set<string>();
  for (let i = 0; i + 1 < descTokens.length; i++) {
    descBigrams.add(`${descTokens[i]} ${descTokens[i + 1]}`);
  }
  let bigramBonus = 0;
  for (let i = 0; i + 1 < promptTokens.length; i++) {
    if (descBigrams.has(`${promptTokens[i]} ${promptTokens[i + 1]}`)) bigramBonus += 0.5;
  }

  const rawScore = (matched.length + bigramBonus) / uniquePrompt.length;
  const score = Math.min(1, Number(rawScore.toFixed(4)));
  return { score, triggered: score >= threshold, matched, missed };
}
