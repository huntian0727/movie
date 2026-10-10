#!/usr/bin/env node
/**
 * Read-only, fail-closed QA preflight. No approvals or publication side effects.
 * Verifies bytes instead of treating the mere presence of archives as proof.
 */
import { readFile, access, mkdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  verifyIsolatedQaInstaller,
  verifyPinnedQaFfmpeg,
  verifyPinnedSourceReviewArchive,
} from "./release-readiness-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (...parts) => path.join(root, ...parts);
const parse = async (name) => JSON.parse(await readFile(file(name), "utf8"));
const isFile = async (name) => access(name).then(() => true, () => false);
async function hashAndSize(name) {
  const sha = createHash("sha256");
  for await (const chunk of createReadStream(name)) sha.update(chunk);
  return { sha256: sha.digest("hex"), sizeBytes: (await stat(name)).size };
}
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, status: ok ? "PASS" : "BLOCKED", detail });
}

const approval = await parse("build/release-approval.json");
const lite = await parse("scripts/native-media-lite.lock.json");
const meta = await parse("release/unsigned-test-build/build-metadata.json");
const flavor = await parse("release/unsigned-test-build/build-flavor.json");
const installer = file("release", "unsigned-test-build", flavor.artifactName);
const installerInfo = await hashAndSize(installer);
const installerOkay = verifyIsolatedQaInstaller({
  flavor, metadata: meta, actualSha256: installerInfo.sha256,
});
check("QA installer integrity", installerOkay,
  `QA identity, pinned build metadata and installer SHA256: ${installerInfo.sha256}`);
check("Public artifact identity", false,
  "This audit checks only the isolated unsigned-test-build and cannot approve unsigned-public-release.");
check("Owner authorization", approval.ownersConfirmed === true,
  "Confirm ownership of project code, assets and contributions before signing off.");
const approvedBinaries = Array.isArray(approval.binaries) &&
  approval.binaries.length >= 3 &&
  approval.binaries.every((b) => b.sourceComplianceApproved === true &&
    typeof b.sha256 === "string" && /^[0-9a-f]{64}$/i.test(b.sha256) &&
    typeof b.sourceEvidenceSha256 === "string" && /^[0-9a-f]{64}$/i.test(b.sourceEvidenceSha256));
check("Third-party binary release approval recorded", Boolean(approvedBinaries &&
  approval.approved === true && lite.distributable === true &&
  lite.status !== "CANDIDATE_NOT_APPROVED"),
  "Human LGPL/runtime compliance approval and distributable lock are required; existence of sources is insufficient.");
check("Clean stable Windows 11 QA approval recorded", approval.manualQaApproved === true &&
  Boolean(approval.cleanWindows11Evidence) &&
  typeof approval.cleanWindows11EvidenceSha256 === "string" &&
  /^[0-9a-f]{64}$/i.test(approval.cleanWindows11EvidenceSha256),
  "Insider/dev-machine smoke is not stable Windows 11/no-Node manual QA.");
check("Release approval recorded", approval.approved === true,
  "Only the owner can approve after reviewing actual evidence; this script never edits approval.");

const ffmpeg = file(".tmp", "native-media-lite-tools", "ffmpeg.exe");
if (await isFile(ffmpeg)) {
  const [media, result] = await Promise.all([
    hashAndSize(ffmpeg),
    Promise.resolve(spawnSync(ffmpeg, ["-hide_banner", "-buildconf"], { encoding: "utf8", timeout: 15_000 })),
  ]);
  const flags = String(result.stdout || "") + String(result.stderr || "");
  const pinned = verifyPinnedQaFfmpeg({
    lock: lite, actualSha256: media.sha256, processStatus: result.status, buildconf: flags,
  });
  check("Pinned FFmpeg QA binary/config integrity", pinned,
    `Actual ffmpeg.exe SHA256 ${media.sha256}; static-linked QA candidate, not a distribution approval.`);
  check("FFmpeg LGPL relinking review", false,
    "Static --enable-static/--disable-shared build; full LGPL and component-license disposition not signed off.");
} else {
  check("Pinned FFmpeg QA binary/config integrity", false, "Missing staged pinned QA ffmpeg.exe.");
  check("FFmpeg LGPL relinking review", false, "Missing FFmpeg; no license disposition.");
}
const sourceZip = process.env.MOVIE_REVIEW_SOURCE_ARCHIVE;
if (sourceZip && await isFile(sourceZip)) {
  const actual = await hashAndSize(sourceZip);
  check("Pinned corresponding-source REVIEW ZIP", verifyPinnedSourceReviewArchive({
    actualSha256: actual.sha256, sizeBytes: actual.sizeBytes,
  }), `Source ZIP SHA256 ${actual.sha256} bytes ${actual.sizeBytes}; PRIVATE, not uploaded.`);
} else {
  check("Pinned corresponding-source REVIEW ZIP", false,
    "Supply MOVIE_REVIEW_SOURCE_ARCHIVE pointing to the pinned private REVIEW-v2 ZIP.");
}
const report = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), outcome: "BLOCKED",
  commit: meta.commit, version: flavor.version,
  artifact: { name: flavor.artifactName, sha256: installerInfo.sha256,
    sizeBytes: installerInfo.sizeBytes, class: flavor.releaseClass },
  checks, note: "This is a QA-only audit: always BLOCKED for public distribution. Human reviews remain required.",
};
const output = file(".tmp", "release-final-readiness", "preflight.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
for (const item of checks) console.log(`[${item.status}] ${item.name}: ${item.detail}`);
console.log(`OUTCOME=BLOCKED\nEVIDENCE=${output}`);
process.exitCode = 2;
