import { listPackage } from "@electron/asar";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { authenticode, hashFile, readJson, releaseOutputDirectory, verifyApplicationVersion } from "./release-engineering.mjs";
import { candidateDirectory, liteFiles, liteRuntime, mediaVariant } from "./media-variant.mjs";

const resourcesDirectory = path.join(process.cwd(), releaseOutputDirectory(), "win-unpacked", "resources");
const asarPath = path.join(resourcesDirectory, "app.asar");
await regularFile(asarPath);

const files = await listPackage(asarPath);
const forbidden = files.filter((file) =>
  /(^|\/)(tests?|\.dbg)(\/|$)/i.test(file) || /(^|\/|\.)\.env/i.test(file) || /\.sqlite(?:-|$)/i.test(file) ||
  /\/node_modules\/(?:ffmpeg-static|ffprobe-static)(?:\/|$)/i.test(file) ||
  /\/node_modules\/better-sqlite3\/prebuilds\/(?!win32-x64\.node$)[^/]+\.node$/i.test(file)
);
if (forbidden.length > 0) throw new Error(`Forbidden files found in app.asar: ${forbidden.join(", ")}`);

const asarBytes = await readFile(asarPath);
const workspacePath = process.cwd().replaceAll("\\", "/");
if (asarBytes.includes(Buffer.from(workspacePath, "utf8"))) {
  throw new Error("Packaged app contains the local development workspace path");
}

const flavor = await readJson(path.join(resourcesDirectory, "build-flavor.json"));
const manifest = await readJson(path.join(process.cwd(), "package.json"));
if (flavor.version !== manifest.version || flavor.arch !== "x64" || flavor.mediaVariant !== mediaVariant()) throw new Error("Packaged build flavor is inconsistent.");
const lite = flavor.mediaVariant === "lite-candidate";
const mediaSource = candidateDirectory(process.cwd(), flavor.mediaVariant);
const unpacked = path.join(resourcesDirectory, "app.asar.unpacked", "node_modules");
const binaries = [
  path.join(unpacked, "better-sqlite3", "prebuilds", "win32-x64.node"),
  path.join(resourcesDirectory, "media-tools", "ffmpeg.exe"),
  path.join(resourcesDirectory, "media-tools", "ffprobe.exe"),
  path.join(resourcesDirectory, "native-player", "NativeHost.exe"),
  path.join(resourcesDirectory, "..", `${flavor.executableName}.exe`),
  ...(lite ? liteRuntime.map(name => path.join(resourcesDirectory, "media-tools", name)) : [])
];
for (const binary of binaries) {
  await regularFile(binary);
  const bytes = await readFile(binary);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Invalid packaged Windows PE binary.");
  const header = bytes.readUInt32LE(0x3c);
  if (header + 6 > bytes.length || bytes.toString("ascii", header, header + 4) !== "PE\0\0" || bytes.readUInt16LE(header + 4) !== 0x8664) {
    throw new Error("Packaged binary must have x64 PE architecture.");
  }
}
await verifyApplicationVersion(binaries[4], flavor);
await Promise.all([
  regularFile(path.join(resourcesDirectory, "..", "LICENSE.electron.txt")),
  regularFile(path.join(resourcesDirectory, "..", "LICENSES.chromium.html")),
  regularFile(path.join(resourcesDirectory, "legal", "PROJECT-LICENSE.txt")),
  regularFile(path.join(resourcesDirectory, "legal", "THIRD-PARTY-NOTICES.txt")),
  regularFile(path.join(resourcesDirectory, "legal", "dependency-inventory.json")),
  regularFile(path.join(resourcesDirectory, "media-tools", "LICENSE.txt")),
  regularFile(path.join(resourcesDirectory, "media-tools", "SOURCE-STATUS.txt")),
  ...(lite ? liteFiles.map(name => regularFile(path.join(resourcesDirectory, "media-tools", name))) : [])
]);
// Check copied binaries against the candidate build inputs, not merely directory existence.
for (const [packaged, source] of [
  [binaries[0], path.join(process.cwd(), "node_modules", "better-sqlite3", "prebuilds", "win32-x64.node")],
  [binaries[1], path.join(mediaSource, "ffmpeg.exe")],
  [binaries[2], path.join(mediaSource, "ffprobe.exe")],
  [binaries[3], path.join(process.cwd(), "native-bin", "NativeHost.exe")],
  ...(lite ? liteRuntime.map(name => [path.join(resourcesDirectory, "media-tools", name), path.join(mediaSource, name)]) : [])
]) {
  if (packaged === binaries[3] && flavor.releaseClass === "signed-release") {
    await authenticode(packaged, flavor);
    continue; // Approved input hash was checked before packing; signing changes its envelope.
  }
  if (await hashFile(packaged) !== await hashFile(source)) throw new Error("Packaged native binary differs from its verified build input.");
}

if (lite) {
  const pinned = await readJson(path.join(process.cwd(), "scripts", "native-media-lite.lock.json"));
  if (pinned.status !== "CANDIDATE_NOT_APPROVED" || pinned.distributable !== false) throw new Error("Lite license approval must remain false.");
  for (const [name, expected] of Object.entries(pinned.files)) {
    if (await hashFile(path.join(resourcesDirectory, "media-tools", name)) !== expected) {
      throw new Error("Packaged Lite file differs from pinned upstream input: " + name);
    }
  }
  if (await hashFile(path.join(resourcesDirectory, "media-tools", "LICENSE.txt")) !== pinned.files["COPYING.LGPLv2.1"]) {
    throw new Error("Packaged Lite LGPL license differs from pinned source");
  }
}
console.log(`Packaged artifact content OK: ${files.length} asar entries, no forbidden development artifacts.`);

async function regularFile(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("Required packaged file is missing, empty or a link.");
}
