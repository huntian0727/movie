// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "../../src/main/db/database";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import {
  DUPLICATE_PREFLIGHT_CONCURRENCY,
  previewDuplicateResolveSafely,
  resolveDuplicatePlanSafely
} from "../../src/main/media/duplicateResolveSafety";
import type { DuplicateResolvePlan, VideoRecord } from "../../src/shared/videoTypes";

let tempDir: string;
let db: DatabaseConnection | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "duplicate-safety-"));
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("duplicate cleanup stale-file safety", () => {
  it("returns ready when every planned file still matches the database", async () => {
    const fixture = await createDuplicateFixture();
    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    expect(result).toMatchObject({ status: "ready", preview: { groupCount: 1, deleteCount: 1 } });
  });

  it("checks a large current page with bounded parallel file-version reads", async () => {
    const fixture = await createDuplicateFixture();
    const videos = Array.from({ length: 24 }, (_, index) => ({
      ...fixture.keepVideo,
      id: `parallel-${index}`
    }));
    const validateDuplicateResolvePlan = vi.fn(() => [{
      groupKey: "parallel-group",
      keepVideo: videos[0],
      deleteVideos: videos.slice(1)
    }]);
    const parallelRepo = { validateDuplicateResolvePlan } as unknown as VideoRepository;
    let activeReads = 0;
    let maximumActiveReads = 0;

    const result = await previewDuplicateResolveSafely(parallelRepo, fixture.queue, fixture.plan, {
      statFile: async (filePath) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 15));
        try {
          return await stat(filePath);
        } finally {
          activeReads -= 1;
        }
      }
    });

    expect(result).toMatchObject({ status: "ready", preview: { deleteCount: 23 } });
    expect(maximumActiveReads).toBe(DUPLICATE_PREFLIGHT_CONCURRENCY);
    expect(validateDuplicateResolvePlan).toHaveBeenCalledOnce();
  });

  it("returns stale for a changed delete file without deleting anything", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-10T00:00:00.000Z");

    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);

    expect(result).toMatchObject({ status: "stale", changedItems: [{ videoId: fixture.deleteVideo.id, changeType: "mtime-changed" }] });
    expect(await readFile(fixture.keepVideo.path)).toHaveLength(16);
    expect(await readFile(fixture.deleteVideo.path)).toHaveLength(16);
  });

  it("returns stale when the selected keep file changes", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.keepVideo.path, "2026-07-11T00:00:00.000Z");
    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    expect(result).toMatchObject({ status: "stale", changedItems: [{ videoId: fixture.keepVideo.id, changeType: "mtime-changed" }] });
  });

  it("refreshes a changed size, clears derived metadata, queues analysis, and removes the old duplicate group", async () => {
    const fixture = await createDuplicateFixture();
    await writeFile(fixture.deleteVideo.path, Buffer.alloc(24, 2));
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-12T00:00:00.000Z");

    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    const refreshed = fixture.repo.getVideo(fixture.deleteVideo.id);

    expect(result).toMatchObject({ status: "stale", changedItems: [{ changeType: "size-and-mtime-changed", currentSizeBytes: 24 }] });
    expect(refreshed).toMatchObject({
      sizeBytes: 24,
      durationMs: null,
      width: null,
      height: null,
      format: null,
      metadataStatus: "pending",
      thumbnailStatus: "pending",
      timelinePreviewStatus: "pending",
      coverCachePath: null,
      contentFingerprint: null,
      fingerprintStatus: "pending"
    });
    expect(fixture.queue.enqueue).toHaveBeenCalledWith(fixture.deleteVideo.id);
    expect(listDuplicateGroups(fixture.repo)).toHaveLength(0);
  });

  it("marks metadata pending when only mtime changes at the same size", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-13T00:00:00.000Z");
    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    expect(result).toMatchObject({ status: "stale", changedItems: [{ changeType: "mtime-changed", currentSizeBytes: 16 }] });
    expect(fixture.repo.getVideo(fixture.deleteVideo.id)).toMatchObject({ sizeBytes: 16, durationMs: null, metadataStatus: "pending" });
  });

  it("marks a confirmed missing file missing and resolves its stale scan failure", async () => {
    const fixture = await createDuplicateFixture();
    fixture.repo.recordScanFailure({
      sourceFolderId: fixture.deleteVideo.sourceFolderId,
      scanTaskId: "duplicate-preflight-test",
      objectType: "file",
      objectPath: fixture.deleteVideo.path,
      failureStage: "file-processing",
      errorCode: "ENOENT",
      errorSummary: "旧的文件异常",
      incrementRetry: false
    });
    await unlink(fixture.deleteVideo.path);

    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);

    expect(result).toMatchObject({ status: "stale", changedItems: [{ changeType: "missing" }] });
    expect(fixture.repo.getVideo(fixture.deleteVideo.id).isMissing).toBe(true);
    expect(fixture.repo.listScanFailures(fixture.deleteVideo.sourceFolderId)).toHaveLength(0);
    expect(listDuplicateGroups(fixture.repo)).toHaveLength(0);
  });

  it("reports unreadable files without marking them missing", async () => {
    const fixture = await createDuplicateFixture();
    const inaccessible = Object.assign(new Error("access denied"), { code: "EACCES" });
    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan, {
      statFile: (filePath) => filePath === fixture.deleteVideo.path ? Promise.reject(inaccessible) : stat(filePath)
    });

    expect(result).toMatchObject({ status: "stale", changedItems: [{ videoId: fixture.deleteVideo.id, changeType: "unreadable", errorCode: "EACCES" }] });
    expect(fixture.repo.getVideo(fixture.deleteVideo.id).isMissing).toBe(false);
    expect(fixture.queue.enqueue).not.toHaveBeenCalled();
  });

  it("reports a changed item outside the preferred directory because the full group participates", async () => {
    const fixture = await createDuplicateFixture(true);
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-14T00:00:00.000Z");
    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    expect(result).toMatchObject({ status: "stale", changedItems: [{ path: fixture.deleteVideo.path, changeType: "mtime-changed" }] });
    expect(path.dirname(fixture.deleteVideo.path)).not.toBe(path.dirname(fixture.keepVideo.path));
  });

  it("returns every changed file instead of stopping at the first one", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.keepVideo.path, "2026-07-15T00:00:00.000Z");
    await writeFile(fixture.deleteVideo.path, Buffer.alloc(20, 3));
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-16T00:00:00.000Z");
    const result = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    expect(result.status).toBe("stale");
    if (result.status === "stale") {
      expect(result.changedItems.map((item) => item.videoId)).toEqual([fixture.keepVideo.id, fixture.deleteVideo.id]);
    }
  });

  it("rejects the old plan after refreshing stale state and requires a newly generated plan", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-17T00:00:00.000Z");
    await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    await expect(previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan)).rejects.toThrow(/Duplicate group not found/);
  });

  it("allows a new confirmation only after refreshed metadata forms a current duplicate plan", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-18T00:00:00.000Z");
    const stale = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, fixture.plan);
    expect(stale.status).toBe("stale");

    const current = await stat(fixture.deleteVideo.path);
    fixture.repo.upsertVideo({
      sourceFolderId: fixture.deleteVideo.sourceFolderId,
      path: fixture.deleteVideo.path,
      directory: fixture.deleteVideo.directory,
      filename: fixture.deleteVideo.filename,
      basename: fixture.deleteVideo.basename,
      extension: fixture.deleteVideo.extension,
      sizeBytes: current.size,
      durationMs: 5000,
      width: 1920,
      height: 1080,
      format: "mp4",
      modifiedAt: current.mtime.toISOString(),
      metadataStatus: "ready"
    });
    const nextPlan = planForCurrentGroups(fixture.repo);
    const ready = await previewDuplicateResolveSafely(fixture.repo, fixture.queue, nextPlan);
    expect(ready.status).toBe("ready");
  });

  it("keeps the final per-file version check and skips a changed delete target", async () => {
    const fixture = await createDuplicateFixture();
    await setModifiedAt(fixture.deleteVideo.path, "2026-07-19T00:00:00.000Z");
    const deleteFile = vi.fn(async () => undefined);

    const execution = await resolveDuplicatePlanSafely(fixture.repo, fixture.plan, deleteFile);

    expect(execution.result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await readFile(fixture.deleteVideo.path)).toHaveLength(16);
  });
});

