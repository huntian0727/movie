#!/usr/bin/env node
/**
 * Prepare the offline LICENSE/SOURCE companion for a future community release.
 * This NEVER creates, renames, signs or publishes an installer.
 * Intentional fail-closed behavior: no approval file is changed.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const pinnedSources = Object.freeze({
  name: "FFmpeg-Lite-8.1.2-Windows-x64-SOURCES-CANDIDATE.zip",
  sha256: "a996afcfd3f2601d0ef324f635d2c63adbb3abfb441c1d5aa0c87652db3258b4",
  size: 239498523,
});
export const nativeNoticeNames = Object.freeze(["COPYING.LGPLv2.1", "SOURCE.txt", "LIBVPL-LICENSE.txt", "LIBOPENH264-LICENSE.txt", "LIBWINPTHREAD-LICENSE.txt", "GCC-LICENSE.txt"]);
const requiredAssets = [
  ["LICENSE", "PROJECT-LICENSE.txt"],
  ["THIRD_PARTY_LICENSES.md", "THIRD_PARTY_LICENSES.md"],
  ["docs/legal/FFMPEG_BUILD_INFO.md", "FFMPEG_BUILD_INFO.md"],
  ["docs/legal/NATIVE_COMPONENTS.md", "NATIVE_COMPONENTS.md"],
  ["docs/legal/THIRD_PARTY_RELEASE_NOTICES.md", "THIRD_PARTY_RELEASE_NOTICES.md"],
  ["docs/legal/FFMPEG-LITE-SBOM.spdx.json", "FFMPEG-LITE-SBOM.spdx.json"],
  ["docs/release-notes-v0.1.15-draft.md", "RELEASE-NOTES-DRAFT.md"],
];
export function assertPinnedSource({ sha256, size }) {
  if (sha256 !== pinnedSources.sha256 || size !== pinnedSources.size) {
    throw new Error("FFmpeg sources differ from the verified 15-entry companion archive.");
  }
}
export function generateSha256Sums(assets) {
  const names = new Set();
  for (const a of assets) {
    if (!/^[\w.\-\u4e00-\u9fa5]+$/.test(a.name) || names.has(a.name) || !/^[a-f0-9]{64}$/.test(a.sha256)) {
      throw new Error("Unsafe or duplicated release asset name/hash.");
    }
    names.add(a.name);
  }
  return [...assets].sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map(a => `${a.sha256}  ${a.name}`).join("\n") + "\n";
}
export async function hashFile(file) {
  const h = createHash("sha256");
  for await (const bytes of createReadStream(file)) h.update(bytes);
  return h.digest("hex");
}
async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Refusing nonregular asset: " + file);
  return info;
}
async function checkInput() {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const approval = JSON.parse(await readFile(path.join(root, "build/release-approval.json"), "utf8"));
  const media = JSON.parse(await readFile(path.join(root, "scripts/native-media-lite.lock.json"), "utf8"));
  if (pkg.version !== "0.1.15" || pkg.license !== "MIT") throw new Error("Source bundle is only pinned for v0.1.15 MIT.");
  if (approval.approved !== false || media.distributable !== false || media.status !== "CANDIDATE_NOT_APPROVED") {
    throw new Error("This script stages only unapproved, nonpublic pre-QA materials.");
  }
  const nativeDir = path.join(root, ".tmp", "native-media-lite-tools");
  for (const name of ["ffmpeg.exe", "ffprobe.exe", "libvpl-2.dll", "libopenh264-7.dll",
    "libwinpthread-1.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll"]) {
    const file = path.join(nativeDir, name);
    await regularFile(file);
    if (await hashFile(file) !== media.files[name]) throw new Error("Current Lite native media does not match pinned SHA: " + name);
  }
  return media;
}
async function main(args) {
  if (args.length !== 4 || args[0] !== "--source-zip" || args[2] !== "--output-dir") {
    throw new Error("Usage: node scripts/prepare-community-release-attachments.mjs --source-zip <pinned-zip> --output-dir <new-directory>");
  }
  const source = path.resolve(args[1]), dest = path.resolve(args[3]);
  if (dest === root || dest.startsWith(root + path.sep)) throw new Error("Staging must be outside the Git workspace.");
  if (source === dest || source.startsWith(dest + path.sep) || dest.startsWith(path.dirname(source) + path.sep) && dest === path.dirname(source)) {
    throw new Error("Source/archive and staging directories must not overlap.");
  }
  try { await lstat(dest); throw new Error("Output directory already exists: refusing to overwrite existing assets."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const input = await regularFile(source);
  assertPinnedSource({ sha256: await hashFile(source), size: input.size });
  const media = await checkInput();
  // All prechecks above run BEFORE creating the output.
  await mkdir(dest, { recursive: false });
  const assets = [];
  async function stage(from, name) {
    const inputInfo = await regularFile(from);
    const target = path.join(dest, name);
    await copyFile(from, target);
    const digest = await hashFile(target);
    if (digest !== await hashFile(from)) throw new Error("Copy corrupted: " + name);
    assets.push({ name, sha256: digest, size: inputInfo.size });
  }
  await stage(source, pinnedSources.name);
  for (const [from, to] of requiredAssets) await stage(path.join(root, from), to);
  // Include exact upstream license texts for every distributed native component.
  for (const name of nativeNoticeNames) {
    const file = path.join(root, ".tmp", "native-media-lite-tools", name);
    await regularFile(file);
    if (await hashFile(file) !== media.files[name]) throw new Error("Native notice SHA-256 mismatch: " + name);
    await stage(file, name);
  }
  const noticeName = "README-STAGING-NOT-FOR-PUBLICATION.txt";
  const notice = [
    "Movie / 拉面影视 - OFFLINE third-party companion only.",
    "NOT A RELEASE. NO INSTALLER INCLUDED. NEVER UPLOAD AS AN APPROVED BUNDLE.",
    "The FFmpeg Lite 8.1.2 source ZIP and other notices are staged with SHA-256.",
    "OpenH264 is from MSYS2, not a Cisco-provided binary: no blanket patent license.",
    "Before public download: confirm FFmpeg LGPL static relinking obligations,",
    "complete source/distribution conditions, build the correct community identity,",
    "run clean Windows 11 QA, and publish matching installer and sources together.",
    "See https://ffmpeg.org/legal.html and repository docs/OPEN_SOURCE_RELEASE_SIMPLE.md.",
    ""
  ].join("\n");
  await writeFile(path.join(dest, noticeName), notice, "utf8");
  assets.push({ name: noticeName, sha256: await hashFile(path.join(dest, noticeName)), size: Buffer.byteLength(notice) });
  await writeFile(path.join(dest, "SHA256SUMS.txt"), generateSha256Sums(assets), "utf8");
  await writeFile(path.join(dest, "STAGING-STATUS.json"), JSON.stringify({
    status: "PENDING_WINDOWS_QA_AND_FFMPEG_DISTRIBUTION_REVIEW",
    approved: false, publicInstallerIncluded: false, version: "0.1.15", nativeSourceZip: pinnedSources.name,
    artifactCount: assets.length,
    assets,
  }, null, 2) + "\n", "utf8");
  console.log(`STAGED=${dest}\nFILES_HASHED=${assets.length}\nPUBLIC_APPROVED=false\nINSTALLER_INCLUDED=false`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
