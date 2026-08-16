// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseConnection } from "../../src/main/db/database";
import { createDatabase } from "../../src/main/db/database";
import { DuplicateCleanupRepository } from "../../src/main/db/duplicateCleanupRepository";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { DuplicateCleanupService } from "../../src/main/media/duplicateCleanupService";
import { buildFullContentHash } from "../../src/main/media/contentFingerprint";
import type { DuplicateResolvePlan, VideoRecord } from "../../src/shared/videoTypes";

describe("full SHA-256 duplicate cleanup authorization", () => {
  let tempDir = "";
  let db: DatabaseConnection | undefined;
  afterEach(async () => { db?.close(); db = undefined; if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

  it("submits metadata-only and does not read any file content until the independent verifier runs", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const hashFile = vi.fn(async () => "a".repeat(64));

    const accepted = jobs.submit({ requestId: "metadata-only", plan });
    const repeated = jobs.submit({ requestId: "metadata-only", plan });

    expect(hashFile).not.toHaveBeenCalled();
    expect(repeated.jobId).toBe(accepted.jobId);
    expect(jobs.getJob(accepted.jobId)).toMatchObject({ workflowVersion: 2, phase: "verification", status: "queued" });
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0]).toMatchObject({ verificationStatus: "pending" });
  });

  it("never deletes after successful verification until a separate exact confirmation authorizes it", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile, hashFile: async () => "a".repeat(64) });

    const accepted = service.submit({ requestId: "two-stage", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    expect(verified).toMatchObject({ identicalItems: 1, differentItems: 0, unverifiableItems: 0 });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(() => service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "delete" as "DELETE" })).toThrow();

    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const completed = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    expect(completed).toMatchObject({ status: "completed", successItems: 1 });
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("classifies same-metadata different content and gives it zero deletion authorization", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, false);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });

    const accepted = service.submit({ requestId: "different", plan });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ identicalItems: 0, differentItems: 1, unverifiableItems: 0, status: "completed_with_errors" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(() => jobs.authorizeDeletion({ jobId: accepted.jobId, verificationRevision: finished.verificationRevision!, confirmation: "DELETE" })).toThrow();
    service.stop();
  });

  it("classifies read failures as unverifiable and deletes nothing", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile, hashFile: vi.fn().mockRejectedValue(Object.assign(new Error("offline"), { code: "EIO" })) });

    const accepted = service.submit({ requestId: "unverifiable", plan });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ identicalItems: 0, unverifiableItems: 1 });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("aborts in-flight verification separately and guarantees zero deletion", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    let hashingStarted = false;
    const hashFile = vi.fn((_filePath: string, signal?: AbortSignal) => new Promise<string>((_resolve, reject) => {
      hashingStarted = true;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { hashFile, deleteFile });

    const accepted = service.submit({ requestId: "cancel-verification", plan });
    await waitUntil(() => hashingStarted);
    service.cancel(accepted.jobId);
    const cancelled = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(cancelled.status).toBe("cancelled");
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0]).toMatchObject({ verificationStatus: "cancelled" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("blocks deletion when either bound file version changes after verification", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "stale-after-hash", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    await utimes(keepVideo.path, new Date("2026-07-20T00:00:00Z"), new Date("2026-07-20T00:00:00Z"));

    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ successItems: 0, skippedItems: 1, status: "completed_with_errors" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("blocks a same-size same-mtime content replacement after verification", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "same-version-content-replacement", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");

    await writeFile(deleteVideo.path, Buffer.alloc(64, 2));
    const originalTime = new Date("2026-07-09T00:00:00.000Z");
    await utimes(deleteVideo.path, originalTime, originalTime);
    expect(await stat(deleteVideo.path)).toMatchObject({
      size: deleteVideo.sizeBytes,
      mtime: new Date(deleteVideo.modifiedAt)
    });

    service.confirm({
      jobId: accepted.jobId,
      verificationRevision: verified.verificationRevision!,
      confirmation: "DELETE"
    });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ successItems: 0, skippedItems: 1, status: "completed_with_errors" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("blocks a same-size same-mtime replacement of the kept file after verification", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "keep-content-replacement", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    await writeFile(keepVideo.path, Buffer.alloc(64, 2));
    await utimes(keepVideo.path, new Date(keepVideo.modifiedAt), new Date(keepVideo.modifiedAt));

    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    expect(finished).toMatchObject({ successItems: 0, skippedItems: 1, status: "completed_with_errors" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("detects a target path swap in the check-to-delete window after the pre-delete hash", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const renameFile = vi.fn(async (source: string, destination: string) => {
      await writeFile(source, Buffer.alloc(64, 8));
      await utimes(source, new Date(deleteVideo.modifiedAt), new Date(deleteVideo.modifiedAt));
      await rename(source, destination);
    });
    const service = createService(jobs, repo, { deleteFile, renameFile });
    const accepted = service.submit({ requestId: "path-swap-window", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ successItems: 0, skippedItems: 1, status: "completed_with_errors" });
    expect(renameFile).toHaveBeenCalledTimes(2);
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();
    service.stop();
  });

  it("restores the isolated target when the kept file changes immediately before deletion", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    let hashCalls = 0;
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { deleteFile, hashFile: async (filePath, signal) => {
      hashCalls += 1;
      const result = await buildFullContentHash(filePath, signal);
      if (hashCalls === 5) {
        await writeFile(keepVideo.path, Buffer.alloc(64, 6));
        await utimes(keepVideo.path, new Date(keepVideo.modifiedAt), new Date(keepVideo.modifiedAt));
      }
      return result;
    } });
    const accepted = service.submit({ requestId: "keep-final-race", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ successItems: 0, skippedItems: 1, status: "completed_with_errors" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();
    service.stop();
  });

  it("keeps verification cancellation distinct from stopping only remaining authorized deletions", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const directory = path.join(tempDir, "videos");
    await mkdir(directory, { recursive: true });
    const folder = repo.addSourceFolder(directory, true);
    const keep = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1);
    const deleteOne = await createVideo(repo, folder.id, path.join(directory, "delete-one.mp4"), 1);
    const deleteTwo = await createVideo(repo, folder.id, path.join(directory, "delete-two.mp4"), 1);
    const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0];
    const plan: DuplicateResolvePlan = { groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [deleteOne.id, deleteTwo.id] }] };
    const jobs = new DuplicateCleanupRepository(db, repo);
    let releaseDelete: () => void = () => undefined;
    const deleteFile = vi.fn(async (filePath: string) => {
      await new Promise<void>((resolve) => { releaseDelete = resolve; });
      await rm(filePath, { force: true });
    });
    const service = createService(jobs, repo, { deleteFile, hashFile: async () => "a".repeat(64) });
    const accepted = service.submit({ requestId: "stop-remaining", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    await waitUntil(() => deleteFile.mock.calls.length === 1);

    expect(service.cancel(accepted.jobId)).toMatchObject({ status: "cancelling", phase: "deletion" });
    releaseDelete();
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ status: "cancelled", successItems: 1, skippedItems: 1 });
    expect(jobs.listItems(accepted.jobId, 1, 20).items.map((item) => item.status).sort()).toEqual(["cancelled", "deleted"]);
    expect((await stat(deleteTwo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("retry after a delete failure requires a new full verification revision and another confirmation", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EBUSY" }))
      .mockImplementation(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile, hashFile: async () => "a".repeat(64) });
    const accepted = service.submit({ requestId: "retry-reverify", plan });
    const firstVerification = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: firstVerification.verificationRevision!, confirmation: "DELETE" });
    const failed = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    expect(failed).toMatchObject({ status: "completed_with_errors", failedItems: 1 });
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();

    const retrying = service.retry(accepted.jobId);
    expect(retrying).toMatchObject({ phase: "verification", status: "queued", authorizedRevision: null });
    expect(retrying.verificationRevision).not.toBe(firstVerification.verificationRevision);
    const reverified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    service.confirm({ jobId: accepted.jobId, verificationRevision: reverified.verificationRevision!, confirmation: "DELETE" });
    expect(await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished")).toMatchObject({ status: "completed", successItems: 1 });
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("invalidates queued deletion authorization across restart and resume requires a new full verification revision", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const verifier = createService(jobs, repo);
    const accepted = verifier.submit({ requestId: "restart", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    verifier.stop();
    jobs.authorizeDeletion({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const oldRevision = verified.verificationRevision;

    const restarted = createService(jobs, repo);
    expect(jobs.getJob(accepted.jobId)).toMatchObject({ status: "interrupted", phase: "deletion", authorizedRevision: null });
    const resumed = jobs.resume(accepted.jobId);
    expect(resumed).toMatchObject({ status: "queued", phase: "verification", authorizedRevision: null });
    expect(resumed.verificationRevision).not.toBe(oldRevision);
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    restarted.stop();
  });

  it("rejects direct authorization without a successful fresh full hash", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    expect(() => jobs.assertGenericPermanentDeleteAllowed([deleteVideo.id])).toThrow(/full SHA-256 verification/);
    const accepted = jobs.submit({ requestId: "direct-bypass", plan });
    const job = jobs.getJob(accepted.jobId);

    expect(() => jobs.authorizeDeletion({ jobId: job.id, verificationRevision: job.verificationRevision!, confirmation: "DELETE" })).toThrow(/not awaiting|missing|stale/i);
    expect(() => jobs.claimDeletionItem(job.id, jobs.listItems(job.id, 1, 20).items[0].id)).not.toThrow();
    expect(jobs.claimDeletionItem(job.id, jobs.listItems(job.id, 1, 20).items[0].id)).toBe(false);
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
  });

  it("accepts a 500-item database-only plan without reading file contents", async () => {
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
    const accepted = jobs.submit({ requestId: "bulk-500", plan: { groups: [{ groupKey: group.groupKey,
      keepVideoId: videos[0].id, deleteVideoIds: videos.slice(1).map((video) => video.id) }] } });

    expect(accepted.totalItems).toBe(500);
    expect(jobs.listItems(accepted.jobId, 1, 500).items).toHaveLength(500);
  });

  it("serializes multiple verification jobs instead of hashing them in parallel", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const plans: DuplicateResolvePlan[] = [];
    for (const [name, sizeBytes] of [["first", 64], ["second", 128]] as const) {
      const directory = path.join(tempDir, name);
      await mkdir(directory, { recursive: true });
      const folder = repo.addSourceFolder(directory, true);
      const keep = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1, sizeBytes);
      const target = await createVideo(repo, folder.id, path.join(directory, "delete.mp4"), 1, sizeBytes);
      const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups
        .find((candidate) => candidate.items.some((item) => item.video.id === target.id))!;
      plans.push({ groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [target.id] }] });
    }
    const jobs = new DuplicateCleanupRepository(db, repo);
    let activeHashes = 0;
    let maxConcurrentHashes = 0;
    const service = createService(jobs, repo, { hashFile: async (filePath, signal) => {
      activeHashes += 1;
      maxConcurrentHashes = Math.max(maxConcurrentHashes, activeHashes);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const hash = await buildFullContentHash(filePath, signal);
      activeHashes -= 1;
      return hash;
    } });
    const first = service.submit({ requestId: "serial-first", plan: plans[0] });
    const second = service.submit({ requestId: "serial-second", plan: plans[1] });

    await waitFor(jobs, first.jobId, (job) => job.phase === "awaiting_confirmation");
    await waitFor(jobs, second.jobId, (job) => job.phase === "awaiting_confirmation");
    expect(maxConcurrentHashes).toBe(1);
    service.stop();
  });

  it("clears terminal records but refuses to clear active tasks", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const service = createService(jobs, repo);
    const accepted = jobs.submit({ requestId: "terminal-clear", plan });

    expect(() => jobs.clear(accepted.jobId)).toThrow(/Active tasks/);
    expect(service.cancel(accepted.jobId)).toMatchObject({ status: "cancelled", phase: "finished" });
    expect(jobs.clear(accepted.jobId)).toBe(true);
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    service.stop();
  });

  it.each([
    ["hash mismatch", async (filePath: string) => `${await buildFullContentHash(filePath)}0`],
    ["read failure", async () => { throw Object.assign(new Error("offline during isolated hash"), { code: "EIO" }); }]
  ])("restores the original path when isolated target %s", async (_label, isolatedResult) => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    let hashCalls = 0;
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { deleteFile, hashFile: async (filePath, signal) => {
      hashCalls += 1;
      if (hashCalls === 5) return isolatedResult(filePath);
      return buildFullContentHash(filePath, signal);
    } });
    const accepted = service.submit({ requestId: `isolated-${_label}`, plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ successItems: 0, status: "completed_with_errors" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();
    service.stop();
  });

  it("restores an isolated target when deletion is cancelled before the irreversible call", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    let hashCalls = 0;
    let releaseIsolatedHash: () => void = () => undefined;
    const isolatedHashReached = new Promise<void>((resolve) => { releaseIsolatedHash = resolve; });
    let continueHash: () => void = () => undefined;
    const service = createService(jobs, repo, { deleteFile: vi.fn(), hashFile: async (filePath, signal) => {
      hashCalls += 1;
      if (hashCalls === 5) {
        releaseIsolatedHash();
        await new Promise<void>((resolve) => { continueHash = resolve; });
      }
      return buildFullContentHash(filePath, signal);
    } });
    const accepted = service.submit({ requestId: "cancel-isolated", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    await isolatedHashReached;
    service.cancel(accepted.jobId);
    continueHash();
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ status: "cancelled", successItems: 0 });
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();
    service.stop();
  });

  it("fails closed without deleting when same-volume isolation rename fails", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { deleteFile,
      renameFile: vi.fn().mockRejectedValue(Object.assign(new Error("SMB rename unavailable"), { code: "EXDEV" })) });
    const accepted = service.submit({ requestId: "rename-failure", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ status: "completed_with_errors", successItems: 0, failedItems: 1 });
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();
    service.stop();
  });

  it("preserves a recoverable staged path when the original path becomes occupied", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const service = createService(jobs, repo, { deleteFile: async () => {
      await writeFile(deleteVideo.path, Buffer.alloc(64, 9));
      throw Object.assign(new Error("locked after replacement"), { code: "EBUSY" });
    } });
    const accepted = service.submit({ requestId: "occupied-restore", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    const item = jobs.listItems(accepted.jobId, 1, 20).items[0];

    expect(item).toMatchObject({ status: "failed", outcomeCode: "EBUSY" });
    expect(item.stagedDeletePath).toMatch(/movie-delete/);
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect((await stat(item.stagedDeletePath!)).isFile()).toBe(true);
    expect(() => jobs.clear(accepted.jobId)).toThrow(/recoverable isolated file/);
    service.stop();
  });

  it("recovers a persisted isolated target on startup and forces re-verification", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const verifier = createService(jobs, repo);
    const accepted = verifier.submit({ requestId: "startup-recovery", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    verifier.stop();
    jobs.authorizeDeletion({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    expect(jobs.start(accepted.jobId)).toBe(true);
    const item = jobs.listDeletionWorkItems(accepted.jobId)[0];
    const stagedPath = path.join(path.dirname(deleteVideo.path), ".startup-recovery-stage");
    expect(jobs.prepareIsolation(accepted.jobId, item.id, stagedPath)).toBe(true);
    await rename(deleteVideo.path, stagedPath);

    const restarted = createService(jobs, repo);
    await waitUntil(async () => (await pathExists(deleteVideo.path)) && !(await pathExists(stagedPath)));
    expect(jobs.getJob(accepted.jobId)).toMatchObject({ status: "interrupted", authorizedRevision: null });
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].stagedDeletePath).toBeNull();
    const resumed = restarted.resume(accepted.jobId);
    expect(resumed).toMatchObject({ phase: "verification", status: "queued" });
    restarted.stop();
  });

  it("keeps persisted recovery evidence when restart finds the original path occupied", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const verifier = createService(jobs, repo);
    const accepted = verifier.submit({ requestId: "startup-conflict", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    verifier.stop();
    jobs.authorizeDeletion({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    expect(jobs.start(accepted.jobId)).toBe(true);
    const item = jobs.listDeletionWorkItems(accepted.jobId)[0];
    const stagedPath = path.join(path.dirname(deleteVideo.path), ".startup-conflict-stage");
    expect(jobs.prepareIsolation(accepted.jobId, item.id, stagedPath)).toBe(true);
    await rename(deleteVideo.path, stagedPath);
    await writeFile(deleteVideo.path, Buffer.alloc(64, 7));

    const restarted = createService(jobs, repo);
    await waitUntil(() => jobs.listItems(accepted.jobId, 1, 20).items[0].outcomeCode === "isolation-recovery-required");
    const recovered = jobs.listItems(accepted.jobId, 1, 20).items[0];
    expect(recovered.stagedDeletePath).toBe(stagedPath);
    expect(recovered.message).toMatch(/Original path is occupied/);
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect((await stat(stagedPath)).isFile()).toBe(true);
    expect(() => restarted.resume(accepted.jobId)).toThrow(/isolated file still requires recovery/);
    restarted.stop();
  });
});

async function fixtureRoot() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "duplicate-cleanup-"));
  return { tempDir, db: createDatabase(path.join(tempDir, "library.sqlite")) };
}

async function duplicateFixture(db: DatabaseConnection, tempDir: string, identical: boolean) {
  const repo = new VideoRepository(db);
  const directory = path.join(tempDir, "videos");
  await mkdir(directory, { recursive: true });
  const folder = repo.addSourceFolder(directory, true);
  const keepVideo = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1);
  const deleteVideo = await createVideo(repo, folder.id, path.join(directory, "delete.mp4"), identical ? 1 : 2);
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

function createService(jobs: DuplicateCleanupRepository, repo: VideoRepository, options: {
  deleteFile?: (filePath: string) => Promise<void>;
  hashFile?: (filePath: string, signal?: AbortSignal) => Promise<string>;
  renameFile?: (source: string, destination: string) => Promise<void>;
} = {}) {
  return new DuplicateCleanupService(jobs, repo, { enqueue: vi.fn(() => true) } as never,
    { scheduleMaintenance: vi.fn() } as never, { publish: vi.fn() } as never, options);
}

async function waitFor(jobs: DuplicateCleanupRepository, jobId: string, predicate: (job: ReturnType<DuplicateCleanupRepository["getJob"]>) => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = jobs.getJob(jobId);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("cleanup job did not reach expected state");
}

async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!(await condition())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}
