import { describe, expect, it } from "vitest";
import { parseFrontmatter, setFrontmatterKey } from "../src/core/frontmatter.js";

describe("parseFrontmatter", () => {
  it("extracts known fields and the body", () => {
    const doc = `---
name: my-skill
description: Does things. Use when asked.
version: 1.0.0
license: MIT
---

# Body here
`;
    const { frontmatter, body, hasBlock } = parseFrontmatter(doc);
    expect(hasBlock).toBe(true);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("Does things. Use when asked.");
    expect(frontmatter.version).toBe("1.0.0");
    expect(body).toContain("# Body here");
  });

  it("treats a document without a leading --- as body-only", () => {
    const { frontmatter, body, hasBlock } = parseFrontmatter("# Just markdown\n");
    expect(hasBlock).toBe(false);
    expect(frontmatter.name).toBeUndefined();
    expect(body).toBe("# Just markdown\n");
  });

  it("treats an unterminated frontmatter block as missing", () => {
    const { hasBlock } = parseFrontmatter("---\nname: x\nno closing delimiter\n");
    expect(hasBlock).toBe(false);
  });

  it("collects unknown keys into extra", () => {
    const { frontmatter } = parseFrontmatter("---\nname: x\ncolor: red\n---\nbody");
    expect(frontmatter.extra["color"]).toBe("red");
  });

  it("coerces a numeric YAML version to a string", () => {
    const { frontmatter } = parseFrontmatter("---\nname: x\nversion: 1.5\n---\nbody");
    expect(frontmatter.version).toBe("1.5");
  });

  it("puts wrongly-typed known fields into extra instead of crashing", () => {
    const { frontmatter } = parseFrontmatter("---\nname: [not, a, string]\n---\nbody");
    expect(frontmatter.name).toBeUndefined();
    expect(frontmatter.extra["name"]).toEqual(["not", "a", "string"]);
  });
});

describe("setFrontmatterKey", () => {
  const doc = `---
name: my-skill
version: 1.0.0
---

body text
`;

  it("replaces an existing key in place, leaving the rest untouched", () => {
    const out = setFrontmatterKey(doc, "version", "2.0.0");
    expect(out).toContain("version: 2.0.0");
    expect(out).toContain("name: my-skill");
    expect(out).toContain("body text");
    expect(out).not.toContain("1.0.0");
  });

  it("inserts a missing key before the closing delimiter", () => {
    const out = setFrontmatterKey(doc, "license", "MIT");
    const fmEnd = out.indexOf("---", 3);
    expect(out.indexOf("license: MIT")).toBeGreaterThan(0);
    expect(out.indexOf("license: MIT")).toBeLessThan(fmEnd);
  });

  it("creates a frontmatter block when none exists", () => {
    const out = setFrontmatterKey("# no frontmatter\n", "version", "0.1.0");
    expect(out.startsWith("---\nversion: 0.1.0\n---\n")).toBe(true);
    expect(out).toContain("# no frontmatter");
  });

  it("does not confuse keys that share a prefix", () => {
    const tricky = "---\nversion-notes: keep\nversion: 1.0.0\n---\nbody";
    const out = setFrontmatterKey(tricky, "version", "1.1.0");
    expect(out).toContain("version-notes: keep");
    expect(out).toContain("version: 1.1.0");
  });

  it("preserves CRLF line endings when replacing a key", () => {
    const crlf = "---\r\nname: x\r\nversion: 1.0.0\r\n---\r\nbody\r\n";
    const out = setFrontmatterKey(crlf, "version", "2.0.0");
    expect(out).toBe("---\r\nname: x\r\nversion: 2.0.0\r\n---\r\nbody\r\n");
  });

  it("preserves CRLF line endings when inserting a key", () => {
    const crlf = "---\r\nname: x\r\n---\r\nbody\r\n";
    const out = setFrontmatterKey(crlf, "license", "MIT");
    expect(out).toBe("---\r\nname: x\r\nlicense: MIT\r\n---\r\nbody\r\n");
  });
});
