import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

export function parsePkginfo(text) {
  const data = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z][\w-]*) = (.+)$/.exec(line);
    if (!match) continue;
    (data[match[1]] ??= []).push(match[2].trim());
  }
  return data;
}
function scalar(data, key) {
  if (!data[key] || data[key].length !== 1) throw new Error("Missing/nonunique MSYS2 metadata: " + key);
  return data[key][0];
}
function executeTar(archive, member, maxBuffer=1024*1024) {
  return execFileSync("tar", ["-xOf", archive, member], {windowsHide:true, maxBuffer, timeout:60_000});
}
async function shaFile(filepath) {
  return new Promise((resolve,reject)=>{
    const h=createHash("sha256");
    createReadStream(filepath).on("data",c=>h.update(c)).on("error",reject).on("end",()=>resolve(h.digest("hex")));
  });
}
export function validatePackageRecord(spec, pkgInfo, buildInfo, binaries, nativeLock) {
  for (const key of ["pkgname","pkgbase","pkgver","license","builddate","packager"]) scalar(pkgInfo,key);
  for (const key of ["pkgname","pkgbase","pkgver","builddate","pkgbuild_sha256sum"]) scalar(buildInfo,key);
  if (scalar(pkgInfo,"pkgname")!==spec.name || scalar(pkgInfo,"pkgbase")!==spec.base ||
      scalar(pkgInfo,"pkgver")!==spec.version) throw new Error("Package metadata conflicts with independently logged build version");
  for (const key of ["pkgname","pkgbase","pkgver","builddate"]) {
    if (scalar(pkgInfo,key)!==scalar(buildInfo,key)) throw new Error("PKGINFO/BUILDINFO mismatch: " + key);
  }
  if (!/^\d{10}$/.test(scalar(pkgInfo,"builddate"))) throw new Error("Invalid MSYS2 build timestamp");
  if (!/^[a-f0-9]{64}$/.test(scalar(buildInfo,"pkgbuild_sha256sum"))) throw new Error("Invalid PKGBUILD SHA");
  const matched = {};
  for (const filename of spec.files) {
    if (!nativeLock.files[filename] || binaries[filename] !== nativeLock.files[filename]) {
      throw new Error("The selected FFmpeg Lite DLL does not match MSYS2 package: "+filename);
    }
    matched[filename] = { sha256: binaries[filename], byteIdenticalToLite:true };
  }
  return {
    packageName:spec.name,version:spec.version,basePackage:spec.base,
    buildTimestampUnix:Number(scalar(pkgInfo,"builddate")),
    licenseAsDeclaredInPackage:pkgInfo.license,
    packageBuilder:scalar(pkgInfo,"packager"),
    pkgbuildSha256:scalar(buildInfo,"pkgbuild_sha256sum"),
    files:matched,
    status:"EXACT_BYTES_MATCH_MSYS2_PACKAGE; SOURCE_CODE_AND_PUBLIC_REDISTRIBUTION_REVIEW_OPEN"
  };
}
export async function buildEvidence(dir, pinned, nativeLock, recipeDir) {
  if (!recipeDir || !path.isAbsolute(recipeDir)) throw new Error("Exact historical PKGBUILD directory is required");
  if (pinned.status !== "SOURCE_BUILD_RELINK_OBLIGATIONS_OPEN" || nativeLock.distributable !== false) {
    throw new Error("Neither this audit nor SBOM may approve software distribution");
  }
  const result=[];
  const allNames=[];
  for (const spec of pinned.packages) {
    if (!/^[a-zA-Z0-9._+-]+$/.test(spec.name) || !/^[a-zA-Z0-9._+-]+$/.test(spec.version)) throw new Error("Invalid package identity");
    const packageFile=spec.name+"-"+spec.version+"-any.pkg.tar.zst";
    const archive=path.join(dir,packageFile);
    if (!(await stat(archive)).isFile() || await shaFile(archive)!==spec.sha256) throw new Error("Untrusted MSYS2 package SHA: "+packageFile);
    const info=parsePkginfo(executeTar(archive,".PKGINFO").toString("utf8"));
    const build=parsePkginfo(executeTar(archive,".BUILDINFO").toString("utf8"));
    const binaries={};
    for (const name of spec.files) {
      if (allNames.includes(name)) throw new Error("DLL appears in multiple source packages: "+name);
      allNames.push(name);
      binaries[name]=sha(executeTar(archive,"mingw64/bin/"+name,20*1024*1024));
    }
    const record=validatePackageRecord(spec,info,build,binaries,nativeLock);
    const recipePath=path.join(recipeDir,spec.base+"-"+spec.version+".PKGBUILD");
    const recipeHash=await shaFile(recipePath);
    if (recipeHash!==scalar(build,"pkgbuild_sha256sum") || recipeHash!==spec.recipeSha256 || !/^[a-f0-9]{40}$/.test(spec.recipeGitCommit)) {
      throw new Error("Exact historical MSYS2 build recipe does not match BUILDINFO/Git pin: "+spec.base);
    }
    record.buildRecipe={
      gitCommit:spec.recipeGitCommit, sha256:recipeHash,
      url:"https://github.com/msys2/MINGW-packages/blob/"+spec.recipeGitCommit+"/"+spec.base+"/PKGBUILD",
      byteIdenticalToUpstreamBuildInfo:true
    };
    record.archive={ filename:packageFile, sha256:spec.sha256, url:pinned.packageRepositoryBase+packageFile };
    record.sourceOnlyArchiveUrl=pinned.sourceRepositoryBase+spec.base+"-"+spec.version+".src.tar.zst";
    result.push(record);
  }
  if (allNames.length !== 5 || allNames.some(n=>!nativeLock.files[n])) throw new Error("Incomplete Lite dynamic-library coverage");
  return {
    schemaVersion:1,releaseAllowed:false,
    verification:"PER_BYTE_5_OF_5_DLL_MATCH_FROM_EXACT_MSYS2_BINARY_PACKAGE_AND_4_OF_4_PINNED_PKGBUILD",
    explanation:"Pinned package SHA256, PKGINFO and BUILDINFO, and 5 embedded DLLs byte-match. This does not by itself establish full corresponding source access, LGPL relinking materials, compliance or clean Windows 11 QA.",
    buildSource:pinned.upstreamBuild,
    packages:result
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir=process.env.MOVIE_MSYS2_AUDIT_DIR;
  const recipeDir=process.env.MOVIE_MSYS2_PKGBUILD_DIR;
  if (!rootDir || !path.isAbsolute(rootDir) || !recipeDir || !path.isAbsolute(recipeDir) || process.argv.length!==2) throw new Error("Specify both MOVIE_MSYS2_AUDIT_DIR and MOVIE_MSYS2_PKGBUILD_DIR");
  const pinned=JSON.parse(await readFile(path.join(root,"scripts","native-msys2-package.lock.json"),"utf8"));
  const native=JSON.parse(await readFile(path.join(root,"scripts","native-media-lite.lock.json"),"utf8"));
  const report=await buildEvidence(rootDir,pinned,native,recipeDir);
  const out=path.join(root,"docs","legal","MSYS2-EXACT-PACKAGE-EVIDENCE.json");
  await writeFile(out,JSON.stringify(report,null,2)+"\n","utf8");
  console.log("MSYS2 exact package audit PASS: "+report.packages.length+" packages; 5/5 DLLs byte-identical; 4/4 Git PKGBUILD exact SHA matches; public release remains blocked.");
}
