import { execFileSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { buildPinnedSbom } from "./generate-native-lite-sbom.mjs";
import path from "node:path";
import electronPackage from "electron/package.json" with { type: "json" };
import { authenticode, createBuildFlavor, hashFile, readJson, releaseOutputDirectory, verifyApplicationVersion, verifyFormalApproval } from "./release-engineering.mjs";

const releaseDirectory = path.join(process.cwd(), releaseOutputDirectory());
const flavor = await readJson(path.join(releaseDirectory, "build-flavor.json"));
const embeddedFlavor = await readJson(path.join(releaseDirectory, "win-unpacked", "resources", "build-flavor.json"));
const manifest = await readJson(path.join(process.cwd(), "package.json"));
const expectedFlavor = createBuildFlavor(manifest, process.env, { signingCredentialsRequired: false });
expectedFlavor.commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
expectedFlavor.complianceApprovalSha256 = await verifyFormalApproval(process.cwd(), expectedFlavor);
if (JSON.stringify(flavor) !== JSON.stringify(embeddedFlavor) || JSON.stringify(flavor) !== JSON.stringify(expectedFlavor)) {
  throw new Error("Candidate flavor/version/architecture does not match the packaged app.");
}
const installerPath = path.join(releaseDirectory, flavor.artifactName);
const appPath = path.join(releaseDirectory, "win-unpacked", `${flavor.executableName}.exe`);
const nativeHostPath = path.join(releaseDirectory, "win-unpacked", "resources", "native-player", "NativeHost.exe");
const applicationVersion = await verifyApplicationVersion(appPath, flavor);
await Promise.all([access(installerPath), access(appPath)]);
const [installerSignature, appSignature, nativeHostSignature] = await Promise.all([authenticode(installerPath, flavor), authenticode(appPath, flavor), authenticode(nativeHostPath, flavor)]);
const checksums = [{ name: flavor.artifactName, sha256: await hashFile(installerPath) }];
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
  installers: checksums,
  materials
};
await writeFile(path.join(releaseDirectory, "build-metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
console.log(`Release metadata written (${metadata.releaseClass}).`);
