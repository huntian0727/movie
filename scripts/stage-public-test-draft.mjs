import { execFileSync } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAsset } from "./prepare-source-release-inputs.mjs";
import { hashFile, isPublicTestVersion, readJson, verifyFormalApproval, zipArtifactName } from "./release-engineering.mjs";

export function publicTestAssetName(flavor) {
  if (!isPublicTestVersion(flavor.version)) throw new Error("Beta version required for public transport name.");
  return `Movie-${flavor.version}-Windows-x64-Portable.zip`;
}

export function assertPublicTestDraft(release, flavor, pair, approval) {
  if (flavor.releaseClass !== "unsigned-public-release" || flavor.publicTestRelease !== true || !isPublicTestVersion(flavor.version) ||
      release.draft !== true || release.prerelease !== true || release.tag_name !== "v" + flavor.version ||
      release.id !== approval.productDraftReleaseId ||
      pair.version !== flavor.version || pair.application.commit !== flavor.commit ||
      pair.native.approvalSha256 !== approval.nativeSourceApprovalSha256 ||
      pair.native.archiveSha256 !== approval.correspondingNativeSourcesSha256) throw new Error("Only the exact approved public beta draft may receive a program.");
  for (const item of [pair.application, pair.native]) {
    const asset = release.assets.find(a => a.name === item.name);
    if (!asset || asset.state !== "uploaded" || asset.size !== item.bytes || asset.digest !== "sha256:" + item.archiveSha256) throw new Error("Matching application/native sources must already be uploaded.");
  }
}

async function main() {
  const root = process.cwd(), output = path.join(root, "release/unsigned-public-release");
  const flavor = await readJson(path.join(output, "build-flavor.json"));
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/tags/v" + flavor.version || process.env.GITHUB_SHA !== flavor.commit) throw new Error("Exact GitHub beta tag required.");
  if (await verifyFormalApproval(root, flavor) !== flavor.complianceApprovalSha256) throw new Error("Packaged approval differs.");
  const approval = await readJson(path.join(root, "build/public-test-approval.json"));
  const qa = await readJson(path.join(output, "portable-qa.json"));
  const archive = path.join(output, zipArtifactName(flavor));
  if (qa.commit !== flavor.commit || qa.sha256 !== await hashFile(archive) || qa.approvalSha256 !== flavor.complianceApprovalSha256 || qa.filesVerified <= 0) throw new Error("Verified beta ZIP differs.");
  const repository = "huntian0727/movie", tag = "v" + flavor.version;
  if (!Number.isSafeInteger(approval.productDraftReleaseId) || approval.productDraftReleaseId <= 0) throw new Error("Explicit product draft ID required.");
  // GitHub's tag endpoint returns published releases only (drafts return 404).
  const release = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/releases/${approval.productDraftReleaseId}`], { encoding: "utf8", windowsHide: true }));
  const pairAsset = release.assets.find(a => a.name === "SOURCE-PAIR.json");
  if (!pairAsset || pairAsset.state !== "uploaded" || !/^sha256:[a-f0-9]{64}$/.test(pairAsset.digest ?? "") || pairAsset.size > 100_000) throw new Error("Source pairing evidence missing.");
  const pair = JSON.parse(await downloadAsset(`https://api.github.com/repos/${repository}/releases/assets/${pairAsset.id}`, process.env.GH_TOKEN, { bytes: pairAsset.size, sha256: pairAsset.digest.slice(7) }));
  assertPublicTestDraft(release, flavor, pair, approval);
  // Upload only to the prepared private draft. This script has no publish call.
  const assetName = publicTestAssetName(flavor);
  const uploadArchive = path.join(root, ".tmp/source-release-ci", assetName);
  try { await copyFile(archive, uploadArchive, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== "EEXIST" || await hashFile(uploadArchive) !== qa.sha256) throw error; }
  const existing = release.assets.find(a => a.name === assetName);
  if (existing) {
    if (existing.state !== "uploaded" || existing.digest !== "sha256:" + qa.sha256) throw new Error("Existing draft program differs; never overwrite it.");
  } else execFileSync("gh", ["release", "upload", tag, uploadArchive, "--repo", repository], { stdio: "inherit", windowsHide: true });
  await writeFile(path.join(root, ".tmp/source-release-ci/draft-staged.json"), JSON.stringify({ releaseId: release.id, tag, assetName, sha256: qa.sha256, commit: flavor.commit, published: false }) + "\n");
  console.log("Verified public beta ZIP staged in the private product draft; publication remains a separate action.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
