import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseConnection } from "../../src/main/db/database";
import { createDatabase } from "../../src/main/db/database";
import { DuplicateCleanupRepository } from "../../src/main/db/duplicateCleanupRepository";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { DuplicateCleanupService } from "../../src/main/media/duplicateCleanupService";
import type { DuplicateResolvePlan, VideoRecord } from "../../src/shared/videoTypes";

describe("durable duplicate cleanup jobs", () => {
  let tempDir = "";
  let db: DatabaseConnection | undefined;
  afterEach(async () => { db?.close(); db = undefined; if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

  it("reserves the complete group transactionally and treats request ids idempotently", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const request = { requestId: "same-request", plan, sourceView: "duplicates" };

    const first = jobs.submit(request);
    const second = jobs.submit(request);

    expect(second.jobId).toBe(first.jobId);
    expect(jobs.listJobs(1, 20)).toMatchObject({ totalItems: 1, activeCount: 1 });
    expect(repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).totalGroups).toBe(0);
    expect(() => jobs.assertVideosAvailable(plan.groups.flatMap((group) => [group.keepVideoId, ...group.deleteVideoIds]))).toThrow(/后台清理任务/);
  });

  it("does the slow validation and irreversible delete after accepting the job", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const service = createService(jobs, repo);

    const accepted = service.submit({ requestId: "delete-in-background", plan });
    expect(accepted.status).toBe("queued");
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed).toMatchObject({ status: "completed", successItems: 1, failedItems: 0 });
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => repo.getVideo(deleteVideo.id)).toThrow(/not found/i);
    service.stop();
  });

  it("blocks the whole group if the kept file changed and deletes nothing", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const accepted = jobs.submit({ requestId: "keep-changed", plan });
    await utimes(keepVideo.path, new Date("2026-07-20T00:00:00Z"), new Date("2026-07-20T00:00:00Z"));
    jobs.interruptActiveJobs();
    const service = createService(jobs, repo);
    service.resume(accepted.jobId);
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed).toMatchObject({ status: "completed_with_errors", successItems: 0, skippedItems: 1 });
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("skips a changed delete item, refreshes metadata state and never deletes it", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const accepted = jobs.submit({ requestId: "delete-changed", plan });
    await utimes(deleteVideo.path, new Date("2026-07-21T00:00:00Z"), new Date("2026-07-21T00:00:00Z"));
    jobs.interruptActiveJobs();
    const service = createService(jobs, repo);
    service.resume(accepted.jobId);
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed).toMatchObject({ status: "completed_with_errors", successItems: 0, skippedItems: 1 });
    expect(repo.getVideo(deleteVideo.id).metadataStatus).toBe("pending");
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("accepts a 500-item database-only plan without touching file contents", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const folder = repo.addSourceFolder(tempDir, true);
    const videos: VideoRecord[] = [];
    for (let index = 0; index <= 500; index += 1) {
      const filePath = path.join(tempDir, `bulk-${index}.mp4`);
      videos.push(repo.upsertVideo({ sourceFolderId: folder.id, path: filePath, directory: tempDir,
        filename: path.basename(filePath), basename: `bulk-${index}`, extension: ".mp4", sizeBytes: 1024,
        durationMs: 60000, width: 1920, height: 1080, format: "mp4", modifiedAt: "2026-07-09T00:00:00.000Z" }));
    }
    const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0];
    const jobs = new DuplicateCleanupRepository(db, repo);
    const startedAt = performance.now();
    const accepted = jobs.submit({ requestId: "bulk-500", plan: { groups: [{ groupKey: group.groupKey, keepVideoId: videos[0].id, deleteVideoIds: videos.slice(1).map((video) => video.id) }] } });

    expect(accepted.totalItems).toBe(500);
    expect(performance.now() - startedAt).toBeLessThan(2500);
  });

  it("cancels a queued job immediately without deleting anything", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const service = createService(jobs, repo);

    const accepted = service.submit({ requestId: "cancel-queued", plan });
    const cancelled = service.cancel(accepted.jobId);

    expect(cancelled.status).toBe("cancelled");
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("waits for the in-flight delete before honouring a cancel", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    let releaseDelete: () => void = () => {};
    const deleteFile = vi.fn(async (filePath: string) => {
      await new Promise<void>((resolve) => { releaseDelete = resolve; });
      await rm(filePath, { force: true });
    });
    const service = createService(jobs, repo, { deleteFile });

    const accepted = service.submit({ requestId: "cancel-in-flight", plan });
    await waitUntil(() => deleteFile.mock.calls.length === 1);
    const cancelling = service.cancel(accepted.jobId);
    expect(cancelling.status).toBe("cancelling");

    releaseDelete();
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed.status).toBe("cancelled");
    expect(completed.successItems).toBe(1);
    expect(completed.failedItems).toBe(0);
    expect(completed.skippedItems).toBe(0);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("resumes an interrupted job and keeps processing pending items", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const accepted = jobs.submit({ requestId: "interrupt-resume", plan });

    jobs.interruptActiveJobs();
    expect(jobs.getJob(accepted.jobId).status).toBe("interrupted");

    const service = createService(jobs, repo);
    const resumed = service.resume(accepted.jobId);
    expect(resumed.status).toBe("queued");
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed.status).toBe("completed");
    expect(completed.successItems).toBe(1);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("marks a failed delete and retries only the failed item later", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EBUSY" }))
      .mockImplementation(async (filePath: string) => { await rm(filePath, { force: true }); });
    const service = createService(jobs, repo, { deleteFile });

    const accepted = service.submit({ requestId: "retry-failed", plan });
    const withErrors = await waitForTerminal(jobs, accepted.jobId);
    expect(withErrors.status).toBe("completed_with_errors");
    expect(withErrors.failedItems).toBe(1);
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);

    const retried = service.retry(accepted.jobId);
    expect(retried.status).toBe("queued");
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed.status).toBe("completed");
    expect(completed.successItems).toBe(1);
    expect(completed.failedItems).toBe(0);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("clears only terminal jobs and refuses to clear running ones", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan } = await duplicateFixture(db, tempDir);
    const jobs = new DuplicateCleanupRepository(db, repo);
    let releaseDelete: () => void = () => {};
    const deleteFile = vi.fn(async (filePath: string) => {
      await new Promise<void>((resolve) => { releaseDelete = resolve; });
      await rm(filePath, { force: true });
    });
    const service = createService(jobs, repo, { deleteFile });

    const running = service.submit({ requestId: "clear-running", plan });
    await waitUntil(() => deleteFile.mock.calls.length === 1);
    expect(() => jobs.clear(running.jobId)).toThrow(/进行中的任务不能清除/);

    releaseDelete();
    await waitForTerminal(jobs, running.jobId);
    expect(jobs.clear(running.jobId)).toBe(true);
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    service.stop();
  });

  it("runs multiple jobs serially, never in parallel", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const firstDir = path.join(tempDir, "first");
    const secondDir = path.join(tempDir, "second");
    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });
    const firstFolder = repo.addSourceFolder(firstDir, true);
    const secondFolder = repo.addSourceFolder(secondDir, true);
    const firstKeep = await createVideo(repo, firstFolder.id, path.join(firstDir, "keep.mp4"), 1);
    const firstDelete = await createVideo(repo, firstFolder.id, path.join(firstDir, "delete.mp4"), 2);
    const secondKeep = await createVideo(repo, secondFolder.id, path.join(secondDir, "keep.mp4"), 1, 128);
    const secondDelete = await createVideo(repo, secondFolder.id, path.join(secondDir, "delete.mp4"), 2, 128);
    const groups = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups;
    const firstGroup = groups.find((group) => group.items.some((item) => item.video.id === firstDelete.id))!;
    const secondGroup = groups.find((group) => group.items.some((item) => item.video.id === secondDelete.id))!;
    const jobs = new DuplicateCleanupRepository(db, repo);

    let activeDeletes = 0;
    let maxConcurrentDeletes = 0;
    const deleteFile = vi.fn(async (filePath: string) => {
      activeDeletes += 1;
      maxConcurrentDeletes = Math.max(maxConcurrentDeletes, activeDeletes);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await rm(filePath, { force: true });
      activeDeletes -= 1;
    });
    const service = createService(jobs, repo, { deleteFile });

    const first = service.submit({ requestId: "serial-1", plan: { groups: [{ groupKey: firstGroup.groupKey, keepVideoId: firstKeep.id, deleteVideoIds: [firstDelete.id] }] } });
    const second = service.submit({ requestId: "serial-2", plan: { groups: [{ groupKey: secondGroup.groupKey, keepVideoId: secondKeep.id, deleteVideoIds: [secondDelete.id] }] } });

    const firstDone = await waitForTerminal(jobs, first.jobId);
    const secondDone = await waitForTerminal(jobs, second.jobId);
    expect(firstDone.status).toBe("completed");
    expect(secondDone.status).toBe("completed");
    expect(maxConcurrentDeletes).toBe(1);
    service.stop();
  });

  it("keeps pending items cancelled instead of skipping the whole group when cancelled during keep inspection", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const directory = path.join(tempDir, "videos");
    await mkdir(directory, { recursive: true });
    const folder = repo.addSourceFolder(directory, true);
    const keep = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1);
    const deleteOne = await createVideo(repo, folder.id, path.join(directory, "delete-1.mp4"), 2);
    const deleteTwo = await createVideo(repo, folder.id, path.join(directory, "delete-2.mp4"), 3);
    const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0];
    const plan: DuplicateResolvePlan = { groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [deleteOne.id, deleteTwo.id] }] };
    const jobs = new DuplicateCleanupRepository(db, repo);
    let releaseDelete: () => void = () => {};
    const deleteFile = vi.fn(async (filePath: string) => {
      await new Promise<void>((resolve) => { releaseDelete = resolve; });
      await rm(filePath, { force: true });
    });
    const service = createService(jobs, repo, { deleteFile });

    const accepted = service.submit({ requestId: "cancel-during-keep", plan });
    await waitUntil(() => deleteFile.mock.calls.length === 1);
    service.cancel(accepted.jobId);
    releaseDelete();
    const completed = await waitForTerminal(jobs, accepted.jobId);

    expect(completed.status).toBe("cancelled");
    const items = jobs.listItems(accepted.jobId, 1, 20).items;
    expect(items.find((item) => item.deleteVideoId === deleteOne.id)?.status).toBe("deleted");
    expect(items.find((item) => item.deleteVideoId === deleteTwo.id)?.status).toBe("cancelled");
    expect((await stat(deleteTwo.path)).isFile()).toBe(true);
    service.stop();
  });
});

