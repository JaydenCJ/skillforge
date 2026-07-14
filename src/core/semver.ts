/**
 * A small, dependency-free semver implementation covering the subset
 * skillforge needs: parse, validate, compare (with full prerelease
 * precedence per semver.org §11) and npm-style bumping.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: (string | number)[];
  build: string[];
}

// Official semver.org regex (suggested in the spec appendix).
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseSemver(input: string): SemVer | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  const prerelease = (m[4] ?? "")
    .split(".")
    .filter((p) => p.length > 0)
    .map((p) => (/^(0|[1-9]\d*)$/.test(p) ? Number(p) : p));
  const build = (m[5] ?? "").split(".").filter((p) => p.length > 0);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
    build,
  };
}

export function isValidSemver(input: string): boolean {
  return parseSemver(input) !== null;
}

export function formatSemver(v: SemVer): string {
  let s = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length > 0) s += `-${v.prerelease.join(".")}`;
  if (v.build.length > 0) s += `+${v.build.join(".")}`;
  return s;
}

function compareIdentifiers(a: string | number, b: string | number): number {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  if (aNum && bNum) return a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum) return -1;
  if (bNum) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Returns -1, 0 or 1. Build metadata is ignored, per the spec. */
export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // A version without prerelease has HIGHER precedence than one with.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const len = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    const cmp = compareIdentifiers(a.prerelease[i]!, b.prerelease[i]!);
    if (cmp !== 0) return cmp;
  }
  if (a.prerelease.length === b.prerelease.length) return 0;
  return a.prerelease.length < b.prerelease.length ? -1 : 1;
}

export type BumpKind = "major" | "minor" | "patch" | "prerelease";

/**
 * npm-style version bumping.
 *
 * - `major` / `minor` / `patch`: zero the lower parts; a prerelease of the
 *   *same* patch level is "finalized" by a `patch` bump (1.2.3-beta.1 → 1.2.3).
 * - `prerelease`: increments the trailing numeric prerelease identifier, or
 *   starts `<next-patch>-<preid>.0` when the version is a release.
 */
export function bumpSemver(version: string, kind: BumpKind, preid = "beta"): string {
  const v = parseSemver(version);
  if (!v) throw new Error(`invalid semver: "${version}"`);
  const out: SemVer = { ...v, prerelease: [...v.prerelease], build: [] };
  switch (kind) {
    case "major":
      if (v.prerelease.length > 0 && v.minor === 0 && v.patch === 0) {
        // 2.0.0-beta.1 → 2.0.0
      } else {
        out.major += 1;
      }
      out.minor = 0;
      out.patch = 0;
      out.prerelease = [];
      break;
    case "minor":
      if (v.prerelease.length > 0 && v.patch === 0) {
        // 1.3.0-rc.0 → 1.3.0
      } else {
        out.minor += 1;
      }
      out.patch = 0;
      out.prerelease = [];
      break;
    case "patch":
      if (v.prerelease.length === 0) out.patch += 1;
      out.prerelease = [];
      break;
    case "prerelease": {
      if (v.prerelease.length === 0) {
        out.patch += 1;
        out.prerelease = [preid, 0];
        break;
      }
      const pre = [...v.prerelease];
      const last = pre[pre.length - 1];
      if (typeof last === "number") {
        pre[pre.length - 1] = last + 1;
      } else {
        pre.push(0);
      }
      // When a different preid is requested, restart its counter.
      if (typeof pre[0] === "string" && pre[0] !== preid) {
        out.prerelease = [preid, 0];
      } else {
        out.prerelease = pre;
      }
      break;
    }
  }
  return formatSemver(out);
}
