import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateSourceArchiveMembers } from "../../scripts/audit-native-msys2-sources.mjs";

test("MSYS2 source archive must be anchored to correct package and contain real source payload", () => {
  const valid=["mingw-w64-libvpl/","mingw-w64-libvpl/.SRCINFO",
    "mingw-w64-libvpl/PKGBUILD","mingw-w64-libvpl/libvpl-2.17.0.tar.gz"];
  assert.equal(validateSourceArchiveMembers("mingw-w64-libvpl",valid),true);
  for(const bad of [
    [...valid,"mingw-w64-libvpl/../oops"],
    [...valid,"C:/secret"],
    [...valid,"mingw-w64-libvpl\\bad"],
    [...valid,valid[2]],
    valid.filter(n=>!n.endsWith("PKGBUILD")),
    valid.filter(n=>!n.endsWith("tar.gz"))
  ]) {
    assert.throws(()=>validateSourceArchiveMembers("mingw-w64-libvpl",bad));
  }
});
test("historical 4-source evidence and byte-for-byte PKGBUILD remains unapproved", async () => {
  const docs=JSON.parse(await readFile(path.resolve("docs/legal/MSYS2-EXACT-SOURCE-EVIDENCE.json"),"utf8"));
  const pinned=JSON.parse(await readFile(path.resolve("scripts/native-msys2-package.lock.json"),"utf8"));
  const binary=JSON.parse(await readFile(path.resolve("docs/legal/MSYS2-EXACT-PACKAGE-EVIDENCE.json"),"utf8"));
  assert.equal(docs.releaseAllowed,false);
  assert.equal(docs.packages.length,4);
  assert.equal(binary.releaseAllowed,false);
  const checks=new Set();
  for(const p of docs.packages){
    const spec=pinned.packages.find(x=>x.base+"-"+x.version+".src.tar.zst"===p.sourcePackage);
    assert.ok(spec);
    const related=binary.packages.find(x=>x.packageName===spec.name);
    assert.ok(related);
    assert.equal(p.sha256,spec.sourceArchiveSha256);
    assert.equal(p.pkbuildSha256,spec.recipeSha256);
    assert.equal(p.pkbuildSha256,related.buildRecipe.sha256);
    assert.equal(p.matchesOriginalBinaryBuildInfo,true);
    assert.ok(p.sourcePayloadPresent);
    assert.ok(p.memberCount>=3);
    assert.match(p.sourceDistributionCompleteForPackage,/REVIEW_OPEN/);
    assert.ok(p.url.includes(spec.base));
    checks.add(spec.base);
  }
  assert.deepEqual([...checks].sort(),["mingw-w64-libvpl","mingw-w64-openh264","mingw-w64-winpthreads","mingw-w64-gcc"].sort());
});
