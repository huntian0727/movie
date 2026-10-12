import { execFileSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createBuildFlavor, hashFile, readJson, verifyFormalApproval, windowsFileVersion, writeJson, zipArtifactName } from "./release-engineering.mjs";
import { candidateDirectory, liteFiles, mediaLockPath, mediaVariant } from "./media-variant.mjs";
import { assertPrivateSourceMedia, verifySourceMedia } from "./native-source-media.mjs";
import { playerRuntimeDirectory, playerRuntimeLockPath, playerRuntimeVariant, verifyPlayerRuntime } from "./native-player-runtime.mjs";
import { isPrivateRelease } from "./source-release-approval.mjs";

const mode = process.argv[2];
if (!["--dir", "--win-nsis", "--win-zip"].includes(mode)) {
  throw new Error("Usage: node scripts/run-electron-builder.mjs <--dir|--win-nsis|--win-zip>");
}

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 build environment required.");
const root = process.cwd();
const playerLock = await readJson(playerRuntimeLockPath(root));
await verifyPlayerRuntime(playerRuntimeDirectory(root), playerLock);
const selectedVariant = mediaVariant();
const mediaSource = candidateDirectory(root, selectedVariant);
const lite = selectedVariant === "lite-candidate";
const sourceMedia = selectedVariant === "source-candidate";
const nativeLock = await readJson(mediaLockPath(root, selectedVariant));
if (sourceMedia) { assertPrivateSourceMedia(); await verifySourceMedia(mediaSource, nativeLock); }
if (nativeLock.status !== "CANDIDATE_NOT_APPROVED" || nativeLock.distributable !== false) {
  throw new Error("Native media licensing is not approved by source staging.");
}
const expectedExecutables = lite || sourceMedia ? nativeLock.files : nativeLock.expectedExecutables;
for (const [name, expected] of Object.entries(expectedExecutables)) {
  const actual = await hashFile(path.join(mediaSource, name));
  if (actual !== expected) throw new Error("Pinned native media input differs: " + name);
}
const expectedLicense = sourceMedia ? nativeLock.files["LICENSE.txt"] : lite ? nativeLock.files["COPYING.LGPLv2.1"] : nativeLock.expectedLicenseSha256;
if (await hashFile(path.join(mediaSource, "LICENSE.txt")) !== expectedLicense) {
  throw new Error("Native media license evidence has changed.");
}
const flavor = createBuildFlavor(await readJson(path.join(root, "package.json")));
if (flavor.publicTestRelease && mode !== "--win-zip") throw new Error("Public beta approval covers a portable ZIP only.");
if (flavor.releaseClass === "unsigned-community-qa" && mode === "--win-nsis") throw new Error("Private community QA is a portable ZIP only; installer approval is separate.");
if (sourceMedia) flavor.mediaRuntimeLockSha256 = await hashFile(mediaLockPath(root, selectedVariant));
if (playerRuntimeVariant() === "source-candidate") {
  if (!isPrivateRelease(flavor) && !(sourceMedia && flavor.releaseClass === "unsigned-public-release")) throw new Error("Source player requires private QA or approved paired community release.");
  flavor.playerRuntimeVariant = "source-candidate";
  flavor.playerRuntimeLockSha256 = await hashFile(playerRuntimeLockPath(root));
}
if (lite && !isPrivateRelease(flavor) && flavor.releaseClass !== "unsigned-public-release") throw new Error("Lite media requires isolated QA or explicitly approved unsigned community build.");
if (flavor.releaseClass === "unsigned-public-release" && !lite && !sourceMedia) throw new Error("Unsigned public build requires reviewed media inputs.");
flavor.commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
flavor.workspaceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true }).trim());
if (flavor.releaseClass !== "unsigned-test-build" && flavor.workspaceDirty) throw new Error("Formal packaging requires a clean reviewed checkout.");
flavor.complianceApprovalSha256 = await verifyFormalApproval(root, flavor);
const buildDirectory = path.join(root, ".tmp", "release-engineering");
await mkdir(buildDirectory, { recursive: true });
await writeJson(path.join(buildDirectory, "build-flavor.json"), flavor);
// Optional offline Electron runtime: only the verified 44.7.0 x64 release ZIP is accepted.
const offlineElectronZip = process.env.MOVIE_ELECTRON_DIST_ZIP;
if (offlineElectronZip) {
  if (path.basename(offlineElectronZip).toLowerCase() !== "electron-v44.7.0-win32-x64.zip" ||
      await hashFile(offlineElectronZip) !== "eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c") {
    throw new Error("Offline Electron ZIP does not match pinned Electron 44.7.0 Windows x64 release.");
  }
}
const configuration = {
  ...(offlineElectronZip ? { electronDist: path.resolve(offlineElectronZip) } : {}),
  extends: path.join(root, "electron-builder.yml"), appId: flavor.appId,
  // Keep Windows resources tied to package.json rather than ambient CI counters.
  buildVersion: windowsFileVersion(flavor), buildNumber: "0",
  directories: { output: flavor.outputDirectory },
  win: { executableName: flavor.executableName, artifactName: mode === "--win-zip" ? zipArtifactName(flavor) : flavor.artifactName, target: [{ target: mode === "--win-zip" ? "zip" : "nsis", arch: ["x64"] }] },
  extraResources: [
    // NativeHost remains in the base config; exactly one runtime closure is
    // declared here, avoiding duplicate copies racing over the same Windows DLL.
    { from: playerRuntimeDirectory(root), to: "native-player", filter: Object.keys(playerLock.files) },
    { from: mediaSource, to: "media-tools", filter: sourceMedia ? Object.keys(nativeLock.files) : lite ? liteFiles : ["ffmpeg.exe", "ffprobe.exe", "LICENSE.txt", "SOURCE-STATUS.txt"] },
    { from: "docs/legal", to: "legal" },
    { from: "THIRD_PARTY_LICENSES.md", to: "legal/THIRD_PARTY_LICENSES.md" },
    { from: "LICENSE", to: "legal/PROJECT-LICENSE.txt" },
    { from: path.join(buildDirectory, "build-flavor.json"), to: "build-flavor.json" }
  ],
  nsis: { include: path.join(root, "build", "installer.nsh"), allowToChangeInstallationDirectory: false },
  afterPack: path.join(root, "scripts", "release-after-pack.cjs")
};
if (isPrivateRelease(flavor) || flavor.releaseClass === "unsigned-public-release") {
  configuration.productName = flavor.executableName;
  configuration.extraMetadata = { name: flavor.packageName };
  // Keep Windows product/version resources accurate while explicitly skipping
  // signing. signAndEditExecutable:false would leave Electron's own metadata.
  configuration.win.signExecutable = false;
  configuration.nsis.guid = flavor.nsisGuid;
  configuration.nsis.createDesktopShortcut = flavor.releaseClass === "unsigned-public-release";
  configuration.nsis.createStartMenuShortcut = flavor.releaseClass === "unsigned-public-release";
  configuration.nsis.shortcutName = flavor.executableName;
  configuration.fileAssociations = [];
} else {
  configuration.forceCodeSigning = true;
  // Preserve third-party binary provenance; sign our app, NativeHost and installer.
  configuration.win.signExts = ["!ffmpeg.exe", "!ffprobe.exe"];
}
await writeJson(path.join(buildDirectory, "builder-config.json"), configuration);
const electronBuilderCli = path.join(root, "node_modules", "electron-builder", "cli.js");
const args = mode === "--dir" ? ["--dir", "--x64"] : ["--win", mode === "--win-zip" ? "zip" : "nsis", "--x64"];

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [electronBuilderCli, ...args, "--config", path.join(buildDirectory, "builder-config.json")], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (signal) reject(new Error(`electron-builder exited with signal ${signal}`));
    else if (code !== 0) reject(new Error(`electron-builder exited with code ${code}`));
    else resolve();
  });
});
await writeJson(path.join(root, flavor.outputDirectory, "build-flavor.json"), flavor);
console.log(`Build complete: ${flavor.releaseClass}, Windows x64, ${flavor.appId}.`);
