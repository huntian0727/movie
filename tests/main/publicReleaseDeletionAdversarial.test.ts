// @vitest-environment node
// Independent release QA: all destructive actions operate on disposable fixtures.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { IPC_CHANNELS } from "../../src/shared/videoTypes";
import { registerTrustedWebContents } from "../../src/main/security";
import { getDefaultSettings } from "../../src/main/settings/settingsStore";
import { DuplicateCleanupService } from "../../src/main/media/duplicateCleanupService";
import { deleteScanFailureFile } from "../../src/main/files/scanFailureActions";

const electron = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => electron.handlers.set(channel, handler) },
  dialog: {}, shell: {}, app: {}, BrowserWindow: class {}
}));
import { registerIpcHandlers } from "../../src/main/ipc";

const roots: string[] = [];
const unregister: Array<() => void> = [];
afterEach(async () => {
  unregister.splice(0).forEach(remove => remove());
  electron.handlers.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "movie-release-deletion-qa-"));
  roots.push(root);
  const managed = path.join(root, "managed");
  const directory = path.join(managed, "library");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, "fixture.mp4");
  await writeFile(filePath, "original-fixture");
  const original = await stat(filePath);
  const record = { id: "fixture-video", sourceFolderId: "fixture-folder", path: filePath,
    sizeBytes: original.size, modifiedAt: original.mtime.toISOString(), filename: "fixture.mp4" };
  const repo = { getVideo: vi.fn(() => record), removeVideo: vi.fn(),
    listSourceFolders: () => [{ id: "fixture-folder", path: managed, enabled: true }],
    getVideoByPath: () => record, getScanFailure: () => ({ id: "fixture-failure", status: "unresolved", objectType: "file",
      objectPath: filePath, sourceFolderId: record.sourceFolderId, errorCode: "CONFIRMED_CORRUPT", errorSummary: "fixture independent confirmation" }),
    resolveScanFailuresForObject: vi.fn() };
  const genericGuard = vi.fn();
  const settings = { get: getDefaultSettings };
  registerIpcHandlers(repo as never, {
    settings, cacheRoot: path.join(root, "cache"), videoDataQueries: { selectIds: async () => [record.id] },
    cacheManager: { scheduleMaintenance: vi.fn() }, domainEvents: { publish: vi.fn() },
    metadataQueue: {}, duplicateCleanupJobs: { assertGenericPermanentDeleteAllowed: genericGuard, assertVideosAvailable: vi.fn() },
    duplicateCleanup: {}, scanManager: {}
  } as never);
  const sender = { id: 971, isDestroyed: () => false, mainFrame: { url: "file:///qa/index.html" }, on: vi.fn() };
  unregister.push(registerTrustedWebContents(sender, "main", sender.mainFrame.url));
  const caller = { sender, senderFrame: sender.mainFrame };
  return { root, managed, directory, filePath, repo, genericGuard,
    invokeDelete: () => electron.handlers.get(IPC_CHANNELS.videoDelete)!(caller, { videoId: record.id }),
    invokeDataDelete: () => electron.handlers.get(IPC_CHANNELS.videoDataDelete)!(caller, {}, { all: false, ids: [record.id], excludedIds: [] }) };
}

describe("independent public-release deletion safety", () => {
  it("deletes an unchanged managed ordinary file and updates the indexed record", async () => {
    const f = await fixture();
    await expect(f.invokeDelete()).resolves.toBe(true);
    await expect(stat(f.filePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.repo.removeVideo).toHaveBeenCalledWith("fixture-video");
  });

  it("preserves explicitly selected ordinary data-table deletion without a duplicate/hash policy guard", async () => {
    const f = await fixture();
    await expect(f.invokeDataDelete()).resolves.toMatchObject({ successCount: 1, failureCount: 0 });
    expect(f.genericGuard).not.toHaveBeenCalled();
    await expect(stat(f.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies final version safety to explicitly selected data-table deletion", async () => {
    const f = await fixture();
    await writeFile(f.filePath, "table-replacement-is-longer");
    await expect(f.invokeDataDelete()).resolves.toMatchObject({ successCount: 0, failureCount: 1 });
    expect(await readFile(f.filePath, "utf8")).toBe("table-replacement-is-longer");
    expect(f.repo.removeVideo).not.toHaveBeenCalled();
  });
  it("does not permanently delete a replacement whose indexed size/version is stale", async () => {
    const f = await fixture();
    await writeFile(f.filePath, "replacement-is-a-different-and-longer-file");
    await f.invokeDelete().catch(() => undefined);
    expect(await readFile(f.filePath, "utf8")).toBe("replacement-is-a-different-and-longer-file");
    expect(f.repo.removeVideo).not.toHaveBeenCalled();
  });

  it("does not follow a replaced ancestor junction outside the managed source", async () => {
    const f = await fixture();
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    const outsideFile = path.join(outside, "fixture.mp4");
    await writeFile(outsideFile, "unindexed-outside-fixture");
    await rename(f.directory, path.join(f.root, "original-library"));
    await symlink(outside, f.directory, process.platform === "win32" ? "junction" : "dir");
    await f.invokeDelete().catch(() => undefined);
    expect(await readFile(outsideFile, "utf8")).toBe("unindexed-outside-fixture");
    expect(f.repo.removeVideo).not.toHaveBeenCalled();
  });

  it("blocks a same-size/mtime outside-junction target in the real scan-failure deletion sink", async () => {
    const f = await fixture();
    const original = await stat(f.filePath);
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    const outsideFile = path.join(outside, "fixture.mp4");
    await writeFile(outsideFile, Buffer.alloc(original.size, 2));
    await utimes(outsideFile, original.atime, original.mtime);
    await rename(f.directory, path.join(f.root, "original-library"));
    await symlink(outside, f.directory, process.platform === "win32" ? "junction" : "dir");
    await expect(deleteScanFailureFile(f.repo as never, "fixture-failure", { assertPermanentDeleteAllowed: () => undefined }))
      .rejects.toThrow(/junction|symbolic link/);
    expect(await readFile(outsideFile)).toEqual(Buffer.alloc(original.size, 2));
    expect(f.repo.removeVideo).not.toHaveBeenCalled();
  });

  it("does not start split CloudDrive retries after the user stops a failed batch", async () => {
    let cancelling = false;
    const jobs = { interruptActiveJobs: vi.fn(), listStagedItems: () => [], recoverFastJobs: () => [],
      isCancelling: () => cancelling, updateItems: vi.fn(), updateItem: vi.fn(),
      getCloudDriveConnectionBinding: () => crypto.createHash("sha256").update("injected-cloud-provider").digest("hex") };
    const deleteCloudFiles = vi.fn(async () => {
      cancelling = true;
      return { success: false, errorMessage: "temporary-fixture-failure", resultFilePaths: [] };
    });
    const service = new DuplicateCleanupService(jobs as never, { removeVideo: vi.fn() } as never,
      {} as never, {} as never, { publish: vi.fn() } as never, { deleteCloudFiles });
    try {
      const items = [1, 2].map(id => ({ id: `item-${id}`, delete_video_id: `video-${id}`,
        delete_provider_path: `/qa-fixtures/file-${id}.mp4` }));
      await (service as unknown as { deleteFastBatch(jobId: string, items: unknown[]): Promise<void> })
        .deleteFastBatch("fixture-job", items);
      expect(deleteCloudFiles).toHaveBeenCalledTimes(1);
    } finally { service.stop(); }
  });
});
