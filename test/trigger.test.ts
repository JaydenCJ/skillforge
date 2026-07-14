import { describe, expect, it } from "vitest";
import { scoreTrigger, stem, tokenize } from "../src/core/trigger.js";

describe("tokenize", () => {
  it("lowercases, strips punctuation and drops stopwords", () => {
    expect(tokenize("Write a Commit Message, please!")).toEqual(["write", "commit", "message"]);
  });

  it("splits hyphenated terms", () => {
    expect(tokenize("release-notes")).toEqual(["release", "note"]);
  });

  it("returns an empty list for stopword-only input", () => {
    expect(tokenize("what is the")).toEqual([]);
  });
});

describe("stem", () => {
  it("unifies plurals without mangling the base word", () => {
    expect(stem("messages")).toBe("message");
    expect(stem("commits")).toBe("commit");
    expect(stem("entries")).toBe("entry");
    expect(stem("boxes")).toBe("box");
  });

  it("leaves short words, -ss and -us words alone", () => {
    expect(stem("as")).toBe("as");
    expect(stem("class")).toBe("class");
    expect(stem("status")).toBe("status");
  });

  it("strips -ing and -ed suffixes", () => {
    expect(stem("refactoring")).toBe("refactor");
    expect(stem("parsed")).toBe("pars");
    expect(stem("agreed")).toBe("agreed");
  });
});

describe("scoreTrigger", () => {
  const description =
    "Write git commit messages as haiku. Use when the user asks for a commit message or wants a diff summarized.";

  it("scores an on-topic prompt above the default threshold", () => {
    const r = scoreTrigger(description, "write a commit message for this diff");
    expect(r.triggered).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.75);
    expect(r.missed).toEqual([]);
  });

  it("scores an off-topic prompt at zero", () => {
    const r = scoreTrigger(description, "what is the capital of France");
    expect(r.triggered).toBe(false);
    expect(r.score).toBe(0);
  });

  it("returns zero for an empty prompt or empty description", () => {
    expect(scoreTrigger(description, "").score).toBe(0);
    expect(scoreTrigger("", "write a commit message").score).toBe(0);
  });

  it("adds a bigram bonus for consecutive-word matches, capped at 1", () => {
    const prompt = "commit message drafts";
    const scattered = scoreTrigger("commit logs and message notes", prompt);
    const adjacent = scoreTrigger("commit message notes", prompt);
    expect(adjacent.score).toBeGreaterThan(scattered.score);
    expect(adjacent.score).toBeLessThanOrEqual(1);
  });

  it("respects a custom threshold", () => {
    const loose = scoreTrigger(description, "summarize my commit", 0.2);
    const strict = scoreTrigger(description, "summarize my commit", 0.99);
    expect(loose.score).toBe(strict.score);
    expect(loose.triggered).toBe(true);
    expect(strict.triggered).toBe(false);
  });

  it("is sensitive to description truncation (the cross-client failure mode)", () => {
    const full =
      "Handles commit haiku. Use when asked for commit messages. Also converts changelog sections into poem cycles.";
    const truncated = full.slice(0, 60); // cut before the changelog sentence
    const prompt = "convert this changelog into a poem cycle";
    expect(scoreTrigger(full, prompt).triggered).toBe(true);
    expect(scoreTrigger(truncated, prompt).triggered).toBe(false);
  });
});
