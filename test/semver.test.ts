import { describe, expect, it } from "vitest";
import {
  bumpSemver,
  compareSemver,
  formatSemver,
  isValidSemver,
  parseSemver,
} from "../src/core/semver.js";

describe("parseSemver", () => {
  it("parses a plain release version", () => {
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
    });
  });

  it("parses prerelease and build metadata, with numeric identifiers as numbers", () => {
    const v = parseSemver("1.0.0-beta.2+build.42");
    expect(v).not.toBeNull();
    expect(v!.prerelease).toEqual(["beta", 2]);
    expect(v!.build).toEqual(["build", "42"]);
  });

  it("rejects malformed versions", () => {
    for (const bad of ["1.2", "v1.2.3", "1.02.3", "1.2.3-", "1.2.3-01", "one.two.three", ""]) {
      expect(isValidSemver(bad), bad).toBe(false);
    }
  });

  it("round-trips through formatSemver", () => {
    for (const s of ["0.1.0", "2.0.0-rc.1", "1.2.3-alpha.beta.7+sha.abc"]) {
      expect(formatSemver(parseSemver(s)!)).toBe(s);
    }
  });
});

describe("compareSemver", () => {
  const cmp = (a: string, b: string): number => compareSemver(parseSemver(a)!, parseSemver(b)!);

  it("orders the semver.org §11 prerelease example correctly", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i + 1 < chain.length; i++) {
      expect(cmp(chain[i]!, chain[i + 1]!), `${chain[i]} < ${chain[i + 1]}`).toBe(-1);
      expect(cmp(chain[i + 1]!, chain[i]!)).toBe(1);
    }
  });

  it("ignores build metadata", () => {
    expect(cmp("1.0.0+abc", "1.0.0+def")).toBe(0);
  });

  it("compares numeric identifiers numerically, not lexically", () => {
    expect(cmp("1.0.0-beta.9", "1.0.0-beta.10")).toBe(-1);
  });
});

describe("bumpSemver", () => {
  it("bumps major / minor / patch and zeroes lower parts", () => {
    expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
    expect(bumpSemver("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpSemver("1.2.3", "patch")).toBe("1.2.4");
  });

  it("finalizes a prerelease instead of skipping a version (npm behavior)", () => {
    expect(bumpSemver("1.2.3-beta.1", "patch")).toBe("1.2.3");
    expect(bumpSemver("1.3.0-rc.0", "minor")).toBe("1.3.0");
    expect(bumpSemver("2.0.0-rc.2", "major")).toBe("2.0.0");
  });

  it("starts a prerelease from a release version", () => {
    expect(bumpSemver("1.2.3", "prerelease")).toBe("1.2.4-beta.0");
    expect(bumpSemver("1.2.3", "prerelease", "rc")).toBe("1.2.4-rc.0");
  });

  it("increments an existing prerelease counter", () => {
    expect(bumpSemver("1.2.4-beta.0", "prerelease")).toBe("1.2.4-beta.1");
    expect(bumpSemver("1.2.4-beta.9", "prerelease")).toBe("1.2.4-beta.10");
  });

  it("restarts the counter when the preid changes", () => {
    expect(bumpSemver("1.2.4-beta.3", "prerelease", "rc")).toBe("1.2.4-rc.0");
  });

  it("throws on invalid input", () => {
    expect(() => bumpSemver("not-a-version", "patch")).toThrow(/invalid semver/);
  });
});
