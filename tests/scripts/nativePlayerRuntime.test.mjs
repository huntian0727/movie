// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { verifyPlayerRuntime } from "../../scripts/native-player-runtime.mjs";

describe("bundled player runtime supply chain", () => {
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
