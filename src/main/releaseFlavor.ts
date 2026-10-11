import { readFileSync } from "node:fs";
import path from "node:path";
import { legacyUserDataPath } from "./legacyUserDataPath.js";

const identities = {
  "unsigned-test-build": { appId: "com.local.video.manager.unsignedtest", profile: "local-video-manager-unsigned-test" },
  "unsigned-public-release": { appId: "com.local.video.manager.community", profile: "local-video-manager-community" },
  "signed-release": { appId: "com.local.video.manager", profile: "local-video-manager" }
} as const;

export type ReleaseFlavor = {
  [Class in keyof typeof identities]: {
    releaseClass: Class;
    userDataDirectoryName: typeof identities[Class]["profile"];
  }
}[keyof typeof identities];

export function readReleaseFlavor(resourcesPath: string, version: string): ReleaseFlavor {
  const marker: unknown = JSON.parse(readFileSync(path.join(resourcesPath, "build-flavor.json"), "utf8"));
  if (!marker || typeof marker !== "object") throw new Error("Invalid packaged release identity");
  const value = marker as Record<string, unknown>;
  if (typeof value.releaseClass !== "string" || !Object.hasOwn(identities, value.releaseClass)) {
    throw new Error("Packaged release identity does not match this application");
  }
  const releaseClass = value.releaseClass as keyof typeof identities;
  const { appId, profile } = identities[releaseClass];
  if (value.schemaVersion !== 1 || value.version !== version || value.arch !== "x64" ||
      value.appId !== appId || value.userDataDirectoryName !== profile) {
    throw new Error("Packaged release identity does not match this application");
  }
  return { releaseClass, userDataDirectoryName: profile } as ReleaseFlavor;
}

// Program folders may move; each validated release identity keeps its own AppData profile.
// Development and signed upgrades retain the original library location.
export function releaseUserDataPath(appDataPath: string, flavor?: ReleaseFlavor): string {
  return flavor ? path.join(appDataPath, identities[flavor.releaseClass].profile) : legacyUserDataPath(appDataPath);
}
