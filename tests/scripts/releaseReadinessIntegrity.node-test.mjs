import test from "node:test";
import assert from "node:assert/strict";
import {
  PINNED_REVIEW_ZIP,
  verifyIsolatedQaInstaller,
  verifyPinnedQaFfmpeg,
  verifyPinnedSourceReviewArchive,
} from "../../scripts/release-readiness-integrity.mjs";

const installerSha = "a".repeat(64);
const commit = "b".repeat(40);
const flavor = {
  releaseClass: "unsigned-test-build", version: "0.1.15", arch: "x64",
  mediaVariant: "lite-candidate", appId: "com.local.video.manager.unsignedtest",
  nsisGuid: "ec02b3c5-6e7a-4e3d-9f2a-1c6854cc8072",
  executableName: "isolated-unsigned-test-build",
  artifactName: "candidate-0.1.15-x64-Setup.exe", commit,
};
const metadata = {
  signed: false, releaseClass: flavor.releaseClass,
  flavor: { ...flavor },
  installers: [{ name: flavor.artifactName, sha256: installerSha }],
};
const qa = (changes = {}) => ({
  flavor, metadata, actualSha256: installerSha, ...changes,
});

test("accepts only an internally consistent isolated QA installer", () => {
  assert.equal(verifyIsolatedQaInstaller(qa()), true);
});
test("rejects modified installer bytes (the hash must match exactly)", () => {
  assert.equal(verifyIsolatedQaInstaller(qa({ actualSha256: "c".repeat(64) })), false);
});
test("rejects missing or non-hex SHA digests", () => {
  assert.equal(verifyIsolatedQaInstaller(qa({ actualSha256: "a".repeat(63) })), false);
});
test("rejects public release identity even when hashes coincide", () => {
  const forged = { ...flavor, releaseClass: "unsigned-public-release", appId: "com.local.video.manager" };
  assert.equal(verifyIsolatedQaInstaller(qa({ flavor: forged })), false);
});
test("rejects unsafe artifact filenames and traversal", () => {
  for (const name of ["../outside.exe", "..\\outside.exe", ".", "", "sub/fake.exe"]) {
    assert.equal(verifyIsolatedQaInstaller(qa({
      flavor: { ...flavor, artifactName: name },
      metadata: { ...metadata, flavor: { ...flavor, artifactName: name },
        installers: [{ name, sha256: installerSha }] },
    })), false, name);
  }
});
test("rejects forged unsigned status", () => {
  assert.equal(verifyIsolatedQaInstaller(qa({ metadata: { ...metadata, signed: true } })), false);
});
test("rejects inconsistent embedded flavor metadata", () => {
  assert.equal(verifyIsolatedQaInstaller(qa({
    metadata: { ...metadata, flavor: { ...flavor, commit: "c".repeat(40) } },
  })), false);
});
test("rejects unknown installer count, app id and NSIS GUID", () => {
  assert.equal(verifyIsolatedQaInstaller(qa({
    metadata: { ...metadata, installers: [...metadata.installers, ...metadata.installers] },
  })), false);
  assert.equal(verifyIsolatedQaInstaller(qa({
    flavor: { ...flavor, appId: "com.other.test" },
  })), false);
  assert.equal(verifyIsolatedQaInstaller(qa({
    flavor: { ...flavor, nsisGuid: "other" },
  })), false);
});

const ffmpegSha = "d".repeat(64);
const lock = {
  files: { "ffmpeg.exe": ffmpegSha },
  status: "CANDIDATE_NOT_APPROVED", distributable: false,
  variant: "lite-candidate",
};
const mandatory = "--disable-gpl --disable-nonfree --disable-version3 " +
  "--enable-static --disable-shared --enable-libvpl --enable-libopenh264";
const media = (changes = {}) => ({
  lock, actualSha256: ffmpegSha, processStatus: 0, buildconf: mandatory, ...changes,
});
test("accepts exact known QA FFmpeg bytes and observed flags", () => {
  assert.equal(verifyPinnedQaFfmpeg(media()), true);
});
test("blocks changed ffmpeg binary even if flags appear correct", () => {
  assert.equal(verifyPinnedQaFfmpeg(media({ actualSha256: "f".repeat(64) })), false);
});
test("blocks nonzero/failed ffmpeg process", () => {
  assert.equal(verifyPinnedQaFfmpeg(media({ processStatus: 1 })), false);
  assert.equal(verifyPinnedQaFfmpeg(media({ processStatus: null })), false);
});
test("blocks missing required configure flags or GPL / nonfree flags", () => {
  assert.equal(verifyPinnedQaFfmpeg(media({ buildconf: mandatory.replace("--disable-shared", "") })), false);
  assert.equal(verifyPinnedQaFfmpeg(media({ buildconf: mandatory + " --enable-gpl" })), false);
  assert.equal(verifyPinnedQaFfmpeg(media({ buildconf: mandatory + " --enable-nonfree" })), false);
});
test("does not treat a distributable/approved lock as internal QA", () => {
  assert.equal(verifyPinnedQaFfmpeg(media({ lock: { ...lock, distributable: true } })), false);
  assert.equal(verifyPinnedQaFfmpeg(media({ lock: { ...lock, status: "APPROVED" } })), false);
});
test("accepts only the pinned private corresponding-source review ZIP digest AND size", () => {
  assert.equal(verifyPinnedSourceReviewArchive({
    actualSha256: PINNED_REVIEW_ZIP.sha256, sizeBytes: PINNED_REVIEW_ZIP.sizeBytes,
  }), true);
  assert.equal(verifyPinnedSourceReviewArchive({
    actualSha256: "0".repeat(64), sizeBytes: PINNED_REVIEW_ZIP.sizeBytes,
  }), false);
  assert.equal(verifyPinnedSourceReviewArchive({
    actualSha256: PINNED_REVIEW_ZIP.sha256, sizeBytes: PINNED_REVIEW_ZIP.sizeBytes - 1,
  }), false);
});
