import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { packagedNoticeMap, verifyPackagedNotices } from "../../scripts/verify-packaged-notices.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "movie-notice-fixture-"));
  const resources = path.join(root, "unpacked", "resources");
  for (const [sourceName, packedName] of packagedNoticeMap) {
    const source = path.join(root, sourceName);
    const packed = path.join(resources, packedName);
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(path.dirname(packed), { recursive: true });
    await writeFile(source, "fixture " + sourceName);
    await writeFile(packed, "fixture " + sourceName);
  }
  return { root, resources };
}
test("all required license notice files must match by hash", async () => {
  const f = await fixture();
  assert.equal(await verifyPackagedNotices(f.root, f.resources), packagedNoticeMap.length);
});

test("tampering with packaged third-party notice must fail", async () => {
  const f = await fixture();
  const file = path.join(f.resources, packagedNoticeMap[1][1]);
  await writeFile(file, (await readFile(file, "utf8")) + " wrong bytes");
  await assert.rejects(verifyPackagedNotices(f.root, f.resources), /differs from source/);
});

test("empty required notice must fail", async () => {
  const f = await fixture();
  await writeFile(path.join(f.resources, packagedNoticeMap[2][1]), "");
  await assert.rejects(verifyPackagedNotices(f.root, f.resources), /missing, empty or linked/);
});
