import { spawn } from "node:child_process";
import { mkdir, statfs } from "node:fs/promises";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const [requestedCommand, ...args] = process.argv.slice(2);
if (!requestedCommand) throw new Error("Usage: node scripts/with-movie-storage.mjs <command> [args...]");

const env = { ...process.env };
const isMaintainerWindows = process.platform === "win32" && env.GITHUB_ACTIONS !== "true";
if (isMaintainerWindows && existsSync("D:\\")) {
  const storageRoot = path.resolve(env.MOVIE_STORAGE_ROOT || "D:\\MovieProjectBuilds\\movie");
  const tempRoot = path.join(storageRoot, ".tmp");
  const processTemp = path.join(storageRoot, "temp");
  const npmCache = path.join(storageRoot, "npm-cache");
  const electronCache = path.join(storageRoot, "electron-builder-cache");
  const backupRoot = path.resolve(env.MOVIE_PROJECT_BACKUP_ROOT || "D:\\MovieProjectBackups\\movie-project");
  const requiredDirectories = [storageRoot, tempRoot, processTemp, npmCache, electronCache, backupRoot];
  for (const directory of requiredDirectories) await mkdir(directory, { recursive: true });

  const stats = await statfs("D:\\");
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (freeBytes < 8 * 1024 ** 3) {
    throw new Error(`D: has only ${(freeBytes / 1024 ** 3).toFixed(2)} GiB free; packaging/tests are stopped before they can fill C:.`);
  }

  Object.assign(env, {
    MOVIE_STORAGE_ROOT: storageRoot,
    MOVIE_TEMP_ROOT: tempRoot,
    MOVIE_PROJECT_BACKUP_ROOT: backupRoot,
    TEMP: processTemp,
    TMP: processTemp,
    TMPDIR: processTemp,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_cache: npmCache,
    ELECTRON_BUILDER_CACHE: electronCache
  });

  const projectRoot = process.cwd();
  const routes = [
    [".tmp", path.join(storageRoot, ".tmp")],
    ["release/unsigned-test-build", path.join(storageRoot, "release", "unsigned-test-build")],
    ["release/local-optimized", path.join(storageRoot, "release", "local-optimized")],
    ["release/local-background", path.join(storageRoot, "release", "local-background")],
    ["release/unsigned-community-qa", path.join(storageRoot, "release", "unsigned-community-qa")]
  ];
  const normalize = value => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  for (const [relative, expectedPath] of routes) {
    const aliasPath = path.join(projectRoot, relative);
    if (!existsSync(aliasPath) || !lstatSync(aliasPath).isSymbolicLink()) {
      throw new Error(`Required D: junction is missing at ${aliasPath}; run npm run storage:check and stop instead of writing build output to C:.`);
    }
    const actual = realpathSync(aliasPath);
    const expected = realpathSync(expectedPath);
    if (normalize(actual) !== normalize(expected)) {
      throw new Error(`Unexpected storage target for ${relative}: ${actual}; expected ${expected}`);
    }
  }
  if (lstatSync(path.join(projectRoot, "native-bin")).isSymbolicLink()) {
    throw new Error("native-bin must remain a real in-repository directory for toolchain path-safety checks.");
  }
  const flavorBaseline = path.join(storageRoot, "release", "win-unpacked-baseline", "resources", "build-flavor.json");
  if (!existsSync(flavorBaseline)) throw new Error(`Daily-flavor baseline is missing at ${flavorBaseline}; local packaging is blocked.`);
  console.log(`[movie-storage] D: build/temp/cache/backup roots, 5 junctions and daily-flavor baseline verified (${(freeBytes / 1024 ** 3).toFixed(1)} GiB free).`);
}

const command = process.platform === "win32" && requestedCommand.toLowerCase() === "npm" ? "npm.cmd" : requestedCommand;
const child = spawn(command, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: true,
  shell: process.platform === "win32"
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
