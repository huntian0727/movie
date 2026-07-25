import { listPackage } from "@electron/asar";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const resourcesDirectory = path.join(process.cwd(), "release", "win-unpacked", "resources");
const asarPath = path.join(resourcesDirectory, "app.asar");
await access(asarPath);

const files = await listPackage(asarPath);
const forbidden = files.filter((file) =>
  /(^|\/)(tests?|\.dbg)(\/|$)/i.test(file) || /(^|\/|\.)\.env/i.test(file) || /\.sqlite(?:-|$)/i.test(file)
);
if (forbidden.length > 0) throw new Error(`Forbidden files found in app.asar: ${forbidden.join(", ")}`);

const asarBytes = await readFile(asarPath);
const workspacePath = process.cwd().replaceAll("\\", "/");
if (asarBytes.includes(Buffer.from(workspacePath, "utf8"))) {
  throw new Error("Packaged app contains the local development workspace path");
}

await Promise.all([
  access(path.join(resourcesDirectory, "app.asar.unpacked", "node_modules", "better-sqlite3")),
  access(path.join(resourcesDirectory, "app.asar.unpacked", "node_modules", "ffmpeg-static")),
  access(path.join(resourcesDirectory, "app.asar.unpacked", "node_modules", "ffprobe-static"))
]);

console.log(`Packaged artifact content OK: ${files.length} asar entries, no forbidden development artifacts.`);
