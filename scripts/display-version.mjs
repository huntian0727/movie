// Two-part visible version used by the app UI and local build metadata.
// Keep package.json's three-part technical SemVer independent from this label.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DISPLAY_VERSION_PATH = "src/shared/displayVersion.json";
export const MAX_MINOR = 999;

export function validateDisplayVersion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isSafeInteger(value.major) || value.major < 1 ||
      !Number.isSafeInteger(value.minor) || value.minor < 0 || value.minor > MAX_MINOR) {
    throw new Error("Display version requires integer major >=1 and minor between 0 and 999.");
  }
  return { major: value.major, minor: value.minor };
}

export function formatDisplayVersion(value) {
  const { major, minor } = validateDisplayVersion(value);
  return `${major}.${minor}`;
}

export function bumpDisplayVersion(current, level) {
  const { major, minor } = validateDisplayVersion(current);
  if (level === "major") {
    if (!Number.isSafeInteger(major + 1)) throw new Error("Major version overflow.");
    return { major: major + 1, minor: 0 };
  }
  if (level === "minor") {
    if (minor >= MAX_MINOR) throw new Error("Minor version reached 999; a major release is required.");
    return { major, minor: minor + 1 };
  }
  throw new Error("Version bump must be 'major' or 'minor'.");
}

/**
 * Local delivery guard: a different Git commit MUST have a newer visible
 * two-part version than the previously delivered daily desktop. Repacking
 * the same commit stays repeatable and does not silently advance a number.
 * Legacy desktop packages without displayVersion are allowed once.
 */
export function assertDeliveredVersionAdvanced(previousFlavor, nextVersion, nextCommit) {
  const next = validateDisplayVersion(nextVersion);
  if (!previousFlavor || typeof previousFlavor.displayVersion !== "string") return;
  const match = /^([0-9]+)[.]([0-9]{1,3})$/.exec(previousFlavor.displayVersion);
  if (!match) throw new Error("Previous desktop build has malformed displayVersion.");
  const previous = validateDisplayVersion({ major: Number(match[1]), minor: Number(match[2]) });
  const earlier = next.major < previous.major ||
    (next.major === previous.major && next.minor < previous.minor);
  if (earlier) throw new Error(`Visible version must not decrease: ${formatDisplayVersion(previous)} -> ${formatDisplayVersion(next)}.`);
  const unchanged = formatDisplayVersion(previous) === formatDisplayVersion(next);
  if (unchanged && previousFlavor.commit && previousFlavor.commit !== nextCommit) {
    throw new Error(`A new Git commit must bump the user-visible version above ${formatDisplayVersion(previous)}. Run npm run version:minor (or version:major), commit it, then repackage.`);
  }
}

export async function readDisplayVersion(root = process.cwd()) {
  const file = path.resolve(root, DISPLAY_VERSION_PATH);
  return validateDisplayVersion(JSON.parse(await readFile(file, "utf8")));
}

export async function writeDisplayVersion(root, version) {
  const file = path.resolve(root, DISPLAY_VERSION_PATH);
  await writeFile(file, JSON.stringify(validateDisplayVersion(version), null, 2) + "\n", "utf8");
}
