import { randomUUID } from "node:crypto";
import { access, mkdir, opendir, readFile, rename, rm, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import type { StructuredLogger } from "../logging/logger.js";
import { ImageGenerationQueue, ImageRequestCancelledError, type ImageRequestOptions } from "./imageGenerationQueue.js";

export interface MediaCacheLimits {
  totalBytes: number;
  coverBytes: number;
  timelineBytes: number;
  maxAgeMs: number;
  minimumRecentCovers: number;
  minimumRecentTimelineFrames: number;
  accessTouchIntervalMs: number;
  maintenanceIntervalMs: number;
}

export interface MediaCacheStatus {
  totalBytes: number;
  coverBytes: number;
  timelineBytes: number;
  itemCount: number;
  maxBytes: number;
  automaticCleanup: true;
  lastMaintenanceAt: string | null;
  lastCleanup: {
    reason: "startup" | "automatic" | "manual";
    removedCount: number;
    reclaimedBytes: number;
    failureCount: number;
  } | null;
}

export interface MediaCacheCleanupResult {
  removedCount: number;
  reclaimedBytes: number;
  failures: Array<{ cachePath: string; message: string }>;
  status: MediaCacheStatus;
}

export interface MediaCacheManagerDependencies {
  now?: () => number;
  getRetainedCacheKeys?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>;
  onEntriesRemoved?: (paths: string[]) => void | Promise<void>;
  deleteFile?: (filePath: string) => Promise<void>;
  logger?: StructuredLogger;
}

interface CacheEntry {
  path: string;
  category: "covers" | "timeline";
  cacheKey: string | null;
  sizeBytes: number;
  lastAccessMs: number;
}

const GIB = 1024 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const TEMP_MARKER = ".video-manager-cache-";

export const DEFAULT_MEDIA_CACHE_LIMITS: MediaCacheLimits = {
  totalBytes: 10 * GIB,
  coverBytes: 2 * GIB,
  timelineBytes: 8 * GIB,
  maxAgeMs: 365 * DAY,
  minimumRecentCovers: 200,
  minimumRecentTimelineFrames: 2_000,
  accessTouchIntervalMs: 10 * 60 * 1000,
  maintenanceIntervalMs: 5 * 60 * 1000
};

export class CacheGenerationSupersededError extends Error {
  constructor() {
    super("Media cache generation was superseded by cleanup or shutdown");
    this.name = "CacheGenerationSupersededError";
  }
}

export class ImageCacheMissError extends Error {
  constructor() { super("Image is not cached"); this.name = "ImageCacheMissError"; }
}

export class MediaCacheManager {
  readonly root: string;
  readonly limits: MediaCacheLimits;
  private readonly dependencies: MediaCacheManagerDependencies;
  private readonly activePaths = new Map<string, number>();
  private readonly lastTouches = new Map<string, number>();
  private readonly generationQueue = new ImageGenerationQueue(2);
  private clearing: Promise<MediaCacheCleanupResult> | null = null;
  private maintenance: Promise<MediaCacheCleanupResult> | null = null;
  private epoch = 0;
  private stopping = false;
  private lastMaintenanceStartedAt = 0;
  private status: MediaCacheStatus;

  constructor(
    root: string,
    limits: Partial<MediaCacheLimits> = {},
    dependencies: MediaCacheManagerDependencies = {}
  ) {
    this.root = path.resolve(root);
    this.limits = { ...DEFAULT_MEDIA_CACHE_LIMITS, ...limits };
    this.dependencies = dependencies;
    this.status = emptyStatus(this.limits.totalBytes);
  }

  async initialize(): Promise<MediaCacheStatus> {
    await this.ensureOwnedDirectories();
    await this.removeAbandonedTempFiles();
    await this.runMaintenance("startup", true);
    return this.getStatus();
  }

  getStatus(): MediaCacheStatus {
    return structuredClone(this.status);
  }

  async getOrCreateImage(
    outputPath: string,
    generate: (temporaryPath: string, signal: AbortSignal) => Promise<void>,
    options: ImageRequestOptions = {}
  ): Promise<Buffer> {
    await this.waitForClear();
    this.assertOwnedCachePath(outputPath);
    this.acquire(outputPath);
    try {
      await this.ensureCachedImage(outputPath, generate, options);
      if (options.signal?.aborted) throw new ImageRequestCancelledError();
      const body = await readFile(outputPath);
      await this.markAccessed(outputPath);
      return body;
    } finally {
      this.release(outputPath);
      this.scheduleMaintenance();
    }
  }

  async invalidate(outputPath: string): Promise<boolean> {
    this.assertOwnedCachePath(outputPath);
    await this.waitForClear();
    try {
      await this.deleteFile(outputPath);
      await this.notifyEntriesRemoved([outputPath]);
      this.scheduleMaintenance(true);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.notifyEntriesRemoved([outputPath]);
        this.scheduleMaintenance(true);
        return false;
      }
      throw error;
    }
  }

  async clear(): Promise<MediaCacheCleanupResult> {
    if (this.clearing) return this.clearing;
    const maintenanceAtStart = this.maintenance;
    this.epoch += 1;
    const operation = (async () => {
      await maintenanceAtStart?.catch(() => undefined);
      await this.generationQueue.whenIdle();
      await this.waitForActivePaths();
      const entries = await this.collectEntries();
      const failures: MediaCacheCleanupResult["failures"] = [];
      const removedPaths: string[] = [];
      let reclaimedBytes = 0;

      for (const entry of entries) {
        try {
          await this.deleteFile(entry.path);
          removedPaths.push(entry.path);
          reclaimedBytes += entry.sizeBytes;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            removedPaths.push(entry.path);
          } else {
            failures.push({ cachePath: entry.path, message: toErrorMessage(error) });
          }
        }
      }

      await this.removeAbandonedTempFiles(failures);
      await this.ensureOwnedDirectories();
      await this.notifyEntriesRemoved(removedPaths);
      const cleanupSummary = {
          reason: "manual",
          removedCount: removedPaths.length,
          reclaimedBytes,
          failureCount: failures.length
        } as const;
      this.status = statusFromEntries(
        await this.collectEntries(),
        this.limits.totalBytes,
        new Date(this.now()).toISOString(),
        cleanupSummary
      );
      return { removedCount: removedPaths.length, reclaimedBytes, failures, status: this.getStatus() };
    })();
    this.clearing = operation.finally(() => {
      this.clearing = null;
    });
    return this.clearing;
  }

  scheduleMaintenance(force = false): void {
    if (this.stopping || this.clearing || this.maintenance) return;
    if (!force && this.now() - this.lastMaintenanceStartedAt < this.limits.maintenanceIntervalMs) return;
    void this.runMaintenance("automatic", force).catch((error) => {
      this.dependencies.logger?.error({
        module: "media.cache",
        event: "maintenance_failed",
        message: "Media cache maintenance failed",
        error
      });
    });
  }

  async runMaintenance(
    reason: "startup" | "automatic" = "automatic",
    force = false
  ): Promise<MediaCacheCleanupResult> {
    if (this.maintenance) return this.maintenance;
    if (!force && this.now() - this.lastMaintenanceStartedAt < this.limits.maintenanceIntervalMs) {
      return { removedCount: 0, reclaimedBytes: 0, failures: [], status: this.getStatus() };
    }
    this.lastMaintenanceStartedAt = this.now();
    const operation = this.performMaintenance(reason);
    this.maintenance = operation.finally(() => {
      this.maintenance = null;
    });
    return this.maintenance;
  }

  stop(): void {
    this.stopping = true;
    this.epoch += 1;
  }

  private async performMaintenance(
    reason: "startup" | "automatic"
  ): Promise<MediaCacheCleanupResult> {
    await this.waitForClear();
    const entries = await this.collectEntries();
    const retainedKeys = await this.dependencies.getRetainedCacheKeys?.();
    const now = this.now();
    const candidates = new Set<string>();
    const byCategory = {
      covers: entries.filter((entry) => entry.category === "covers").sort(oldestFirst),
      timeline: entries.filter((entry) => entry.category === "timeline").sort(oldestFirst)
    };

    if (retainedKeys) {
      for (const entry of entries) {
        if (!entry.cacheKey || !retainedKeys.has(entry.cacheKey)) candidates.add(entry.path);
      }
    }

    this.addExpiredCandidates(byCategory.covers, this.limits.minimumRecentCovers, now, candidates);
    this.addExpiredCandidates(byCategory.timeline, this.limits.minimumRecentTimelineFrames, now, candidates);
    addQuotaCandidates(byCategory.covers, this.limits.coverBytes, candidates, this.activePaths);
    addQuotaCandidates(byCategory.timeline, this.limits.timelineBytes, candidates, this.activePaths);
    addQuotaCandidates(entries.slice().sort(oldestFirst), this.limits.totalBytes, candidates, this.activePaths);

    const failures: MediaCacheCleanupResult["failures"] = [];
    const removedPaths: string[] = [];
    let reclaimedBytes = 0;
    for (const entry of entries) {
      if (!candidates.has(entry.path) || this.activePaths.has(entry.path)) continue;
      try {
        await this.deleteFile(entry.path);
        removedPaths.push(entry.path);
        reclaimedBytes += entry.sizeBytes;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          removedPaths.push(entry.path);
        } else {
          failures.push({ cachePath: entry.path, message: toErrorMessage(error) });
        }
      }
    }

    await this.removeAbandonedTempFiles(failures);
    await this.notifyEntriesRemoved(removedPaths);
    const remaining = entries.filter((entry) => !removedPaths.includes(entry.path));
    this.status = statusFromEntries(
      remaining,
      this.limits.totalBytes,
      new Date(now).toISOString(),
      {
        reason,
        removedCount: removedPaths.length,
        reclaimedBytes,
        failureCount: failures.length
      }
    );
    return { removedCount: removedPaths.length, reclaimedBytes, failures, status: this.getStatus() };
  }

  private async ensureCachedImage(
    outputPath: string,
    generate: (temporaryPath: string, signal: AbortSignal) => Promise<void>,
    options: ImageRequestOptions
  ): Promise<void> {
    if (options.signal?.aborted) throw new ImageRequestCancelledError();
    if (await exists(outputPath)) return;
    if (options.cachedOnly) throw new ImageCacheMissError();
    const requestedEpoch = this.epoch;
    await this.generationQueue.run(outputPath, async (signal) => {
      if (this.stopping || requestedEpoch !== this.epoch) throw new CacheGenerationSupersededError();
      if (await exists(outputPath)) return;
      await mkdir(path.dirname(outputPath), { recursive: true });
      const temporaryPath = buildTemporaryImagePath(outputPath, requestedEpoch);
      try {
        await generate(temporaryPath, signal);
        const temporaryStat = await stat(temporaryPath);
        if (!temporaryStat.isFile() || temporaryStat.size <= 0) {
          throw new Error("Generated cache image is empty");
        }
        if (this.stopping || requestedEpoch !== this.epoch) throw new CacheGenerationSupersededError();
        if (signal.aborted) throw new ImageRequestCancelledError();
        await publishAtomically(temporaryPath, outputPath);
        this.recordCreated(outputPath, temporaryStat.size);
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }, options);
  }

  private addExpiredCandidates(
    entries: CacheEntry[],
    minimumRecentItems: number,
    now: number,
    candidates: Set<string>
  ): void {
    const protectedPaths = new Set(
      entries
        .slice()
        .sort(newestFirst)
        .slice(0, minimumRecentItems)
        .map((entry) => entry.path)
    );
    for (const entry of entries) {
      if (
        now - entry.lastAccessMs > this.limits.maxAgeMs &&
        !protectedPaths.has(entry.path) &&
        !this.activePaths.has(entry.path)
      ) {
        candidates.add(entry.path);
      }
    }
  }

  private async collectEntries(): Promise<CacheEntry[]> {
    const entries: CacheEntry[] = [];
    await collectFiles(path.join(this.root, "covers"), "covers", entries);
    await collectFiles(path.join(this.root, "timeline"), "timeline", entries);
    return entries.filter((entry) => !path.basename(entry.path).includes(TEMP_MARKER));
  }

  private async removeAbandonedTempFiles(
    failures: MediaCacheCleanupResult["failures"] = []
  ): Promise<void> {
    const temporaryPaths: string[] = [];
    await collectTempFiles(path.join(this.root, "covers"), temporaryPaths);
    await collectTempFiles(path.join(this.root, "timeline"), temporaryPaths);
    for (const temporaryPath of temporaryPaths) {
      if (this.activePaths.has(temporaryPath)) continue;
      try {
        await this.deleteFile(temporaryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          failures.push({ cachePath: temporaryPath, message: toErrorMessage(error) });
        }
      }
    }
  }

  private async markAccessed(filePath: string): Promise<void> {
    const now = this.now();
    const lastTouch = this.lastTouches.get(filePath) ?? 0;
    if (now - lastTouch < this.limits.accessTouchIntervalMs) return;
    this.lastTouches.set(filePath, now);
    const date = new Date(now);
    await utimes(filePath, date, date).catch(() => undefined);
  }

  private acquire(filePath: string): void {
    this.activePaths.set(filePath, (this.activePaths.get(filePath) ?? 0) + 1);
  }

  private recordCreated(filePath: string, sizeBytes: number): void {
    const category = isPathInside(filePath, path.join(this.root, "covers")) ? "covers" : "timeline";
    this.status.totalBytes += sizeBytes;
    this.status.itemCount += 1;
    if (category === "covers") this.status.coverBytes += sizeBytes;
    else this.status.timelineBytes += sizeBytes;
  }

  private release(filePath: string): void {
    const remaining = (this.activePaths.get(filePath) ?? 1) - 1;
    if (remaining <= 0) this.activePaths.delete(filePath);
    else this.activePaths.set(filePath, remaining);
  }

  private async waitForActivePaths(): Promise<void> {
    while (this.activePaths.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async waitForClear(): Promise<void> {
    if (this.clearing) await this.clearing;
  }

  private async ensureOwnedDirectories(): Promise<void> {
    await Promise.all([
      mkdir(path.join(this.root, "covers"), { recursive: true }),
      mkdir(path.join(this.root, "timeline"), { recursive: true })
    ]);
  }

  private assertOwnedCachePath(candidatePath: string): void {
    const resolved = path.resolve(candidatePath);
    const coversRoot = path.join(this.root, "covers");
    const timelineRoot = path.join(this.root, "timeline");
    if (!isPathInside(resolved, coversRoot) && !isPathInside(resolved, timelineRoot)) {
      throw new Error("Cache path is outside the managed media-cache directory");
    }
  }

  private async notifyEntriesRemoved(paths: string[]): Promise<void> {
    if (paths.length > 0) await this.dependencies.onEntriesRemoved?.(paths);
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  private deleteFile(filePath: string): Promise<void> {
    return this.dependencies.deleteFile?.(filePath) ?? unlink(filePath);
  }
}

function buildTemporaryImagePath(outputPath: string, epoch: number): string {
  const extension = path.extname(outputPath);
  const basePath = extension ? outputPath.slice(0, -extension.length) : outputPath;
  return `${basePath}${TEMP_MARKER}${epoch}-${randomUUID()}${extension}`;
}

async function publishAtomically(temporaryPath: string, outputPath: string): Promise<void> {
  try {
    await rename(temporaryPath, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && (await exists(outputPath))) return;
    throw error;
  }
}

async function collectFiles(
  directoryPath: string,
  category: CacheEntry["category"],
  target: CacheEntry[]
): Promise<void> {
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for await (const entry of directory) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, category, target);
    } else if (entry.isFile()) {
      const entryStat = await stat(entryPath);
      target.push({
        path: entryPath,
        category,
        cacheKey: getCacheKeyFromPath(entryPath, category),
        sizeBytes: entryStat.size,
        lastAccessMs: entryStat.mtimeMs
      });
    }
  }
}

