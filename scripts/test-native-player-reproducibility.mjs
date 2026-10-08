import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildNativePlayer, repositoryRoot } from "./build-native-player.mjs";
import { assertX64ManagedExecutable, checkedDirectory, sha256 } from "./native-player-toolchain.mjs";

if (process.platform !== "win32") throw new Error("NativeHost reproducibility test requires Windows; it never runs the built helper");
const temporary = checkedDirectory(repositoryRoot, path.join(repositoryRoot, ".tmp"));
const root = mkdtempSync(path.join(temporary, "native-player-repro-"));
const source = readFileSync(path.join(repositoryRoot, "native/embedded-mpv/NativeHost.cs"));
const builds = [];
for (const name of ["first checkout", "second checkout 中文"]) {
  const sourceDirectory = checkedDirectory(repositoryRoot, path.join(root, name, "native/embedded-mpv"));
  const sourceFile = path.join(sourceDirectory, "NativeHost.cs");
  writeFileSync(sourceFile, source, { flag: "wx" });
  builds.push(await buildNativePlayer({ source: sourceFile, outputDirectory: path.join(root, name, "native-bin") }));
}
const first = readFileSync(builds[0].output), second = readFileSync(builds[1].output);
assertX64ManagedExecutable(first); assertX64ManagedExecutable(second);
if (!first.equals(second) || builds[0].sha256 !== builds[1].sha256
  || builds.some(build => build.sourceSha256 !== sha256(source))) throw new Error("NativeHost changed across absolute source/output paths");
const result = { status: "PASS", helperExecuted: false, sourceSha256: sha256(source), outputSha256: builds[0].sha256,
  compiler: builds[0].compiler, referencePackageVersion: builds[0].referencePackageVersion,
  references: builds[0].references, builds, proof: "Full byte equality across two distinct absolute source, output and compiler working directories; both unsigned x64 managed PE." };
writeFileSync(path.join(root, "reproducibility.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(`NativeHost reproducibility PASS: ${result.outputSha256}; evidence ${path.join(root, "reproducibility.json")}`);
