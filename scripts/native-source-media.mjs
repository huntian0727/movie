import path from "node:path";
import { lstat, readFile, readdir } from "node:fs/promises";
import { checkedFile, materializePinnedFiles, readPinnedZip, sha256 } from "./native-player-toolchain.mjs";

export function assertSourceMediaLock(lock) {
  const notices = ["LICENSE.txt", "SOURCE-STATUS.txt"];
  if (lock.schemaVersion !== 2 || lock.variant !== "source-candidate" || lock.status !== "CANDIDATE_NOT_APPROVED" ||
      lock.distributable !== false || !lock.files?.["ffmpeg.exe"] || !lock.files?.["ffprobe.exe"] ||
      notices.some(name => !lock.files?.[name]) || !/^[a-f0-9]{64}$/.test(lock.archiveSha256 ?? "") ||
      !Number.isSafeInteger(lock.archiveBytes) || lock.archiveBytes <= 0 ||
      lock.licenseSource !== "docs/legal/FFMPEG-SOURCE-CANDIDATE-LICENSE.txt" ||
      typeof lock.sourceStatusText !== "string" || sha256(Buffer.from(lock.sourceStatusText)) !== lock.files["SOURCE-STATUS.txt"] ||
      Object.entries(lock.files).some(([name, hash]) => !/^[a-f0-9]{64}$/.test(hash) ||
        !(notices.includes(name) || ["ffmpeg.exe", "ffprobe.exe"].includes(name) || /^[a-z0-9][a-z0-9_+-]*\.dll$/i.test(name)))) {
    throw new Error("Source media inputs must remain pinned, safe and unapproved.");
  }
}

export function assertPrivateSourceMedia(env = process.env) {
  const publicTestStaging = env.RELEASE_PUBLIC_TEST_ACKNOWLEDGED === "true" && /^refs\/tags\/v\d+\.\d+\.\d+-beta\.\d+$/.test(env.GITHUB_REF ?? "");
  const formalStaging = env.MOVIE_RELEASE_CLASS === "unsigned-public-release" && env.MOVIE_MEDIA_VARIANT === "source-candidate" && env.MOVIE_PLAYER_VARIANT === "source-candidate" &&
    env.GITHUB_ACTIONS === "true" && env.RELEASE_LICENSE_APPROVED === "true" && env.RELEASE_BINARY_COMPLIANCE_APPROVED === "true" && (env.RELEASE_MANUAL_QA_APPROVED === "true" || publicTestStaging) && env.RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED === "true";
  if (env.MOVIE_RELEASE_CLASS && !["unsigned-test-build", "unsigned-community-qa"].includes(env.MOVIE_RELEASE_CLASS) && !formalStaging) {
    throw new Error("Source media candidate requires private QA; formal distribution remains blocked.");
  }
}

export async function verifySourceMedia(directory, lock) {
  assertSourceMediaLock(lock);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe source media directory.");
  for (const [name, expected] of Object.entries(lock.files)) {
    const file = path.join(directory, name), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new Error("Unsafe source media file: " + name);
    const bytes = await readFile(file);
    if (sha256(bytes) !== expected) throw new Error("Pinned source media differs: " + name);
    if (/\.(exe|dll)$/i.test(name)) {
      const pe = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : -1;
      if (bytes.toString("ascii", 0, 2) !== "MZ" || pe < 64 || pe + 6 > bytes.length ||
          bytes.toString("ascii", pe, pe + 4) !== "PE\0\0" || bytes.readUInt16LE(pe + 4) !== 0x8664) {
        throw new Error("Source media must be Windows x64: " + name);
      }
    }
  }
  for (const name of await readdir(directory)) {
    if (!Object.hasOwn(lock.files, name)) throw new Error("Unexpected source media file: " + name);
  }
}

export async function stageSourceMedia(root, directory, archive, lock, env = process.env) {
  assertPrivateSourceMedia(env);
  assertSourceMediaLock(lock);
  checkedFile(root, path.resolve(archive));
  const bytes = await readFile(archive);
  if (bytes.length !== lock.archiveBytes || sha256(bytes) !== lock.archiveSha256) throw new Error("Source media archive differs from pinned producer output.");
  const entries = readPinnedZip(bytes, name => /\.(exe|dll)$/i.test(name) && Object.hasOwn(lock.files, name));
  const binaryNames = Object.keys(lock.files).filter(name => /\.(exe|dll)$/i.test(name));
  if (entries.size !== binaryNames.length) throw new Error("Source media archive has missing runtime files.");
  checkedFile(root, path.join(root, lock.licenseSource));
  entries.set("LICENSE.txt", await readFile(path.join(root, lock.licenseSource)));
  entries.set("SOURCE-STATUS.txt", Buffer.from(lock.sourceStatusText));
  for (const [name, data] of entries) if (sha256(data) !== lock.files[name]) throw new Error("Source media entry differs: " + name);
  materializePinnedFiles(root, directory, entries);
  await verifySourceMedia(directory, lock);
}
