import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryFile = path.join(root, "docs", "legal", "ffmpeg-source-candidate-inventory.json");

export function parsePinnedRecipe(body, name = "recipe") {
  const readVar = (key) => {
    const matches = [...body.matchAll(new RegExp("^\\s*" + key + '\\s*=\\s*["\\x27]([^"\\x27]+)["\\x27]\\s*(?:#.*)?$', "gm"))];
    if (matches.length !== 1) return null;
    return matches[0][1];
  };
  const sourceRepo = readVar("SCRIPT_REPO");
  const commit = readVar("SCRIPT_COMMIT");
  const svnRevision = readVar("SCRIPT_REV");
  if (!sourceRepo || !/^https:\/\/[a-z0-9.-]+\//i.test(sourceRepo)) throw new Error(name + ": source repository is absent or invalid");
  if ((commit ? 1 : 0) + (svnRevision ? 1 : 0) !== 1) throw new Error(name + ": expected exactly one explicit source revision");
  if (commit && !/^[a-f0-9]{40}$/i.test(commit)) throw new Error(name + ": source commit must be a full 40-hex commit");
  if (svnRevision && !/^\d+$/.test(svnRevision)) throw new Error(name + ": source SVN revision must be numeric");
  const dependsBlock = body.match(/ffbuild_depends\(\)\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
  const dependencyHints = [...new Set([...dependsBlock.matchAll(/^\s*echo\s+["']?([\w.-]+)["']?\s*(?:#.*)?$/gm)].map(x => x[1]))].sort();
  const patchDirectories = [...new Set([...body.matchAll(/(?:src=|\/)patches\/([a-zA-Z0-9_.-]+)/g)].map(x => "patches/" + x[1]))].sort();
  return {
    repository: sourceRepo,
    referenceType: commit ? "git" : "svn",
    revision: commit ?? svnRevision,
    dependencyHints,
    patchDirectories,
    hasTargetGuard: /ffbuild_enabled\(\)/.test(body),
    hasBuildRecipe: /ffbuild_dockerbuild\(\)/.test(body),
  };
}

export async function sha256(file) {
  return await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    const hash = createHash("sha256");
    stream.on("data", x => hash.update(x));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function filesBelow(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlink inside source evidence is refused: " + full);
    if (entry.isDirectory()) out.push(...await filesBelow(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

export async function buildSourceEvidence(sourceRoot, sourceArchive, inventory) {
  if (inventory.approvedForDistribution !== false || inventory.sourceComplianceApproved !== false) {
    throw new Error("Candidate must remain explicitly unapproved");
  }
  const digest = await sha256(sourceArchive);
  if (digest !== inventory.build.archiveSha256) throw new Error("Pinned build-source archive hash differs");
  const rows = [];
  for (const entry of inventory.externalLibraries) {
    const recipes = [];
    for (const relative of entry.upstreamRecipeCandidates) {
      if (!relative.startsWith("scripts.d/") || !relative.endsWith(".sh")) throw new Error("Untrusted recipe path");
      const full = path.resolve(sourceRoot, relative);
      if (!full.startsWith(path.resolve(sourceRoot) + path.sep)) throw new Error("Recipe path escaped upstream root");
      const fileInfo = await lstat(full);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error("Recipe must be a regular file");
      const body = await readFile(full, "utf8");
      const data = parsePinnedRecipe(body, relative);
      const patches = [];
      for (const patchDirectory of data.patchDirectories) {
        const patchRoot = path.resolve(sourceRoot, patchDirectory);
        if (!patchRoot.startsWith(path.resolve(sourceRoot) + path.sep)) throw new Error("Patch directory escaped root");
        for (const patchFile of await filesBelow(patchRoot)) {
          patches.push({ file: path.relative(sourceRoot, patchFile).replaceAll("\\", "/"), sha256: await sha256(patchFile) });
        }
      }
      recipes.push({
        recipe: relative,
        recipeSha256: await sha256(full),
        ...data,
        patchFiles: patches,
        sourceArchiveRetrieved: false,
        sourceLicenseReviewed: false,
        binarySourceCorrespondenceProven: false,
      });
    }
    if (!recipes.length) throw new Error("Missing candidate recipe for " + entry.ffmpegEnableFlag);
    rows.push({ ffmpegEnableFlag: entry.ffmpegEnableFlag, recipes, reviewStatus: "RECIPE_PIN_LOCATED_NOT_LICENSE_APPROVED" });
  }
  const all = rows.flatMap(row => row.recipes);
  return {
    schemaVersion: 1,
    verdict: "PINNED_RECIPE_REFERENCES_ONLY_SOURCE_LICENSE_AND_BINARY_CORRESPONDENCE_OPEN",
    approvedForDistribution: false,
    sourceComplianceApproved: false,
    buildSource: { commit: inventory.build.commit, archiveSha256: digest },
    statistics: {
      enabledExternalLibraries: rows.length,
      candidateRecipes: all.length,
      gitCommitRecipes: all.filter(x => x.referenceType === "git").length,
      svnRevisionRecipes: all.filter(x => x.referenceType === "svn").length,
      distinctSourceRepositories: new Set(all.map(x => x.repository)).size,
      recipesWithDirectDependencyHints: all.filter(x => x.dependencyHints.length).length,
      distinctDirectDependencyHints: new Set(all.flatMap(x => x.dependencyHints)).size,
      recipesWithPatchFiles: all.filter(x => x.patchFiles.length).length,
      identifiedPatchFiles: all.reduce((sum, x) => sum + x.patchFiles.length, 0),
      fullyApprovedLibraries: 0,
    },
    limitations: [
      "Parsing of echo dependency lines yields only hints; conditional and transitive dependencies require a full build graph audit",
      "Pinned build recipes are not proof the actual Windows executable used the exact referenced source revision",
      "Every corresponding source archive, license, patch application and LGPL static relinking obligation must be verified separately",
      "No entitlement to distribute FFmpeg or the application is granted by this evidence",
    ],
    libraries: rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--source-root" || args[2] !== "--source-archive") {
    console.error("Usage: node scripts/audit-native-media-recipes.mjs --source-root <pinned extracted source> --source-archive <pinned source tarball>");
    process.exitCode = 2;
  } else {
    const inventory = JSON.parse(await readFile(inventoryFile, "utf8"));
    const result = await buildSourceEvidence(path.resolve(args[1]), path.resolve(args[3]), inventory);
    const output = path.join(root, "docs", "legal", "native-media-recipe-evidence.json");
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ output, verdict: result.verdict, ...result.statistics }, null, 2));
  }
}
