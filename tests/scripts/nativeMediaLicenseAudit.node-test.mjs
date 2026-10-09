import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { githubPinnedSource, inspectPinnedGithubLicenses, licenseTreeCandidates } from "../../scripts/audit-native-media-licenses.mjs";

const rev = "a".repeat(40);
const text = Buffer.from("Copyright Test Project\nSPDX-License-Identifier: MIT\n");
const sha1 = createHash("sha1").update("blob " + text.length + "\0").update(text).digest("hex");
const manifest = () => ({
  approvedForDistribution: false,
  sourceComplianceApproved: false,
  libraries: [
    { ffmpegEnableFlag: "libfirst", recipes: [{ repository: "https://github.com/test-org/test-repo.git", revision: rev }] },
    { ffmpegEnableFlag: "libsecond", recipes: [{ repository: "https://github.com/test-org/test-repo.git", revision: rev }] },
    { ffmpegEnableFlag: "libother", recipes: [{ repository: "https://gitlab.com/test/other.git", revision: rev }] }
  ]
});

test("only accepts pinned GitHub origins", () => {
  assert.deepEqual(githubPinnedSource("https://github.com/test-org/test-repo.git", rev),
    { owner: "test-org", repo: "test-repo", commit: rev, id: "test-org/test-repo" });
  assert.equal(githubPinnedSource("https://evil.github.com/test/repo", rev), null);
  assert.equal(githubPinnedSource("https://github.com/test/repo", "main"), null);
  assert.equal(githubPinnedSource("https://github.com/test/repo/extra", rev), null);
});

test("selects only safe, license-like root blob entries", () => {
  assert.deepEqual(licenseTreeCandidates([
    { type: "blob", path: "LICENSE", sha: sha1 },
    { type: "tree", path: "COPYING", sha: sha1 },
    { type: "blob", path: "../SECRET", sha: sha1 },
    { type: "blob", path: "src/LICENSE", sha: sha1 }
  ]), [{ path: "LICENSE", blobSha: sha1 }]);
});

test("archives pinned license hashes without making compliance claims", async () => {
  const calls = [], stores = [];
  const api = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes("/git/trees/")) return { truncated: false, tree: [{ path: "COPYING", sha: sha1, type: "blob" }] };
    return { encoding: "base64", content: text.toString("base64") };
  };
  const output = await inspectPinnedGithubLicenses(manifest(), api, async (source, name, bytes) => {
    stores.push({ source, name, contents: bytes.toString() });
  });
  assert.equal(output.approvedForDistribution, false);
  assert.equal(output.statistics.referencedSourceLibraries, 3);
  assert.equal(output.statistics.eligibleGithubRepos, 1);
  assert.equal(output.statistics.rootLicenseTextsArchivedRepos, 1);
  assert.equal(output.statistics.completeThirdPartyLicenseReviews, 0);
  assert.equal(output.repositories[0].licenseFiles[0].sha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(output.repositories[0].binarySourceCorrespondenceProven, false);
  assert.equal(calls.length, 2);
  assert.equal(stores.length, 1);
});

test("tampered license blobs fail closed", async () => {
  const result = await inspectPinnedGithubLicenses(manifest(), async (path) =>
    path.includes("/git/trees/")
      ? { tree: [{ path: "LICENSE", type: "blob", sha: sha1 }], truncated: false }
      : { encoding: "base64", content: Buffer.from("wrong").toString("base64") });
  assert.equal(result.statistics.rootLicenseTextsArchivedRepos, 0);
  assert.equal(result.repositories[0].status, "NOT_VERIFIED");
});

test("refuses approval flags even with valid pinned manifest", async () => {
  await assert.rejects(inspectPinnedGithubLicenses({ ...manifest(), approvedForDistribution: true }, async () => ({})),
    /failed closed/);
});

test("missing root license is not treated as license approval", async () => {
  const result = await inspectPinnedGithubLicenses(manifest(), async () => ({ tree: [], truncated: false }));
  assert.equal(result.repositories[0].status, "NO_ROOT_LICENSE_FILES_LOCATED");
  assert.equal(result.statistics.completeThirdPartyLicenseReviews, 0);
});
