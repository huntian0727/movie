// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertReleasePackagingMode, createBuildFlavor, hashFile, verifyFormalApproval } from "../../scripts/release-engineering.mjs";
import { sourceBinaryRecords, sourceReviewMaterialPaths, sourceReviewMaterialHash, verifySourceReleaseApproval } from "../../scripts/source-release-approval.mjs";
import { assertInputLock, downloadAsset, prepareSourceReleaseInputs } from "../../scripts/prepare-source-release-inputs.mjs";
import { sha256 } from "../../scripts/native-player-toolchain.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function rootForTest() { const root = await mkdtemp(path.join(os.tmpdir(), "movie-source-release-")); roots.push(root); return root; }
async function json(root, name, value) {
  const destination = path.join(root, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(value));
  return hashFile(destination);
}
const publicEnv = { MOVIE_RELEASE_CLASS: "unsigned-public-release", MOVIE_MEDIA_VARIANT: "source-candidate", MOVIE_PLAYER_VARIANT: "source-candidate",
  GITHUB_ACTIONS: "true", GITHUB_REF: "refs/tags/v1.2.3", RELEASE_LICENSE_APPROVED: "true", RELEASE_BINARY_COMPLIANCE_APPROVED: "true",
  RELEASE_MANUAL_QA_APPROVED: "true", RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED: "true" };
const manifest = { version: "1.2.3", license: "MIT" };

async function sourceFixture() {
  const root = await rootForTest();
  const pe = Buffer.alloc(128); pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.write("PE\0\0", 64); pe.writeUInt16LE(0x8664, 68);
  const mediaFiles = { "ffmpeg.exe": pe, "ffprobe.exe": pe, "shared.dll": pe, "LICENSE.txt": Buffer.from("synthetic license"), "SOURCE-STATUS.txt": Buffer.from("synthetic private") };
  const playerFiles = { "libmpv-2.dll": pe, "shared.dll": pe, "Copyright": Buffer.from("synthetic"), "LICENSE.GPL": Buffer.from("synthetic"), "LICENSE.LGPL": Buffer.from("synthetic") };
  const source = Buffer.from("Synthetic source archive, never real compliance evidence.");
  const common = { schemaVersion: 2, variant: "source-candidate", status: "CANDIDATE_NOT_APPROVED", distributable: false,
    archiveSha256: "a".repeat(64), archiveBytes: 1, sourceEvidenceZipSha256: sha256(source) };
  const media = { ...common, licenseSource: "docs/legal/FFMPEG-SOURCE-CANDIDATE-LICENSE.txt", sourceStatusText: "synthetic private", files: {} };
  const player = { ...common, files: {} };
  for (const [dir, files, lock] of [[".tmp/native-source-media-tools", mediaFiles, media], [".tmp/native-source-player-runtime", playerFiles, player]]) {
    await mkdir(path.join(root, dir), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) { await writeFile(path.join(root, dir, name), bytes); lock.files[name] = sha256(bytes); }
  }
  await mkdir(path.join(root, "native-bin")); await writeFile(path.join(root, "native-bin/NativeHost.exe"), pe);
  await mkdir(path.join(root, ".tmp/native-source-inputs")); await writeFile(path.join(root, ".tmp/native-source-inputs/source-evidence.zip"), source);
  await mkdir(path.join(root, "docs/legal"), { recursive: true });
  const evidence = "docs/legal/synthetic-approval.md";
  const materialRows = [];
  for (const relative of sourceReviewMaterialPaths) {
    const bytes = Buffer.from(relative === "LICENSE" ? "MIT License\nPermission is hereby granted by this synthetic test fixture." : "Synthetic reviewed material: " + relative);
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), bytes);
    materialRows.push("material-sha256 " + sourceReviewMaterialHash(relative, bytes) + " " + relative);
  }
  await writeFile(path.join(root, evidence), "Synthetic unit fixture only. No real distribution approval.\n" + materialRows.join("\n"));
  const evidenceHash = await hashFile(path.join(root, evidence));
  const approval = { schemaVersion: 1, approved: true,
    mediaRuntimeLockSha256: await json(root, "scripts/native-source-media.lock.json", media),
    playerRuntimeLockSha256: await json(root, "scripts/native-source-player-runtime.lock.json", player),
    nativeArchiveSha256: common.archiveSha256, sourceEvidenceZipSha256: common.sourceEvidenceZipSha256, sourceEvidenceZipBytes: source.length,
    reviewEvidence: evidence, reviewEvidenceSha256: evidenceHash,
    binaries: sourceBinaryRecords(media, player, sha256(pe)).map(item => ({ ...item, sourceComplianceApproved: true, sourceEvidence: evidence, sourceEvidenceSha256: evidenceHash })) };
  await json(root, "build/native-source-approval.json", approval);
  await json(root, "package.json", manifest);
  await writeFile(path.join(root, "LICENSE"), "MIT License\nPermission is hereby granted by this synthetic test fixture.");
  await writeFile(path.join(root, "package-lock.json"), "synthetic locked fixture");
  const mainApproval = { schemaVersion: 1, approved: true, ownersConfirmed: true, applicationLicense: "MIT", manualQaApproved: true,
    licenseSha256: await hashFile(path.join(root, "LICENSE")), packageLockSha256: await hashFile(path.join(root, "package-lock.json")),
    cleanWindows11Evidence: evidence, cleanWindows11EvidenceSha256: evidenceHash };
  await json(root, "build/release-approval.json", mainApproval);
  const flavor = { ...createBuildFlavor(manifest, publicEnv), mediaRuntimeLockSha256: approval.mediaRuntimeLockSha256,
    playerRuntimeVariant: "source-candidate", playerRuntimeLockSha256: approval.playerRuntimeLockSha256 };
  return { root, approval, flavor, mainApproval, evidence, media, player };
}