async function collectTempFiles(directoryPath: string, target: string[]): Promise<void> {
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for await (const entry of directory) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) await collectTempFiles(entryPath, target);
    else if (entry.isFile() && entry.name.includes(TEMP_MARKER)) target.push(entryPath);
  }
}

function addQuotaCandidates(
  entries: CacheEntry[],
  quotaBytes: number,
  candidates: Set<string>,
  activePaths: ReadonlyMap<string, number>
): void {
  let retainedBytes = entries
    .filter((entry) => !candidates.has(entry.path))
    .reduce((total, entry) => total + entry.sizeBytes, 0);
  for (const entry of entries) {
    if (retainedBytes <= quotaBytes) break;
    if (activePaths.has(entry.path) || candidates.has(entry.path)) continue;
    candidates.add(entry.path);
    retainedBytes -= entry.sizeBytes;
  }
}

function getCacheKeyFromPath(filePath: string, category: CacheEntry["category"]): string | null {
  const value = category === "covers" ? path.basename(filePath) : path.basename(path.dirname(filePath));
  const match = /^([a-f0-9]{32})(?:-|$)/i.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

function statusFromEntries(
  entries: CacheEntry[],
  maxBytes: number,
  lastMaintenanceAt: string | null,
  lastCleanup: MediaCacheStatus["lastCleanup"]
): MediaCacheStatus {
  const coverBytes = entries
    .filter((entry) => entry.category === "covers")
    .reduce((total, entry) => total + entry.sizeBytes, 0);
  const timelineBytes = entries
    .filter((entry) => entry.category === "timeline")
    .reduce((total, entry) => total + entry.sizeBytes, 0);
  return {
    totalBytes: coverBytes + timelineBytes,
    coverBytes,
    timelineBytes,
    itemCount: entries.length,
    maxBytes,
    automaticCleanup: true,
    lastMaintenanceAt,
    lastCleanup
  };
}

function emptyStatus(maxBytes: number): MediaCacheStatus {
  return statusFromEntries([], maxBytes, null, null);
}

function oldestFirst(left: CacheEntry, right: CacheEntry): number {
  return left.lastAccessMs - right.lastAccessMs || left.path.localeCompare(right.path);
}

function newestFirst(left: CacheEntry, right: CacheEntry): number {
  return oldestFirst(right, left);
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function exists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
