// @vitest-environment node

import { access, mkdir, mkdtemp, readdir, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CacheGenerationSupersededError,
  MediaCacheManager
} from "../../src/main/media/cacheManager";

const temporaryRoots: string[] = [];
const generousLimits = {
  totalBytes: 1024 * 1024,
  coverBytes: 1024 * 1024,
  timelineBytes: 1024 * 1024,
  maxAgeMs: Number.MAX_SAFE_INTEGER,
  minimumRecentCovers: 0,
  minimumRecentTimelineFrames: 0,
  accessTouchIntervalMs: 60_000,
  maintenanceIntervalMs: 60_000
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}, 30_000);

describe("MediaCacheManager", () => {
  it("evicts the least-recently-used entries when category or total quotas are exceeded", async () => {
    const root = await createRoot();
    const covers = path.join(root, "covers");
    const files = [
      path.join(covers, `${"a".repeat(32)}-5s.jpg`),
      path.join(covers, `${"b".repeat(32)}-5s.jpg`),
      path.join(covers, `${"c".repeat(32)}-5s.jpg`)
    ];
    await mkdir(covers, { recursive: true });
    for (let index = 0; index < files.length; index += 1) {
      await writeFile(files[index], Buffer.alloc(4, index));
      const time = new Date(1_000 + index * 1_000);
      await utimes(files[index], time, time);
    }
    const manager = new MediaCacheManager(root, { ...generousLimits, totalBytes: 8, coverBytes: 8 });

    const result = await manager.runMaintenance("automatic", true);

    expect(result.removedCount).toBe(1);
    await expectPath(files[0], false);
    await expectPath(files[1], true);
    await expectPath(files[2], true);
    expect(result.status.totalBytes).toBe(8);
  });

  it("expires old entries but retains the configured minimum of recent previews", async () => {
    const root = await createRoot();
    const covers = path.join(root, "covers");
    const files = ["d", "e", "f"].map((letter) => path.join(covers, `${letter.repeat(32)}-5s.jpg`));
    await mkdir(covers, { recursive: true });
    for (let index = 0; index < files.length; index += 1) {
      await writeFile(files[index], "old");
      const time = new Date(1_000 + index * 1_000);
      await utimes(files[index], time, time);
    }
    const manager = new MediaCacheManager(
      root,
      { ...generousLimits, maxAgeMs: 100, minimumRecentCovers: 1 },
      { now: () => 10_000 }
    );

    const result = await manager.runMaintenance("automatic", true);

    expect(result.removedCount).toBe(2);
    await expectPath(files[0], false);
    await expectPath(files[1], false);
    await expectPath(files[2], true);
  });

  it("throttles approximate-LRU access timestamp writes", async () => {
    const root = await createRoot();
    const cachePath = path.join(root, "covers", `${"8".repeat(32)}-5s.jpg`);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "preview");
    let now = 10_000;
    const manager = new MediaCacheManager(
      root,
      { ...generousLimits, accessTouchIntervalMs: 1_000 },
      { now: () => now }
    );
    const generate = vi.fn();

    await manager.getOrCreateImage(cachePath, generate);
    const firstTouch = (await stat(cachePath)).mtimeMs;
    now = 10_500;
    await manager.getOrCreateImage(cachePath, generate);
    expect((await stat(cachePath)).mtimeMs).toBe(firstTouch);
    now = 12_000;
    await manager.getOrCreateImage(cachePath, generate);

    expect((await stat(cachePath)).mtimeMs).toBeGreaterThan(firstTouch);
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses a temporary file and prevents an in-flight generation from publishing after clear", async () => {
    const root = await createRoot();
    const outputPath = path.join(root, "covers", `${"1".repeat(32)}-5s.jpg`);
    const started = deferred<string>();
    const release = deferred<void>();
    const manager = new MediaCacheManager(root, generousLimits);
    const generation = manager.getOrCreateImage(outputPath, async (temporaryPath) => {
      expect(path.dirname(temporaryPath)).toBe(path.dirname(outputPath));
      expect(path.basename(temporaryPath)).toContain(".video-manager-cache-");
      expect(path.extname(temporaryPath)).toBe(".jpg");
      await writeFile(temporaryPath, "preview");
      started.resolve(temporaryPath);
      await release.promise;
    });

    const temporaryPath = await started.promise;
    const clearing = manager.clear();
    release.resolve();

    await expect(generation).rejects.toBeInstanceOf(CacheGenerationSupersededError);
    const result = await clearing;
    expect(result.failures).toEqual([]);
    await expectPath(outputPath, false);
    await expectPath(temporaryPath, false);
  });

  it("invalidates pending work on shutdown and removes abandoned app-owned temp files on next startup", async () => {
    const root = await createRoot();
    const outputPath = path.join(root, "covers", `${"2".repeat(32)}-5s.jpg`);
    const started = deferred<string>();
    const release = deferred<void>();
    const manager = new MediaCacheManager(root, generousLimits);
    const generation = manager.getOrCreateImage(outputPath, async (temporaryPath) => {
      await writeFile(temporaryPath, "preview");
      started.resolve(temporaryPath);
      await release.promise;
    });
    const temporaryPath = await started.promise;

    manager.stop();
    release.resolve();

    await expect(generation).rejects.toBeInstanceOf(CacheGenerationSupersededError);
    await writeFile(temporaryPath, "crash residue");
    const restarted = new MediaCacheManager(root, generousLimits);
    await restarted.initialize();
    await expectPath(temporaryPath, false);
    await expectPath(outputPath, false);
  });

  it("finishes an already-started clear safely when shutdown begins", async () => {
    const root = await createRoot();
    const cachePath = path.join(root, "covers", `${"7".repeat(32)}-5s.jpg`);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "preview");
    const deletionStarted = deferred<void>();
    const releaseDeletion = deferred<void>();
    const manager = new MediaCacheManager(root, generousLimits, {
      deleteFile: async (candidatePath) => {
        if (candidatePath === cachePath) {
          deletionStarted.resolve();
          await releaseDeletion.promise;
        }
        await unlink(candidatePath);
      }
    });

    const clearing = manager.clear();
    await deletionStarted.promise;
    manager.stop();
    releaseDeletion.resolve();

    await expect(clearing).resolves.toMatchObject({ removedCount: 1, failures: [] });
    await expectPath(cachePath, false);
  });

  it("removes cache identities no longer referenced after a path or file version changes", async () => {
    const root = await createRoot();
    const retainedKey = "3".repeat(32);
    const staleKey = "4".repeat(32);
    const retainedPath = path.join(root, "covers", `${retainedKey}-5s.jpg`);
    const stalePath = path.join(root, "timeline", staleKey, "1000.jpg");
    await mkdir(path.dirname(retainedPath), { recursive: true });
    await mkdir(path.dirname(stalePath), { recursive: true });
    await writeFile(retainedPath, "keep");
    await writeFile(stalePath, "stale");
    const removed = vi.fn();
    const manager = new MediaCacheManager(root, generousLimits, {
      getRetainedCacheKeys: () => new Set([retainedKey]),
      onEntriesRemoved: removed
    });

    const result = await manager.runMaintenance("automatic", true);

    expect(result.removedCount).toBe(1);
    await expectPath(retainedPath, true);
    await expectPath(stalePath, false);
    expect(removed).toHaveBeenCalledWith([stalePath]);
  });

  it.each(["ENOSPC", "EACCES"])("does not publish partial output when generation fails with %s", async (code) => {
    const root = await createRoot();
    const outputPath = path.join(root, "covers", `${"5".repeat(32)}-${code}.jpg`);
    const manager = new MediaCacheManager(root, generousLimits);

    await expect(manager.getOrCreateImage(outputPath, async (temporaryPath) => {
      await writeFile(temporaryPath, "partial");
      throw Object.assign(new Error(code), { code });
    })).rejects.toMatchObject({ code });

    await expectPath(outputPath, false);
    expect((await listFiles(path.join(root, "covers"))).filter((file) => file.includes(".video-manager-cache-"))).toEqual([]);
  });

  it("reports permission failures during manual cleanup and leaves the failed cache entry intact", async () => {
    const root = await createRoot();
    const cachePath = path.join(root, "covers", `${"6".repeat(32)}-5s.jpg`);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "keep");
    const manager = new MediaCacheManager(root, generousLimits, {
      deleteFile: async (candidatePath) => {
        if (candidatePath === cachePath) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        await unlink(candidatePath);
      }
    });

    const result = await manager.clear();

    expect(result.removedCount).toBe(0);
    expect(result.failures).toEqual([{ cachePath, message: "permission denied" }]);
    await expectPath(cachePath, true);
    expect(result.status.totalBytes).toBe(4);
  });

  it("keeps maintenance bounded for a large cache index", async () => {
    const root = await createRoot();
    const covers = path.join(root, "covers");
    await mkdir(covers, { recursive: true });
    const count = 1_000;
    await Promise.all(Array.from({ length: count }, async (_, index) => {
      const key = index.toString(16).padStart(32, "0");
      await writeFile(path.join(covers, `${key}-5s.jpg`), "x");
    }));
    const manager = new MediaCacheManager(root, { ...generousLimits, totalBytes: 500, coverBytes: 500 });
    const startedAt = Date.now();

    const result = await manager.runMaintenance("automatic", true);

    expect(result.status.itemCount).toBe(500);
    expect(result.status.totalBytes).toBe(500);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 15_000);
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "video-manager-cache-test-"));
  temporaryRoots.push(root);
  return root;
}

async function expectPath(candidatePath: string, expected: boolean): Promise<void> {
  let found = true;
  try {
    await access(candidatePath);
  } catch {
    found = false;
  }
  expect(found).toBe(expected);
}

async function listFiles(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch {
    return [];
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
