import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import electronPackage from "electron/package.json" with { type: "json" };

const releaseDirectory = path.join(process.cwd(), "release");
const installers = [];
for (const name of await readdir(releaseDirectory)) {
  const filePath = path.join(releaseDirectory, name);
  if (/Setup\.exe$/i.test(name) && (await stat(filePath)).isFile()) installers.push({ name, filePath });
}
if (installers.length === 0) throw new Error("No NSIS installer found for release metadata");

const checksums = [];
for (const installer of installers) {
  checksums.push({ name: installer.name, sha256: await hashFile(installer.filePath) });
}
await writeFile(
  path.join(releaseDirectory, "SHA256SUMS.txt"),
  checksums.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n",
  "utf8"
);

const signed = Boolean(process.env.CSC_LINK);
const metadata = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? "local",
  ref: process.env.GITHUB_REF ?? "local",
  node: process.versions.node,
  npm: process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] ?? "unknown",
  electron: electronPackage.version,
  signed,
  releaseClass: signed ? "signed" : "unsigned-test-build",
  installers: checksums
};
await writeFile(path.join(releaseDirectory, "build-metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
console.log(`Release metadata written (${metadata.releaseClass}).`);

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
