import { readFileSync } from "node:fs";
import path from "node:path";
import { legacyUserDataPath } from "./legacyUserDataPath.js";

const identities = {
  "local-development": { appId: "com.local.video.manager.development", profile: "local-video-manager" },
  "unsigned-test-build": { appId: "com.local.video.manager.unsignedtest", profile: "local-video-manager-unsigned-test" },
  "unsigned-community-qa": { appId: "com.local.video.manager.community", profile: "local-video-manager-community" },
  "unsigned-public-release": { appId: "com.local.video.manager.community", profile: "local-video-manager-community" },
  "signed-release": { appId: "com.local.video.manager", profile: "local-video-manager" }
} as const;

export type ReleaseFlavor = {
  [Class in keyof typeof identities]: {
    releaseClass: Class;
    userDataDirectoryName: typeof identities[Class]["profile"];
    migrationBackupDirectory?: string;
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
  const migrationBackupDirectory = value.migrationBackupDirectory;
  if (migrationBackupDirectory !== undefined &&
      (releaseClass !== "local-development" || typeof migrationBackupDirectory !== "string" ||
       !(path.isAbsolute(migrationBackupDirectory) || path.win32.isAbsolute(migrationBackupDirectory)))) {
    throw new Error("Invalid migration backup directory in packaged release identity");
  }
  return {
    releaseClass,
    userDataDirectoryName: profile,
    ...(releaseClass === "local-development" && typeof migrationBackupDirectory === "string"
      ? { migrationBackupDirectory }
      : {})
  } as ReleaseFlavor;
}

// Program folders may move; each validated release identity keeps its own AppData profile.
// Development and signed upgrades retain the original library location.
export function releaseUserDataPath(appDataPath: string, flavor?: ReleaseFlavor): string {
  return flavor ? path.join(appDataPath, identities[flavor.releaseClass].profile) : legacyUserDataPath(appDataPath);
}
