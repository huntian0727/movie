import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const binaryNames = Object.freeze(["ffmpeg.exe", "ffprobe.exe", "libvpl-2.dll", "libopenh264-7.dll", "libwinpthread-1.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll"]);
const notices = ["COPYING.LGPLv2.1","SOURCE.txt","LIBVPL-LICENSE.txt","LIBOPENH264-LICENSE.txt","LIBWINPTHREAD-LICENSE.txt","GCC-LICENSE.txt"];
const binarySources = {
  "ffmpeg.exe": { name: "FFmpeg Lite executable", source: "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz", knownVersion: "8.1.2", status: "UPSTREAM_SOURCE_ARCHIVED_BUILD_CORRESPONDENCE_NOT_REPRODUCED" },
  "ffprobe.exe": { name: "FFprobe Lite executable", source: "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz", knownVersion: "8.1.2", status: "UPSTREAM_SOURCE_ARCHIVED_BUILD_CORRESPONDENCE_NOT_REPRODUCED" },
  "libvpl-2.dll": { name: "Intel oneVPL dispatcher runtime", source: "https://github.com/intel/libvpl", status: "EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED" },
  "libopenh264-7.dll": { name: "Cisco OpenH264 runtime", source: "https://github.com/cisco/openh264", status: "EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED" },
  "libwinpthread-1.dll": { name: "mingw-w64 winpthreads runtime", source: "https://www.mingw-w64.org/", status: "EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED" },
  "libgcc_s_seh-1.dll": { name: "GCC libgcc exception runtime", source: "https://gcc.gnu.org/", status: "EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED" },
  "libstdc++-6.dll": { name: "GCC libstdc++ runtime", source: "https://gcc.gnu.org/", status: "EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED" },
};
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function sha256File(file) {
  return new Promise((resolve,reject)=>{
    const hash = createHash("sha256"), stream = createReadStream(file);
    stream.on("data", chunk=>hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", ()=>resolve(hash.digest("hex")));
  });
}
function validatedName(name) {
  if (!/^[a-zA-Z0-9._+-]+$/.test(name) || name === "." || name === ".." || name.includes("..")) throw new Error("Unsafe native file name");
  return name;
}
export function createSbom(lock, hashes) {
  if (lock.variant !== "lite-candidate" || lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false) {
    throw new Error("SBOM generation must NOT approve native media distribution");
  }
  const required = [...binaryNames,...notices,"SOURCE-STATUS.txt","LICENSE.txt"];
  for (const name of required) {
    validatedName(name);
    if (!/^[0-9a-f]{64}$/.test(hashes[name] ?? "")) throw new Error("Missing verified hash: " + name);
    if (lock.files[name] && lock.files[name] !== hashes[name]) throw new Error("Native evidence changed: " + name);
  }
  if (hashes["LICENSE.txt"] !== hashes["COPYING.LGPLv2.1"]) throw new Error("LGPL notice copy diverges");
  const packages = binaryNames.map((name,i)=>({
    name: binarySources[name].name,
    SPDXID: `SPDXRef-Lite-Package-${i+1}`,
    ...(binarySources[name].knownVersion ? {versionInfo:binarySources[name].knownVersion}:{ }),
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    copyrightText: "NOASSERTION",
    sourceInfo: `Candidate source project: ${binarySources[name].source}; ${binarySources[name].status}. Archive release tag ${lock.releaseTag}; actual binary SHA256 verified. This is NOT a legal approval.`,
  }));
  const files = binaryNames.map((name,i)=>({
    fileName: `./media-tools/${name}`,
    SPDXID: `SPDXRef-Lite-File-${i+1}`,
    checksums: [{algorithm:"SHA256", checksumValue:hashes[name]}],
    fileTypes: ["BINARY"],
    licenseConcluded: "NOASSERTION",
    licenseInfoInFiles: ["NOASSERTION"],
    copyrightText: "NOASSERTION",
  }));
  const relationships = [
    ...packages.map(x=>({spdxElementId:"SPDXRef-DOCUMENT",relationshipType:"DESCRIBES",relatedSpdxElement:x.SPDXID})),
    ...packages.map((x,i)=>({spdxElementId:x.SPDXID,relationshipType:"CONTAINS",relatedSpdxElement:files[i].SPDXID})),
  ];
  return {
    spdxVersion:"SPDX-2.3",
    dataLicense:"CC0-1.0",
    SPDXID:"SPDXRef-DOCUMENT",
    name:"movie-ffmpeg-lite-v8.1.2-27-UNAPPROVED-CANDIDATE",
    documentNamespace:"https://github.com/huntian0727/movie/spdx/ffmpeg-lite-v8.1.2-27-unapproved",
    creationInfo:{created:"2026-10-09T00:00:00Z",creators:["Tool: movie-native-lite-sbom-generator"]},
    documentComment:"Hashes verified on home B5. This describes an isolated QA candidate, NOT a public installer, NOT permission to redistribute and NOT complete corresponding source compliance. Runtime DLL exact MSYS2 package versions and relicensing evidence remain unverified.",
    packages,files,relationships,
    annotations:[{annotationDate:"2026-10-09T00:00:00Z",annotationType:"OTHER",annotator:"Tool: movie-native-lite-sbom-generator",comment:"NOT_APPROVED_FOR_DISTRIBUTION; review GCC exception, all transitive DLLs, matching source and clean Windows11 QA."}],
  };
}

export async function validateLiteFiles(root, lock) {
  const verified = {};
  const required = [...Object.keys(lock.files),"LICENSE.txt","SOURCE-STATUS.txt"];
  for (const name of required) {
    validatedName(name);
    const file = path.join(root,name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size===0) throw new Error("Non-regular or empty source: " + name);
    verified[name] = await sha256File(file);
    if (lock.files[name] && lock.files[name]!==verified[name]) throw new Error("Mismatch SHA256: " + name);
  }
  const present = await readdir(root);
  for (const name of required) if (!present.includes(name)) throw new Error("Missing source file: " + name);
  return verified;
}
export async function buildPinnedSbom(root, lock) {
  const verified = await validateLiteFiles(root,lock);
  return createSbom(lock,verified);
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (process.argv.length!==2) throw new Error("SBOM generator accepts only pinned staged Lite candidate, no arbitrary source paths");
  const lock = JSON.parse(await readFile(path.join(repo,"scripts","native-media-lite.lock.json"),"utf8"));
  const staged = path.join(repo,".tmp","native-media-lite-tools");
  const document = await buildPinnedSbom(staged,lock);
  const output = path.join(repo,"docs","legal","FFMPEG-LITE-SBOM.spdx.json");
  await writeFile(output,JSON.stringify(document,null,2)+"\n","utf8");
  console.log(`SBOM generated: ${document.files.length} verified binaries, all source compliance statuses UNAPPROVED. ${path.relative(repo,output)}`);
}
