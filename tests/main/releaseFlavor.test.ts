// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReleaseFlavor } from "../../src/main/releaseFlavor.js";

const roots: string[] = [];
function fixture(changes: Record<string, unknown> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "movie-release-identity-")); roots.push(root);
  writeFileSync(path.join(root, "build-flavor.json"), JSON.stringify({ schemaVersion: 1,
    releaseClass: "unsigned-test-build", appId: "com.local.video.manager.unsignedtest",
    userDataDirectoryName: "local-video-manager-unsigned-test", version: "0.1.15", arch: "x64", ...changes }));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("packaged identity before opening user data", () => {
  it("isolates a valid unsigned build", () => expect(readReleaseFlavor(fixture(), "0.1.15"))
    .toEqual({ releaseClass: "unsigned-test-build", userDataDirectoryName: "local-video-manager-unsigned-test" }));
  it("retains the legacy profile only for a consistent formal identity", () => expect(readReleaseFlavor(fixture({
    releaseClass: "signed-release", appId: "com.local.video.manager", userDataDirectoryName: "local-video-manager"
  }), "0.1.15").userDataDirectoryName).toBe("local-video-manager"));
  it.each([
    { userDataDirectoryName: "local-video-manager" }, { userDataDirectoryName: "../another-profile" },
    { appId: "com.local.video.manager" }, { arch: "arm64" }, { version: "0.1.14" }, { releaseClass: "unknown" }
  ])("fails closed for inconsistent marker %j", (changes) => {
    expect(() => readReleaseFlavor(fixture(changes), "0.1.15")).toThrow();
  });
});