async function betaFixture() {
  const f = await sourceFixture(), version = "1.2.3-beta.1";
  await json(f.root, "package.json", { ...manifest, version });
  f.mainApproval.approved = false; f.mainApproval.manualQaApproved = false;
  await json(f.root, "build/release-approval.json", f.mainApproval);
  await mkdir(path.join(f.root, "docs/QA"), { recursive: true });
  const sandboxEvidence = "docs/QA/2026-10-12-source-community-sandbox-evidence.json";
  const sandboxEvidenceSha256 = await json(f.root, sandboxEvidence, { status: "PASS_SCOPED_SANDBOX_ACCEPTANCE", environment: { stableWindowsCoverage: false, standardUserCoverage: false } });
  const test = { schemaVersion: 1, approved: true, scope: "public-prerelease-portable-only", version,
    stableReleaseApproved: false, stableWindowsCoverage: false, standardUserCoverage: false, unsignedAcknowledged: true,
    nativeLicenseElection: "LGPL-3.0-or-later", packageLockSha256: f.mainApproval.packageLockSha256,
    nativeSourceApprovalSha256: await hashFile(path.join(f.root, "build/native-source-approval.json")),
    decisionEvidence: f.evidence, decisionEvidenceSha256: f.approval.reviewEvidenceSha256, sandboxEvidence, sandboxEvidenceSha256 };
  await json(f.root, "build/public-test-approval.json", test);
  const beta = createBuildFlavor({ ...manifest, version }, { ...publicEnv, GITHUB_REF: "refs/tags/v" + version, RELEASE_MANUAL_QA_APPROVED: "false", RELEASE_PUBLIC_TEST_ACKNOWLEDGED: "true" });
  f.flavor = { ...f.flavor, ...beta }; return { ...f, test };
}

