// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { DuplicateCleanupRepository } from "../../src/main/db/duplicateCleanupRepository";
import { deleteReviewedDuplicatePlan } from "../../src/main/media/reviewedDuplicateDelete";
import { ReviewedDuplicateBackgroundQueue } from "../../src/main/media/reviewedDuplicateBackground";
import type { DuplicateResolvePlan } from "../../src/shared/videoTypes";

let temp: string | undefined;
let database: DatabaseConnection | undefined;
afterEach(() => {
  database?.close(); database = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

async function waitForBackgroundStatus(
  queue: ReviewedDuplicateBackgroundQueue,
  expected: "partial" | "blocked"
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = queue.get();
    if (job?.status === expected) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Background queue never became ${expected}`);
}

async function fixture() {
  temp = mkdtempSync(path.join(tmpdir(), "reviewed-duplicate-safe-"));
  database = createDatabase(path.join(temp, "test.sqlite"));
  const repo = new VideoRepository(database);
  const folder = repo.addSourceFolder(temp, true);
  const directory = path.join(temp, "movies");
  await mkdir(directory);
  const keepPath = path.join(directory, "keep.mp4");
  const deletePath = path.join(directory, "delete.mp4");
  await writeFile(keepPath, Buffer.alloc(16, 1));
  await writeFile(deletePath, Buffer.alloc(16, 2));
  const modified = new Date("2026-07-09T00:00:00.000Z");
  await utimes(keepPath, modified, modified);
  await utimes(deletePath, modified, modified);
  const insert = async (filepath: string, durationMs: number) => {
    const parsed = path.parse(filepath), info = await stat(filepath);
    return repo.upsertVideo({
      sourceFolderId: folder.id, path: filepath, directory: parsed.dir,
      filename: parsed.base, basename: parsed.name, extension: ".mp4",
      sizeBytes: info.size, durationMs,
      width: 640, height: 480, format: "mp4", modifiedAt: info.mtime.toISOString()
    });
  };
  const keep = await insert(keepPath, 5100);
  const removed = await insert(deletePath, 5400);
  const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0];
  const plan: DuplicateResolvePlan = { groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [removed.id] }] };
  return { repo, plan, keep, removed, keepPath, deletePath, queue: { enqueue: vi.fn(() => true) } };
}

describe("explicit reviewed duplicate deletion, isolated filesystem", () => {
  it("deletes only the explicitly selected file with equal size and rounded-second duration; preserves the chosen keep file", async () => {
    const f = await fixture(), onRemoved = vi.fn(), assertAvailable = vi.fn();
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, assertAvailable, onRemoved);
    expect(result).toMatchObject({ successCount: 1, failureCount: 0, reclaimedBytes: 16 });
    expect(assertAvailable).toHaveBeenCalledOnce();
    expect(onRemoved).toHaveBeenCalledWith([f.removed.id]);
    await expect(stat(f.deletePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(f.keepPath)).toEqual(Buffer.alloc(16, 1));
    expect(f.repo.getVideo(f.keep.id)).toBeTruthy();
    expect(() => f.repo.getVideo(f.removed.id)).toThrow();
  });

  it("blocks generic permanent deletion for rounded-second matches even when millisecond durations differ", async () => {
    const f = await fixture();
    const jobs = new DuplicateCleanupRepository(database!, f.repo);
    expect(f.keep.durationMs).not.toBe(f.removed.durationMs);
    expect(() => jobs.assertGenericPermanentDeleteAllowed([f.removed.id])).toThrow(/大小与时长重复条件/);
    expect(await readFile(f.keepPath)).toHaveLength(16);
    expect(await readFile(f.deletePath)).toHaveLength(16);
  });

  async function cloudFixture() {
    const f = await fixture();
    const source = f.repo.listSourceFolders().find((item) => item.id === f.keep.sourceFolderId)!;
    const updates = [
      { videoId: f.keep.id, expectedPath: f.keep.path, expectedSizeBytes: f.keep.sizeBytes,
        providerFileId: "remote-keep", providerPath: "/115/keep.mp4", providerModifiedAt: f.keep.modifiedAt },
      { videoId: f.removed.id, expectedPath: f.removed.path, expectedSizeBytes: f.removed.sizeBytes,
        providerFileId: "remote-delete", providerPath: "/115/delete.mp4", providerModifiedAt: f.removed.modifiedAt }
    ];
    expect(f.repo.bindCloudDriveVideoIdentities(source.id, {
      rootPath: "/115", name: "mock mounted CloudDrive", readOnly: false
    }, updates)).toBe(2);
    const freshKeep = f.repo.getVideo(f.keep.id);
    const freshDelete = f.repo.getVideo(f.removed.id);
    const refresh = vi.fn(async (_paths: readonly string[]) => new Map([
      [freshKeep.path, { status: "present" as const, sizeBytes: freshKeep.sizeBytes,
        modifiedAt: freshKeep.modifiedAt, providerFileId: freshKeep.providerFileId!, providerPath: freshKeep.providerPath! }],
      [freshDelete.path, { status: "present" as const, sizeBytes: freshDelete.sizeBytes,
        modifiedAt: freshDelete.modifiedAt, providerFileId: freshDelete.providerFileId!, providerPath: freshDelete.providerPath! }]
    ]));
    const del = vi.fn().mockResolvedValue({
      success: true, permanentlyDeleted: true, errorMessage: "",
      resultFilePaths: [freshDelete.providerPath!]
    });
    return { ...f, freshKeep, freshDelete, remote: { refresh, delete: del, binding: vi.fn(() => "fixed-account-binding") } };
  }

  it("deletes a verified CloudDrive duplicate via remote API, never unlinking the virtual mount path", async () => {
    const f = await cloudFixture();
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 1, failureCount: 0, reclaimedBytes: 16, recycledCount: 0 });
    expect(f.remote.refresh).toHaveBeenCalledTimes(2); // Initial complete review + immediate pre-delete verification.
    expect(f.remote.delete).toHaveBeenCalledWith(["/115/delete.mp4"]);
    expect(await readFile(f.deletePath)).toHaveLength(16); // Mock remote API; no real deletion.
    expect(await readFile(f.keepPath)).toHaveLength(16);
    expect(() => f.repo.getVideo(f.freshDelete.id)).toThrow();
    expect(f.repo.getVideo(f.freshKeep.id)).toBeTruthy();
  });

  it("refuses a changed provider file ID before sending any remote delete", async () => {
    const f = await cloudFixture();
    f.remote.refresh.mockImplementationOnce(async () => new Map([
      [f.freshKeep.path, { status: "present" as const, sizeBytes: 16, modifiedAt: f.freshKeep.modifiedAt,
        providerFileId: f.freshKeep.providerFileId!, providerPath: f.freshKeep.providerPath! }],
      [f.freshDelete.path, { status: "present" as const, sizeBytes: 16, modifiedAt: f.freshDelete.modifiedAt,
        providerFileId: "different-file", providerPath: f.freshDelete.providerPath! }]
    ]));
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(result.failures[0].message).toContain("身份");
    expect(f.remote.delete).not.toHaveBeenCalled();
    expect(f.repo.getVideo(f.freshDelete.id)).toBeTruthy();
  });

  it("returns an unknown outcome and never retries when CloudDrive loses its reply mid-delete", async () => {
    const f = await cloudFixture();
    f.remote.delete.mockRejectedValueOnce(new Error("HTTP2 stream disconnected"));
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({
      successCount: 0, failureCount: 0, uncertainCount: 1, unsubmittedCount: 0
    });
    expect(result.uncertainMessage).toContain("结果未知");
    expect(f.remote.delete).toHaveBeenCalledTimes(1);
    expect(f.repo.getVideo(f.freshDelete.id)).toBeTruthy();
  });

  it("blocks a changed remote account binding without executing deletion", async () => {
    const f = await cloudFixture();
    f.remote.binding.mockReturnValueOnce("account-A").mockReturnValueOnce("account-B");
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(f.remote.delete).not.toHaveBeenCalled();
  });

  it("reports an API recycle-bin fallback without claiming permanent space reclamation", async () => {
    const f = await cloudFixture();
    f.remote.delete.mockResolvedValueOnce({
      success: true, permanentlyDeleted: false, errorMessage: "", resultFilePaths: ["/115/delete.mp4"]
    });
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 1, failureCount: 0, reclaimedBytes: 0, recycledCount: 1 });
  });

  async function cloudBatchFixture(targetCount = 8) {
    const f = await fixture();
    const folder = f.repo.listSourceFolders().find((source) => source.id === f.keep.sourceFolderId)!;
    const records = [f.keep, f.removed];
    for (let i = 2; i <= targetCount; i++) {
      const filePath = path.join(path.dirname(f.keepPath), `remove-${i}.mp4`);
      await writeFile(filePath, Buffer.alloc(16, i));
      await utimes(filePath, new Date(f.keep.modifiedAt), new Date(f.keep.modifiedAt));
      const info = await stat(filePath);
      const parsed = path.parse(filePath);
      records.push(f.repo.upsertVideo({
        sourceFolderId: folder.id, path: filePath, directory: parsed.dir,
        filename: parsed.base, basename: parsed.name, extension: ".mp4",
        sizeBytes: info.size, durationMs: 5200, width: 640, height: 480,
        format: "mp4", modifiedAt: info.mtime.toISOString()
      }));
    }
    expect(f.repo.bindCloudDriveVideoIdentities(folder.id, {
      rootPath: "/115", name: "mock CloudDrive", readOnly: false
    }, records.map((video) => ({
      videoId: video.id, expectedPath: video.path, expectedSizeBytes: video.sizeBytes,
      providerFileId: `provider-${video.id}`,
      providerPath: `/115/${video.filename}`,
      providerModifiedAt: video.modifiedAt
    })))).toBe(targetCount + 1);
    const keep = f.repo.getVideo(f.keep.id);
    const targets = records.slice(1).map((video) => f.repo.getVideo(video.id));
    const currentByLocal = new Map([keep, ...targets].map((video) => [video.path, video]));
    const remoteFiles = new Set([keep.providerPath!, ...targets.map((video) => video.providerPath!)]);
    const refresh = vi.fn(async (paths: readonly string[]) => new Map(paths.filter((local) => {
      const video = currentByLocal.get(local);
      return video && remoteFiles.has(video.providerPath!);
    }).map((local) => {
      const video = currentByLocal.get(local)!;
      return [local, {
        status: "present" as const, sizeBytes: video.sizeBytes, modifiedAt: video.modifiedAt,
        providerFileId: video.providerFileId!, providerPath: video.providerPath!
      }] as const;
    })));
    const remoteDelete = vi.fn(async (paths: readonly string[]) => {
      if (paths.length !== 1) throw new Error("One target per attributable RPC");
      remoteFiles.delete(paths[0]!);
      return { success: true, permanentlyDeleted: true, errorMessage: "", resultFilePaths: [paths[0]!] };
    });
    const group = f.repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0];
    const plan: DuplicateResolvePlan = { groups: [{
      groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: targets.map((target) => target.id)
    }] };
    return { ...f, keep, targets, plan, remoteFiles, remote: {
      refresh, delete: remoteDelete, binding: vi.fn(() => "stable-cloud-drive")
    } };
  }

  it("coalesces fresh remote metadata and caps parallel per-file deletes at three", async () => {
    const f = await cloudBatchFixture(8);
    let active = 0, peak = 0;
    f.remote.delete.mockImplementation(async (paths) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active--;
      f.remoteFiles.delete(paths[0]!);
      return { success: true, permanentlyDeleted: true, errorMessage: "", resultFilePaths: [paths[0]!] };
    });
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 8, failureCount: 0, uncertainCount: 0, reclaimedBytes: 128 });
    expect(peak).toBe(3);
    expect(f.remote.delete).toHaveBeenCalledTimes(8);
    expect(f.remote.delete.mock.calls.every(([paths]) => paths.length === 1)).toBe(true);
    // Old logic did one initial refresh + one per target = 9 scans.
    // New logic is one initial refresh + ceil(8 / 3) = 4.
    expect(f.remote.refresh).toHaveBeenCalledTimes(4);
    expect(f.remote.refresh.mock.calls[0][0]).toHaveLength(9);
    expect(f.repo.getVideo(f.keep.id)).toBeTruthy();
    expect(await readFile(f.keepPath)).toHaveLength(16);
  });

  it("waits for the current wave and stops submitting after one unknown reply", async () => {
    const f = await cloudBatchFixture(8);
    let issued = 0;
    f.remote.delete.mockImplementation(async (paths) => {
      issued++;
      if (issued === 4) throw new Error("HTTP/2 disconnect");
      f.remoteFiles.delete(paths[0]!);
      return { success: true, permanentlyDeleted: true, errorMessage: "", resultFilePaths: [paths[0]!] };
    });
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 5, failureCount: 0, uncertainCount: 1, unsubmittedCount: 2 });
    expect(result.uncertainMessage).toContain("停止提交后续");
    expect(f.remote.delete).toHaveBeenCalledTimes(6);
    expect(f.repo.getVideo(f.keep.id)).toBeTruthy();
    expect(f.remoteFiles.has(f.keep.providerPath!)).toBe(true);
    // Unknown and never-submitted videos remain in the database.
    expect(f.repo.getVideo(f.targets[3]!.id)).toBeTruthy();
    expect(f.repo.getVideo(f.targets[7]!.id)).toBeTruthy();
  });

  it("rejects a changed remote keeper during the second wave before any more deletions", async () => {
    const f = await cloudBatchFixture(5);
    const baseline = f.remote.refresh.getMockImplementation()!;
    let calls = 0;
    f.remote.refresh.mockImplementation(async (paths) => {
      calls++;
      const values = await baseline(paths);
      if (calls === 3) {
        const keepLive = values.get(f.keep.path)!;
        values.set(f.keep.path, { ...keepLive, providerFileId: "different-keeper" });
      }
      return values;
    });
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 3, failureCount: 2, uncertainCount: 0 });
    expect(f.remote.delete).toHaveBeenCalledTimes(3);
    expect(f.repo.getVideo(f.keep.id)).toBeTruthy();
  });

  it("treats a rejected remote delete as a retryable failure only when the same remote object still exists", async () => {
    const f = await cloudFixture();
    f.remote.delete.mockResolvedValueOnce({
      success: false, permanentlyDeleted: false, errorMessage: "Remote permission denied", resultFilePaths: []
    });
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 0, failureCount: 1, uncertainCount: 0 });
    expect(result.failures[0]!.message).toContain("permission denied");
    expect(f.remote.refresh).toHaveBeenCalledTimes(3); // Full, pre-delete, verify no deletion.
    expect(f.repo.getVideo(f.removed.id)).toBeTruthy();
  });

  it("marks an API rejection UNKNOWN if the remote target has already disappeared", async () => {
    const f = await cloudFixture();
    const baseline = f.remote.refresh.getMockImplementation()!;
    let calls = 0;
    f.remote.refresh.mockImplementation(async (paths) => {
      calls++;
      const state = await baseline(paths);
      if (calls === 3) state.delete(f.freshDelete.path);
      return state;
    });
    f.remote.delete.mockResolvedValueOnce({
      success: false, permanentlyDeleted: false, errorMessage: "partial operation", resultFilePaths: []
    });
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn(), f.remote);
    expect(result).toMatchObject({ successCount: 0, failureCount: 0, uncertainCount: 1 });
    expect(result.uncertainMessage).toContain("不能直接重试");
    expect(f.remote.delete).toHaveBeenCalledTimes(1);
  });

  it("rejects an altered keep/delete plan without touching files", async () => {
    const f = await fixture();
    const badPlan: DuplicateResolvePlan = {
      groups: [{ ...f.plan.groups[0], deleteVideoIds: [f.keep.id] }]
    };
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, badPlan, vi.fn(), vi.fn());
    expect(result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(await readFile(f.keepPath)).toHaveLength(16);
    expect(await readFile(f.deletePath)).toHaveLength(16);
  });

  it("checks keep and target file versions again before deletion", async () => {
    const f = await fixture();
    await writeFile(f.deletePath, Buffer.alloc(17, 9));
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan, vi.fn(), vi.fn());
    expect(result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(await readFile(f.keepPath)).toHaveLength(16);
    expect(await readFile(f.deletePath)).toHaveLength(17);
    expect(f.repo.getVideo(f.removed.id)).toBeTruthy();
  });

  it("persists explicit CloudDrive failures across two background chunks without hiding or retrying the failed item", async () => {
    const f = await cloudBatchFixture(35);
    const failed = f.targets[4]!;
    const ordinaryDelete = f.remote.delete.getMockImplementation()!;
    f.remote.delete.mockImplementation(async (paths) => {
      if (paths[0] === failed.providerPath) return {
        success: false, permanentlyDeleted: false,
        errorMessage: "simulated permission denied", resultFilePaths: []
      };
      return ordinaryDelete(paths);
    });
    const jobFile = path.join(temp!, "reviewed-job.json");
    const onRemoved = vi.fn();
    const run = vi.fn((batch: DuplicateResolvePlan) =>
      deleteReviewedDuplicatePlan(f.repo, f.queue, batch, vi.fn(), onRemoved, f.remote));
    const queue = new ReviewedDuplicateBackgroundQueue(jobFile, run);
    const accepted = queue.submit(f.plan);
    expect(accepted.status).toBe("running");
    expect(accepted.queuedVideoIds).toHaveLength(35);

    const partial = await waitForBackgroundStatus(queue, "partial");
    expect(partial).toMatchObject({
      total: 35, processed: 35, successCount: 34, failureCount: 1,
      uncertainCount: 0, unsubmittedCount: 0
    });
    expect(partial.failures).toEqual([expect.objectContaining({
      videoId: failed.id, message: expect.stringContaining("simulated permission denied")
    })]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(f.remote.delete).toHaveBeenCalledTimes(35);
    expect(f.repo.getVideo(failed.id)).toBeTruthy();
    expect(f.remoteFiles.has(failed.providerPath!)).toBe(true);
    expect(f.repo.getVideo(f.keep.id)).toBeTruthy();
    expect(await readFile(f.keepPath)).toEqual(Buffer.alloc(16, 1));
    expect(JSON.parse(await readFile(jobFile, "utf8")).current.status).toBe("partial");

    const noReplay = vi.fn();
    const restored = new ReviewedDuplicateBackgroundQueue(jobFile, noReplay);
    expect(restored.get()).toMatchObject({ status: "partial", successCount: 34, failureCount: 1 });
    expect(noReplay).not.toHaveBeenCalled();
  });

  it("stops an integrated background CloudDrive job after an unknown reply and persists unsent items", async () => {
    const f = await cloudBatchFixture(35);
    const ordinaryDelete = f.remote.delete.getMockImplementation()!;
    let submitted = 0;
    f.remote.delete.mockImplementation(async (paths) => {
      submitted++;
      if (submitted === 31) throw new Error("simulated HTTP/2 disconnect after submission");
      return ordinaryDelete(paths);
    });
    const jobFile = path.join(temp!, "reviewed-job.json");
    const run = vi.fn((batch: DuplicateResolvePlan) =>
      deleteReviewedDuplicatePlan(f.repo, f.queue, batch, vi.fn(), vi.fn(), f.remote));
    const queue = new ReviewedDuplicateBackgroundQueue(jobFile, run);
    queue.submit(f.plan);

    const blocked = await waitForBackgroundStatus(queue, "blocked");
    expect(blocked).toMatchObject({
      total: 35, processed: 32, successCount: 32, failureCount: 0,
      uncertainCount: 1, unsubmittedCount: 2
    });
    expect(blocked.message).toContain("不能直接重试");
    expect(run).toHaveBeenCalledTimes(2);
    expect(f.remote.delete).toHaveBeenCalledTimes(33);
    // The unknown target and the unsubmitted tail MUST remain indexed.
    for (const target of [f.targets[30]!, f.targets[33]!, f.targets[34]!]) {
      expect(f.repo.getVideo(target.id)).toBeTruthy();
      expect(f.remoteFiles.has(target.providerPath!)).toBe(true);
    }
    expect(f.repo.getVideo(f.keep.id)).toBeTruthy();
    expect(await readFile(f.keepPath)).toEqual(Buffer.alloc(16, 1));
    expect(JSON.parse(await readFile(jobFile, "utf8")).current).toMatchObject({
      status: "blocked", uncertainCount: 1, unsubmittedCount: 2
    });

    const noReplay = vi.fn();
    const restored = new ReviewedDuplicateBackgroundQueue(jobFile, noReplay);
    expect(restored.get()).toMatchObject({ status: "blocked", uncertainCount: 1, unsubmittedCount: 2 });
    expect(noReplay).not.toHaveBeenCalled();
  });

  it("respects active duplicate-job reservations and never calls a delete primitive", async () => {
    const f = await fixture(), onRemoved = vi.fn();
    const result = await deleteReviewedDuplicatePlan(f.repo, f.queue, f.plan,
      () => { throw new Error("Selected videos are reserved"); }, onRemoved);
    expect(result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(result.failures[0].message).toContain("reserved");
    expect(onRemoved).not.toHaveBeenCalled();
    expect(await readFile(f.keepPath)).toHaveLength(16);
    expect(await readFile(f.deletePath)).toHaveLength(16);
  });
});
