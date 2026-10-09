import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parsePkginfo, validatePackageRecord } from "../../scripts/audit-native-msys2-packages.mjs";

const fixture=()=>{
  const spec={name:"mingw-w64-x86_64-libvpl",base:"mingw-w64-libvpl",version:"2.17.0-1",files:["libvpl-2.dll"]};
  const pkg=parsePkginfo("pkgname = mingw-w64-x86_64-libvpl\npkgbase = mingw-w64-libvpl\npkgver = 2.17.0-1\nlicense = spdx:MIT\nbuilddate = 1782641073\npackager = CI https://msys2.org\n");
  const build=parsePkginfo("pkgname = mingw-w64-x86_64-libvpl\npkgbase = mingw-w64-libvpl\npkgver = 2.17.0-1\nbuilddate = 1782641073\npkgbuild_sha256sum = "+"e".repeat(64)+"\n");
  const hash="f".repeat(64);
  return {spec,pkg,build,binaries:{"libvpl-2.dll":hash},lock:{files:{"libvpl-2.dll":hash}}};
};
test("parses MSYS2 native PKGINFO while retaining multi-value license fields",()=>{
  const fields=parsePkginfo("# comment\r\nlicense = spdx:MIT\r\nlicense = spdx:BSD-2-Clause\r\npkgver = 2.17.0-1\r\n");
  assert.deepEqual(fields.license,["spdx:MIT","spdx:BSD-2-Clause"]);
  assert.deepEqual(fields.pkgver,["2.17.0-1"]);
});
test("connects only exact package build metadata and SHA256-matched native input",()=>{
  const x=fixture();const record=validatePackageRecord(x.spec,x.pkg,x.build,x.binaries,x.lock);
  assert.equal(record.version,"2.17.0-1");
  assert.equal(record.licenseAsDeclaredInPackage[0],"spdx:MIT");
  assert.equal(record.files["libvpl-2.dll"].byteIdenticalToLite,true);
  assert.match(record.status,/SOURCE_CODE_AND_PUBLIC_REDISTRIBUTION_REVIEW_OPEN/);
});
test("rejects altered package version, build metadata and DLL hash",()=>{
  const x=fixture();
  assert.throws(()=>validatePackageRecord({...x.spec,version:"2.17.0-2"},x.pkg,x.build,x.binaries,x.lock),/logged build version/);
  assert.throws(()=>validatePackageRecord(x.spec,x.pkg,{...x.build,builddate:["1782641074"]},x.binaries,x.lock),/BUILDINFO mismatch/);
  assert.throws(()=>validatePackageRecord(x.spec,{...x.pkg,license:[]},x.build,x.binaries,x.lock),/Missing\/nonunique/);
  assert.throws(()=>validatePackageRecord(x.spec,x.pkg,x.build,{"libvpl-2.dll":"0".repeat(64)},x.lock),/does not match/);
});
test("committed evidence remains fail-closed and covers exactly 5 pinned native DLLs",async()=>{
  const docs=JSON.parse(await readFile(path.resolve("docs/legal/MSYS2-EXACT-PACKAGE-EVIDENCE.json"),"utf8"));
  const spec=JSON.parse(await readFile(path.resolve("scripts/native-msys2-package.lock.json"),"utf8"));
  const media=JSON.parse(await readFile(path.resolve("scripts/native-media-lite.lock.json"),"utf8"));
  assert.equal(docs.releaseAllowed,false);
  assert.equal(docs.packages.length,4);
  assert.equal(docs.buildSource.runId,29303740323);
  const all=[];
  for(const pkg of docs.packages){
    const expected=spec.packages.find(p=>p.name===pkg.packageName);
    assert.ok(expected);
    assert.equal(pkg.version,expected.version);
    assert.equal(pkg.archive.sha256,expected.sha256);
    assert.match(pkg.pkgbuildSha256,/^[a-f0-9]{64}$/);
    assert.equal(pkg.buildRecipe.sha256,pkg.pkgbuildSha256);
    assert.equal(pkg.buildRecipe.sha256,expected.recipeSha256);
    assert.equal(pkg.buildRecipe.gitCommit,expected.recipeGitCommit);
    assert.equal(pkg.buildRecipe.byteIdenticalToUpstreamBuildInfo,true);
    assert.ok(pkg.buildRecipe.url.includes(expected.recipeGitCommit));
    assert.match(pkg.status,/SOURCE_CODE_AND_PUBLIC_REDISTRIBUTION_REVIEW_OPEN/);
    for(const [n,v] of Object.entries(pkg.files)){
      assert.equal(v.byteIdenticalToLite,true);
      assert.equal(v.sha256,media.files[n]);all.push(n);
    }
  }
  assert.deepEqual(all.sort(),["libvpl-2.dll","libopenh264-7.dll","libwinpthread-1.dll","libgcc_s_seh-1.dll","libstdc++-6.dll"].sort());
  assert.equal(media.distributable,false);
});