describe("public beta authorization is separate from stable Windows acceptance", () => {
  it("retains the real beta approval and its exact version/dependency/native evidence pins", async () => {
    const approval = JSON.parse(await readFile("build/public-test-approval.json", "utf8"));
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(approval).toMatchObject({ approved: true, version: "0.1.16-beta.1", scope: "public-prerelease-portable-only", stableReleaseApproved: false });
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).not.toBe(approval.version);
    expect(approval.packageLockSha256).toBe("277f4b5b3c362901db434618b04d4897a4228b524beddb25d872915df967d865");
    expect(approval.packageLockSha256).not.toBe(await hashFile("package-lock.json"));
    expect(approval.nativeSourceApprovalSha256).toBe("8040e06202843d216d7771d0e4cdaf42380f4d99880575988f37b6515f707dde");
    expect(approval.nativeSourceApprovalSha256).not.toBe(await hashFile("build/native-source-approval.json"));
    expect(approval.decisionEvidenceSha256).toBe(await hashFile(approval.decisionEvidence));
    expect(approval.sandboxEvidenceSha256).toBe(await hashFile(approval.sandboxEvidence));
  });
  it("allows only the explicitly acknowledged paired-source beta tag", () => {
    const beta = { ...manifest, version: "1.2.3-beta.1" };
    const env = { ...publicEnv, GITHUB_REF: "refs/tags/v1.2.3-beta.1", RELEASE_PUBLIC_TEST_ACKNOWLEDGED: "true", RELEASE_MANUAL_QA_APPROVED: "false" };
    expect(createBuildFlavor(beta, env).publicTestRelease).toBe(true);
    expect(() => createBuildFlavor(beta, { ...env, RELEASE_PUBLIC_TEST_ACKNOWLEDGED: "" })).toThrow();
    expect(() => createBuildFlavor(manifest, { ...publicEnv, RELEASE_PUBLIC_TEST_ACKNOWLEDGED: "true" })).toThrow(/cannot promote/);
    expect(() => createBuildFlavor(beta, { ...env, MOVIE_MEDIA_VARIANT: "lite-candidate" })).toThrow();
  });
  it("binds exact beta approvals while stable approval remains false", async () => {
    const f = await betaFixture();
    expect(await verifyFormalApproval(f.root, f.flavor)).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyFormalApproval(f.root, { ...f.flavor, version: manifest.version })).rejects.toThrow();
  });
  it.each(["approval", "version", "scope", "stable", "lock", "native", "qa", "decision", "owner"])("rejects changed %s beta evidence", async kind => {
    const f = await betaFixture();
    if (kind === "approval") f.test.approved = false;
    if (kind === "version") f.test.version = "1.2.3-beta.2";
    if (kind === "scope") f.test.scope = "stable";
    if (kind === "stable") f.test.stableWindowsCoverage = true;
    if (kind === "lock") f.test.packageLockSha256 = "b".repeat(64);
    if (kind === "native") f.test.nativeSourceApprovalSha256 = "b".repeat(64);
    if (kind === "qa") await writeFile(path.join(f.root, f.test.sandboxEvidence), "tampered");
    if (kind === "decision") f.test.decisionEvidenceSha256 = "b".repeat(64);
    if (kind === "owner") { f.mainApproval.ownersConfirmed = false; await json(f.root, "build/release-approval.json", f.mainApproval); }
    await json(f.root, "build/public-test-approval.json", f.test);
    await expect(verifyFormalApproval(f.root, f.flavor)).rejects.toThrow();
  });
});

