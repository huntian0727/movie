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

async function createVideo(repo: VideoRepository, sourceFolderId: string, filePath: string, fill: number): Promise<VideoRecord> {
  await writeFile(filePath, Buffer.alloc(64, fill));
  const time = new Date("2026-07-09T00:00:00.000Z");
  await utimes(filePath, time, time);
  const info = await stat(filePath);
  const parsed = path.parse(filePath);
  return repo.upsertVideo({ sourceFolderId, path: filePath, directory: parsed.dir, filename: parsed.base, basename: parsed.name,
    extension: parsed.ext, sizeBytes: info.size, durationMs: 5000, width: 1920, height: 1080, format: "mp4", modifiedAt: info.mtime.toISOString() });
}

function createService(jobs: DuplicateCleanupRepository, repo: VideoRepository) {
  return new DuplicateCleanupService(
    jobs,
    repo,
    { enqueue: vi.fn(() => true) } as never,
    { scheduleMaintenance: vi.fn() } as never,
    { publish: vi.fn() } as never
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
