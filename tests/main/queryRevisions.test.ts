// @vitest-environment node
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { QueryRevisionMonitor, withCleanupRevisionBatch } from "../../src/main/db/queryRevisions";
import { VideoRepository, type DuplicatePageRankingCache } from "../../src/main/db/videoRepository";
import { DuplicateCleanupRepository } from "../../src/main/db/duplicateCleanupRepository";
import { writeCleanupPreparationStage } from "../../src/main/db/cleanupPreparationStage";

let directory = "";
let writer: Database.Database | undefined;
let reader: Database.Database | undefined;
afterEach(() => {
  reader?.close(); writer?.close(); reader = undefined; writer = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

function fixture() {
  directory = mkdtempSync(path.join(os.tmpdir(), "query-revisions-"));
  const databasePath = path.join(directory, "library.sqlite");
  writer = createDatabase(databasePath);
  const repo = new VideoRepository(writer);
  const source = repo.addSourceFolder(path.join(directory, "unopened-videos"), true);
  const video = repo.upsertVideo({ sourceFolderId: source.id, path: path.join(source.path, "cached.mp4"),
    directory: source.path, filename: "cached.mp4", basename: "cached", extension: ".mp4", sizeBytes: 100,
    durationMs: 10000, width: 1920, height: 1080, format: "mp4", modifiedAt: "2026-10-05T00:00:00.000Z" });
  reader = new Database(databasePath, { readonly: true });
  const monitor = new QueryRevisionMonitor(reader);
  expect(monitor.refresh().unknown).toBe(true);
  return { repo, source, video, monitor };
}

describe("transactional query revisions", () => {
  it("atomically admits staged plans, rejects stale versions and reservations, and is idempotent", () => {
    const { repo, video, monitor } = fixture();
    const copy = repo.upsertVideo({ ...video, path: path.join(video.directory, "staged.mp4"), filename: "staged.mp4", basename: "staged",
      providerFileId: "staged-copy", providerPath: "/staged/copy.mp4" });
    const entries = repo.validateDuplicateResolvePlan({ groups: [{ groupKey: `size-duration:${video.sizeBytes}:${video.durationMs}`,
      keepVideoId: video.id, deleteVideoIds: [copy.id] }] });
    const stagePath = path.join(directory, "plan.sqlite");
    writeCleanupPreparationStage(stagePath, entries);
    const jobs = new DuplicateCleanupRepository(writer!, repo);
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    repo.markMissing(copy.id, true);
    expect(() => jobs.submitFastStaged({ requestId: "stale-stage" }, stagePath)).toThrow("changed during preparation");
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    repo.markMissing(copy.id, false); monitor.refresh();
    const accepted = jobs.submitFastStaged({ requestId: "stage" }, stagePath);
    expect(accepted.totalItems).toBe(1);
    expect(monitor.refresh().changed).toEqual(new Set(["all", "cleanup", "tasks"]));
    expect(jobs.submitFastStaged({ requestId: "stage" }, stagePath)).toEqual(accepted);
    expect(() => jobs.submitFastStaged({ requestId: "conflict-stage" }, stagePath)).toThrow("reserved");
    expect(jobs.listJobs(1, 20).totalItems).toBe(1);
    expect(jobs.getJob(accepted.jobId)).toMatchObject({ workflowVersion: 3, phase: "deletion", status: "queued" });
    expect((writer!.prepare("PRAGMA database_list").all() as { name: string }[]).some((db) => db.name === "cleanup_preparation")).toBe(false);
  });
  it("rolls back every SQL batch when a late reservation insert fails", () => {
    const { repo, video, monitor } = fixture();
    const copies = Array.from({ length: 120 }, (_, index) => repo.upsertVideo({ ...video,
      path: path.join(video.directory, `copy-${index}.mp4`), filename: `copy-${index}.mp4`, basename: `copy-${index}`,
      providerFileId: `synthetic-${index}`, providerPath: `/synthetic/copy-${index}.mp4` }));
    const entries = repo.validateDuplicateResolvePlan({ groups: [{ groupKey: `size-duration:${video.sizeBytes}:${video.durationMs}`,
      keepVideoId: video.id, deleteVideoIds: copies.map((copy) => copy.id) }] });
    writer!.exec(`CREATE TRIGGER synthetic_late_failure BEFORE INSERT ON duplicate_cleanup_reservations
      WHEN NEW.video_id = '${copies.at(-1)!.id}' BEGIN SELECT RAISE(ABORT, 'synthetic late failure'); END`);
    monitor.refresh();
    const jobs = new DuplicateCleanupRepository(writer!, repo);
    expect(() => jobs.submitFastPrepared({ requestId: "late-failure" }, entries)).toThrow("synthetic late failure");
    const stagePath = path.join(directory, "late-plan.sqlite");
    writeCleanupPreparationStage(stagePath, entries);
    expect(() => jobs.submitFastStaged({ requestId: "late-staged-failure" }, stagePath)).toThrow("synthetic late failure");
    for (const table of ["duplicate_cleanup_jobs", "duplicate_cleanup_items", "duplicate_cleanup_reservations"]) {
      expect((writer!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(0);
    }
    expect((writer!.prepare("SELECT batch_mask FROM query_cache_revisions").get() as { batch_mask: number }).batch_mask).toBe(0);
    expect(monitor.refresh().changed.size).toBe(0);
  });
  it("separates task progress from candidate reservations", () => {
    const { repo, video, monitor } = fixture();
    const duplicate = repo.upsertVideo({ ...video, path: path.join(video.directory, "copy.mp4"), filename: "copy.mp4", basename: "copy",
      providerFileId: "synthetic-copy", providerPath: "/synthetic/copy.mp4" });
    const entries = repo.validateDuplicateResolvePlan({ groups: [{ groupKey: `size-duration:${video.sizeBytes}:${video.durationMs}`, keepVideoId: video.id, deleteVideoIds: [duplicate.id] }] });
    const jobs = new DuplicateCleanupRepository(writer!, repo);
    const accepted = jobs.submitFastPrepared({ requestId: "progress" }, entries);
    monitor.refresh();
    expect(jobs.start(accepted.jobId)).toBe(true);
    expect(monitor.refresh().changed).toEqual(new Set(["all", "tasks"]));
    writer!.prepare("UPDATE duplicate_cleanup_reservations SET released_at = ? WHERE job_id = ?").run("2026-10-05", accepted.jobId);
    expect(monitor.refresh().changed).toEqual(new Set(["all", "cleanup"]));
    expect(() => withCleanupRevisionBatch(writer!, () => undefined)).toThrow("atomic transaction");
    expect(() => writer!.transaction(() => withCleanupRevisionBatch(writer!, () => {
      writer!.prepare("UPDATE duplicate_cleanup_jobs SET processed_items = 1 WHERE id = ?").run(accepted.jobId);
      expect(monitor.refresh().changed.size).toBe(0);
      throw new Error("rollback admission");
    }))()).toThrow("rollback admission");
    expect(monitor.refresh().changed.size).toBe(0);
    expect((writer!.prepare("SELECT batch_mask FROM query_cache_revisions").get() as { batch_mask: number }).batch_mask).toBe(0);
  });
  it("reuses duplicate rankings across pages but reads current image data for the page", () => {
    const { repo, video } = fixture();
    for (let group = 0; group < 25; group += 1) for (let item = 0; item < 2; item += 1) {
      const name = `group-${group}-${item}.mp4`;
      repo.upsertVideo({ ...video, path: path.join(video.directory, name), filename: name, basename: name.slice(0, -4), sizeBytes: 1000 + group });
    }
    const cache: DuplicatePageRankingCache = {};
    const query = { page: 1, pageSize: 20, sortField: "duplicateCount", sortDirection: "desc" } as const;
    const first = repo.listDuplicateGroupsPage(query, cache);
    expect(first).toEqual(repo.listDuplicateGroupsPage(query));
    const ranking = cache.identities;
    expect(repo.listDuplicateGroupsPage({ ...query, page: 2 }, cache)).toEqual(repo.listDuplicateGroupsPage({ ...query, page: 2 }));
    expect(cache.identities).toBe(ranking);
    const shown = first.groups[0]!.items[0]!.video;
    repo.markThumbnailReady(shown.id, "fresh-image.jpg");
    const refreshed = repo.listDuplicateGroupsPage(query, cache);
    expect(refreshed.groups[0]!.items.find((item) => item.video.id === shown.id)!.video.coverCachePath).toBe("fresh-image.jpg");
  });
  it("distinguishes history and image writes from library changes across connections", () => {
    const { repo, video, monitor } = fixture();
    repo.recordPlayback(video.id, 1000);
    repo.recordPlayback(video.id, 2000);
    repo.markThumbnailReady(video.id, "cached-cover.jpg");
    const unrelated = monitor.refresh();
    expect(unrelated.unknown).toBe(false);
    expect(unrelated.changed).toEqual(new Set(["all", "playback", "images"]));
    writer!.prepare("UPDATE videos SET size_bytes = 200 WHERE id = ?").run(video.id);
    expect(monitor.refresh().changed).toEqual(new Set(["all", "library"]));
    expect(monitor.refresh().changed.size).toBe(0);
  });

  it("does not lose a simultaneous library update among unrelated writes and rolls counters back", () => {
    const { repo, video, monitor } = fixture();
    writer!.transaction(() => {
      repo.recordPlayback(video.id, 1);
      writer!.prepare("UPDATE videos SET is_missing = 1 WHERE id = ?").run(video.id);
    })();
    expect(monitor.refresh().changed).toEqual(new Set(["all", "library", "playback"]));
    expect(() => writer!.transaction(() => {
      writer!.prepare("UPDATE videos SET size_bytes = 333 WHERE id = ?").run(video.id);
      throw new Error("rollback");
    })()).toThrow("rollback");
    expect(monitor.refresh().changed.size).toBe(0);
  });

  it("falls back after unexpected schema writes or removed tracking triggers", () => {
    const { monitor, video } = fixture();
    writer!.exec("CREATE TABLE unexpected_writer (value INTEGER)");
    expect(monitor.refresh().unknown).toBe(true);
    writer!.exec("INSERT INTO unexpected_writer VALUES (1)");
    expect(monitor.refresh().unknown).toBe(true);
    writer!.exec("DROP TRIGGER query_revision_videos_update");
    expect(monitor.refresh().unknown).toBe(true);
    writer!.prepare("UPDATE videos SET size_bytes = 444 WHERE id = ?").run(video.id);
    expect(monitor.refresh().unknown).toBe(true);
  });
});
