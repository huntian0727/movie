import { describe, it, expect } from "vitest";
import { parseArgs, validatePublishedRelease } from "../../scripts/release-fastpath-preflight.mjs";

const version = "0.1.17";
const names = [
  `Movie-${version}-Windows-x64-Portable.zip`,
  `Movie-${version}-Application-Sources.zip`,
  `Movie-Native-Runtime-${version}-Corresponding-Sources.zip`,
  "SOURCE-PAIR.json", "SHA256SUMS.txt", "RELEASE-VERIFICATION.json"
];
const asset = name => ({ name, state: "uploaded", size: 1024, digest: `sha256:${"a".repeat(64)}` });
const release = () => ({ tag_name: `v${version}`, draft: false, prerelease: false, html_url: "https://github.com/huntian0727/movie/releases/tag/v0.1.17", assets: names.map(asset) });

describe("read-only fastpath release preflight", () => {
  it("parses explicit version and never defaults to publishing", () => {
    expect(parseArgs(["--version", "0.1.17"])).toEqual({ version, published: false });
    expect(parseArgs(["--version=v0.1.17", "--published"])).toEqual({ version, published: true });
    expect(() => parseArgs(["--publish"])).toThrow("Unknown option");
    expect(() => parseArgs([])).toThrow("--version");
  });
  it("only accepts a real public latest release with six verified assets", () => {
    expect(validatePublishedRelease(release(), { tag_name: `v${version}` }, version).ok).toBe(true);
    for (const change of [
      r => { r.draft = true; },
      r => { r.prerelease = true; },
      r => { r.assets.pop(); },
      r => { r.assets[0].digest = ""; },
      r => { r.assets[0].size = 0; }
    ]) {
      const r = release(); change(r);
      expect(validatePublishedRelease(r, { tag_name: `v${version}` }, version).ok).toBe(false);
    }
    expect(validatePublishedRelease(release(), { tag_name: "v0.1.16" }, version).ok).toBe(false);
  });
});
