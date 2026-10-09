import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifest = path.join(root, "docs", "legal", "native-media-recipe-evidence.json");

export function githubPinnedSource(repository, revision) {
  if (!/^[0-9a-f]{40}$/i.test(revision ?? "")) return null;
  const match = /^https:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(repository ?? "");
  if (!match) return null;
  const owner = match[1], repo = match[2];
  if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
  return { owner, repo, commit: revision.toLowerCase(), id: owner + "/" + repo };
}

export function licenseTreeCandidates(entries) {
  if (!Array.isArray(entries)) throw new Error("GitHub tree entries missing");
  return entries.filter(entry => entry && entry.type === "blob" &&
    /^[0-9a-f]{40}$/i.test(entry.sha ?? "") &&
    /^(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|AUTHORS)(?:[-_.][A-Za-z0-9_.-]+)?$/i.test(entry.path ?? "")
  ).map(entry => ({ path: entry.path, blobSha: entry.sha })).sort((a,b)=>a.path.localeCompare(b.path));
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }

export async function inspectPinnedGithubLicenses(manifest, api, store) {
  if (manifest.approvedForDistribution !== false || manifest.sourceComplianceApproved !== false) {
    throw new Error("License research must remain failed closed");
  }
  const sourceRefs = manifest.libraries.flatMap(lib => lib.recipes.map(recipe => ({
    flag: lib.ffmpegEnableFlag, repository: recipe.repository, revision: recipe.revision
  })));
  const grouped = new Map();
  for (const ref of sourceRefs) {
    const parsed = githubPinnedSource(ref.repository, ref.revision);
    if (!parsed) continue;
    const key = parsed.id.toLowerCase() + "@" + parsed.commit;
    if (!grouped.has(key)) grouped.set(key, { ...parsed, flags: [] });
    grouped.get(key).flags.push(ref.flag);
  }
  const inspected = [];
  for (const target of grouped.values()) {
    const result = {
      repository: target.id,
      commit: target.commit,
      linkedFlags: [...new Set(target.flags)].sort(),
      status: "NOT_VERIFIED",
      licenseFiles: [],
      sourceArchiveRetrieved: false,
      binarySourceCorrespondenceProven: false,
      sourceLicenseReviewed: false,
    };
    try {
      const tree = await api("repos/" + target.id + "/git/trees/" + target.commit);
      if (tree.truncated === true) throw new Error("truncated root tree");
      const candidates = licenseTreeCandidates(tree.tree);
      if (!candidates.length) {
        result.status = "NO_ROOT_LICENSE_FILES_LOCATED";
      } else {
        for (const entry of candidates) {
          const blob = await api("repos/" + target.id + "/git/blobs/" + entry.blobSha);
          if (blob.encoding !== "base64" || typeof blob.content !== "string" ||
              !/^(?:[a-z0-9+/=\r\n]+)$/i.test(blob.content)) throw new Error("Unrecognized GitHub license blob");
          const bytes = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
          if (bytes.length > 150_000 || bytes.length < 1) throw new Error("License text is empty or exceeds size bound");
          const gitBlobSha = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
          if (gitBlobSha !== entry.blobSha) throw new Error("Source license blob SHA-1 mismatch");
          if (store) await store(target, entry.path, bytes);
          result.licenseFiles.push({ path: entry.path, gitBlobSha: entry.blobSha, sha256: digest(bytes), bytes: bytes.length });
        }
        result.status = "ROOT_LICENSE_TEXT_ARCHIVED";
      }
    } catch (error) {
      result.status = "NOT_VERIFIED";
      result.failureCategory = /timeout|timed out|ETIMEDOUT/i.test(String(error)) ? "TIMEOUT" : "API_OR_EVIDENCE_ERROR";
      result.licenseFiles = [];
    }
    inspected.push(result);
  }
  return {
    schemaVersion: 1,
    verdict: "PARTIAL_LICENSE_SOURCES_ONLY_NO_BINARY_DISTRIBUTION_APPROVAL",
    approvedForDistribution: false,
    sourceComplianceApproved: false,
    statistics: {
      referencedSourceLibraries: manifest.libraries.length,
      eligibleGithubRepos: grouped.size,
      rootLicenseTextsArchivedRepos: inspected.filter(x=>x.status==="ROOT_LICENSE_TEXT_ARCHIVED").length,
      noRootLicenseRepos: inspected.filter(x=>x.status==="NO_ROOT_LICENSE_FILES_LOCATED").length,
      notVerifiedRepos: inspected.filter(x=>x.status==="NOT_VERIFIED").length,
      completeThirdPartyLicenseReviews: 0,
    },
    limitations: [
      "This checks only root license-file names, not dual licenses, dependencies, submodule and vendored notices",
      "A verified license blob at a pinned Git commit is not proof that the tested native EXE used that exact revision",
      "No static relinking materials, complete corresponding sources or final binary rights were approved",
      "License interpretation and source/binary correspondence must be independently reviewed before public distribution"
    ],
    repositories: inspected
  };
}

async function ghApi(endpoint) {
  const { stdout } = await exec("gh", ["api", endpoint], { windowsHide: true, timeout: 30_000, maxBuffer: 1_800_000 });
  return JSON.parse(stdout);
}

async function stageText(target, name, bytes) {
  const auditDir = "D:\\CodexReleaseAudit\\media-candidate-20261008\\source-evidence\\pin-license-texts";
  await mkdir(auditDir, { recursive: true });
  const safeName = target.id.replace("/", "__") + "__" + target.commit + "__" + name.replaceAll(/[^a-z0-9_.-]/gi, "_");
  const out = path.join(auditDir, safeName);
  try {
    const old = await lstat(out);
    if (!old.isFile() || old.isSymbolicLink()) throw new Error("Unsafe existing license path");
    const contents = await readFile(out);
    if (digest(contents) !== digest(bytes)) throw new Error("License archive overwrite conflict");
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(out, bytes, { flag: "wx" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length) throw new Error("License audit uses the exact repository pinned manifest; no floating source flags");
  const manifest = JSON.parse(await readFile(sourceManifest, "utf8"));
  const result = await inspectPinnedGithubLicenses(manifest, ghApi, stageText);
  const output = path.join(root, "docs", "legal", "native-media-license-availability.json");
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ output, ...result.statistics, verdict: result.verdict }));
}
