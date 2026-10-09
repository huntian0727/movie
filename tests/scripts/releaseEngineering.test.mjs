// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSignature, assertTestFlavor, createBuildFlavor, hashFile, packagedFileManifest, renderRemovalManifest, releaseOutputDirectory, TEST_APP_ID, validateRelativeFile, verifyFormalApproval } from "../../scripts/release-engineering.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
const manifest = { version: "1.2.3", license: "MIT" };
const signedEnvironment = {
  GITHUB_ACTIONS: "true", GITHUB_REF: "refs/tags/v1.2.3", CSC_LINK: "synthetic-certificate-reference",
  CSC_KEY_PASSWORD: "synthetic-password", WINDOWS_EXPECTED_PUBLISHER: "Synthetic Publisher",
  RELEASE_LICENSE_APPROVED: "true", RELEASE_BINARY_COMPLIANCE_APPROVED: "true", RELEASE_MANUAL_QA_APPROVED: "true"
};

describe("release engineering trust boundaries", () => {
  it("declares MIT for project-owned source while keeping binary distribution unapproved", async () => {
    const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.resolve("package-lock.json"), "utf8"));
    const license = await readFile(path.resolve("LICENSE"), "utf8");
    const approval = JSON.parse(await readFile(path.resolve("build/release-approval.json"), "utf8"));
    expect(pkg.license).toBe("MIT");
    expect(lock.packages[""].license).toBe("MIT");
    expect(license).toMatch(/^MIT License\r?\n/);
    expect(license).toContain("Copyright (c) 2026 huntian0727");
    expect(license).toContain("Permission is hereby granted");
    expect(approval.applicationLicense).toBe("MIT");
    expect(approval.licenseSha256).toBe(await hashFile(path.resolve("LICENSE")));
    expect(approval.approved).toBe(false);
    expect(approval.ownersConfirmed).toBe(false);
    expect(approval.binaries.every((binary) => binary.sourceComplianceApproved === false)).toBe(true);
  });
  it("gives unsigned builds separate file, app, GUID, package and data identities", () => {
    const flavor = createBuildFlavor(manifest, {});
    expect(flavor).toMatchObject({ releaseClass: "unsigned-test-build", appId: TEST_APP_ID, packageName: "local-video-manager-unsigned-test", userDataDirectoryName: "local-video-manager-unsigned-test", expectedPublisher: null });
    expect(flavor.artifactName).toBe("拉面影视-1.2.3-x64-unsigned-test-build-Setup.exe");
    expect(() => assertTestFlavor(flavor)).not.toThrow();
    expect(() => assertTestFlavor({ ...flavor, appId: "com.local.video.manager" })).toThrow();
    expect(() => assertTestFlavor({ ...flavor, userDataDirectoryName: "local-video-manager" })).toThrow();
    expect(flavor.outputDirectory).toBe("release/unsigned-test-build");
    expect(releaseOutputDirectory(signedEnvironment)).toBe("release/signed-release");
    expect(() => assertTestFlavor({ ...flavor, artifactName: `../${flavor.artifactName}` })).toThrow();
  });
  it("requires every formal approval plus GitHub signing secrets and matching tag", () => {
    expect(createBuildFlavor(manifest, signedEnvironment)).toMatchObject({ releaseClass: "signed-release", appId: "com.local.video.manager", executableName: "拉面影视" });
    for (const field of ["GITHUB_ACTIONS", "CSC_LINK", "CSC_KEY_PASSWORD", "WINDOWS_EXPECTED_PUBLISHER", "RELEASE_LICENSE_APPROVED", "RELEASE_BINARY_COMPLIANCE_APPROVED", "RELEASE_MANUAL_QA_APPROVED"]) {
      expect(() => createBuildFlavor(manifest, { ...signedEnvironment, [field]: "" })).toThrow();
    }
    expect(() => createBuildFlavor(manifest, { ...signedEnvironment, GITHUB_REF: "refs/tags/v9.0.0" })).toThrow(/match/);
    expect(() => createBuildFlavor({ version: "1.2.3" }, signedEnvironment)).toThrow(/license/);
    expect(() => createBuildFlavor({ ...manifest, license: "UNLICENSED" }, signedEnvironment)).toThrow(/license/);
  });
  it("refuses credential-bearing local/test builds and supports tag QA without keys", () => {
    expect(() => createBuildFlavor(manifest, { CSC_LINK: "synthetic" })).toThrow();
    expect(() => createBuildFlavor(manifest, { WIN_CSC_LINK: "synthetic" })).toThrow();
    expect(createBuildFlavor(manifest, { GITHUB_REF: "refs/tags/v1.2.3", MOVIE_RELEASE_CLASS: "unsigned-test-build" }).releaseClass).toBe("unsigned-test-build");
  });
  it("checks actual signature status, publisher equality and timestamp", () => {
    const flavor = createBuildFlavor(manifest, signedEnvironment);
    const valid = { status: "Valid", publisher: "CN=Synthetic Publisher, O=Test", hasTimestamp: true };
    expect(() => assertSignature(valid, flavor)).not.toThrow();
    for (const candidate of [{ ...valid, status: "NotSigned" }, { ...valid, hasTimestamp: false }, { ...valid, publisher: "CN=Synthetic Publisher Evil" }, { ...valid, publisher: "CN=Other" }]) expect(() => assertSignature(candidate, flavor)).toThrow();
    expect(() => assertSignature({ status: "NotSigned" }, createBuildFlavor(manifest, {}))).not.toThrow();
    expect(() => assertSignature(valid, createBuildFlavor(manifest, {}))).toThrow();
  });
  it.each(["../video.mp4", "a/../video.mp4", "C:\\video.mp4", "/video.mp4", "a//b", "a\\b$INSTDIR", "*.mp4", "quote\".exe", "line\n.exe", "file:stream"])("rejects unsafe whitelist paths %j", (input) => { expect(() => validateRelativeFile(input)).toThrow(); });
  it("generates exact deletions and nonrecursive deepest-first directory removal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "movie-release-manifest-")); roots.push(root);
    await mkdir(path.join(root, "resources", "nested"), { recursive: true });
    await writeFile(path.join(root, "app.exe"), "synthetic");
    await writeFile(path.join(root, "resources", "nested", "data.bin"), "synthetic");
    const inventory = await packagedFileManifest(root);
    expect(inventory.files).toEqual(["app.exe", "resources\\nested\\data.bin"]);
    expect(inventory.directories).toEqual(["resources\\nested", "resources"]);
    const script = renderRemovalManifest(inventory);
    expect(script).toContain('!insertmacro movieDeleteOwnedFile "$INSTDIR\\app.exe"');
    expect(script).toContain('RMDir "$INSTDIR\\resources\\nested"');
    expect(script).not.toMatch(/RMDir\s+\/r|Delete\s+[^\n]*\*/i);
    expect(script).not.toContain("unknown-user-library.sqlite");
    expect(await hashFile(path.join(root, "app.exe"))).toHaveLength(64);
  });
  it("rejects junctions in build inputs instead of following external trees", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "movie-release-link-")); roots.push(root);
    const target = path.join(root, "target"), artifact = path.join(root, "artifact");
    await mkdir(target); await mkdir(artifact); await writeFile(path.join(target, "user.mp4"), "synthetic");
    await symlink(target, path.join(artifact, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(packagedFileManifest(artifact)).rejects.toThrow(/links/);
  });
  it("hooks explicitly block legacy removal/data deletion and preserve unknown files", async () => {
    const script = await readFile(path.resolve("build/installer.nsh"), "utf8");
    expect(script).toContain("!macro customRemoveFiles");
    expect(script).toContain("!macro customUnInit");
    expect(script).toContain('"--delete-app-data"');
    expect(script).toContain('"safeUninstaller" "1"');
    expect(script).toContain("GetFileAttributesW");
    expect(script).not.toMatch(/RMDir\s+\/r|Delete\s+[^\n]*\*/i);
  });
  it("blocks formal builds with false ownership/source/manual-QA approval records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "movie-release-approval-")); roots.push(root);
    await mkdir(path.join(root, "build")); await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await writeFile(path.join(root, "build", "release-approval.json"), JSON.stringify({ schemaVersion: 1, approved: false }));
    await expect(verifyFormalApproval(root, createBuildFlavor(manifest, signedEnvironment))).rejects.toThrow(/Owner-approved/);
    expect(await verifyFormalApproval(root, createBuildFlavor(manifest, {}))).toBeNull();
  });
  it("does not accept a license declaration when LICENSE remains a placeholder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "movie-release-placeholder-")); roots.push(root);
    await mkdir(path.join(root, "build")); await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await writeFile(path.join(root, "LICENSE"), "PENDING_OWNER_DECISION: owner may select MIT License. Permission is hereby granted is only draft text.");
    await writeFile(path.join(root, "build", "release-approval.json"), JSON.stringify({ schemaVersion: 1, approved: true, ownersConfirmed: true, applicationLicense: "MIT", manualQaApproved: true, legacyUpgradeApproved: true }));
    await expect(verifyFormalApproval(root, createBuildFlavor(manifest, signedEnvironment))).rejects.toThrow(/placeholder/);
  });
  it("binds explicit approval to actual binary, dependency, license and evidence bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "movie-release-binding-")); roots.push(root);
    for (const directory of ["build", "docs/legal", "native-bin/media-tools", "native-bin"]) await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await writeFile(path.join(root, "package-lock.json"), "synthetic-lock");
    await writeFile(path.join(root, "LICENSE"), "MIT License\nCopyright (c) Synthetic Test Fixtures\nPermission is hereby granted to test fixtures only.\n");
    const evidence = "docs/legal/synthetic-evidence.md";
    await writeFile(path.join(root, evidence), "Synthetic evidence for isolated unit fixtures only.");
    const evidenceHash = await hashFile(path.join(root, evidence));
    const binaries = [];
    for (const [name, relative] of [["ffmpeg.exe", "native-bin/media-tools/ffmpeg.exe"], ["ffprobe.exe", "native-bin/media-tools/ffprobe.exe"], ["NativeHost.exe", "native-bin/NativeHost.exe"]]) {
      await writeFile(path.join(root, relative), `synthetic-${name}`);
      binaries.push({ name, sha256: await hashFile(path.join(root, relative)), sourceComplianceApproved: true, sourceEvidence: evidence, sourceEvidenceSha256: evidenceHash });
    }
    const approval = { schemaVersion: 1, approved: true, ownersConfirmed: true, applicationLicense: "MIT", manualQaApproved: true, legacyUpgradeApproved: true,
      licenseSha256: await hashFile(path.join(root, "LICENSE")), packageLockSha256: await hashFile(path.join(root, "package-lock.json")), binaries,
      cleanWindows11Evidence: evidence, cleanWindows11EvidenceSha256: evidenceHash, previousSignedUpgradeEvidence: evidence, previousSignedUpgradeEvidenceSha256: evidenceHash };
    const approvalPath = path.join(root, "build", "release-approval.json");
    await writeFile(approvalPath, JSON.stringify(approval));
    const flavor = createBuildFlavor(manifest, signedEnvironment);
    expect(await verifyFormalApproval(root, flavor)).toBe(await hashFile(approvalPath));
    await writeFile(path.join(root, "native-bin/media-tools/ffmpeg.exe"), "different-binary");
    await expect(verifyFormalApproval(root, flavor)).rejects.toThrow(/binary/);
    await writeFile(path.join(root, "native-bin/media-tools/ffmpeg.exe"), "synthetic-ffmpeg.exe");
    await writeFile(path.join(root, evidence), "Changed source/QA evidence.");
    await expect(verifyFormalApproval(root, flavor)).rejects.toThrow(/evidence/);
  });
});
