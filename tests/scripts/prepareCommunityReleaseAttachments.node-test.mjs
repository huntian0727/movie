import test from "node:test";
import assert from "node:assert/strict";
import { assertPinnedSource, generateSha256Sums, pinnedSources } from "../../scripts/prepare-community-release-attachments.mjs";

test("accepts only verified FFmpeg source companion bytes and size", () => {
  assert.doesNotThrow(() => assertPinnedSource({ sha256: pinnedSources.sha256, size: pinnedSources.size }));
  assert.throws(() => assertPinnedSource({ sha256: "0".repeat(64), size: pinnedSources.size }), /differ/);
  assert.throws(() => assertPinnedSource({ sha256: pinnedSources.sha256, size: pinnedSources.size + 1 }), /differ/);
});

test("generates deterministic SHA-256 file suitable for local offline integrity checks", () => {
  const lines = generateSha256Sums([
    { name: "THIRD_PARTY_LICENSES.md", sha256: "a".repeat(64) },
    { name: pinnedSources.name, sha256: "b".repeat(64) },
  ]);
  assert.equal(lines.split("\n").filter(Boolean).length, 2);
  assert.match(lines, /a{64}  THIRD_PARTY_LICENSES\.md/);
  assert.match(lines, /b{64}  FFmpeg-Lite-8\.1\.2-Windows-x64-SOURCES-CANDIDATE\.zip/);
});

test("rejects ambiguous or unsafe release asset names and forged hashes", () => {
  const good = { name: "LICENSE.txt", sha256: "a".repeat(64) };
  for (const bad of ["../evil", "subdir/file", "name\nInjected", "LICENSE.txt", "hello:pw", ""]) {
    assert.throws(() => generateSha256Sums([good, { name: bad, sha256: good.sha256 }]));
  }
  assert.throws(() => generateSha256Sums([{ name: "ok.txt", sha256: "not-a-hash" }]));
});
