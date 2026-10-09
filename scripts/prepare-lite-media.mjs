import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root,"scripts","native-media-lite.lock.json"),"utf8"));
export const expectedLiteNames = Object.keys(lock.files).sort();
const out = path.join(root,".tmp","native-media-lite-tools");

function quote(value) { return "'" + value.replaceAll("'", "''") + "'"; }
async function sha256(file) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file), hash = createHash("sha256");
    stream.on("data", part => hash.update(part)); stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
async function requireRegularHashed(file, expected) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || await sha256(file) !== expected) {
    throw new Error("Lite candidate input differs from pinned SHA256: " + path.basename(file));
  }
}
async function getArchive() {
  const override = process.env.MOVIE_LITE_MEDIA_ARCHIVE;
  const archive = override ? path.resolve(override) : path.join(root,".tmp","native-media-lite-download",lock.archive);
  if (!override) {
    await mkdir(path.dirname(archive), {recursive:true});
    const { access } = await import("node:fs/promises");
    let found = false;
    try { await access(archive); found = true; } catch {}
    if (!found) {
      const partial = archive + ".partial";
      const ps = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';Invoke-WebRequest -Uri " +
        quote(lock.archiveUrl) + " -OutFile " + quote(partial);
      await exec("powershell.exe",["-NoProfile","-NonInteractive","-Command",ps],{timeout:300000,windowsHide:true});
      await requireRegularHashed(partial,lock.archiveSha256);
      const { rename } = await import("node:fs/promises");
      await rename(partial,archive);
    }
  }
  await requireRegularHashed(archive, lock.archiveSha256);
  return archive;
}
async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Lite native candidate is Windows x64 only.");
  if (lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false) throw new Error("Lite media remains NOT APPROVED.");
  const archive = await getArchive();
  const { stdout } = await exec("tar",["-tzf",archive],{timeout:60000,maxBuffer:1024*1024,windowsHide:true});
  const entries = stdout.trimEnd().split(/\r?\n/).sort();
  if (new Set(entries).size !== entries.length || JSON.stringify(entries) !== JSON.stringify(expectedLiteNames)) {
    throw new Error("Unexpected files or path traversal inside pinned Lite archive");
  }
  const stage = path.join(root,".tmp","native-media-lite-extracted");
  await mkdir(stage,{recursive:true});
  await exec("tar",["-xzf",archive,"-C",stage],{timeout:60000,windowsHide:true});
  const extracted = (await readdir(stage)).sort();
  if (JSON.stringify(extracted) !== JSON.stringify(entries)) throw new Error("Unexpected extracted Lite entry");
  await mkdir(out,{recursive:true});
  for (const name of entries) {
    const source = path.join(stage,name), target = path.join(out,name);
    await requireRegularHashed(source,lock.files[name]);
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe Lite candidate staging path");
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await copyFile(source,target);
    await requireRegularHashed(target,lock.files[name]);
  }
  // The packaging interface expects a canonical LGPL document alongside exact upstream notices.
  await copyFile(path.join(out,"COPYING.LGPLv2.1"),path.join(out,"LICENSE.txt"));
  await requireRegularHashed(path.join(out,"LICENSE.txt"),lock.files["COPYING.LGPLv2.1"]);
  await writeFile(path.join(out,"SOURCE-STATUS.txt"),
    "Lite LGPL 2.1 media QA candidate; NOT APPROVED FOR PUBLIC DISTRIBUTION.\n" +
    "source=" + lock.archiveUrl + "\narchive-sha256=" + lock.archiveSha256 + "\n" +
    "GCC runtime exception notice referenced by SOURCE.txt is NOT included in upstream archive.\n" +
    "No corresponding-source/relinkability or binary-redistribution approval granted.\n","utf8");
  console.log("Lite staged and SHA256 checked: " + entries.length + " archive files (QA ONLY)");
}
await main();
