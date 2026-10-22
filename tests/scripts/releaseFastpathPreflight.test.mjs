import { describe, it, expect } from "vitest";
import { parseArgs, validatePublishedRelease, validateDraftRelease, validateSameCommitRuns } from "../../scripts/release-fastpath-preflight.mjs";

const version = "0.1.17";
const names = [
  "Movie-" + version + "-Windows-x64-Portable.zip",
  "Movie-" + version + "-Application-Sources.zip",
  "Movie-Native-Runtime-" + version + "-Corresponding-Sources.zip",
  "SOURCE-PAIR.json", "SHA256SUMS.txt", "RELEASE-VERIFICATION.json",
];
const asset = (name) => ({ name, state: "uploaded", size: 1024, digest: "sha256:" + "a".repeat(64) });
const release = () => ({
  tag_name: "v" + version, draft: false, prerelease: false,
  html_url: "https://github.com/huntian0727/movie/releases/tag/v0.1.17", assets: names.map(asset),
});

describe("read-only fastpath release preflight", () => {
  it("parses explicit version; never enables publishing or draft modification", () => {
    expect(parseArgs(["--version", "0.1.17"])).toEqual({ version, published: false, draft: false });
    expect(parseArgs(["--version=v0.1.17", "--published"])).toEqual({ version, published: true, draft: false });
    expect(parseArgs(["--version", version, "--draft"])).toEqual({ version, published: false, draft: true });
    expect(() => parseArgs(["--version", version, "--draft", "--published"])).toThrow();
    expect(() => parseArgs(["--publish"])).toThrow("Unknown option");
    expect(() => parseArgs([])).toThrow("--version");
  });

  it("requires real Latest, six valid files and non-prerelease status", () => {
    expect(validatePublishedRelease(release(), { tag_name: "v" + version }, version).ok).toBe(true);
    for (const change of [
      (r) => { r.draft = true; },
      (r) => { r.prerelease = true; },
      (r) => { r.assets.pop(); },
      (r) => { r.assets[0].digest = ""; },
      (r) => { r.assets[0].size = 0; },
    ]) {
      const r = release(); change(r);
      expect(validatePublishedRelease(r, { tag_name: "v" + version }, version).ok).toBe(false);
    }
    expect(validatePublishedRelease(release(), { tag_name: "v0.1.16" }, version).ok).toBe(false);
  });

  it("requires a private draft and all six staged assets", () => {
    expect(validateDraftRelease({ ...release(), draft: true }, version).ok).toBe(true);
    expect(validateDraftRelease(release(), version).ok).toBe(false);
    const partial = { ...release(), draft: true, assets: names.slice(0, 4).map(asset) };
    expect(validateDraftRelease(partial, version).missing.length).toBe(2);
  });

  it("never accepts successful CI from another SHA", () => {
    const sha = "c".repeat(40);
    const success = [
      "Windows CI", "Security audit",
      "Source runtime community ZIP (manual, private delivery)",
    ].map((name) => ({ name, status: "completed", conclusion: "success", head_sha: sha }));
    expect(validateSameCommitRuns(success, sha).ok).toBe(true);
    expect(validateSameCommitRuns(success, "d".repeat(40)).ok).toBe(false);
    expect(validateSameCommitRuns(success.slice(0, 2), sha).missing).toEqual([
      "Source runtime community ZIP (manual, private delivery)",
    ]);
    expect(validateSameCommitRuns(success.map((run) => ({ ...run, conclusion: "failure" })), sha).ok).toBe(false);
  });
});
