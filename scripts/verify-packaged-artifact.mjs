import { listPackage } from "@electron/asar";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { authenticode, hashFile, readJson, releaseOutputDirectory, verifyApplicationVersion } from "./release-engineering.mjs";

const resourcesDirectory = path.join(process.cwd(), releaseOutputDirectory(), "win-unpacked", "resources");
const asarPath = path.join(resourcesDirectory, "app.asar");
await regularFile(asarPath);

const files = await listPackage(asarPath);
const forbidden = files.filter((file) =>
  /(^|\/)(tests?|\.dbg)(\/|$)/i.test(file) || /(^|\/|\.)\.env/i.test(file) || /\.sqlite(?:-|$)/i.test(file) ||
  /\/node_modules\/ffprobe-static\/bin\/(?:darwin|linux|win32\/ia32)(?:\/|$)/i.test(file) ||
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
if (flavor.version !== manifest.version || flavor.arch !== "x64") throw new Error("Packaged build flavor is inconsistent.");
const unpacked = path.join(resourcesDirectory, "app.asar.unpacked", "node_modules");
const binaries = [
  path.join(unpacked, "better-sqlite3", "prebuilds", "win32-x64.node"),
  path.join(unpacked, "ffmpeg-static", "ffmpeg.exe"),
  path.join(unpacked, "ffprobe-static", "bin", "win32", "x64", "ffprobe.exe"),
  path.join(resourcesDirectory, "native-player", "NativeHost.exe"),
  path.join(resourcesDirectory, "..", `${flavor.executableName}.exe`)
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
  regularFile(path.join(unpacked, "ffmpeg-static", "ffmpeg.exe.LICENSE")),
  regularFile(path.join(unpacked, "ffmpeg-static", "ffmpeg.exe.README"))
]);
// Check copied binaries against the candidate build inputs, not merely directory existence.
for (const [packaged, source] of [
  [binaries[0], path.join(process.cwd(), "node_modules", "better-sqlite3", "prebuilds", "win32-x64.node")],
  [binaries[1], path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe")],
  [binaries[2], path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", "win32", "x64", "ffprobe.exe")],
  [binaries[3], path.join(process.cwd(), "native-bin", "NativeHost.exe")]
]) {
  if (packaged === binaries[3] && flavor.releaseClass === "signed-release") {
    await authenticode(packaged, flavor);
    continue; // Approved input hash was checked before packing; signing changes its envelope.
  }
  if (await hashFile(packaged) !== await hashFile(source)) throw new Error("Packaged native binary differs from its verified build input.");
}

console.log(`Packaged artifact content OK: ${files.length} asar entries, no forbidden development artifacts.`);

async function regularFile(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("Required packaged file is missing, empty or a link.");
}
