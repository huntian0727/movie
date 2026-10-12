import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { verifySourceMedia } from "./native-source-media.mjs";
import { verifyPlayerRuntime } from "./native-player-runtime.mjs";

export const isPrivateRelease = flavor => ["unsigned-test-build", "unsigned-community-qa"].includes(flavor.releaseClass);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const sourceReviewMaterialPaths = Object.freeze([
  "LICENSE", "THIRD_PARTY_LICENSES.md", "docs/legal/THIRD_PARTY_RELEASE_NOTICES.md",
  "docs/legal/FFMPEG_BUILD_INFO.md", "docs/legal/FFMPEG_SOURCE_NOTICE.md", "docs/legal/NATIVE_COMPONENTS.md",
  "docs/legal/FFMPEG-LITE-SBOM.spdx.json", "docs/legal/MPV_SOURCE_NOTICE.md", "docs/legal/NATIVE-SOURCE-CANDIDATE.md",
  "docs/legal/NATIVE-SOURCE-CANDIDATE-NOTICES.txt", "docs/legal/NATIVE-SOURCE-CANDIDATE-REVIEW-INDEX.json",
  "docs/legal/FFMPEG-SOURCE-CANDIDATE-LICENSE.txt", "docs/legal/NATIVE-SOURCE-COMPILED-NOTICES.txt",
  "docs/legal/NATIVE-SOURCE-COMPILE-REVIEW.json", "docs/legal/GNU-GPLv3.txt", "docs/legal/GNU-LGPLv3.txt",
  "native/embedded-mpv/NativeHost.cs", "scripts/build-native-player.mjs", "scripts/native-player-toolchain.mjs",
  "scripts/native-player-toolchain.lock.json"
]);
// Preserve upstream TXT bytes exactly; canonicalize only line endings in our
// owned text/code so reviewed material pins survive Windows Git checkout policy.
export function sourceReviewMaterialHash(relative, bytes) {
  return hash(relative.endsWith(".txt") ? bytes : new TextEncoder().encode(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replaceAll("\r\n", "\n")));
}
async function file(root, relative) {
  if (!/^[a-zA-Z0-9_. /-]+$/.test(relative) || relative.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Unsafe source approval path.");
  const target = path.join(root, relative);
  // Check every parent, rather than following a junction to an unrelated file.
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (!current.startsWith(root + path.sep)) throw new Error("Source approval path escaped root.");
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Source approval rejects links.");
  }
  const info = await lstat(target);
  if (!info.isFile() || info.size === 0) throw new Error("Missing source approval file.");
  return readFile(target);
}

export function sourceBinaryRecords(media, player, nativeHostSha256) {
  return [
    ...Object.entries(media.files).filter(([name]) => /\.(exe|dll)$/i.test(name)).map(([name, sha256]) => ({ path: "media-tools/" + name, sha256 })),
    ...Object.entries(player.files).filter(([name]) => /\.dll$/i.test(name)).map(([name, sha256]) => ({ path: "native-player/" + name, sha256 })),
    { path: "native-player/NativeHost.exe", sha256: nativeHostSha256 }
  ].sort((a, b) => a.path.localeCompare(b.path, "en"));
}

// Staging remains unapproved. This separate, exact record grants formal use only
// after the main owner/license/Windows QA approval has also been verified.
export async function verifySourceReleaseApproval(root, flavor, verifyEvidence) {
  root = path.resolve(root);
  if (flavor.releaseClass !== "unsigned-public-release" || flavor.mediaVariant !== "source-candidate" || flavor.playerRuntimeVariant !== "source-candidate") {
    throw new Error("Source pair is not approved for this formal release identity.");
  }
  const mediaBytes = await file(root, "scripts/native-source-media.lock.json");
  const playerBytes = await file(root, "scripts/native-source-player-runtime.lock.json");
  const media = JSON.parse(mediaBytes), player = JSON.parse(playerBytes);
  const approvalBytes = await file(root, "build/native-source-approval.json");
  const approval = JSON.parse(approvalBytes);
  if (approval.schemaVersion !== 1 || approval.approved !== true ||
      approval.mediaRuntimeLockSha256 !== hash(mediaBytes) || approval.playerRuntimeLockSha256 !== hash(playerBytes) ||
      flavor.mediaRuntimeLockSha256 !== hash(mediaBytes) || flavor.playerRuntimeLockSha256 !== hash(playerBytes) ||
      media.archiveSha256 !== player.archiveSha256 || media.archiveBytes !== player.archiveBytes ||
      media.sourceEvidenceZipSha256 !== player.sourceEvidenceZipSha256 ||
      approval.nativeArchiveSha256 !== media.archiveSha256 || approval.sourceEvidenceZipSha256 !== media.sourceEvidenceZipSha256) {
    throw new Error("Source runtime approval or paired input locks differ.");
  }
  const source = await file(root, ".tmp/native-source-inputs/source-evidence.zip");
  if (source.length !== approval.sourceEvidenceZipBytes || hash(source) !== approval.sourceEvidenceZipSha256) throw new Error("Retained source archive differs from approved evidence.");
  await verifySourceMedia(path.join(root, ".tmp/native-source-media-tools"), media);
  await verifyPlayerRuntime(path.join(root, ".tmp/native-source-player-runtime"), player);
  const nativeHost = await file(root, "native-bin/NativeHost.exe");
  const expected = sourceBinaryRecords(media, player, hash(nativeHost));
  if (!Array.isArray(approval.binaries) || approval.binaries.length !== expected.length ||
      new Set(approval.binaries.map(item => item.path)).size !== expected.length ||
      approval.binaries.some(item => !expected.some(record => record.path === item.path))) throw new Error("Source approval must cover the exact distributed binary paths.");
  for (const record of expected) {
    const item = approval.binaries.find(item => item.path === record.path);
    if (item.sourceComplianceApproved !== true || item.sha256 !== record.sha256) throw new Error("Distributed source binary lacks matching approval: " + record.path);
    await verifyEvidence(root, item.sourceEvidence, item.sourceEvidenceSha256);
  }
  await verifyEvidence(root, approval.reviewEvidence, approval.reviewEvidenceSha256);
  const review = (await file(root, approval.reviewEvidence)).toString("utf8");
  const materials = [...review.matchAll(/^material-sha256 ([a-f0-9]{64}) ([a-zA-Z0-9_./-]+)$/gm)];
  if (materials.length !== sourceReviewMaterialPaths.length || new Set(materials.map(row => row[2])).size !== materials.length ||
      materials.some(row => !sourceReviewMaterialPaths.includes(row[2]))) throw new Error("Source review must bind the exact reviewed material set.");
  for (const [, expectedHash, relative] of materials) {
    if (sourceReviewMaterialHash(relative, await file(root, relative)) !== expectedHash) throw new Error("Reviewed source/license material differs: " + relative);
  }
  return hash(approvalBytes);
}
