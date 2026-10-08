import { readFileSync } from "node:fs";
import path from "node:path";

export interface ReleaseFlavor {
  releaseClass: "unsigned-test-build" | "signed-release";
  userDataDirectoryName: "local-video-manager-unsigned-test" | "local-video-manager";
}

export function readReleaseFlavor(resourcesPath: string, version: string): ReleaseFlavor {
  const marker: unknown = JSON.parse(readFileSync(path.join(resourcesPath, "build-flavor.json"), "utf8"));
  if (!marker || typeof marker !== "object") throw new Error("Invalid packaged release identity");
  const value = marker as Record<string, unknown>;
  const test = value.releaseClass === "unsigned-test-build";
  const appId = test ? "com.local.video.manager.unsignedtest" : "com.local.video.manager";
  const profile = test ? "local-video-manager-unsigned-test" : "local-video-manager";
  if (value.schemaVersion !== 1 || value.version !== version || value.arch !== "x64" ||
      !["unsigned-test-build", "signed-release"].includes(String(value.releaseClass)) ||
      value.appId !== appId || value.userDataDirectoryName !== profile) {
    throw new Error("Packaged release identity does not match this application");
  }
  return { releaseClass: test ? "unsigned-test-build" : "signed-release", userDataDirectoryName: profile };
}
