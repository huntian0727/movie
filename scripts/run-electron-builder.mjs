import { execFileSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createBuildFlavor, hashFile, readJson, verifyFormalApproval, writeJson } from "./release-engineering.mjs";
import { candidateDirectory, liteFiles, mediaVariant } from "./media-variant.mjs";

const mode = process.argv[2];
if (mode !== "--dir" && mode !== "--win-nsis") {
  throw new Error("Usage: node scripts/run-electron-builder.mjs <--dir|--win-nsis>");
}

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 build environment required.");
const root = process.cwd();
const selectedVariant = mediaVariant();
const mediaSource = candidateDirectory(root, selectedVariant);
const lite = selectedVariant === "lite-candidate";
const nativeLock = await readJson(path.join(root, "scripts", lite ? "native-media-lite.lock.json" : "native-media-candidate.lock.json"));
if (nativeLock.status !== "CANDIDATE_NOT_APPROVED" || nativeLock.distributable !== false) {
  throw new Error("Native media licensing is not approved by source staging.");
}
const expectedExecutables = lite ? nativeLock.files : nativeLock.expectedExecutables;
for (const [name, expected] of Object.entries(expectedExecutables)) {
  const actual = await hashFile(path.join(mediaSource, name));
  if (actual !== expected) throw new Error("Pinned native media input differs: " + name);
}
const expectedLicense = lite ? nativeLock.files["COPYING.LGPLv2.1"] : nativeLock.expectedLicenseSha256;
if (await hashFile(path.join(mediaSource, "LICENSE.txt")) !== expectedLicense) {
  throw new Error("Native media license evidence has changed.");
}
const flavor = createBuildFlavor(await readJson(path.join(root, "package.json")));
if (lite && flavor.releaseClass !== "unsigned-test-build") throw new Error("Lite native input may only be built for isolated internal QA.");
flavor.commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
flavor.complianceApprovalSha256 = await verifyFormalApproval(root, flavor);
const buildDirectory = path.join(root, ".tmp", "release-engineering");
await mkdir(buildDirectory, { recursive: true });
await writeJson(path.join(buildDirectory, "build-flavor.json"), flavor);
const configuration = {
  extends: path.join(root, "electron-builder.yml"), appId: flavor.appId,
  // Keep Windows resources tied to package.json rather than ambient CI counters.
  buildVersion: flavor.version, buildNumber: "0",
  directories: { output: flavor.outputDirectory },
  win: { executableName: flavor.executableName, artifactName: flavor.artifactName, target: [{ target: "nsis", arch: ["x64"] }] },
  extraResources: [
    { from: "native-bin", to: "native-player", filter: ["NativeHost.exe"] },
    { from: mediaSource, to: "media-tools", filter: lite ? liteFiles : ["ffmpeg.exe", "ffprobe.exe", "LICENSE.txt", "SOURCE-STATUS.txt"] },
    { from: "docs/legal", to: "legal" },
    { from: "LICENSE", to: "legal/PROJECT-LICENSE.txt" },
    { from: path.join(buildDirectory, "build-flavor.json"), to: "build-flavor.json" }
  ],
  nsis: { include: path.join(root, "build", "installer.nsh"), allowToChangeInstallationDirectory: false },
  afterPack: path.join(root, "scripts", "release-after-pack.cjs")
};
if (flavor.releaseClass === "unsigned-test-build") {
  configuration.productName = flavor.executableName;
  configuration.extraMetadata = { name: flavor.packageName };
  // Keep Windows product/version resources accurate while explicitly skipping
  // signing. signAndEditExecutable:false would leave Electron's own metadata.
  configuration.win.signExecutable = false;
  configuration.nsis.guid = flavor.nsisGuid;
  configuration.nsis.createDesktopShortcut = false;
  configuration.nsis.createStartMenuShortcut = false;
  configuration.nsis.shortcutName = flavor.executableName;
  configuration.fileAssociations = [];
} else {
  configuration.forceCodeSigning = true;
  // Preserve third-party binary provenance; sign our app, NativeHost and installer.
  configuration.win.signExts = ["!ffmpeg.exe", "!ffprobe.exe"];
}
await writeJson(path.join(buildDirectory, "builder-config.json"), configuration);
const electronBuilderCli = path.join(root, "node_modules", "electron-builder", "cli.js");
const args = mode === "--dir" ? ["--dir", "--x64"] : ["--win", "nsis", "--x64"];

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
