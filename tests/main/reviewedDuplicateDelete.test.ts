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
import type { DuplicateResolvePlan } from "../../src/shared/videoTypes";

let temp: string | undefined;
let database: DatabaseConnection | undefined;
afterEach(() => {
  database?.close(); database = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

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
    const refresh = vi.fn(async () => new Map([
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
