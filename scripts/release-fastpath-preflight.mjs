#!/usr/bin/env node
// Read-only, fail-closed release identity/evidence check. Never builds, tags, pushes or publishes.
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseArgs(argv) {
  let version = "";
  let published = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--published") published = true;
    else if (arg === "--version") version = argv[++i] ?? "";
    else if (arg.startsWith("--version=")) version = arg.slice("--version=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  version = version.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
    throw new Error("Specify --version X.Y.Z (or vX.Y.Z), e.g. --version 0.1.17");
  }
  return { version, published };
}

export async function validateLocal(root, version) {
  const failures = [];
  const report = { version, checks: [] };
  const check = (label, ok, reason = "") => {
    report.checks.push({ check: label, ok, reason });
    if (!ok) failures.push(`${label}: ${reason || "failed"}`);
  };
  const read = async name => readFile(path.join(root, name));
  const json = async name => JSON.parse((await read(name)).toString("utf8"));
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const matchesFileHash = async (name, expected) => {
    if (!/^[a-f\d]{64}$/i.test(expected ?? "")) return false;
    try { return sha(await read(name)) === expected.toLowerCase(); } catch { return false; }
  };
  let pkg, approval, native, display;
  try { pkg = await json("package.json"); } catch { failures.push("package.json missing/invalid"); }
  try { display = await json("src/shared/displayVersion.json"); } catch { failures.push("displayVersion.json missing/invalid"); }
  try { approval = await json("build/release-approval.json"); } catch { failures.push("release approval missing/invalid"); }
  try { native = await json("build/native-source-approval.json"); } catch { failures.push("native source approval missing/invalid"); }
  check("package version", pkg?.version === version, `package.json is ${pkg?.version ?? "missing"}`);
  check("UI display version", Number.isInteger(display?.major) && Number.isInteger(display?.minor), "display major/minor must be integers");
  let notes = "";
  try { notes = (await read(`docs/releases/${version}.md`)).toString("utf8"); }
  catch { /* recorded below */ }
  check("versioned release notes", notes.length > 0, `docs/releases/${version}.md missing`);
  for (const category of ["安全类", "性能类", "功能增加类"]) {
    check(`release notes: ${category}`, notes.includes(category), "missing category in release notes");
  }
  check("release approval scope", approval?.scope === "stable-portable-only" && approval?.approved === true && approval?.version === version,
    "exact version, stable-portable-only scope and approved=true required");
  check("native source approval", native?.approved === true && Array.isArray(native?.binaries) && native.binaries.every(x => x.sourceComplianceApproved === true),
    "native approval must cover every shipped binary");
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
        check(`evidence sha: ${name}`, await matchesFileHash(name, expected), "missing / changed bytes, or unapproved hash");
      } else check("evidence file path", false, "unsafe/missing path");
    }
    check("corresponding source hash", /^[a-f\d]{64}$/i.test(approval.correspondingNativeSourcesSha256 ?? ""),
      "version-bound corresponding source SHA-256 missing");
  }
  if (native) {
    check("native review evidence", await matchesFileHash(native.reviewEvidence, native.reviewEvidenceSha256), "native review document differs");
  }
  report.ok = failures.length === 0;
  report.failures = failures;
  return report;
}

export function validatePublishedRelease(release, latest, version) {
  const expected = [
    `Movie-${version}-Windows-x64-Portable.zip`,
    `Movie-${version}-Application-Sources.zip`,
    `Movie-Native-Runtime-${version}-Corresponding-Sources.zip`,
    "SOURCE-PAIR.json", "SHA256SUMS.txt", "RELEASE-VERIFICATION.json"
  ];
  const assets = release?.assets ?? [];
  const missing = expected.filter(name => !assets.some(a => a.name === name && a.state === "uploaded" && /^sha256:[a-f0-9]{64}$/.test(a.digest ?? "") && a.size > 0));
  return {
    ok: !!release && release.tag_name === `v${version}` && release.draft === false && release.prerelease === false
      && latest?.tag_name === `v${version}` && missing.length === 0,
    missing,
    releaseUrl: release?.html_url ?? null,
    draft: release?.draft ?? null,
    prerelease: release?.prerelease ?? null,
    latest: latest?.tag_name ?? null
  };
}

async function main() {
  const { version, published } = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const local = await validateLocal(root, version);
  console.log(JSON.stringify({ phase: "local", ...local }, null, 2));
  if (!local.ok) process.exitCode = 2;
  if (published) {
    let result;
    try {
      const fetch = route => JSON.parse(execFileSync("gh", ["api", `repos/huntian0727/movie/${route}`], {
        cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true
      }));
      const release = fetch(`releases/tags/v${version}`);
      const latest = fetch("releases/latest");
      result = validatePublishedRelease(release, latest, version);
    } catch (error) {
      result = { ok: false, error: `GitHub read failed: ${error.message}` };
    }
    console.log(JSON.stringify({ phase: "published", ...result }, null, 2));
    if (!result.ok) process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