describe("private community QA and exact source release approval", () => {
  it("uses the community profile before public approval, with visibly private artifact identity", async () => {
    const qa = createBuildFlavor(manifest, { MOVIE_RELEASE_CLASS: "unsigned-community-qa", MOVIE_MEDIA_VARIANT: "source-candidate", MOVIE_PLAYER_VARIANT: "source-candidate" });
    const published = createBuildFlavor(manifest, publicEnv);
    expect(qa.playerRuntimeVariant).toBe("source-candidate");
    expect(published.playerRuntimeVariant).toBe("source-candidate");
    expect(qa.appId).toBe(published.appId); expect(qa.nsisGuid).toBe(published.nsisGuid);
    expect(qa.userDataDirectoryName).toBe(published.userDataDirectoryName);
    expect(qa.executableName).toMatch(/-QA$/); expect(qa.artifactName).toMatch(/-community-qa-Setup.exe$/);
    expect(await verifyFormalApproval("absent-root", qa)).toBeNull();
    expect(() => createBuildFlavor(manifest, { MOVIE_RELEASE_CLASS: "unsigned-community-qa", CSC_LINK: "synthetic" })).toThrow();
    expect(() => createBuildFlavor(manifest, { ...publicEnv, MOVIE_PLAYER_VARIANT: "legacy-candidate" })).toThrow();
  });
  it("binds v0.1.17 to the previously approved third-party runtime and rebuilt NativeHost", async () => {
    const media = JSON.parse(await readFile("scripts/native-source-media.lock.json", "utf8"));
    const player = JSON.parse(await readFile("scripts/native-source-player-runtime.lock.json", "utf8"));
    const approval = JSON.parse(await readFile("build/native-source-approval.json", "utf8"));
    expect(approval.approved).toBe(true); expect(approval.binaries).toHaveLength(39);
    expect(approval.binaries.every(item => item.sourceComplianceApproved === true)).toBe(true);
    const stable = JSON.parse(await readFile("build/release-approval.json", "utf8"));
    expect(stable).toMatchObject({ approved: true, manualQaApproved: true, scope: "stable-portable-only", version: "0.1.17", stableWindowsCoverage: false, standardUserCoverage: false, legacyUpgradeApproved: false, qaScope: "owner-accepted-targeted-portable-qa" });
    expect(media.status).toBe("CANDIDATE_NOT_APPROVED"); expect(media.distributable).toBe(false);
    expect(player.status).toBe("CANDIDATE_NOT_APPROVED"); expect(player.distributable).toBe(false);
    expect(media.producerCiConclusion).toBe("FAIL"); expect(media.originalCiClosureValid).toBe(false);
    expect(player.producerCiConclusion).toBe("FAIL"); expect(player.originalCiClosureValid).toBe(false);
    const host = approval.binaries.find(item => item.path === "native-player/NativeHost.exe");
    expect(approval.binaries.map(({ path, sha256 }) => ({ path, sha256 }))).toEqual(sourceBinaryRecords(media, player, host.sha256));
    expect(approval.mediaRuntimeLockSha256).toBe(await hashFile("scripts/native-source-media.lock.json"));
    expect(approval.playerRuntimeLockSha256).toBe(await hashFile("scripts/native-source-player-runtime.lock.json"));
    expect(host.sha256).toBe("61aa3328dfd98ec29fd75beb88e5630fec2769670f41f930da18cf8166446b07");
    expect(approval.nativeHostSourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("accepts a fully approved synthetic pair and binds both approval manifests", async () => {
    const { root, flavor, approval } = await sourceFixture();
    const first = await verifyFormalApproval(root, flavor); expect(first).toMatch(/^[a-f0-9]{64}$/);
    approval.reviewEvidence = "docs/legal/second-synthetic.md";
    await writeFile(path.join(root, approval.reviewEvidence), await readFile(path.join(root, "docs/legal/synthetic-approval.md"), "utf8") + "\nSecond synthetic review");
    approval.reviewEvidenceSha256 = await hashFile(path.join(root, approval.reviewEvidence));
    await json(root, "build/native-source-approval.json", approval);
    expect(await verifyFormalApproval(root, flavor)).not.toBe(first);
  });
  it.each(["false", "missing", "extra", "duplicate", "wrong-hash", "record-false", "lock", "source", "dll", "extra-dll", "host", "evidence", "material", "windows-false"])("rejects %s without granting distribution", async kind => {
    const f = await sourceFixture();
    if (kind === "false") f.approval.approved = false;
    if (kind === "missing") f.approval.binaries.pop();
    if (kind === "extra") f.approval.binaries.push({ ...f.approval.binaries[0], path: "native-player/extra.dll" });
    if (kind === "duplicate") f.approval.binaries[1] = f.approval.binaries[0];
    if (kind === "wrong-hash") f.approval.binaries[0].sha256 = "b".repeat(64);
    if (kind === "record-false") f.approval.binaries[0].sourceComplianceApproved = false;
    if (kind === "lock") f.flavor.mediaRuntimeLockSha256 = "b".repeat(64);
    if (kind === "source") await writeFile(path.join(f.root, ".tmp/native-source-inputs/source-evidence.zip"), "tampered source");
    if (kind === "dll") await writeFile(path.join(f.root, ".tmp/native-source-media-tools/shared.dll"), "tampered DLL");
    if (kind === "extra-dll") await writeFile(path.join(f.root, ".tmp/native-source-player-runtime/injected.dll"), "extra");
    if (kind === "host") await writeFile(path.join(f.root, "native-bin/NativeHost.exe"), "changed host");
    if (kind === "evidence") await writeFile(path.join(f.root, f.evidence), "changed review");
    if (kind === "material") await writeFile(path.join(f.root, "docs/legal/GNU-LGPLv3.txt"), "changed reviewed license");
    if (kind === "windows-false") { f.mainApproval.manualQaApproved = false; await json(f.root, "build/release-approval.json", f.mainApproval); }
    await json(f.root, "build/native-source-approval.json", f.approval);
    await expect(verifyFormalApproval(f.root, f.flavor)).rejects.toThrow();
  });
  it("rejects mixed source/legacy variants and signed source distribution", async () => {
    const { root, flavor } = await sourceFixture();
    for (const change of [{ playerRuntimeVariant: "legacy-candidate" }, { mediaVariant: "lite-candidate" }, { releaseClass: "signed-release" }]) {
      await expect(verifySourceReleaseApproval(root, { ...flavor, ...change }, () => {})).rejects.toThrow(/not approved/);
    }
  });
  it("preserves upstream TXT bytes while accepting owned-text checkout line endings", () => {
    expect(sourceReviewMaterialHash("docs/legal/own.md", Buffer.from("a\r\nb\r\n"))).toBe(sourceReviewMaterialHash("docs/legal/own.md", Buffer.from("a\nb\n")));
    expect(sourceReviewMaterialHash("docs/legal/upstream.txt", Buffer.from("a\r\n"))).not.toBe(sourceReviewMaterialHash("docs/legal/upstream.txt", Buffer.from("a\n")));
  });
  it.each(["missing", "duplicate"])("rejects a %s reviewed material row even if the review itself is rehashed", async kind => {
    const f = await sourceFixture();
    const lines = (await readFile(path.join(f.root, f.evidence), "utf8")).split("\n");
    if (kind === "missing") lines.pop(); else lines[lines.length - 1] = lines[1];
    await writeFile(path.join(f.root, f.evidence), lines.join("\n"));
    f.approval.reviewEvidenceSha256 = await hashFile(path.join(f.root, f.evidence));
    for (const binary of f.approval.binaries) binary.sourceEvidenceSha256 = f.approval.reviewEvidenceSha256;
    await json(f.root, "build/native-source-approval.json", f.approval);
    await expect(verifyFormalApproval(f.root, f.flavor)).rejects.toThrow(/exact reviewed material set/);
  });
});

describe("owner-selected Windows scope for stable portable release", () => {
  it("retains historical decision and Sandbox evidence but never reuses stale approval for the current package", async () => {
    const a = JSON.parse(await readFile("build/release-approval.json", "utf8"));
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const currentLockSha256 = await hashFile("package-lock.json");
    expect(a.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(a.version === pkg.version).toBe(a.packageLockSha256 === currentLockSha256);
    if (a.version !== pkg.version || a.packageLockSha256 !== currentLockSha256) {
      await expect(verifyFormalApproval(process.cwd(), {
        releaseClass: "unsigned-public-release",
        version: pkg.version,
        mediaVariant: "source-candidate",
        playerRuntimeVariant: "source-candidate",
        publicTestRelease: false,
      })).rejects.toThrow();
    }
    for (const [file, pin] of [[a.decisionEvidence, a.decisionEvidenceSha256], [a.cleanWindows11Evidence, a.cleanWindows11EvidenceSha256]]) expect(await hashFile(file)).toBe(pin);
    const qa = JSON.parse(await readFile(a.cleanWindows11Evidence, "utf8"));
    expect(qa).toMatchObject({ ownerAcceptedEnvironment: true, status: "PASS_OWNER_ACCEPTED_TARGETED_PORTABLE_QA", version: a.version, environment: {stableWindowsCoverage:false, standardUserCoverage:false} });
    expect(await hashFile(qa.previousSandboxEvidence)).toBe(qa.previousSandboxEvidenceSha256);
  });
  it("does not permit installer or directory mode from a ZIP approval", () => {
    const approval = { scope: "stable-portable-only" };
    const flavor = { releaseClass: "unsigned-public-release" };
    expect(() => assertReleasePackagingMode(flavor, approval, "--win-zip")).not.toThrow();
    for (const mode of ["--win-nsis", "--dir"]) expect(() => assertReleasePackagingMode(flavor, approval, mode)).toThrow(/ZIP only/);
    expect(() => assertReleasePackagingMode({releaseClass:"unsigned-community-qa"}, approval, "--dir")).not.toThrow();
  });
  it.each(["version", "signed", "claimed-stable-os", "missing-qa"])("rejects changed %s scope before native distribution", async kind => {
    const f = await sourceFixture();
    Object.assign(f.mainApproval, {scope:"stable-portable-only", version:manifest.version, unsignedAcknowledged:true, stableWindowsCoverage:false, standardUserCoverage:false, decisionEvidence:f.evidence, decisionEvidenceSha256:f.approval.reviewEvidenceSha256});
    if (kind === "version") f.mainApproval.version="9.0.0";
    if (kind === "signed") f.flavor.releaseClass="signed-release";
    if (kind === "claimed-stable-os") f.mainApproval.stableWindowsCoverage=true;
    await json(f.root,"build/release-approval.json",f.mainApproval);
    await expect(verifyFormalApproval(f.root,f.flavor)).rejects.toThrow();
  });
});

describe("retained private input transport", () => {
  const bytes = Buffer.from("synthetic private asset");
  const pin = { bytes: bytes.length, sha256: sha256(bytes) };
  const url = "https://api.github.com/repos/huntian0727/movie/releases/assets/1";
  it("drops authentication on the signed asset redirect", async () => {
    const calls = [];
    const result = await downloadAsset(url, "synthetic-auth", pin, async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/synthetic" } }) : new Response(bytes);
    });
    expect(result).toEqual(bytes); expect(calls[0].options.headers.Authorization).toBe("Bearer synthetic-auth");
    expect(calls[1].options.headers).toBeUndefined(); expect(calls[1].options.redirect).toBe("error");
  });
  it.each(["http://release-assets.githubusercontent.com/a", "https://evil.example/a", "https://u:p@objects.githubusercontent.com/a"])("rejects unsafe redirect %s", async location => {
    await expect(downloadAsset(url, "synthetic", pin, async () => new Response(null, { status: 302, headers: { location } }))).rejects.toThrow();
  });
  it.each([Buffer.from("tampered private asset"), Buffer.alloc(100), Buffer.from("short")])("rejects altered/oversized/truncated input", async bytes => {
    await expect(downloadAsset(url, "synthetic", pin, async () => new Response(bytes))).rejects.toThrow();
  });
  it("checks draft identity even when inputs are cached and refuses changed local inputs", async () => {
    const root = await rootForTest();
    const lock = { schemaVersion: 1, repository: "huntian0727/movie", releaseId: 1, tag: "checkpoint-fixture",
      assets: ["native-runtime.zip", "source-evidence.zip"].map((destination, i) => ({ ...pin, destination, name: `asset-${i}.zip` })) };
    await json(root, "scripts/native-source-inputs.lock.json", lock);
    const release = { id: 1, draft: true, tag_name: lock.tag, assets: lock.assets.map((a, i) => ({ id: i + 1, name: a.name, size: a.bytes, state: "uploaded" })) };
    let assetDownloads = 0;
    const request = async url => new URL(url).pathname.endsWith("releases/1") ? Response.json(release) : (assetDownloads++, new Response(bytes));
    await prepareSourceReleaseInputs(root, "synthetic", request); expect(assetDownloads).toBe(2);
    await prepareSourceReleaseInputs(root, "synthetic", request); expect(assetDownloads).toBe(2);
    release.draft = false; await expect(prepareSourceReleaseInputs(root, "synthetic", request)).rejects.toThrow(/identity/);
    release.draft = true;
    await writeFile(path.join(root, ".tmp/native-source-inputs/native-runtime.zip"), "changed");
    await expect(prepareSourceReleaseInputs(root, "synthetic", request)).rejects.toThrow(/overwrite/);
    expect(() => assertInputLock({ ...lock, repository: "other/repository" })).toThrow();
    expect(() => assertInputLock({ ...lock, assets: [{ ...lock.assets[0], destination: "../outside.zip" }, lock.assets[1]] })).toThrow();
  });
});
