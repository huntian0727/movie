import { execFileSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { buildPinnedSbom } from "./generate-native-lite-sbom.mjs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import electronPackage from "electron/package.json" with { type: "json" };
import { authenticode, createBuildFlavor, hashFile, readJson, releaseOutputDirectory, verifyApplicationVersion, verifyFormalApproval, zipArtifactName } from "./release-engineering.mjs";
import { mediaLockPath } from "./media-variant.mjs";
import { playerRuntimeLockPath, playerRuntimeVariant } from "./native-player-runtime.mjs";
import { formatDisplayVersion, readDisplayVersion } from "./display-version.mjs";

const releaseDirectory = path.join(process.cwd(), releaseOutputDirectory());
const flavor = await readJson(path.join(releaseDirectory, "build-flavor.json"));
const embeddedFlavor = await readJson(path.join(releaseDirectory, "win-unpacked", "resources", "build-flavor.json"));
const manifest = await readJson(path.join(process.cwd(), "package.json"));
const expectedFlavor = createBuildFlavor(manifest, process.env, { signingCredentialsRequired: false });
expectedFlavor.displayVersion = formatDisplayVersion(await readDisplayVersion(process.cwd()));
expectedFlavor.commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
expectedFlavor.workspaceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim());
if (expectedFlavor.mediaVariant === "source-candidate") expectedFlavor.mediaRuntimeLockSha256 = await hashFile(mediaLockPath(process.cwd(), "source-candidate"));
if (playerRuntimeVariant() === "source-candidate") {
  expectedFlavor.playerRuntimeVariant = "source-candidate";
  expectedFlavor.playerRuntimeLockSha256 = await hashFile(playerRuntimeLockPath(process.cwd()));
}
expectedFlavor.complianceApprovalSha256 = await verifyFormalApproval(process.cwd(), expectedFlavor);
if (!isDeepStrictEqual(flavor, embeddedFlavor) || !isDeepStrictEqual(flavor, expectedFlavor)) {
  throw new Error("Candidate flavor/version/architecture does not match the packaged app.");
}
const portable = process.argv.includes("--portable");
if (process.argv.slice(2).some(arg => arg !== "--portable")) throw new Error("Only --portable is supported.");
const artifactName = portable ? zipArtifactName(flavor) : flavor.artifactName;
const installerPath = path.join(releaseDirectory, artifactName);
const appPath = path.join(releaseDirectory, "win-unpacked", `${flavor.executableName}.exe`);
const nativeHostPath = path.join(releaseDirectory, "win-unpacked", "resources", "native-player", "NativeHost.exe");
const applicationVersion = await verifyApplicationVersion(appPath, flavor);
await Promise.all([access(installerPath), access(appPath)]);
const [installerSignature, appSignature, nativeHostSignature] = await Promise.all([portable ? null : authenticode(installerPath, flavor), authenticode(appPath, flavor), authenticode(nativeHostPath, flavor)]);
const checksums = [{ name: artifactName, sha256: await hashFile(installerPath) }];
if (portable) {
  const qa = await readJson(path.join(releaseDirectory, "portable-qa.json"));
  if (qa.sha256 !== checksums[0].sha256 || qa.commit !== flavor.commit || qa.releaseClass !== flavor.releaseClass || qa.filesVerified <= 0 || qa.approvalSha256 !== flavor.complianceApprovalSha256) throw new Error("Portable metadata requires matching extraction and packaged smoke evidence.");
}
const materials = [];
if (flavor.mediaVariant === "lite-candidate") {
  const nativeLock = await readJson(path.join(process.cwd(), "scripts", "native-media-lite.lock.json"));
  const nativeSbom = await buildPinnedSbom(path.join(process.cwd(), ".tmp", "native-media-lite-tools"), nativeLock);
  const name = "FFMPEG-LITE-SBOM.spdx.json";
  const output = path.join(releaseDirectory, name);
  await writeFile(output, JSON.stringify(nativeSbom, null, 2) + "\n", "utf8");
  materials.push({ name, sha256: await hashFile(output), status: "UNAPPROVED_NATIVE_MEDIA_CANDIDATE" });
}
await writeFile(
  path.join(releaseDirectory, "SHA256SUMS.txt"),
  [...checksums, ...materials].map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n",
  "utf8"
);

const signed = flavor.releaseClass === "signed-release";
const metadata = {
  generatedAt: new Date().toISOString(),
  commit: flavor.commit,
  ref: process.env.GITHUB_REF ?? "local",
  node: process.versions.node,
  npm: process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] ?? "unknown",
  electron: electronPackage.version,
  signed,
  releaseClass: flavor.releaseClass,
  flavor,
  signatures: { installer: installerSignature, application: appSignature, nativeHost: nativeHostSignature },
  application: { name: `${flavor.executableName}.exe`, sha256: await hashFile(appPath), version: applicationVersion },
  nativeHost: { name: "NativeHost.exe", sha256: await hashFile(nativeHostPath) },
  installers: portable ? [] : checksums,
  portableArchives: portable ? checksums : [],
  materials
};
await writeFile(path.join(releaseDirectory, "build-metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
console.log(`Release metadata written (${metadata.releaseClass}).`);
