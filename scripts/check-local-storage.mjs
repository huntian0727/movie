import { existsSync, lstatSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";

const root = realpathSync(process.cwd());
if (process.platform !== "win32" || !existsSync("D:\\")) {
  console.log("[movie-storage] local D: routing check skipped outside the maintainer Windows environment.");
  process.exit(0);
}

const storageRoot = "D:\\MovieProjectBuilds\\movie";
const backupRoot = "D:\\MovieProjectBackups\\movie-project";
const routes = [
  [".tmp", path.join(storageRoot, ".tmp")],
  ["release\\unsigned-test-build", path.join(storageRoot, "release", "unsigned-test-build")],
  ["release\\local-optimized", path.join(storageRoot, "release", "local-optimized")],
  ["release\\local-background", path.join(storageRoot, "release", "local-background")],
  ["release\\unsigned-community-qa", path.join(storageRoot, "release", "unsigned-community-qa")]
];

function normalized(value) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

for (const [relative, expectedTarget] of routes) {
  const aliasPath = path.join(root, relative);
  const linkStat = lstatSync(aliasPath);
  if (!linkStat.isSymbolicLink()) throw new Error(`Expected a junction at ${aliasPath}`);
  const actualTarget = realpathSync(aliasPath);
  const resolvedExpected = realpathSync(expectedTarget);
  if (normalized(actualTarget) !== normalized(resolvedExpected)) {
    throw new Error(`Storage route mismatch: ${aliasPath} -> ${actualTarget}; expected ${resolvedExpected}`);
  }
  console.log(`OK ${relative} -> ${actualTarget}`);
}

const nativeBin = lstatSync(path.join(root, "native-bin"));
if (nativeBin.isSymbolicLink()) throw new Error("native-bin must remain a real in-repository directory for the toolchain safety guard.");

for (const required of [
  backupRoot,
  path.join(storageRoot, "temp"),
  path.join(storageRoot, "npm-cache"),
  path.join(storageRoot, "electron-builder-cache"),
  path.join(storageRoot, "release", "win-unpacked-baseline", "resources", "build-flavor.json")
]) {
  if (!existsSync(required)) throw new Error(`Required D: storage directory or daily-flavor baseline is missing: ${required}`);
}

const cFree = Number(statfsSync("C:\\").bavail) * Number(statfsSync("C:\\").bsize);
const dStats = statfsSync("D:\\");
const dFree = Number(dStats.bavail) * Number(dStats.bsize);
if (dFree < 8 * 1024 ** 3) throw new Error("D: has less than 8 GiB free; stop heavy build/test tasks.");
console.log(`C_FREE_GIB=${(cFree / 1024 ** 3).toFixed(2)}`);
console.log(`D_FREE_GIB=${(dFree / 1024 ** 3).toFixed(2)}`);
console.log("LOCAL_STORAGE_CHECK=PASS");
