// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candidateDirectory, mediaVariant } from "../../scripts/media-variant.mjs";
import { assertPrivateSourceMedia, stageSourceMedia, verifySourceMedia } from "../../scripts/native-source-media.mjs";
import { sha256 } from "../../scripts/native-player-toolchain.mjs";
import { assertTestFlavor, createBuildFlavor, verifyFormalApproval } from "../../scripts/release-engineering.mjs";

describe("source-built shared media closure", () => {
  it("permits beta source staging only with explicit scope and the exact tag shape", () => {
    const env = { MOVIE_RELEASE_CLASS: "unsigned-public-release", MOVIE_MEDIA_VARIANT: "source-candidate", MOVIE_PLAYER_VARIANT: "source-candidate", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/tags/v1.2.3-beta.1", RELEASE_LICENSE_APPROVED: "true", RELEASE_BINARY_COMPLIANCE_APPROVED: "true", RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED: "true", RELEASE_PUBLIC_TEST_ACKNOWLEDGED: "true" };
    expect(() => assertPrivateSourceMedia(env)).not.toThrow();
    for (const change of [{ GITHUB_REF: "refs/tags/v1.2.3" }, { GITHUB_REF: "refs/heads/main" }, { RELEASE_PUBLIC_TEST_ACKNOWLEDGED: "" }, { RELEASE_BINARY_COMPLIANCE_APPROVED: "" }, { MOVIE_PLAYER_VARIANT: "legacy-candidate" }]) expect(() => assertPrivateSourceMedia({ ...env, ...change })).toThrow();
  });
  it("keeps private identity and blocks formal approval without reading a manifest", async () => {
    const env = { MOVIE_MEDIA_VARIANT: "source-candidate" };
    expect(mediaVariant(env)).toBe("source-candidate");
    expect(candidateDirectory("root", "source-candidate")).toBe(path.join("root", ".tmp", "native-source-media-tools"));
    assertTestFlavor(createBuildFlavor({ version: "1.0.0", license: "MIT" }, env));
    expect(() => assertPrivateSourceMedia({ MOVIE_RELEASE_CLASS: "unsigned-public-release" })).toThrow(/private QA/);
    await expect(verifyFormalApproval("absent-root", { releaseClass: "unsigned-public-release", mediaVariant: "source-candidate" })).rejects.toThrow(/not approved/);
  });

  it("pins the exact FFmpeg dependency closure and shares identical player dependency bytes", async () => {
    const lock = JSON.parse(await readFile("scripts/native-source-media.lock.json", "utf8"));
    const player = JSON.parse(await readFile("scripts/native-source-player-runtime.lock.json", "utf8"));
    expect(lock.archiveSha256).toBe(player.archiveSha256);
    expect(lock.sourceEvidenceZipSha256).toBe(player.sourceEvidenceZipSha256);
    expect(Object.keys(lock.binaryImports)).toHaveLength(14);
    for (const name of Object.keys(lock.binaryImports)) {
      if (name.endsWith(".dll")) expect(lock.files[name]).toBe(player.files[name]);
      for (const dependency of lock.binaryImports[name]) {
        const shared = Object.keys(player.files).find(n => n.toLowerCase() === dependency.toLowerCase());
        if (shared) expect(lock.files[shared]).toBe(player.files[shared]);
      }
    }
    expect(lock.files).not.toHaveProperty("libmpv-2.dll");
    expect(lock.files).not.toHaveProperty("libopenh264-7.dll");
    expect(sha256(await readFile(lock.licenseSource))).toBe(lock.files["LICENSE.txt"]);
  });

  it("rejects altered or missing dependencies, extra loadable files and wrong architecture", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "movie-source-media-"));
    const pe = Buffer.alloc(128); pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.write("PE\0\0", 64); pe.writeUInt16LE(0x8664, 68);
    const files = { "ffmpeg.exe": pe, "ffprobe.exe": pe, "avcodec-63.dll": pe, "LICENSE.txt": Buffer.from("license"), "SOURCE-STATUS.txt": Buffer.from("private") };
    const lock = { schemaVersion: 2, variant: "source-candidate", status: "CANDIDATE_NOT_APPROVED", distributable: false,
      archiveSha256: "a".repeat(64), archiveBytes: 1, licenseSource: "docs/legal/FFMPEG-SOURCE-CANDIDATE-LICENSE.txt", sourceStatusText: "private", files: {} };
    try {
      for (const [name, bytes] of Object.entries(files)) { await writeFile(path.join(root, name), bytes); lock.files[name] = sha256(bytes); }
      await verifySourceMedia(root, lock);
      await expect(verifySourceMedia(root, { ...lock, distributable: true })).rejects.toThrow(/unapproved/);
      await expect(verifySourceMedia(root, { ...lock, files: { ...lock.files, "../evil.dll": sha256(pe) } })).rejects.toThrow(/safe/);
      await writeFile(path.join(root, "injected.dll"), pe);
      await expect(verifySourceMedia(root, lock)).rejects.toThrow(/Unexpected/);
      await rm(path.join(root, "injected.dll"));
      await writeFile(path.join(root, "avcodec-63.dll"), "tampered");
      await expect(verifySourceMedia(root, lock)).rejects.toThrow(/differs/);
      const x86 = Buffer.from(pe); x86.writeUInt16LE(0x14c, 68);
      await writeFile(path.join(root, "avcodec-63.dll"), x86);
      await expect(verifySourceMedia(root, { ...lock, files: { ...lock.files, "avcodec-63.dll": sha256(x86) } })).rejects.toThrow(/x64/);
      await rm(path.join(root, "avcodec-63.dll"));
      await expect(verifySourceMedia(root, lock)).rejects.toThrow();
      await mkdir(path.join(root, "stage"));
      await writeFile(path.join(root, "wrong.zip"), "wrong");
      await expect(stageSourceMedia(root, path.join(root, "stage"), path.join(root, "wrong.zip"), lock)).rejects.toThrow(/archive differs/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
