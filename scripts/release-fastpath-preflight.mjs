#!/usr/bin/env node
// Read-only, fail-closed. Never builds, tags, pushes, deletes or publishes.
// Formal GitHub builder + artifact-bound approvals remain authoritative.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isCleanWorkingTreeStatus(statusOutput) {
  return String(statusOutput ?? "").trim().length === 0;
}

export function parseArgs(argv) {
  let version = "";
  let published = false;
  let draft = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--published") published = true;
    else if (arg === "--draft") draft = true;
    else if (arg === "--version") version = argv[++i] ?? "";
    else if (arg.startsWith("--version=")) version = arg.slice("--version=".length);
    else throw new Error("Unknown option: " + arg);
  }
  version = version.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Specify --version X.Y.Z (or vX.Y.Z), e.g. --version 0.1.17");
  if (draft && published) throw new Error("--draft and --published are mutually exclusive");
  return { version, published, draft };
}

export async function validateLocal(root, version) {
  const failures = [];
  const report = { version, checks: [] };
  const check = (label, ok, reason = "") => {
    report.checks.push(ok ? { check: label, ok: true } : { check: label, ok: false, reason });
    if (!ok) failures.push(label + ": " + (reason || "failed"));
  };
  try {
    const status = exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], root);
    check("clean working tree", isCleanWorkingTreeStatus(status),
      "uncommitted or untracked files present; prepare release from an isolated clean checkout");
  } catch {
    check("clean working tree", false, "could not inspect Git working-tree status");
  }
  const read = (name) => readFile(path.join(root, name));
  const json = async (name) => JSON.parse((await read(name)).toString("utf8"));
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const matchesFileHash = async (name, expected) => {
    if (!/^[a-f\d]{64}$/i.test(expected ?? "")) return false;
    try { return sha(await read(name)) === expected.toLowerCase(); }
    catch { return false; }
  };
  let pkg, approval, native, display;
  try { pkg = await json("package.json"); } catch { failures.push("package.json missing/invalid"); }
  try { display = await json("src/shared/displayVersion.json"); } catch { failures.push("displayVersion.json missing/invalid"); }
  try { approval = await json("build/release-approval.json"); } catch { failures.push("release approval missing/invalid"); }
  try { native = await json("build/native-source-approval.json"); } catch { failures.push("native source approval missing/invalid"); }
  check("package version", pkg?.version === version, "package.json is " + (pkg?.version ?? "missing"));
  check("UI display version", Number.isInteger(display?.major) && display.major >= 1 &&
    Number.isInteger(display?.minor) && display.minor >= 0 && display.minor <= 999, "display major/minor must be valid integers");
  let notes = "";
  try { notes = (await read("docs/releases/" + version + ".md")).toString("utf8"); }
  catch { /* recorded below */ }
  check("versioned release notes", notes.length > 0, "docs/releases/" + version + ".md missing");
  for (const category of ["安全类", "性能类", "功能增加类"]) {
    check("release notes: " + category, notes.includes(category), "missing category in release notes");
  }
  check("release approval scope", approval?.scope === "stable-portable-only" &&
    approval?.approved === true && approval?.ownersConfirmed === true &&
    approval?.version === version && approval?.manualQaApproved === true &&
    approval?.unsignedAcknowledged === true,
    "exact version, real approval, unsigned acknowledgement and stable-portable-only scope required");
  check("GitHub Draft ID bound", Number.isSafeInteger(approval?.productDraftReleaseId) &&
    approval.productDraftReleaseId > 0, "missing exact draft release ID");
  check("native source approval", native?.approved === true && native?.approvedForVersion === version &&
    Array.isArray(native?.binaries) && native.binaries.length > 0 &&
    native.binaries.every((item) => item.sourceComplianceApproved === true),
    "native approval must cover this version and every shipped binary");
  if (approval) {
    for (const [name, expected] of [
      ["LICENSE", approval.licenseSha256],
      ["package-lock.json", approval.packageLockSha256],
      ["build/native-source-approval.json", approval.nativeSourceApprovalSha256],
      [approval.decisionEvidence, approval.decisionEvidenceSha256],
      [approval.cleanWindows11Evidence, approval.cleanWindows11EvidenceSha256],
      ["scripts/native-source-media.lock.json", native?.mediaRuntimeLockSha256],
      ["scripts/native-source-player-runtime.lock.json", native?.playerRuntimeLockSha256],
    ]) {
      if (typeof name === "string" && !name.startsWith("..") && !path.isAbsolute(name)) {
        check("evidence sha: " + name, await matchesFileHash(name, expected),
          "missing / changed bytes, stale approval or CRLF/LF mismatch");
      } else check("evidence file path", false, "unsafe/missing path");
    }
    check("corresponding source hash", /^[a-f\d]{64}$/i.test(approval.correspondingNativeSourcesSha256 ?? ""),
      "version-bound corresponding source ZIP SHA-256 missing");
  }
  if (native) {
    check("native review evidence", await matchesFileHash(native.reviewEvidence, native.reviewEvidenceSha256),
      "native review document differs");
    check("NativeHost source bytes", await matchesFileHash("native/embedded-mpv/NativeHost.cs", native.nativeHostSourceSha256),
      "NativeHost source SHA differs from the approved native bundle");
  }
  report.ok = failures.length === 0;
  report.failures = failures;
  return report;
}

