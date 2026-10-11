// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReleaseFlavor, releaseUserDataPath } from "../../src/main/releaseFlavor.js";

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
  it("accepts the distinct unsigned community identity", () => {
    const flavor = readReleaseFlavor(fixture({ releaseClass: "unsigned-public-release",
      appId: "com.local.video.manager.community", userDataDirectoryName: "local-video-manager-community" }), "0.1.15");
    expect(flavor).toEqual({ releaseClass: "unsigned-public-release", userDataDirectoryName: "local-video-manager-community" });
    expect(releaseUserDataPath("C:\\Users\\QA\\AppData\\Roaming", flavor))
      .toBe("C:\\Users\\QA\\AppData\\Roaming\\local-video-manager-community");
  });
  it("keeps development and signed upgrade paths stable, separate from QA and community", () => {
    const root = "C:\\Users\\QA\\AppData\\Roaming";
    const signed = readReleaseFlavor(fixture({ releaseClass: "signed-release", appId: "com.local.video.manager",
      userDataDirectoryName: "local-video-manager" }), "0.1.15");
    expect(releaseUserDataPath(root)).toBe(path.join(root, "local-video-manager"));
    expect(releaseUserDataPath(root, signed)).toBe(releaseUserDataPath(root));
    expect(releaseUserDataPath(root, readReleaseFlavor(fixture(), "0.1.15")))
      .toBe(path.join(root, "local-video-manager-unsigned-test"));
  });
  it.each([
    { appId: "com.local.video.manager", userDataDirectoryName: "local-video-manager-community" },
    { appId: "com.local.video.manager.unsignedtest", userDataDirectoryName: "local-video-manager-community" },
    { appId: "com.local.video.manager.community", userDataDirectoryName: "local-video-manager" },
    { appId: "com.local.video.manager.community", userDataDirectoryName: "local-video-manager-unsigned-test" },
    { appId: "com.local.video.manager.community", userDataDirectoryName: "../local-video-manager" },
    { appId: "com.local.video.manager.community", userDataDirectoryName: "C:\\another-library" }
  ])("rejects cross-profile community marker %j before data access", (changes) => {
    expect(() => readReleaseFlavor(fixture({ releaseClass: "unsigned-public-release", ...changes }), "0.1.15")).toThrow();
  });
  it.each([
    { userDataDirectoryName: "local-video-manager" }, { userDataDirectoryName: "../another-profile" },
    { appId: "com.local.video.manager" }, { arch: "arm64" }, { version: "0.1.14" }, { releaseClass: "unknown" },
    { releaseClass: "constructor" }, { releaseClass: null }, { schemaVersion: 2 }
  ])("fails closed for inconsistent marker %j", (changes) => {
    expect(() => readReleaseFlavor(fixture(changes), "0.1.15")).toThrow();
  });
  it("fails closed for missing or malformed identity", () => {
    const root = fixture();
    writeFileSync(path.join(root, "build-flavor.json"), "{}");
    expect(() => readReleaseFlavor(root, "0.1.15")).toThrow();
    writeFileSync(path.join(root, "build-flavor.json"), "broken JSON");
    expect(() => readReleaseFlavor(root, "0.1.15")).toThrow();
    rmSync(path.join(root, "build-flavor.json"));
    expect(() => readReleaseFlavor(root, "0.1.15")).toThrow();
  });
});
