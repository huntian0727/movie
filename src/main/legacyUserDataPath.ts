import path from "node:path";

// Product branding may change, but existing libraries and settings stay here.
export function legacyUserDataPath(appDataPath: string): string {
  return path.join(appDataPath, "local-video-manager");
}
