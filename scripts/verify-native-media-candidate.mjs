import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const lockFile = path.join(scriptDirectory, "native-media-candidate.lock.json");

export function validateCandidatePair(ffmpegVersionOutput, ffprobeVersionOutput, expectedVersion) {
  function parse(output, executable) {
    const version = output.match(new RegExp("^" + executable + " version (\\S+)", "m"))?.[1];
    const configuration = output.match(/^configuration: (.+)$/m)?.[1]?.trim();
    if (!version || !configuration) throw new Error(executable + " version/configuration is missing.");
    return { version, configuration };
  }
  const encoder = parse(ffmpegVersionOutput, "ffmpeg");
  const probe = parse(ffprobeVersionOutput, "ffprobe");
  if (encoder.version !== expectedVersion || probe.version !== expectedVersion) {
    throw new Error("Candidate FFmpeg and FFprobe must match the exact pinned build version.");
  }
  if (encoder.configuration !== probe.configuration) throw new Error("Candidate binary build configurations differ.");
  if (!encoder.configuration.includes("--arch=x86_64") || !encoder.configuration.includes("--target-os=mingw32")) {
    throw new Error("Candidate must be a Windows x64 build.");
  }
  if (/(?:^|\s)--enable-(?:gpl|nonfree)(?:\s|$)/.test(encoder.configuration)) {
    throw new Error("Candidate advertises GPL or nonfree configuration; expected LGPL variant.");
  }
  return {
    version: encoder.version,
    configuration: encoder.configuration,
    enabledLibraries: [...encoder.configuration.matchAll(/--enable-(lib[a-zA-Z0-9_-]+)/g)].map(match => match[1]).sort()
  };
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function assertRegularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("Candidate input must be a nonempty regular file.");
  return info.size;
}

async function assertWindowsX64(file) {
  const { open } = await import("node:fs/promises");
  const handle = await open(file, "r");
  try {
    const dos = Buffer.alloc(64);
    await handle.read(dos, 0, dos.length, 0);
    if (dos.toString("ascii", 0, 2) !== "MZ") throw new Error("Not a Windows PE executable.");
    const peOffset = dos.readUInt32LE(0x3c);
    const header = Buffer.alloc(6);
    await handle.read(header, 0, header.length, peOffset);
    if (header.toString("ascii", 0, 4) !== "PE\0\0" || header.readUInt16LE(4) !== 0x8664) {
      throw new Error("Candidate binary must use x64 PE machine type.");
    }
  } finally {
    await handle.close();
  }
}

async function query(executable, args) {
  const { stdout } = await execute(executable, args, { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  return stdout;
}

export async function inspectCandidate(directory, outputFile = path.join(directory, "candidate-evidence.json")) {
  const lock = JSON.parse(await readFile(lockFile, "utf8"));
  if (lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false) throw new Error("Candidate lock must remain explicitly unapproved.");
  const archive = path.join(directory, lock.archive);
  const [archiveSize, archiveHash] = await Promise.all([assertRegularFile(archive), sha256(archive)]);
  if (archiveHash !== lock.archiveSha256) throw new Error("Pinned upstream archive SHA-256 mismatch.");

  const names = ["ffmpeg.exe", "ffprobe.exe"];
  const binaries = [];
  const versions = [];
  for (const name of names) {
    const executable = path.join(directory, name);
    const bytes = await assertRegularFile(executable);
    await assertWindowsX64(executable);
    const [digest, versionOutput, buildConfiguration, licenseText] = await Promise.all([
      sha256(executable), query(executable, ["-version"]), query(executable, ["-buildconf"]), query(executable, ["-L"])
    ]);
    if (digest !== lock.expectedExecutables?.[name]) throw new Error(name + " differs from the pinned archive contents.");
    binaries.push({ name, bytes, sha256: digest, buildConfiguration, licenseText });
    versions.push(versionOutput);
  }
  const pair = validateCandidatePair(versions[0], versions[1], lock.expectedVersion);
  for (const binary of binaries) {
    if (!/Lesser General Public License/i.test(binary.licenseText)) {
      throw new Error(binary.name + " does not report the anticipated LGPL licensing text.");
    }
  }
  const licensePath = path.join(directory, "LICENSE.txt");
  await assertRegularFile(licensePath);
  const licenseSha = await sha256(licensePath);
  if (licenseSha !== lock.expectedLicenseSha256) throw new Error("License evidence differs from the pinned archive contents.");
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    finding: "PAIR_VERSION_AND_ARCHIVE_VERIFIED_SOURCE_COMPLIANCE_PENDING",
    approvedForDistribution: false,
    sourceComplianceApproved: false,
    archive: { name: lock.archive, bytes: archiveSize, sha256: archiveHash, url: lock.archiveUrl },
    buildSource: { project: lock.sourceProject, commit: lock.sourceCommit, releaseTag: lock.releaseTag },
    pair,
    binaries,
    includedLicenseTextSha256: licenseSha,
    unresolved: [
      "Complete corresponding FFmpeg and all enabled third-party library sources and patches",
      "Reproducible build instructions and source/binary correspondence",
      "Full enabled-library license inventory and distribution notices",
      "Remove or separately resolve GPL ffmpeg-static JavaScript wrapper in the application",
      "Regression and signed Windows installation QA; owner legal approval"
    ]
  };
  await writeFile(outputFile, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--candidate-directory");
  const directory = index >= 0 ? process.argv[index + 1] : null;
  if (!directory || process.argv.length !== index + 2) {
    console.error("Usage: node scripts/verify-native-media-candidate.mjs --candidate-directory <isolated-directory>");
    process.exitCode = 2;
  } else {
    inspectCandidate(path.resolve(directory)).then(result => {
      console.log(JSON.stringify({
        finding: result.finding,
        archiveSha256: result.archive.sha256,
        version: result.pair.version,
        binaries: result.binaries.map(({ name, sha256 }) => ({ name, sha256 })),
        approvedForDistribution: false
      }));
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
