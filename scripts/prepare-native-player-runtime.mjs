import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { playerRuntimeDirectory, verifyPlayerRuntime } from "./native-player-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root, "scripts/native-player-runtime.lock.json"), "utf8"));
const destination = playerRuntimeDirectory(root);
try { await verifyPlayerRuntime(destination, lock); console.log("Pinned player runtime already staged (not approved for distribution)."); process.exit(0); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Player runtime requires Windows x64.");
const cache = path.join(root, ".tmp/native-player-download");
await mkdir(cache, { recursive: true });
await mkdir(destination, { recursive: true });
async function download(url, file, expected) {
  try { if (createHash("sha256").update(await readFile(file)).digest("hex") === expected) return; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error("Player runtime download failed: " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Player download differs from pinned source.");
  await writeFile(file + ".partial", bytes); await rename(file + ".partial", file);
}
let dll = process.env.MOVIE_LIBMPV_DLL ? path.resolve(process.env.MOVIE_LIBMPV_DLL) : path.join(cache, "libmpv-2.dll");
if (!process.env.MOVIE_LIBMPV_DLL) {
  const archive = path.join(cache, "mpv-dev-x86_64-20261002-git-3186d369f9.7z");
  await download(lock.archiveUrl, archive, lock.archiveSha256);
  // Extraction utility is build-only, from the locked electron-winstaller dependency.
  // 7-Zip loads the fixed name 7z.dll; do not rely on npm's architecture-selection hook.
  const extractor = path.join(cache, "extractor-x64");
  await mkdir(extractor, { recursive: true });
  await copyFile(path.join(root,"node_modules/electron-winstaller/vendor/7z-x64.exe"),path.join(extractor,"7z.exe"));
  await copyFile(path.join(root,"node_modules/electron-winstaller/vendor/7z-x64.dll"),path.join(extractor,"7z.dll"));
  await promisify(execFile)(path.join(extractor, "7z.exe"),
    ["x", archive, "libmpv-2.dll", "-o" + cache, "-y"], { windowsHide: true, timeout: 60_000 });
}
for (const name of ["Copyright", "LICENSE.GPL", "LICENSE.LGPL"]) {
  await download(lock.noticeSourceBase + name, path.join(cache, name), lock.files[name]);
}
// Reject links and modified offline DLLs just as downloads.
const dllInfo = await lstat(dll);
if (!dllInfo.isFile() || dllInfo.isSymbolicLink() || createHash("sha256").update(await readFile(dll)).digest("hex") !== lock.files["libmpv-2.dll"]) throw new Error("Offline libmpv differs from pinned input.");
for (const name of Object.keys(lock.files)) {
  const target = path.join(destination, name);
  try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe player staging destination"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await copyFile(name === "libmpv-2.dll" ? dll : path.join(cache, name), target);
}
await verifyPlayerRuntime(destination, lock);
console.log("Player runtime staged; public source/license approval remains required.");
