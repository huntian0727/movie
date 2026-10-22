// Usage: npm run version:minor  OR  npm run version:major
// Run once before each user-visible local delivery. This command is manual on purpose;
// test/build retries must NEVER silently advance the displayed version.
import { bumpDisplayVersion, formatDisplayVersion, readDisplayVersion, writeDisplayVersion } from "./display-version.mjs";
const level = process.argv[2];
if (level !== "minor" && level !== "major") {
  throw new Error("Usage: node scripts/bump-display-version.mjs <major|minor>");
}
const original = await readDisplayVersion();
const next = bumpDisplayVersion(original, level);
await writeDisplayVersion(process.cwd(), next);
console.log(`Display version ${formatDisplayVersion(original)} → ${formatDisplayVersion(next)} (${level})`);
