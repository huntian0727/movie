import assert from "node:assert/strict";
import test from "node:test";
import { parsePinnedRecipe } from "../../scripts/audit-native-media-recipes.mjs";

const gitRecipe = `SCRIPT_REPO="https://github.com/xiph/opus.git"
SCRIPT_COMMIT="503d81b138d76621aae4b12786e90de48aa8db3a"
ffbuild_depends() {
  echo base
  echo libiconv
}
ffbuild_enabled() { return 0; }
ffbuild_dockerbuild() { echo build; }
ffbuild_dockerstage() { to_df "RUN --mount=src=patches/opus,dst=/patches run_stage"; }`;

test("extracts explicit full commit and dependency hints", () => {
  const result = parsePinnedRecipe(gitRecipe);
  assert.equal(result.repository, "https://github.com/xiph/opus.git");
  assert.equal(result.referenceType, "git");
  assert.equal(result.revision, "503d81b138d76621aae4b12786e90de48aa8db3a");
  assert.deepEqual(result.dependencyHints, ["base", "libiconv"]);
  assert.deepEqual(result.patchDirectories, ["patches/opus"]);
});

test("extracts fixed SVN revisions without inventing a Git commit", () => {
  const result = parsePinnedRecipe('SCRIPT_REPO="https://svn.code.sf.net/p/lame/svn/trunk/lame"\nSCRIPT_REV="6835"');
  assert.equal(result.referenceType, "svn");
  assert.equal(result.revision, "6835");
});

test("refuses non-immutable source branches", () => {
  assert.throws(() => parsePinnedRecipe('SCRIPT_REPO="https://github.com/a/b.git"\nSCRIPT_COMMIT="main"'), /40-hex/);
});

test("refuses unpinned, missing or contradictory source references", () => {
  assert.throws(() => parsePinnedRecipe('SCRIPT_REPO="https://github.com/a/b.git"'), /exactly one/);
  assert.throws(() => parsePinnedRecipe('SCRIPT_COMMIT="' + "a".repeat(40) + '"'), /source repository/);
  assert.throws(() => parsePinnedRecipe('SCRIPT_REPO="https://github.com/a/b.git"\nSCRIPT_REV="42"\nSCRIPT_COMMIT="' + "a".repeat(40) + '"'), /exactly one/);
});

test("rejects non-HTTPS or invalid SVN references", () => {
  assert.throws(() => parsePinnedRecipe('SCRIPT_REPO="file:///untrusted"\nSCRIPT_REV="42"'), /repository/);
  assert.throws(() => parsePinnedRecipe('SCRIPT_REPO="https://svn.code.sf.net/p/a"\nSCRIPT_REV="latest"'), /numeric/);
});

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSourceEvidence } from "../../scripts/audit-native-media-recipes.mjs";

test("full source evidence remains explicitly unapproved despite matching pinned recipes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-recipe-contract-"));
  try {
    const scripts = path.join(dir, "scripts.d");
    await mkdir(scripts);
    const recipe = 'SCRIPT_REPO="https://github.com/xiph/opus.git"\nSCRIPT_COMMIT="503d81b138d76621aae4b12786e90de48aa8db3a"\nffbuild_dockerbuild() { :; }\n';
    await writeFile(path.join(scripts, "50-libopus.sh"), recipe);
    const tar = path.join(dir, "pinned.tar.gz");
    const bytes = "synthetic audited archive fixture";
    await writeFile(tar, bytes);
    const manifest = {
      approvedForDistribution: false,
      sourceComplianceApproved: false,
      build: { commit: "9".repeat(40), archiveSha256: createHash("sha256").update(bytes).digest("hex") },
      externalLibraries: [{ ffmpegEnableFlag: "libopus", upstreamRecipeCandidates: ["scripts.d/50-libopus.sh"] }]
    };
    const evidence = await buildSourceEvidence(dir, tar, manifest);
    assert.equal(evidence.approvedForDistribution, false);
    assert.equal(evidence.sourceComplianceApproved, false);
    assert.equal(evidence.statistics.enabledExternalLibraries, 1);
    assert.equal(evidence.statistics.fullyApprovedLibraries, 0);
    assert.equal(evidence.statistics.gitCommitRecipes, 1);
    assert.equal(evidence.libraries[0].recipes[0].sourceLicenseReviewed, false);
    await assert.rejects(buildSourceEvidence(dir, tar, { ...manifest, approvedForDistribution: true }), /explicitly unapproved/);
    await assert.rejects(buildSourceEvidence(dir, tar, {
      ...manifest, build: { ...manifest.build, archiveSha256: "0".repeat(64) }
    }), /hash differs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recipe evidence cannot read through a traversal path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-recipe-path-"));
  try {
    const archive = path.join(dir, "src.tar.gz");
    await writeFile(archive, "fixture");
    const manifest = {
      approvedForDistribution: false,
      sourceComplianceApproved: false,
      build: { commit: "a".repeat(40), archiveSha256: createHash("sha256").update("fixture").digest("hex") },
      externalLibraries: [{ ffmpegEnableFlag: "libbad", upstreamRecipeCandidates: ["scripts.d/../../outside.sh"] }]
    };
    await assert.rejects(buildSourceEvidence(dir, archive, manifest), /escaped upstream root/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
