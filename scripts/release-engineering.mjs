import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { candidateDirectory, liteRuntime, mediaVariant } from "./media-variant.mjs";

const execute = promisify(execFile);
export const PRODUCTION_APP_ID = "com.local.video.manager";
export const TEST_APP_ID = "com.local.video.manager.unsignedtest";
export const COMMUNITY_APP_ID = "com.local.video.manager.community";
export const COMMUNITY_NSIS_GUID = "b73f7252-798d-48d9-b877-19fb6d355f83";
export const TEST_NSIS_GUID = "ec02b3c5-6e7a-4e3d-9f2a-1c6854cc8072";
export const PRODUCT_NAME = "拉面影视";
export function zipArtifactName(flavor) {
  if (!flavor.artifactName?.endsWith("-Setup.exe")) throw new Error("Invalid installer artifact name.");
  return flavor.artifactName.replace(/-Setup\.exe$/, "-Portable.zip");
}

export function releaseClassFor(env = process.env) {
  const requested = env.MOVIE_RELEASE_CLASS;
  if (requested && !["signed-release","unsigned-public-release","unsigned-test-build"].includes(requested)) {
    throw new Error("Unrecognized release class; refusing release build.");
  }
  if (requested === "unsigned-public-release") return "unsigned-public-release";
  if (requested === "signed-release" || (!requested && env.GITHUB_REF?.startsWith("refs/tags/"))) return "signed-release";
  return "unsigned-test-build";
}
export function releaseOutputDirectory(env = process.env) {
  return "release/" + releaseClassFor(env);
}

export function createBuildFlavor(manifest, env = process.env, { signingCredentialsRequired = true } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error("A safe semantic package version is required.");
  const releaseClass = releaseClassFor(env);
  const tagged = env.GITHUB_REF?.startsWith("refs/tags/") === true;
  const formal = releaseClass !== "unsigned-test-build";
  const signed = releaseClass === "signed-release";
  const community = releaseClass === "unsigned-public-release";
  const certificate = Boolean(env.CSC_LINK || env.WIN_CSC_LINK || env.CSC_KEY_PASSWORD);
  if (formal) {
    if (env.GITHUB_ACTIONS !== "true") throw new Error("Formal builds require GitHub Actions.");
    if (env.RELEASE_LICENSE_APPROVED !== "true" || env.RELEASE_BINARY_COMPLIANCE_APPROVED !== "true") throw new Error("Formal builds require explicit license and binary-compliance approval.");
    if (!manifest.license || manifest.license === "UNLICENSED") throw new Error("The owner must select and declare the application license before formal distribution.");
    if (env.RELEASE_MANUAL_QA_APPROVED !== "true") throw new Error("Formal builds require approved clean-Windows QA evidence.");
    if (!tagged || env.GITHUB_REF !== `refs/tags/v${manifest.version}`) throw new Error("Release tag must match package version.");
    if (signed && (signingCredentialsRequired && (!env.CSC_LINK || !env.CSC_KEY_PASSWORD))) throw new Error("Formal signed builds require GitHub Actions signing secrets.");
    if (signed && !env.WINDOWS_EXPECTED_PUBLISHER?.trim()) throw new Error("Formal signed builds require expected publisher identity.");
    if (community && certificate) throw new Error("Unsigned public builds cannot contain signing credentials.");
    if (community && mediaVariant(env) !== "lite-candidate") throw new Error("Unsigned public builds require reviewed Lite media source.");
    if (community && env.RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED !== "true") throw new Error("Explicit unsigned public risk acknowledgement is required.");
  } else if (certificate) throw new Error("Signing credentials must not be supplied to unsigned test builds.");
  return {
    schemaVersion: 1, releaseClass, version: manifest.version, arch: "x64", mediaVariant: mediaVariant(env), outputDirectory: releaseOutputDirectory(env), complianceApprovalSha256: null,
    appId: community ? COMMUNITY_APP_ID : signed ? PRODUCTION_APP_ID : TEST_APP_ID,
    nsisGuid: community ? COMMUNITY_NSIS_GUID : signed ? null : TEST_NSIS_GUID,
    packageName: community ? "local-video-manager-community" : signed ? "local-video-manager" : "local-video-manager-unsigned-test",
    executableName: community ? `${PRODUCT_NAME}-免费分享版` : signed ? PRODUCT_NAME : `${PRODUCT_NAME}-unsigned-test-build`,
    userDataDirectoryName: community ? "local-video-manager-community" : signed ? "local-video-manager" : "local-video-manager-unsigned-test",
    artifactName: `${PRODUCT_NAME}-${manifest.version}-x64-${community ? "unsigned-public-Setup" : signed ? "Setup" : "unsigned-test-build-Setup"}.exe`,
    expectedPublisher: signed ? env.WINDOWS_EXPECTED_PUBLISHER.trim() : null, commit: env.GITHUB_SHA ?? "local"
  };
}

