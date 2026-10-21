// Maintainer's local daily desktop only. Never produces an installer, ZIP or publication.
import { execFileSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson, hashFile } from "./release-engineering.mjs";
import { verifySourceMedia } from "./native-source-media.mjs";
import { verifyPlayerRuntime } from "./native-player-runtime.mjs";

if (process.platform !== "win32" || process.arch !== "x64" || process.env.GITHUB_ACTIONS === "true") {
  throw new Error("Local Windows x64 daily development builds only; use the release workflow for distribution.");
}
const root = process.cwd();
// The optional staging directory lets us build a new local desktop without
// overwriting an app that could be processing a destructive operation.
const outputDirectory = process.env.MOVIE_SAFE_STAGE_LOCAL === "1" ? "release/local-optimized" : "release";
const mediaLock = await readJson(path.join(root, "scripts/native-source-media.lock.json"));
const playerLock = await readJson(path.join(root, "scripts/native-source-player-runtime.lock.json"));
const media = path.join(root, ".tmp/native-source-media-tools"), player = path.join(root, ".tmp/native-source-player-runtime");
await verifySourceMedia(media, mediaLock);
await verifyPlayerRuntime(player, playerLock);
const pkg = await readJson(path.join(root, "package.json"));
const staging = path.join(root, ".tmp/development-package");
await mkdir(staging, { recursive: true });
const flavor = { schemaVersion: 1, releaseClass: "local-development", appId: "com.local.video.manager.development",
  userDataDirectoryName: "local-video-manager", version: pkg.version, arch: "x64", distributable: false,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(),
  workspaceDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", windowsHide: true }).trim()),
  builtAt: new Date().toISOString() };
await writeJson(path.join(staging, "build-flavor.json"), flavor);
const offline = process.env.MOVIE_ELECTRON_DIST_ZIP;
if (offline && (path.basename(offline).toLowerCase() !== "electron-v44.7.0-win32-x64.zip" ||
    await hashFile(offline) !== "eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c")) {
  throw new Error("Local Electron runtime differs from the pinned official Electron 44.7.0 archive.");
}
const config = {
  extends: path.join(root, "electron-builder.yml"), appId: flavor.appId, forceCodeSigning: false,
  ...(offline ? { electronDist: path.resolve(offline) } : {}),
  directories: { output: outputDirectory }, win: { executableName: "拉面影视", signExecutable: false },
  extraResources: [
    { from: "native-bin/NativeHost.exe", to: "native-player/NativeHost.exe" },
    { from: player, to: "native-player", filter: Object.keys(playerLock.files) },
    { from: media, to: "media-tools", filter: Object.keys(mediaLock.files) },
    { from: path.join(staging, "build-flavor.json"), to: "build-flavor.json" },
    { from: "docs/legal", to: "legal" }, { from: "THIRD_PARTY_LICENSES.md", to: "legal/THIRD_PARTY_LICENSES.md" },
    { from: "LICENSE", to: "legal/PROJECT-LICENSE.txt" }
  ]
};
const configFile = path.join(staging, "builder-config.json");
await writeJson(configFile, config);
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, "node_modules/electron-builder/cli.js"), "--dir", "--x64", "--publish", "never", "--config", configFile],
    { cwd: root, env: process.env, stdio: "inherit", windowsHide: true });
  child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Local desktop packaging failed (${code})`)));
});
console.log(`Local desktop regenerated at ${outputDirectory}/win-unpacked; distribution remains a separate workflow.`);
