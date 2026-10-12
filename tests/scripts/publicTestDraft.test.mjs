// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertPublicTestDraft, publicTestAssetName } from "../../scripts/stage-public-test-draft.mjs";
const flavor = { releaseClass: "unsigned-public-release", publicTestRelease: true, version: "1.2.3-beta.2", commit: "a".repeat(40) };
function fixture() {
  const approval = { productDraftReleaseId: 1, nativeSourceApprovalSha256: "c".repeat(64), correspondingNativeSourcesSha256: "d".repeat(64) };
  const pair = { version: flavor.version, application: { name: "application.zip", bytes: 1, archiveSha256: "b".repeat(64), commit: flavor.commit }, native: { name: "native.zip", bytes: 2, archiveSha256: approval.correspondingNativeSourcesSha256, approvalSha256: approval.nativeSourceApprovalSha256 } };
  const release = { id: 1, draft: true, prerelease: true, tag_name: "v" + flavor.version, assets: [pair.application, pair.native].map(p => ({ name: p.name, size: p.bytes, digest: "sha256:" + p.archiveSha256, state: "uploaded" })) };
  return { approval, pair, release };
}
describe("public beta staging never publishes or accepts missing matching sources", () => {
  it("uses an ASCII transport filename while preserving the beta version", () => {
    expect(publicTestAssetName(flavor)).toBe("Movie-1.2.3-beta.2-Windows-x64-Portable.zip");
    expect(() => publicTestAssetName({ version: "1.2.3" })).toThrow();
  });
  it("allows a prepared private beta draft with both exact source assets", () => { const f = fixture(); expect(() => assertPublicTestDraft(f.release, flavor, f.pair, f.approval)).not.toThrow(); });
  it.each(["published", "stable", "tag", "commit", "missing", "digest", "size", "native-approval", "release-id"])("rejects %s staging", kind => {
    const f = fixture();
    if (kind === "published") f.release.draft = false;
    if (kind === "stable") f.release.prerelease = false;
    if (kind === "tag") f.release.tag_name = "v9.0.0";
    if (kind === "commit") f.pair.application.commit = "e".repeat(40);
    if (kind === "missing") f.release.assets.pop();
    if (kind === "digest") f.release.assets[0].digest = "sha256:" + "e".repeat(64);
    if (kind === "size") f.release.assets[0].size++;
    if (kind === "native-approval") f.pair.native.approvalSha256 = "e".repeat(64);
    if (kind === "release-id") f.release.id++;
    expect(() => assertPublicTestDraft(f.release, flavor, f.pair, f.approval)).toThrow();
  });
});