export function assertTestFlavor(flavor) {
  if (flavor.schemaVersion !== 1 || flavor.releaseClass !== "unsigned-test-build" || flavor.appId !== TEST_APP_ID ||
      flavor.nsisGuid !== TEST_NSIS_GUID || flavor.arch !== "x64" || flavor.userDataDirectoryName !== "local-video-manager-unsigned-test" ||
      flavor.outputDirectory !== "release/unsigned-test-build" || !["btbn-candidate","lite-candidate"].includes(flavor.mediaVariant) || flavor.packageName !== "local-video-manager-unsigned-test" ||
      flavor.executableName !== `${PRODUCT_NAME}-unsigned-test-build` || !flavor.artifactName?.endsWith("-unsigned-test-build-Setup.exe")) {
    throw new Error("Installer smoke only accepts the isolated unsigned test identity.");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(flavor.version) || flavor.artifactName !== `${PRODUCT_NAME}-${flavor.version}-x64-unsigned-test-build-Setup.exe`) {
    throw new Error("Installer test artifact name/version is invalid.");
  }
}

export function validateRelativeFile(value) {
  if (!value || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split(/[\\/]/).some((part) => !part || part === "." || part === "..") ||
      /[\r\n"$*?:<>|]/.test(value)) throw new Error("Unsafe packaged manifest path.");
  return value.replaceAll("/", "\\");
}

export async function packagedFileManifest(root) {
  const files = [], directories = [];
  async function walk(relative = "") {
    const directory = path.join(root, relative), info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Packaged directory is not a regular directory.");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(relative, entry.name), childInfo = await lstat(path.join(root, child));
      if (childInfo.isSymbolicLink()) throw new Error("Packaged manifest rejects reparse/symbolic links.");
      if (childInfo.isDirectory()) { directories.push(validateRelativeFile(child)); await walk(child); }
      else if (childInfo.isFile()) files.push(validateRelativeFile(child));
      else throw new Error("Packaged manifest rejects special files.");
    }
  }
  await walk(); files.sort(); directories.sort((a, b) => b.split("\\").length - a.split("\\").length || b.localeCompare(a));
  return { schemaVersion: 1, files, directories };
}

export function renderRemovalManifest(manifest) {
  const files = manifest.files.map(validateRelativeFile), directories = manifest.directories.map(validateRelativeFile);
  return ["; Generated from regular packaged files. Never enumerate user installation contents.", "!macro moviePreflightOwnedFiles",
    ...directories.map((file) => `  !insertmacro movieRejectReparse "$INSTDIR\\${file}"`),
    ...files.map((file) => `  !insertmacro moviePreflightFile "$INSTDIR\\${file}"`), "!macroend", "!macro movieRemoveOwnedFiles",
    ...files.map((file) => `  !insertmacro movieDeleteOwnedFile "$INSTDIR\\${file}"`),
    ...directories.map((file) => `  RMDir "$INSTDIR\\${file}"`), "!macroend", ""].join("\n");
}

export async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256"), stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function verifyFormalApproval(root, flavor) {
  if (flavor.releaseClass === "unsigned-test-build") return null;
  const approvalPath = path.join(root, "build", "release-approval.json");
  const approval = await readJson(approvalPath);
  const manifest = await readJson(path.join(root, "package.json"));
  if (approval.schemaVersion !== 1 || approval.approved !== true || approval.ownersConfirmed !== true ||
      approval.applicationLicense !== manifest.license || approval.manualQaApproved !== true ||
      (flavor.releaseClass === "signed-release" && approval.legacyUpgradeApproved !== true)) {
    throw new Error("Owner-approved release manifest and actual Windows/legacy upgrade evidence are required.");
  }
  const licenseText = await readFile(path.join(root, "LICENSE"), "utf8");
  const licenseGrant = manifest.license === "MIT" ? /^\s*(?:MIT License|The MIT License)/.test(licenseText) && licenseText.includes("Permission is hereby granted") :
    manifest.license === "Apache-2.0" ? licenseText.includes("Apache License") && licenseText.includes("Version 2.0") && licenseText.includes("TERMS AND CONDITIONS") :
    /^GPL-3\.0-(?:only|or-later)$/.test(manifest.license) ? licenseText.includes("GNU GENERAL PUBLIC LICENSE") && licenseText.includes("Version 3") && licenseText.includes("TERMS AND CONDITIONS") : false;
  if (!licenseGrant || /PENDING_OWNER_DECISION|TODO|pending license|未确定|待确认|待决定/i.test(licenseText)) {
    throw new Error("LICENSE contains a pending placeholder rather than an approved license grant.");
  }
  if (await hashFile(path.join(root, "LICENSE")) !== approval.licenseSha256 ||
      await hashFile(path.join(root, "package-lock.json")) !== approval.packageLockSha256) throw new Error("Approved license/dependency hashes no longer match the candidate.");
  const mediaRoot = candidateDirectory(root, flavor.mediaVariant);
  const required = {
    "ffmpeg.exe": path.join(mediaRoot, "ffmpeg.exe"),
    "ffprobe.exe": path.join(mediaRoot, "ffprobe.exe"),
    "NativeHost.exe": path.join(root, "native-bin", "NativeHost.exe"),
    "libmpv-2.dll": path.join(root, "native-bin", "player-runtime", "libmpv-2.dll")
  };
  if (flavor.releaseClass === "unsigned-public-release") {
    if (flavor.appId !== COMMUNITY_APP_ID || flavor.nsisGuid !== COMMUNITY_NSIS_GUID ||
        flavor.mediaVariant !== "lite-candidate") throw new Error("Unsigned public build must retain its isolated community identity and pinned Lite variant.");
    for (const name of liteRuntime) required[name] = path.join(mediaRoot, name);
  }
  for (const [name, relative] of Object.entries(required)) {
    const item = approval.binaries?.find((entry) => entry.name === name);
    if (!item || item.sourceComplianceApproved !== true || await hashFile(relative) !== item.sha256) throw new Error("A distributed binary has no matching approved source/license/hash record.");
    await verifyEvidence(root, item.sourceEvidence, item.sourceEvidenceSha256);
  }
  await verifyEvidence(root, approval.cleanWindows11Evidence, approval.cleanWindows11EvidenceSha256);
  if (flavor.releaseClass === "signed-release") await verifyEvidence(root, approval.previousSignedUpgradeEvidence, approval.previousSignedUpgradeEvidenceSha256);
  return hashFile(approvalPath);
}

