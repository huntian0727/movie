import { execFileSync } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAsset } from "./prepare-source-release-inputs.mjs";
import { hashFile, readJson, verifyFormalApproval, zipArtifactName } from "./release-engineering.mjs";

export function assertStablePortableDraft(release, flavor, pair, approval) {
  if (approval.approved !== true || approval.manualQaApproved !== true || approval.scope !== "stable-portable-only" ||
      flavor.releaseClass !== "unsigned-public-release" || flavor.publicTestRelease === true || !/^\d+\.\d+\.\d+$/.test(flavor.version) ||
      approval.version !== flavor.version || release.draft !== true || release.prerelease !== false || release.tag_name !== "v" + flavor.version ||
      release.id !== approval.productDraftReleaseId || pair.version !== flavor.version || pair.application.commit !== flavor.commit ||
      pair.native.approvalSha256 !== approval.nativeSourceApprovalSha256 || pair.native.archiveSha256 !== approval.correspondingNativeSourcesSha256) {
    throw new Error("Only the exact approved stable portable draft may receive this program.");
  }
  for (const item of [pair.application, pair.native]) {
    const asset = release.assets.find(a => a.name === item.name);
    if (!asset || asset.state !== "uploaded" || asset.size !== item.bytes || asset.digest !== "sha256:" + item.archiveSha256) throw new Error("Matching sources must already be uploaded.");
  }
}

async function main() {
  const root = process.cwd(), output = path.join(root, "release/unsigned-public-release");
  const flavor = await readJson(path.join(output, "build-flavor.json"));
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/tags/v" + flavor.version || process.env.GITHUB_SHA !== flavor.commit) throw new Error("Exact GitHub stable tag required.");
  if (await verifyFormalApproval(root, flavor) !== flavor.complianceApprovalSha256) throw new Error("Packaged approval differs.");
  const approval = await readJson(path.join(root, "build/release-approval.json"));
  const qa = await readJson(path.join(output, "portable-qa.json"));
  const archive = path.join(output, zipArtifactName(flavor));
  if (qa.commit !== flavor.commit || qa.sha256 !== await hashFile(archive) || qa.approvalSha256 !== flavor.complianceApprovalSha256 || qa.filesVerified <= 0) throw new Error("Verified stable ZIP differs.");
  if (!Number.isSafeInteger(approval.productDraftReleaseId) || approval.productDraftReleaseId <= 0) throw new Error("Explicit private draft ID required.");
  const repository = "huntian0727/movie";
  const release = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/releases/${approval.productDraftReleaseId}`], { encoding: "utf8", windowsHide: true }));
  const pairAsset = release.assets.find(a => a.name === "SOURCE-PAIR.json");
  if (!pairAsset || pairAsset.state !== "uploaded" || !/^sha256:[a-f0-9]{64}$/.test(pairAsset.digest ?? "") || pairAsset.size > 100_000) throw new Error("Source pairing evidence missing.");
  const pair = JSON.parse(await downloadAsset(`https://api.github.com/repos/${repository}/releases/assets/${pairAsset.id}`, process.env.GH_TOKEN, { bytes: pairAsset.size, sha256: pairAsset.digest.slice(7) }));
  assertStablePortableDraft(release, flavor, pair, approval);
  const assetName = `Movie-${flavor.version}-Windows-x64-Portable.zip`, transport = path.join(root, ".tmp/source-release-ci", assetName);
  try { await copyFile(archive, transport, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== "EEXIST" || await hashFile(transport) !== qa.sha256) throw error; }
  const existing = release.assets.find(a => a.name === assetName);
  if (existing) {
    if (existing.state !== "uploaded" || existing.digest !== "sha256:" + qa.sha256) throw new Error("Existing draft program differs.");
  } else execFileSync("gh", ["release", "upload", "v" + flavor.version, transport, "--repo", repository], { stdio: "inherit", windowsHide: true });
  await writeFile(path.join(root, ".tmp/source-release-ci/draft-staged.json"), JSON.stringify({ releaseId: release.id, assetName, sha256: qa.sha256, commit: flavor.commit, published: false }) + "\n");
  console.log("Verified stable portable ZIP staged privately; publication follows final Sandbox verification.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