async function fixtureRoot() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "duplicate-cleanup-"));
  return { tempDir, db: createDatabase(path.join(tempDir, "library.sqlite")) };
}

async function duplicateFixture(db: DatabaseConnection, tempDir: string) {
  const repo = new VideoRepository(db);
  const directory = path.join(tempDir, "videos");
  await mkdir(directory, { recursive: true });
  const folder = repo.addSourceFolder(directory, true);
  const keepVideo = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1);
  const deleteVideo = await createVideo(repo, folder.id, path.join(directory, "delete.mp4"), 2);
  const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0];
  const plan: DuplicateResolvePlan = { groups: [{ groupKey: group.groupKey, keepVideoId: keepVideo.id, deleteVideoIds: [deleteVideo.id] }] };
  return { repo, plan, keepVideo, deleteVideo };
}

async function createVideo(repo: VideoRepository, sourceFolderId: string, filePath: string, fill: number, sizeBytes = 64): Promise<VideoRecord> {
  await writeFile(filePath, Buffer.alloc(sizeBytes, fill));
  const time = new Date("2026-07-09T00:00:00.000Z");
  await utimes(filePath, time, time);
  const info = await stat(filePath);
  const parsed = path.parse(filePath);
  return repo.upsertVideo({ sourceFolderId, path: filePath, directory: parsed.dir, filename: parsed.base, basename: parsed.name,
    extension: parsed.ext, sizeBytes: info.size, durationMs: 5000, width: 1920, height: 1080, format: "mp4", modifiedAt: info.mtime.toISOString() });
}

function createService(jobs: DuplicateCleanupRepository, repo: VideoRepository, options: { deleteFile?: (filePath: string) => Promise<void> } = {}) {
  return new DuplicateCleanupService(
    jobs,
    repo,
    { enqueue: vi.fn(() => true) } as never,
    { scheduleMaintenance: vi.fn() } as never,
    { publish: vi.fn() } as never,
    options
  );
}

async function waitForTerminal(jobs: DuplicateCleanupRepository, jobId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = jobs.getJob(jobId);
    if (["completed", "completed_with_errors", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("cleanup job did not finish");
}

async function waitUntil(condition: () => boolean, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
