#!/usr/bin/env node
/**
 * Non-destructive, fail-closed preflight. Reads actual QA artifact and approval.
 * Produces evidence in the ignored .tmp directory. Does not approve/publish.
 */
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (...segments) => path.join(root, ...segments);
const parse = async (name) => JSON.parse(await readFile(file(name), "utf8"));
const isFile = async (name) => access(name).then(() => true, () => false);
const sha256 = async (name) => createHash("sha256").update(await readFile(name)).digest("hex");
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, status: ok ? "PASS" : "BLOCKED", detail });
}

const approval = await parse("build/release-approval.json");
const lite = await parse("scripts/native-media-lite.lock.json");
const meta = await parse("release/unsigned-test-build/build-metadata.json");
const flavor = await parse("release/unsigned-test-build/build-flavor.json");
const installer = file("release", "unsigned-test-build", flavor.artifactName);
const installerHash = await sha256(installer);
const expected = (meta.installers || []).find((item) => item.name === flavor.artifactName);
check("QA installer integrity",
  flavor.releaseClass === "unsigned-test-build" &&
  meta.releaseClass === flavor.releaseClass &&
  flavor.appId === "com.local.video.manager.unsignedtest" &&
  flavor.commit === meta.commit &&
  expected?.sha256?.toLowerCase() === installerHash,
  `test-only flavor; SHA-256 ${installerHash}`);
check("Public artifact identity", false,
  "Current candidate is isolated unsigned-test-build, NOT the distinct unsigned-public-release identity.");
check("Owner authorization", approval.ownersConfirmed === true,
  approval.ownersConfirmed ? "Owner's authorization recorded" : "Owner's rights for project code/assets not confirmed.");
const approvedBinaries = Array.isArray(approval.binaries) &&
  approval.binaries.length >= 3 &&
  approval.binaries.every((b) => b.sourceComplianceApproved === true && b.sha256 && b.sourceEvidenceSha256);
check("Third-party binary compliance", approvedBinaries &&
  approval.approved === true && lite.distributable === true &&
  lite.status !== "CANDIDATE_NOT_APPROVED",
  "Native media candidate and/or owner compliance approval is still unapproved.");
check("Clean stable Windows 11 QA", approval.manualQaApproved === true &&
  Boolean(approval.cleanWindows11Evidence) &&
  Boolean(approval.cleanWindows11EvidenceSha256),
  "Only Insider/development-machine automated QA evidence exists; clean Windows 11/no-Node manual test missing.");
check("Release approval", approval.approved === true,
  "build/release-approval.json is authoritative; this script never changes it.");
const ffmpeg = file(".tmp", "native-media-lite-tools", "ffmpeg.exe");
if (await isFile(ffmpeg)) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-buildconf"], { encoding: "utf8", timeout: 15_000 });
  const flags = result.stdout + result.stderr;
  const staticBuild = /--enable-static/.test(flags) && /--disable-shared/.test(flags);
  check("FFmpeg LGPL linking disposition", Boolean(approvedBinaries && approval.approved === true),
    staticBuild
      ? "Observed --enable-static and --disable-shared; LGPL relinking/modified-library compliance requires documented human approval."
      : "Linking modes and LGPL obligations require documented human approval; flags alone cannot approve distribution.");
} else {
  check("FFmpeg static LGPL review", false,
    "Pinned ffmpeg.exe not staged locally; cannot inspect linking flags.");
}
const sourceZip = process.env.MOVIE_REVIEW_SOURCE_ARCHIVE;
if (sourceZip && await isFile(sourceZip)) {
  const hash = await sha256(sourceZip);
  check("Review source archive is available locally", true,
    `SHA-256 ${hash}; existence does NOT mean public attachment or relink approval.`);
}
const outcome = checks.every((item) => item.status === "PASS") ? "READY_FOR_HUMAN_APPROVAL" : "BLOCKED";
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  outcome, commit: meta.commit, version: flavor.version,
  artifact: { name: flavor.artifactName, sha256: installerHash, class: flavor.releaseClass },
  checks,
  note: "Engineering-only evidence. Does not replace legal sign-off, manual QA or GitHub release approval."
};
const output = file(".tmp", "release-final-readiness", "preflight.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
for (const item of checks) console.log(`[${item.status}] ${item.name}: ${item.detail}`);
console.log(`OUTCOME=${outcome}\nEVIDENCE=${output}`);
process.exitCode = outcome === "BLOCKED" ? 2 : 0;
