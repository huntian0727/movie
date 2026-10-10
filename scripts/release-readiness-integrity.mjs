/**
 * Non-I/O integrity predicates for the v0.1.15 isolated QA build.
 *
 * These intentionally do not decide legal compliance or authorize public release.
 * A valid QA candidate must still be blocked by the separate publication gate.
 */
export const PINNED_REVIEW_ZIP = Object.freeze({
  sha256: "6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4",
  sizeBytes: 239488121,
});
export const isSha256 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);
const eqHash = (a, b) => isSha256(a) && isSha256(b) && a.toLowerCase() === b.toLowerCase();
const plainFileName = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name !== "." && name !== ".." &&
  !/[\\/\x00-\x1f]/.test(name);

export function verifyIsolatedQaInstaller({ flavor, metadata, actualSha256 }) {
  if (!flavor || !metadata || !plainFileName(flavor.artifactName)) return false;
  const recorded = metadata.installers;
  const recipe = metadata.flavor;
  if (!Array.isArray(recorded) || recorded.length !== 1 || !recipe) return false;
  const sameFields = ["releaseClass", "version", "arch", "mediaVariant",
    "appId", "nsisGuid", "executableName", "artifactName", "commit"];
  return flavor.releaseClass === "unsigned-test-build" &&
    metadata.releaseClass === flavor.releaseClass &&
    flavor.mediaVariant === "lite-candidate" &&
    flavor.appId === "com.local.video.manager.unsignedtest" &&
    flavor.nsisGuid === "ec02b3c5-6e7a-4e3d-9f2a-1c6854cc8072" &&
    metadata.signed === false &&
    /^[0-9a-f]{40}$/i.test(flavor.commit || "") &&
    sameFields.every((key) => recipe[key] === flavor[key]) &&
    recorded[0].name === flavor.artifactName &&
    eqHash(recorded[0].sha256, actualSha256);
}

export function verifyPinnedQaFfmpeg({ lock, actualSha256, processStatus, buildconf }) {
  if (!lock || !lock.files || !eqHash(lock.files["ffmpeg.exe"], actualSha256)) return false;
  if (lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false ||
      lock.variant !== "lite-candidate" || processStatus !== 0 ||
      typeof buildconf !== "string") return false;
  const mandatoryFlags = [
    "--disable-gpl", "--disable-nonfree", "--disable-version3",
    "--enable-static", "--disable-shared", "--enable-libopenh264", "--enable-libvpl",
  ];
  const flags = new Set(buildconf.match(/--[a-z0-9-]+/g) || []);
  return mandatoryFlags.every((flag) => flags.has(flag)) &&
    !flags.has("--enable-gpl") && !flags.has("--enable-nonfree");
}

export function verifyPinnedSourceReviewArchive({ actualSha256, sizeBytes }) {
  return eqHash(actualSha256, PINNED_REVIEW_ZIP.sha256) &&
    sizeBytes === PINNED_REVIEW_ZIP.sizeBytes;
}
