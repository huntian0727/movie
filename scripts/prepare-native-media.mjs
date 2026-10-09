import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inspectCandidate } from "./verify-native-media-candidate.mjs";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root, "scripts", "native-media-candidate.lock.json"), "utf8"));
const candidate = process.env.MOVIE_MEDIA_CANDIDATE_DIR
  ? path.resolve(process.env.MOVIE_MEDIA_CANDIDATE_DIR)
  : path.join(root, ".tmp", "native-media-download");
const dest = path.join(root, "native-bin", "media-tools");

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function rejectUnsafeOutput(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Untrusted native media staging destination: " + path.basename(file));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
async function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", c => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}
async function requireSha(file, expected) {
  if (!await exists(file) || await digest(file) !== expected) throw new Error("Pinned media candidate hash mismatch: " + path.basename(file));
}
function psQuote(value) { return "'" + value.replaceAll("'", "''") + "'"; }
async function powershell(script) {
  await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 300000, maxBuffer: 1024 * 1024, windowsHide: true
  });
}
async function prepareArchive() {
  await mkdir(candidate, { recursive: true });
  const archive = path.join(candidate, lock.archive);
  if (!await exists(archive)) {
    if (process.env.MOVIE_MEDIA_CANDIDATE_DIR) throw new Error("An explicit media candidate directory must already contain the exact release archive");
    const temporary = archive + ".partial";
    // The GitHub release URL is pinned in the checked-in lock and every downloaded byte is hash-checked.
    const script = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri " +
      psQuote(lock.archiveUrl) + " -OutFile " + psQuote(temporary);
    await powershell(script);
    await requireSha(temporary, lock.archiveSha256);
    const { rename } = await import("node:fs/promises");
    await rename(temporary, archive);
  }
  await requireSha(archive, lock.archiveSha256);
  if (!await exists(path.join(candidate, "ffmpeg.exe")) ||
      !await exists(path.join(candidate, "ffprobe.exe")) ||
      !await exists(path.join(candidate, "LICENSE.txt"))) {
    const extraction = path.join(candidate, "extracted");
    await mkdir(extraction, { recursive: true });
    await powershell("$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath " + psQuote(archive) +
      " -DestinationPath " + psQuote(extraction) + " -Force");
    async function locate(dir, filename, depth = 0) {
      if (depth > 5) throw new Error("Unexpected source ZIP nesting");
      for (const child of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, child.name);
        if (child.isSymbolicLink()) throw new Error("Source ZIP contains a link");
        if (child.isFile() && child.name === filename) return full;
        if (child.isDirectory()) { const found = await locate(full, filename, depth + 1); if (found) return found; }
      }
      return null;
    }
    for (const file of ["ffmpeg.exe", "ffprobe.exe", "LICENSE.txt"]) {
      const match = await locate(extraction, file);
      if (!match) throw new Error("Pinned source archive missing " + file);
      await copyFile(match, path.join(candidate, file));
    }
  }
}
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Pinned media toolchain requires Windows x64");
if (lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false) throw new Error("Unsigned media candidate must remain unapproved");
await prepareArchive();
const evidencePath = path.join(root, ".tmp", "media-candidate-evidence.json");
const evidence = await inspectCandidate(candidate, evidencePath);
if (evidence.sourceComplianceApproved !== false || evidence.approvedForDistribution !== false) throw new Error("This staging step never grants distribution approval");
await mkdir(dest, { recursive: true });
for (const [name, expected] of Object.entries(lock.expectedExecutables)) {
  const input = path.join(candidate, name), output = path.join(dest, name);
  await requireSha(input, expected);
  await rejectUnsafeOutput(output);
  if (!await exists(output) || await digest(output) !== expected) await copyFile(input, output);
  await requireSha(output, expected);
}
const license = path.join(dest, "LICENSE.txt");
await rejectUnsafeOutput(license);
if (!await exists(license) || await digest(license) !== lock.expectedLicenseSha256) await copyFile(path.join(candidate, "LICENSE.txt"), license);
await requireSha(license, lock.expectedLicenseSha256);
await writeFile(path.join(dest, "SOURCE-STATUS.txt"),
  "Pinned BtbN LGPLv3 native media candidate; corresponding sources and third-party library notices are NOT APPROVED.\n" +
  "source=" + lock.archiveUrl + "\n" + "source-commit=" + lock.sourceCommit + "\n" +
  "source-archive-sha256=" + lock.archiveSha256 + "\n" +
  "Do not publicly redistribute this test build until full corresponding-source review and owner approval.\n", "utf8");
console.log("Pinned native media staged: " + evidence.pair.version + " (NOT APPROVED FOR PUBLIC DISTRIBUTION)");