async function createDuplicateFixture(preferredDirectoryPlan = false) {
  db = createDatabase(path.join(tempDir, "library.sqlite"));
  const repo = new VideoRepository(db);
  const preferredDirectory = path.join(tempDir, "preferred");
  const outsideDirectory = path.join(tempDir, "outside");
  await mkdir(preferredDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });
  const source = repo.addSourceFolder(tempDir, true);
  const keepVideo = await createVideo(repo, source.id, path.join(preferredDirectory, "keep.mp4"), 1);
  const deleteVideo = await createVideo(repo, source.id, path.join(outsideDirectory, "delete.mp4"), 2);
  const page = repo.listDuplicateGroupsPage({
    page: 1,
    pageSize: 20,
    sortDirection: "desc",
    preferredDirectoryPath: preferredDirectoryPlan ? preferredDirectory : undefined,
    preferredDirectoryScope: "recursive"
  });
  const group = page.groups[0];
  const plan: DuplicateResolvePlan = {
    groups: [{ groupKey: group.groupKey, keepVideoId: keepVideo.id, deleteVideoIds: [deleteVideo.id] }]
  };
  const queue = { enqueue: vi.fn(() => true) };
  return { repo, keepVideo, deleteVideo, plan, queue };
}

async function createVideo(repo: VideoRepository, sourceFolderId: string, filePath: string, fill: number): Promise<VideoRecord> {
  await writeFile(filePath, Buffer.alloc(16, fill));
  await setModifiedAt(filePath, "2026-07-09T00:00:00.000Z");
  const info = await stat(filePath);
  const parsed = path.parse(filePath);
  return repo.upsertVideo({
    sourceFolderId,
    path: filePath,
    directory: parsed.dir,
    filename: parsed.base,
    basename: parsed.name,
    extension: parsed.ext,
    sizeBytes: info.size,
    durationMs: 5000,
    width: 1920,
    height: 1080,
    format: "mp4",
    modifiedAt: info.mtime.toISOString()
  });
}

async function setModifiedAt(filePath: string, iso: string): Promise<void> {
  const time = new Date(iso);
  await utimes(filePath, time, time);
}

function listDuplicateGroups(repo: VideoRepository) {
  return repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups;
}

function planForCurrentGroups(repo: VideoRepository): DuplicateResolvePlan {
  const group = listDuplicateGroups(repo)[0];
  return {
    groups: [{
      groupKey: group.groupKey,
      keepVideoId: group.recommendedKeepVideoId,
      deleteVideoIds: group.items.map((item) => item.video.id).filter((id) => id !== group.recommendedKeepVideoId)
    }]
  };
}