async function verifyEvidence(root, relative, expectedHash) {
  if (typeof relative !== "string" || !relative.startsWith("docs/legal/") || !/^[a-f0-9]{64}$/i.test(expectedHash ?? "")) throw new Error("Reviewed source/manual QA evidence is missing.");
  validateRelativeFile(relative);
  const filePath = path.join(root, relative);
  if (await hashFile(filePath) !== expectedHash) throw new Error("Reviewed source/manual QA evidence has changed.");
}
export function assertSignature(result, flavor) {
  if (flavor.releaseClass === "unsigned-test-build" || flavor.releaseClass === "unsigned-public-release") {
    if (result.status !== "NotSigned") throw new Error("Unsigned artifact must be explicitly unsigned.");
    return;
  }
  if (result.status !== "Valid" || !result.hasTimestamp || !result.publisher?.split(/,\s*/).includes(`CN=${flavor.expectedPublisher}`)) {
    throw new Error("Artifact signature, trusted timestamp, or expected publisher verification failed.");
  }
}
export async function authenticode(filePath, flavor) {
  if (process.platform !== "win32") throw new Error("Authenticode verification requires Windows.");
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Import-Module (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $s=Get-AuthenticodeSignature -LiteralPath $env:MOVIE_SIGNATURE_FILE; @{status=$s.Status.ToString();publisher=$s.SignerCertificate.Subject;hasTimestamp=($null -ne $s.TimeStamperCertificate)} | ConvertTo-Json -Compress";
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, MOVIE_SIGNATURE_FILE: path.resolve(filePath) }, windowsHide: true, timeout: 30_000
  });
  const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, "")); assertSignature(result, flavor); return result;
}
export async function verifyApplicationVersion(filePath, flavor) {
  if (process.platform !== "win32") throw new Error("Windows executable version verification requires Windows.");
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $v=[Diagnostics.FileVersionInfo]::GetVersionInfo($env:MOVIE_VERSION_FILE); @{productName=$v.ProductName;productVersion=$v.ProductVersion;fileVersion=$v.FileVersion;major=$v.FileMajorPart;minor=$v.FileMinorPart;patch=$v.FileBuildPart} | ConvertTo-Json -Compress";
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, MOVIE_VERSION_FILE: path.resolve(filePath) }, windowsHide: true, timeout: 30_000
  });
  const version = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
  const expectedProduct = flavor.releaseClass === "signed-release" ? PRODUCT_NAME : flavor.executableName;
  const expectedNumbers = flavor.version.split("-")[0].split(".").map(Number);
  // electron-builder writes the fixed Windows ProductVersion as four numbers,
  // while preserving the package's semantic version in the FileVersion string.
  const expectedProductVersion = `${expectedNumbers.join(".")}.0`;
  if (version.productName !== expectedProduct || version.productVersion !== expectedProductVersion || version.fileVersion !== flavor.version ||
      [version.major, version.minor, version.patch].some((part, index) => part !== expectedNumbers[index])) {
    throw new Error("Windows application product/version resources do not match the candidate identity.");
  }
  return version;
}
export async function writeJson(filePath, value) { await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8"); }
export async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }
