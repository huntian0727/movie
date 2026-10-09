import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { binaryNames, createSbom, buildPinnedSbom } from "../../scripts/generate-native-lite-sbom.mjs";

const names=["COPYING.LGPLv2.1","SOURCE.txt","LIBVPL-LICENSE.txt","LIBOPENH264-LICENSE.txt","LIBWINPTHREAD-LICENSE.txt","GCC-LICENSE.txt","SOURCE-STATUS.txt","LICENSE.txt"];
const digest=(v)=>createHash("sha256").update(v).digest("hex");
const fixture=()=>{
 const all=[...binaryNames,...names], hashes=Object.fromEntries(all.map(name=>[name,digest(name==="LICENSE.txt"?"COPYING.LGPLv2.1":name)]));
 const lock={variant:"lite-candidate",status:"CANDIDATE_NOT_APPROVED",distributable:false,releaseTag:"v8.1.2-27",files:Object.fromEntries(all.filter(n=>n!=="SOURCE-STATUS.txt"&&n!=="LICENSE.txt").map(n=>[n,hashes[n]]))};
 return {all,hashes,lock};
};
test("generates SPDX 2.3 for exactly 7 native binaries and no legal approval",()=>{
 const {hashes,lock}=fixture();
 const sbom=createSbom(lock,hashes);
 assert.equal(sbom.spdxVersion,"SPDX-2.3");
 assert.equal(sbom.packages.length,7);
 assert.equal(sbom.files.length,7);
 assert.equal(sbom.relationships.length,14);
 assert.equal(sbom.files[0].checksums[0].checksumValue,hashes["ffmpeg.exe"]);
 assert.ok(sbom.packages.every(p=>p.licenseConcluded==="NOASSERTION"&&p.filesAnalyzed===false));
 assert.ok(sbom.packages.filter(p=>!["FFmpeg Lite executable","FFprobe Lite executable"].includes(p.name)).every(p=>!p.versionInfo));
 assert.match(sbom.documentComment,/NOT permission to redistribute/);
 assert.equal(JSON.stringify(sbom),JSON.stringify(createSbom(lock,hashes)));
});
test("rejects non-candidate approval, tampered DLL and missing LGPL exact copy",()=>{
 const {hashes,lock}=fixture();
 assert.throws(()=>createSbom({...lock,distributable:true},hashes),/NOT approve/);
 assert.throws(()=>createSbom(lock,{...hashes,"libvpl-2.dll":digest("tampered")}),/Native evidence changed/);
 assert.throws(()=>createSbom(lock,{...hashes,"LICENSE.txt":digest("tampered")}),/LGPL notice copy diverges/);
});
test("validates real bytes before issuing SBOM and fails on modified source",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"movie-native-sbom-"));
 try{
   const {all,lock}=fixture();
   for(const name of all)await writeFile(path.join(dir,name),name==="LICENSE.txt"?"COPYING.LGPLv2.1":name);
   const valid=await buildPinnedSbom(dir,lock);
   assert.equal(valid.files.length,7);
   await writeFile(path.join(dir,"libgcc_s_seh-1.dll"),"damaged");
   await assert.rejects(buildPinnedSbom(dir,lock),/Mismatch SHA256/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
