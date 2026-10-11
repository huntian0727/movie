// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { playerRuntimeDirectory, playerRuntimeLockPath, playerRuntimeVariant, verifyPlayerRuntime } from "../../scripts/native-player-runtime.mjs";
import { verifyFormalApproval } from "../../scripts/release-engineering.mjs";

describe("bundled player runtime supply chain", () => {
  it("keeps source candidates isolated and blocks formal release", async () => {
    expect(playerRuntimeVariant({})).toBe("legacy-candidate");
    expect(playerRuntimeDirectory("root",{})).toBe(path.join("root","native-bin","player-runtime"));
    const env={MOVIE_PLAYER_VARIANT:"source-candidate"};
    expect(playerRuntimeDirectory("root",env)).toBe(path.join("root",".tmp","native-source-player-runtime"));
    expect(playerRuntimeLockPath("root",env)).toBe(path.join("root","scripts","native-source-player-runtime.lock.json"));
    expect(()=>playerRuntimeVariant({MOVIE_PLAYER_VARIANT:"invented"})).toThrow(/Unknown/);
    await expect(verifyFormalApproval("missing-root",{releaseClass:"unsigned-public-release",playerRuntimeVariant:"source-candidate"})).rejects.toThrow(/not approved/);
  });
  it("checks every shared dependency and rejects unsafe names or architecture", async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),"movie-source-player-"));
    const pe=Buffer.alloc(128);pe.write("MZ");pe.writeUInt32LE(64,60);pe.write("PE\0\0",64);pe.writeUInt16LE(0x8664,68);
    const files={"libmpv-2.dll":pe,"avcodec-63.dll":pe,Copyright:Buffer.from("notice"),"LICENSE.GPL":Buffer.from("gpl"),"LICENSE.LGPL":Buffer.from("lgpl")};
    const lock={schemaVersion:2,variant:"source-candidate",status:"CANDIDATE_NOT_APPROVED",distributable:false,files:{}};
    try {
      for(const [name,bytes] of Object.entries(files)){await writeFile(path.join(root,name),bytes);lock.files[name]=createHash("sha256").update(bytes).digest("hex");}
      await verifyPlayerRuntime(root,lock);
      await writeFile(path.join(root,"injected.dll"),pe);
      await expect(verifyPlayerRuntime(root,lock)).rejects.toThrow(/Unexpected/);
      await rm(path.join(root,"injected.dll"));
      await expect(verifyPlayerRuntime(root,{...lock,files:{...lock.files,"../injected.dll":lock.files["libmpv-2.dll"]}})).rejects.toThrow(/unapproved/);
      await writeFile(path.join(root,"avcodec-63.dll"),"modified");
      await expect(verifyPlayerRuntime(root,lock)).rejects.toThrow(/differs/);
      const x86=Buffer.from(pe);x86.writeUInt16LE(0x14c,68);await writeFile(path.join(root,"avcodec-63.dll"),x86);
      await expect(verifyPlayerRuntime(root,{...lock,files:{...lock.files,"avcodec-63.dll":createHash("sha256").update(x86).digest("hex")}})).rejects.toThrow(/x64/);
      await rm(path.join(root,"avcodec-63.dll"));await expect(verifyPlayerRuntime(root,lock)).rejects.toThrow();
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it("rejects missing or modified DLL/notices, wrong architecture and invented approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),"movie-player-runtime-"));
    const directory = path.join(root,"native-player"); await mkdir(directory);
    const pe = Buffer.alloc(128); pe.write("MZ"); pe.writeUInt32LE(64,60); pe.write("PE\0\0",64); pe.writeUInt16LE(0x8664,68);
    const files = { "libmpv-2.dll": pe, Copyright: Buffer.from("synthetic copyright"), "LICENSE.GPL": Buffer.from("synthetic GPL"), "LICENSE.LGPL": Buffer.from("synthetic LGPL") };
    const lock = {schemaVersion:1,status:"CANDIDATE_NOT_APPROVED",distributable:false,files:{}};
    try {
      for(const [name,bytes] of Object.entries(files)) { await writeFile(path.join(directory,name),bytes);lock.files[name]=createHash("sha256").update(bytes).digest("hex"); }
      await verifyPlayerRuntime(directory,lock);
      await expect(verifyPlayerRuntime(directory,{...lock,distributable:true})).rejects.toThrow(/unapproved/);
      for(const name of Object.keys(files)) {
        await writeFile(path.join(directory,name),"tampered");
        await expect(verifyPlayerRuntime(directory,lock)).rejects.toThrow(/differs/);
        await rm(path.join(directory,name)); await expect(verifyPlayerRuntime(directory,lock)).rejects.toThrow();
        await writeFile(path.join(directory,name),files[name]);
      }
      pe.writeUInt16LE(0x14c,68); await writeFile(path.join(directory,"libmpv-2.dll"),pe);
      lock.files["libmpv-2.dll"]=createHash("sha256").update(pe).digest("hex");
      await expect(verifyPlayerRuntime(directory,lock)).rejects.toThrow(/x64/);
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