export function validateReleaseAssets(assets, version) {
  const expected = [
    "Movie-" + version + "-Windows-x64-Portable.zip",
    "Movie-" + version + "-Application-Sources.zip",
    "Movie-Native-Runtime-" + version + "-Corresponding-Sources.zip",
    "SOURCE-PAIR.json", "SHA256SUMS.txt", "RELEASE-VERIFICATION.json",
  ];
  return expected.filter((name) =>
    (assets ?? []).filter((asset) => asset.name === name && asset.state === "uploaded" &&
      /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") && asset.size > 0).length !== 1
  );
}

export function validatePublishedRelease(release, latest, version) {
  const missing = validateReleaseAssets(release?.assets, version);
  return {
    ok: !!release && release.tag_name === "v" + version && release.draft === false &&
      release.prerelease === false && latest?.tag_name === "v" + version && missing.length === 0,
    missing, releaseUrl: release?.html_url ?? null,
    draft: release?.draft ?? null, prerelease: release?.prerelease ?? null,
    latest: latest?.tag_name ?? null,
  };
}

export function validateDraftRelease(release, version) {
  const missing = validateReleaseAssets(release?.assets, version);
  return { ok: !!release && release.tag_name === "v" + version &&
    release.draft === true && release.prerelease === false && missing.length === 0,
    missing, draft: release?.draft ?? null, releaseUrl: release?.html_url ?? null };
}

export function validateSameCommitRuns(runs, sha) {
  const required = ["Windows CI", "Security audit", "Source runtime community ZIP (manual, private delivery)"];
  const missing = required.filter((name) => !(runs ?? []).some((run) =>
    run.name === name && run.head_sha === sha &&
    run.status === "completed" && run.conclusion === "success"));
  return { ok: missing.length === 0, missing };
}

function exec(binary, argv, cwd) {
  return execFileSync(binary, argv, { cwd, encoding: "utf8", timeout: 30000, windowsHide: true }).trim();
}

async function main() {
  const { version, published, draft } = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const local = await validateLocal(root, version);
  console.log(JSON.stringify({ phase: "local", ...local }, null, 2));
  if (!local.ok) process.exitCode = 2;

  if (draft || published) {
    let result;
    try {
      const repo = "huntian0727/movie";
      const fetch = (endpoint) => JSON.parse(exec("gh", ["api", "repos/" + repo + "/" + endpoint], root));
      const sha = exec("git", ["rev-parse", "HEAD"], root);
      const peeled = exec("git", ["ls-remote", "--tags", "origin", "refs/tags/v" + version + "^{}"], root);
      const release = fetch("releases/tags/v" + version);
      const latest = published ? fetch("releases/latest") : null;
      const runs = fetch("actions/runs?head_sha=" + sha + "&per_page=100").workflow_runs;
      const identity = (peeled.startsWith(sha + "\t") && release.id ===
        (JSON.parse((await readFile(path.join(root, "build/release-approval.json"), "utf8")))).productDraftReleaseId);
      const ci = validateSameCommitRuns(runs, sha);
      const stage = published ? validatePublishedRelease(release, latest, version) :
        validateDraftRelease(release, version);
      result = { ...stage, ok: stage.ok && identity && ci.ok, commit: sha,
        tagAndReleaseIdMatch: identity, sameCommitChecks: ci };
    } catch (error) {
      result = { ok: false, error: "GitHub read failed: " + error.message };
    }
    console.log(JSON.stringify({ phase: published ? "published" : "draft", ...result }, null, 2));
    if (!result.ok) process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => { console.error(error.message); process.exitCode = 2; });
