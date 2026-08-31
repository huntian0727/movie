import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { access, cp, mkdir, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { execa } from "execa";
import { resolvePackagedExecutablePath } from "./packagedExecutable.js";
export { getCoverTimeSeconds } from "../../shared/previewIdentity.js";

interface CacheGenerationDependencies {
  signal?: AbortSignal;
  ffmpegPath?: string;
  ensureDir?: (directoryPath: string) => Promise<void>;
  runFfmpeg?: (ffmpegPath: string, args: string[]) => Promise<void>;
}

const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static") as string | null;
const persistentCacheDirectoryName = "media-cache";
const legacyMediaCacheDirectoryName = "cache";
const mediaCacheSubdirectories = ["covers", "timeline"] as const;

export function getMediaCacheRoot(userDataPath: string): string {
  return path.join(userDataPath, persistentCacheDirectoryName);
}

/**
 * Moves only media previews out of the legacy `cache` directory. On Windows the
 * old path can be the same directory as Electron's `Cache`, so other children
 * (notably `Cache_Data`) must never be copied, moved, or removed here.
 */
export async function migrateLegacyMediaCache(userDataPath: string, mediaCacheRoot = getMediaCacheRoot(userDataPath)): Promise<void> {
  const legacyCacheRoot = path.join(userDataPath, legacyMediaCacheDirectoryName);
  await mkdir(mediaCacheRoot, { recursive: true });

  for (const subdirectory of mediaCacheSubdirectories) {
    const sourcePath = path.join(legacyCacheRoot, subdirectory);
    const destinationPath = path.join(mediaCacheRoot, subdirectory);
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    try {
      await rename(sourcePath, destinationPath);
    } catch {
      // A previous/partial migration or a cross-device move may make rename
      // unavailable. Copy missing files without overwriting either cache.
      await cp(sourcePath, destinationPath, {
        recursive: true,
        force: false,
        errorOnExist: false
      });
    }
  }
}

export function buildCacheKey(filePath: string, sizeBytes: number, modifiedAt: string): string {
  const normalizedPath = normalizeCacheIdentityPath(filePath);
  return crypto.createHash("sha256").update(`${normalizedPath}|${sizeBytes}|${modifiedAt}`).digest("hex").slice(0, 32);
}

export function getCoverPath(cacheRoot: string, cacheKey: string, timeSeconds = 5): string {
  return path.join(cacheRoot, "covers", `${cacheKey}-${normalizeCoverTimeSeconds(timeSeconds)}s.jpg`);
}

export function getTimelineFramePath(cacheRoot: string, cacheKey: string, timeMs: number): string {
  const clampedTimeMs = clampTimelineTimeMs(timeMs);
  return path.join(cacheRoot, "timeline", cacheKey, `${clampedTimeMs}.jpg`);
}

export async function generateCover(
  inputPath: string,
  outputPath: string,
  timeSeconds = 1,
  dependencies: CacheGenerationDependencies = {}
): Promise<void> {
  await generateImage(
    inputPath,
    outputPath,
    ["-y", "-ss", String(timeSeconds), "-i", inputPath, "-frames:v", "1", "-update", "1", "-vf", "scale=480:-1", outputPath],
    "cover",
    dependencies
  );
}

export async function generateTimelineFrame(
  inputPath: string,
  outputPath: string,
  timeMs: number,
  dependencies: CacheGenerationDependencies = {}
): Promise<void> {
  const clampedTimeMs = clampTimelineTimeMs(timeMs);
  const seconds = clampedTimeMs / 1000;

  await generateImage(
    inputPath,
    outputPath,
    ["-y", "-ss", seconds.toFixed(3), "-i", inputPath, "-frames:v", "1", "-update", "1", "-vf", "scale=320:-1", outputPath],
    "timeline frame",
    dependencies
  );
}

async function generateImage(
  inputPath: string,
  outputPath: string,
  args: string[],
  imageType: "cover" | "timeline frame",
  dependencies: CacheGenerationDependencies
): Promise<void> {
  let ffmpegPath: string;

  try {
    ffmpegPath = resolveFfmpegPath(dependencies.ffmpegPath);
  } catch (error) {
    throw new Error(`Unable to generate ${imageType} for ${inputPath}: ${toErrorMessage(error)}`, { cause: error });
  }

  const ensureDir = dependencies.ensureDir ?? ensureDirectory;
  const runFfmpeg = dependencies.runFfmpeg ?? ((executable: string, args: string[]) => executeFfmpeg(executable, args, dependencies.signal));

  try {
    await ensureDir(path.dirname(outputPath));
    await runFfmpeg(ffmpegPath, args);
  } catch (error) {
    throw new Error(`Unable to generate ${imageType} for ${inputPath}: ${toErrorMessage(error)}`, { cause: error });
  }
}

function resolveFfmpegPath(ffmpegPathOverride?: string): string {
  if (typeof ffmpegPathOverride === "string") {
    if (ffmpegPathOverride.trim() === "") {
      throw new Error("ffmpeg path is not configured");
    }

    return resolvePackagedExecutablePath(ffmpegPathOverride);
  }

  if (typeof ffmpegStatic === "string" && ffmpegStatic.trim() !== "") {
    const resolvedStaticPath = resolvePackagedExecutablePath(ffmpegStatic);
    if (existsSync(resolvedStaticPath)) return resolvedStaticPath;
  }

  // Fall back to PATH when the static binary was not downloaded into node_modules.
  return "ffmpeg";
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function executeFfmpeg(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<void> {
  await execa(ffmpegPath, args, { cancelSignal: signal, timeout: 30_000, windowsHide: true });
}

function normalizeCacheIdentityPath(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function clampTimelineTimeMs(timeMs: number): number {
  return Math.max(0, Math.trunc(timeMs));
}

function normalizeCoverTimeSeconds(timeSeconds: number): number {
  return Math.max(0, Math.trunc(timeSeconds));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
