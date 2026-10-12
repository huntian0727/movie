import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAsset } from "./prepare-source-release-inputs.mjs";
import { hashFile, isPublicTestVersion, readJson, verifyFormalApproval, zipArtifactName } from "./release-engineering.mjs";

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
  const existing = release.assets.find(a => a.name === path.basename(archive));
  if (existing) {
    if (existing.state !== "uploaded" || existing.digest !== "sha256:" + qa.sha256) throw new Error("Existing draft program differs; never overwrite it.");
  } else execFileSync("gh", ["release", "upload", tag, archive, "--repo", repository], { stdio: "inherit", windowsHide: true });
  await writeFile(path.join(root, ".tmp/source-release-ci/draft-staged.json"), JSON.stringify({ releaseId: release.id, tag, sha256: qa.sha256, commit: flavor.commit, published: false }) + "\n");
  console.log("Verified public beta ZIP staged in the private product draft; publication remains a separate action.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
