import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function sha256Buffer(value) { return createHash("sha256").update(value).digest("hex"); }
async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", b => hash.update(b)).on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
export function validateSourceArchiveMembers(base, members) {
  if (!/^[a-z0-9-]+$/.test(base) || !Array.isArray(members) || members.length < 3) {
    throw new Error("Invalid MSYS2 source member list");
  }
  const expectedPrefix = base + "/";
  if (new Set(members).size !== members.length) throw new Error("Duplicate source archive member");
  for (const name of members) {
    if (!name.startsWith(expectedPrefix) || name.includes("\\") || name.includes("\0") ||
        name.startsWith("/") || /(^|\/)\.\.?(\/|$)/.test(name) || /^[a-z]:/i.test(name)) {
      throw new Error("Unsafe or unexpected MSYS2 source archive entry: " + name);
    }
  }
  if (!members.includes(base + "/PKGBUILD") || !members.includes(base + "/.SRCINFO")) {
    throw new Error("Source archive must contain PKGBUILD and .SRCINFO");
  }
  if (!members.some(n => n !== expectedPrefix && n !== base+"/PKGBUILD" &&
    n !== base+"/.SRCINFO" && !n.endsWith("/") && !n.endsWith(".patch"))) {
    throw new Error("No source payload found in source archive");
  }
  return true;
}
export async function verifySourceArchives(directory, pinned, binaryEvidence) {
  if (!pinned || pinned.status !== "SOURCE_BUILD_RELINK_OBLIGATIONS_OPEN" ||
      !binaryEvidence || binaryEvidence.releaseAllowed !== false) throw new Error("Source audit must not approve distribution");
  const entries = [];
  for (const pkg of pinned.packages) {
    const archiveName = pkg.base+"-"+pkg.version+".src.tar.zst";
    const archive = path.join(directory, archiveName);
    const info = await stat(archive);
    if (!info.isFile() || info.size < 1024 || !/^[0-9a-f]{64}$/.test(pkg.sourceArchiveSha256)) {
      throw new Error("Missing or malformed source package: " + archiveName);
    }
    const sha256 = await sha256File(archive);
    if (sha256 !== pkg.sourceArchiveSha256) throw new Error("MSYS2 source archive SHA changed: "+archiveName);
    const members = execFileSync("tar", ["-tf", archive], { encoding:"utf8", windowsHide:true, timeout:120_000, maxBuffer:2*1024*1024 })
      .trimEnd().split(/\r?\n/);
    validateSourceArchiveMembers(pkg.base, members);
    const recipe = execFileSync("tar", ["-xOf", archive, pkg.base+"/PKGBUILD"], {
      windowsHide:true, timeout:60_000, maxBuffer: 2*1024*1024
    });
    const recipeSha256 = sha256Buffer(recipe);
    const binary = binaryEvidence.packages.find(p => p.packageName === pkg.name && p.version === pkg.version);
    if (!binary || binary.pkgbuildSha256 !== pkg.recipeSha256 || !binary.buildRecipe?.byteIdenticalToUpstreamBuildInfo ||
        recipeSha256 !== pkg.recipeSha256 || recipeSha256 !== binary.buildRecipe.sha256) {
      throw new Error("Source package PKGBUILD does not match original binary build recipe: " + pkg.base);
    }
    entries.push({
      sourcePackage: archiveName,
      sha256,
      bytes: info.size,
      url: pinned.sourceRepositoryBase+archiveName,
      memberCount: members.length,
      sourcePayloadPresent: true,
      pkbuildSha256: recipeSha256,
      matchesOriginalBinaryBuildInfo: true,
      historicalGitCommit: pkg.recipeGitCommit,
      associatedBinaryPackage: pkg.name+"-"+pkg.version,
      sourceDistributionCompleteForPackage: "ARCHIVE_AND_BUILD_RECIPE_OBTAINED; EXTERNAL_LICENSE_AND_RELINKING_REVIEW_OPEN"
    });
  }
  if (entries.length !== 4) throw new Error("Incomplete MSYS2 source evidence");
  return {
    schemaVersion:1,
    releaseAllowed:false,
    status:"FOUR_MSYS2_SOURCE_ARCHIVES_VERIFIED_WITH_EXACT_BUILD_RECIPES; FFMPEG_LGPL_RELINK_REVIEW_OPEN",
    description:"These original MSYS2 source packages are archived and hash-verified, with their PKGBUILD byte-identical to BUILDINFO of 5/5 selected DLLs. Not proof of all corresponding-source and LGPL license duties, not a public-release authorization.",
    originalWindowsBuild: pinned.upstreamBuild,
    packages: entries
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.env.MOVIE_MSYS2_SOURCE_DIR;
  if (!directory || !path.isAbsolute(directory) || process.argv.length !== 2) {
    throw new Error("Set MOVIE_MSYS2_SOURCE_DIR to privately archived complete MSYS2 source packages");
  }
  const pinned = JSON.parse(await readFile(path.join(repository,"scripts/native-msys2-package.lock.json"),"utf8"));
  const binaries = JSON.parse(await readFile(path.join(repository,"docs/legal/MSYS2-EXACT-PACKAGE-EVIDENCE.json"),"utf8"));
  const report = await verifySourceArchives(directory, pinned, binaries);
  const target = path.join(repository,"docs/legal/MSYS2-EXACT-SOURCE-EVIDENCE.json");
  await writeFile(target,JSON.stringify(report,null,2)+"\n","utf8");
  console.log("MSYS2 source evidence PASS: four complete source archives and four exact PKGBUILD hashes; publication not approved.");
}