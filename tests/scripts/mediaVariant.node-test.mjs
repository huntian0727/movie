import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { candidateDirectory, liteFiles, liteRuntime, mediaVariant } from "../../scripts/media-variant.mjs";

test("defaults to the existing BtbN build; never silently selects Lite", () => {
  assert.equal(mediaVariant({}), "btbn-candidate");
  assert.equal(mediaVariant({ MOVIE_MEDIA_VARIANT: "btbn-candidate" }), "btbn-candidate");
});

test("selects Lite only with an explicit internal-QA option", () => {
  assert.equal(mediaVariant({ MOVIE_MEDIA_VARIANT: "lite-candidate" }), "lite-candidate");
  assert.throws(() => mediaVariant({ MOVIE_MEDIA_VARIANT: "../untrusted" }), /Unknown/);
  assert.throws(() => candidateDirectory("C:/work", "arbitrary"), /Unsupported/);
});

test("Lite runtime includes all five dynamic dependencies and legal notices", async () => {
  const lock = JSON.parse(await readFile(path.resolve("scripts/native-media-lite.lock.json"), "utf8"));
  assert.equal(lock.status, "CANDIDATE_NOT_APPROVED");
  assert.equal(lock.distributable, false);
  assert.equal(lock.variant, "lite-candidate");
  assert.match(lock.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(lock.files).length, 13);
  for (const file of liteRuntime) assert.match(lock.files[file], /^[a-f0-9]{64}$/);
  for (const file of liteFiles.filter(x => !["LICENSE.txt","SOURCE-STATUS.txt"].includes(x))) {
    assert.match(lock.files[file], /^[a-f0-9]{64}$/);
  }
  assert.equal(lock.files["COPYING.LGPLv2.1"], "246041b6ecf9bc32d718a62c57877c78b5eb397b6467e74ed7ae2626ab189c30");
});

test("Lite binaries are staged in an ignored QA-only directory, not committed assets", () => {
  const root = path.resolve(".");
  const lite = candidateDirectory(root,"lite-candidate");
  const btbn = candidateDirectory(root,"btbn-candidate");
  assert.ok(lite.startsWith(path.join(root,".tmp") + path.sep));
  assert.ok(btbn.startsWith(root));
  assert.notEqual(lite,btbn);
});
