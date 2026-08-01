// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SourceFolder } from "../../src/shared/videoTypes";
import type { VideoRepository } from "../../src/main/db/videoRepository";
import { ScanManager } from "../../src/main/media/scanManager";
import { ScanCancelledError } from "../../src/main/media/libraryScanner";
import type { MetadataQueue } from "../../src/main/media/metadataQueue";

const folder: SourceFolder = {
  id: "folder-1",
  path: "Z:\\Cloud",
  recursive: true,
  enabled: true,
  lastScannedAt: null,
  createdAt: "",
  updatedAt: "",
  scanError: null
};

describe("ScanManager", () => {
  it("pauses between files, resumes, and records completed progress", async () => {
    let releaseCurrentFile: (() => void) | undefined;
    const currentFile = new Promise<void>((resolve) => { releaseCurrentFile = resolve; });
    const scan = vi.fn(async (_repo, _folder, dependencies) => {
      dependencies.onProgress?.({ phase: "processing", totalFiles: 2, processedFiles: 0, currentPath: "a.mp4" });
      await currentFile;
      await dependencies.waitIfPaused?.();
      dependencies.onProgress?.({ phase: "processing", totalFiles: 2, processedFiles: 2, currentPath: "b.mp4" });
      return { state: "completed" as const, totalFiles: 2, processedFiles: 2, failureCount: 0, message: null };
    });
    const manager = new ScanManager({} as VideoRepository, scan);
    const task = manager.start(folder);
    await vi.waitFor(() => expect(manager.listStatuses()[0]?.state).toBe("scanning"));

    expect(manager.pause(folder.id)).toBe(true);
    releaseCurrentFile?.();
    await vi.waitFor(() => expect(manager.listStatuses()[0]?.state).toBe("paused"));
    expect(manager.resume(folder.id)).toBe(true);
    await task;

    expect(manager.listStatuses()[0]).toMatchObject({ state: "completed", totalFiles: 2, processedFiles: 2 });
  });

  it("records a temporarily offline result for retry", async () => {
    const manager = new ScanManager({} as VideoRepository, async () => ({
      state: "offline",
      totalFiles: 0,
      processedFiles: 0,
      failureCount: 1,
      message: "network unavailable"
    }));

    await manager.start(folder);
    expect(manager.listStatuses()[0]).toMatchObject({ state: "offline", message: "network unavailable" });
  });

  it("forwards newly indexed videos to the background metadata queue", async () => {
    const enqueue = vi.fn();
    const metadataQueue = { enqueue } as unknown as MetadataQueue;
    const manager = new ScanManager({} as VideoRepository, async (_repo, _folder, dependencies) => {
      dependencies.onMetadataPending?.("video-1");
      expect(enqueue).not.toHaveBeenCalled();
      return { state: "completed", totalFiles: 1, processedFiles: 1, failureCount: 0, message: null };
    }, metadataQueue);

    await manager.start(folder);

    expect(enqueue).toHaveBeenCalledWith("video-1");
  });

  it("scans every enabled folder sequentially and labels scan-all status", async () => {
    const secondFolder = { ...folder, id: "folder-2", path: "Y:\\Archive" };
    const disabledFolder = { ...folder, id: "folder-3", path: "X:\\Disabled", enabled: false };
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const scan = vi.fn(async (_repo, currentFolder) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(currentFolder.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { state: "completed" as const, totalFiles: 0, processedFiles: 0, failureCount: 0, message: null };
    });
    const manager = new ScanManager({} as VideoRepository, scan);

    await manager.scanAll([folder, secondFolder, disabledFolder]);

    expect(order).toEqual([folder.id, secondFolder.id]);
    expect(maxActive).toBe(1);
    expect(manager.listStatuses()).toEqual(expect.arrayContaining([
      expect.objectContaining({ folderId: folder.id, mode: "scan-all", state: "completed" }),
      expect.objectContaining({ folderId: secondFolder.id, mode: "scan-all", state: "completed" })
    ]));
  });

  it("deduplicates concurrent requests for the same source folder", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scan = vi.fn(async () => {
      await gate;
      return { state: "completed" as const, totalFiles: 0, processedFiles: 0, failureCount: 0, message: null };
    });
    const manager = new ScanManager({} as VideoRepository, scan);

    const first = manager.start(folder);
    const second = manager.start(folder);
    release?.();
    await Promise.all([first, second]);

    expect(scan).toHaveBeenCalledOnce();
  });

  it("reuses an active current-folder scan when scan-all reaches the same folder", async () => {
    const secondFolder = { ...folder, id: "folder-2", path: "Y:\\Archive" };
    const gate = deferred();
    const order: string[] = [];
    const scan = vi.fn(async (_repo, currentFolder) => {
      order.push(currentFolder.id);
      if (currentFolder.id === folder.id) await gate.promise;
      return completedResult();
    });
    const manager = new ScanManager({} as VideoRepository, scan);

    const current = manager.start(folder);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const all = manager.scanAll([folder, secondFolder]);
    gate.resolve();
    await Promise.all([current, all]);

    expect(order).toEqual([folder.id, secondFolder.id]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(manager.listStatuses().find((status) => status.folderId === secondFolder.id)?.counters)
      .toMatchObject({ totalFolders: 2, completedFolders: 2, currentFolderIndex: 2 });
  });

  it("skips a retry requested during a normal scan when no unresolved failures remain", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scan = vi.fn(async () => {
      await gate;
      return { state: "completed" as const, totalFiles: 0, processedFiles: 0, failureCount: 0, message: null };
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 0 }) } as unknown as VideoRepository;
    const retryScan = vi.fn();
    const manager = new ScanManager(repo, scan, undefined, undefined, retryScan);
    const normal = manager.start(folder);
    const retry = manager.retryFailures(folder);
    release?.();
    await Promise.all([normal, retry]);
    expect(scan).toHaveBeenCalledOnce();
    expect(retryScan).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent retry requests for the same source folder", async () => {
    const gate = deferred();
    const retryScan = vi.fn(async () => {
      await gate.promise;
      return completedResult();
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 1 }) } as unknown as VideoRepository;
    const manager = new ScanManager(repo, vi.fn(), undefined, undefined, retryScan);

    const first = manager.retryFailures(folder);
    const second = manager.retryFailures(folder);
    gate.resolve();
    await Promise.all([first, second]);

    expect(retryScan).toHaveBeenCalledOnce();
  });

  it("deduplicates the same single failure and serializes it behind an active folder scan", async () => {
    const gate = deferred();
    const normalScan = vi.fn(async () => { await gate.promise; return completedResult(); });
    const retrySingle = vi.fn(async () => completedResult());
    const manager = new ScanManager({} as VideoRepository, normalScan, undefined, undefined, vi.fn(), retrySingle);

    const normal = manager.start(folder);
    await vi.waitFor(() => expect(normalScan).toHaveBeenCalledOnce());
    const first = manager.retryFailure(folder, "failure-1");
    const second = manager.retryFailure(folder, "failure-1");
    expect(retrySingle).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([normal, first, second]);

    expect(retrySingle).toHaveBeenCalledOnce();
    expect(retrySingle).toHaveBeenCalledWith(expect.anything(), folder, "failure-1", expect.anything());
  });

  it("can enqueue a retry without keeping the caller waiting for the scan", async () => {
    const gate = deferred();
    const retryScan = vi.fn(async () => {
      await gate.promise;
      return completedResult();
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 1 }) } as unknown as VideoRepository;
    const manager = new ScanManager(repo, vi.fn(), undefined, undefined, retryScan);
    const onCompleted = vi.fn();
    const onFailed = vi.fn();

    expect(manager.retryFailuresInBackground(folder, onCompleted, onFailed)).toBeUndefined();
    await vi.waitFor(() => expect(retryScan).toHaveBeenCalledOnce());
    expect(onCompleted).not.toHaveBeenCalled();

    gate.resolve();
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("queues a normal scan after an active retry instead of treating it as equivalent", async () => {
    const retryGate = deferred();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const scan = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("normal");
      active -= 1;
      return completedResult();
    });
    const retryScan = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("retry");
      await retryGate.promise;
      active -= 1;
      return completedResult();
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 1 }) } as unknown as VideoRepository;
    const manager = new ScanManager(repo, scan, undefined, undefined, retryScan);

    const retry = manager.retryFailures(folder);
    await vi.waitFor(() => expect(retryScan).toHaveBeenCalledOnce());
    const normal = manager.start(folder);
    expect(scan).not.toHaveBeenCalled();
    retryGate.resolve();
    await Promise.all([retry, normal]);

    expect(order).toEqual(["retry", "normal"]);
    expect(maxActive).toBe(1);
  });

  it("queues scan-all work after an active retry and preserves batch counters", async () => {
    const secondFolder = { ...folder, id: "folder-2", path: "Y:\\Archive" };
    const retryGate = deferred();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const scan = vi.fn(async (_repo, currentFolder) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`normal:${currentFolder.id}`);
      active -= 1;
      return completedResult();
    });
    const retryScan = vi.fn(async (_repo, currentFolder) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`retry:${currentFolder.id}`);
      await retryGate.promise;
      active -= 1;
      return completedResult();
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 1 }) } as unknown as VideoRepository;
    const manager = new ScanManager(repo, scan, undefined, undefined, retryScan);

    const retry = manager.retryFailures(folder);
    await vi.waitFor(() => expect(retryScan).toHaveBeenCalledOnce());
    const scanAll = manager.scanAll([folder, secondFolder]);
    retryGate.resolve();
    await Promise.all([retry, scanAll]);

    expect(order).toEqual(["retry:folder-1", "normal:folder-1", "normal:folder-2"]);
    expect(maxActive).toBe(1);
    expect(manager.listStatuses()).toEqual(expect.arrayContaining([
      expect.objectContaining({ folderId: "folder-1", mode: "scan-all", counters: expect.objectContaining({ totalFolders: 2, completedFolders: 1 }) }),
      expect.objectContaining({ folderId: "folder-2", mode: "scan-all", counters: expect.objectContaining({ totalFolders: 2, completedFolders: 2 }) })
    ]));
  });

  it("queues a retry after a normal scan only when unresolved failures remain", async () => {
    const normalGate = deferred();
    const order: string[] = [];
    const scan = vi.fn(async () => {
      order.push("normal");
      await normalGate.promise;
      return completedResult();
    });
    const retryScan = vi.fn(async () => {
      order.push("retry");
      return completedResult();
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 1 }) } as unknown as VideoRepository;
    const manager = new ScanManager(repo, scan, undefined, undefined, retryScan);

    const normal = manager.start(folder);
    const retry = manager.retryFailures(folder);
    normalGate.resolve();
    await Promise.all([normal, retry]);

    expect(order).toEqual(["normal", "retry"]);
  });

  it("keeps the follow-up task registered when the preceding task settles", async () => {
    const retryGate = deferred();
    const normalGate = deferred();
    const scan = vi.fn(async () => {
      await normalGate.promise;
      return completedResult();
    });
    const retryScan = vi.fn(async () => {
      await retryGate.promise;
      return completedResult();
    });
    const repo = { getScanFailureSummary: () => ({ totalUnresolved: 1 }) } as unknown as VideoRepository;
    const manager = new ScanManager(repo, scan, undefined, undefined, retryScan);

    const retry = manager.retryFailures(folder);
    await vi.waitFor(() => expect(retryScan).toHaveBeenCalledOnce());
    const normal = manager.start(folder);
    retryGate.resolve();
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());

    expect(manager.isActive(folder.id)).toBe(true);
    normalGate.resolve();
    await Promise.all([retry, normal]);
    expect(manager.isActive(folder.id)).toBe(false);
  });

  it("cancels cooperatively without reporting the task as a failure", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scan = vi.fn(async (_repo, _folder, dependencies) => {
      await gate;
      if (dependencies.isCancelled?.()) throw new ScanCancelledError();
      return { state: "completed" as const, totalFiles: 0, processedFiles: 0, failureCount: 0, message: null };
    });
    const manager = new ScanManager({} as VideoRepository, scan);
    const task = manager.start(folder);
    await vi.waitFor(() => expect(manager.listStatuses()[0]?.state).toBe("scanning"));

    expect(manager.cancel(folder.id)).toBe(true);
    release?.();
    await task;

    expect(manager.listStatuses()[0]).toMatchObject({ state: "cancelled", message: null });
  });
});

function completedResult() {
  return { state: "completed" as const, totalFiles: 0, processedFiles: 0, failureCount: 0, message: null };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
