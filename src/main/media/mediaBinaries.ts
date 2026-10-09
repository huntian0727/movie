import { existsSync } from "node:fs";
import path from "node:path";

export type MediaTool = "ffmpeg.exe" | "ffprobe.exe";
interface Options {
  resourcesPath?: string;
  workspace?: string;
  pathExists?: (file: string) => boolean;
}

/** Never use PATH or the obsolete npm binary wrappers for FFmpeg/FFprobe. */
export function resolvePinnedMediaTool(name: MediaTool, options: Options = {}): string {
  if (name !== "ffmpeg.exe" && name !== "ffprobe.exe") throw new Error("Unsupported native media tool");
  const resources = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const exists = options.pathExists ?? existsSync;
  if (resources) {
    const bundled = path.join(resources, "media-tools", name);
    if (exists(bundled)) return bundled;
    // Packaged Electron carries app.asar. Its runtime must fail closed instead
    // of discovering a developer-owned executable outside its installation.
    if (exists(path.join(resources, "app.asar"))) {
      throw new Error("Required pinned native media tool missing from installed app: " + name);
    }
  }
  const developer = path.resolve(options.workspace ?? process.cwd(), "native-bin", "media-tools", name);
  if (exists(developer)) return developer;
  throw new Error("Pinned native media tool not staged: " + name + "; run npm run prepare:media-tools");
}
