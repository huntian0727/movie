// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { DatabaseConnection } from "../../src/main/db/database";
import { createDatabase } from "../../src/main/db/database";
import { DuplicateCleanupRepository } from "../../src/main/db/duplicateCleanupRepository";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { DuplicateCleanupService } from "../../src/main/media/duplicateCleanupService";
import type { DuplicateResolvePlan, VideoRecord } from "../../src/shared/videoTypes";

describe("size-duration duplicate cleanup authorization", () => {
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

  it("reserves keep and delete videos across overlapping cleanup plans and releases them after cancellation", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const secondDelete = await createVideo(repo, keepVideo.sourceFolderId,
      path.join(path.dirname(keepVideo.path), "delete-second.mp4"), 1, deleteVideo.sizeBytes);
    const groupKey = plan.groups[0]!.groupKey;
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "reservation-primary", plan });
    await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");

    const sharedKeepPlan: DuplicateResolvePlan = {
      groups: [{ groupKey, keepVideoId: keepVideo.id, deleteVideoIds: [secondDelete.id] }]
    };
    const sharedTargetAsKeepPlan: DuplicateResolvePlan = {
      groups: [{ groupKey, keepVideoId: deleteVideo.id, deleteVideoIds: [secondDelete.id] }]
    };
    const sharedTargetPlan: DuplicateResolvePlan = {
      groups: [{ groupKey, keepVideoId: secondDelete.id, deleteVideoIds: [deleteVideo.id] }]
    };

    expect(() => service.submit({ requestId: "reservation-shared-keep", plan: sharedKeepPlan })).toThrow(/reserved/);
    expect(() => service.submit({ requestId: "reservation-target-as-keep", plan: sharedTargetAsKeepPlan })).toThrow(/reserved/);
    expect(() => service.submit({ requestId: "reservation-shared-target", plan: sharedTargetPlan })).toThrow(/reserved/);
    expect(jobs.listJobs(1, 20).totalItems).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect((await stat(secondDelete.path)).isFile()).toBe(true);

    expect(service.cancel(accepted.jobId)).toMatchObject({ status: "cancelled", phase: "finished" });
    const replacement = service.submit({ requestId: "reservation-after-cancel", plan: sharedKeepPlan });
    expect(replacement.status).toBe("queued");
    await waitFor(jobs, replacement.jobId, (job) => job.phase === "awaiting_confirmation");
    service.cancel(replacement.jobId);
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    expect((await stat(secondDelete.path)).isFile()).toBe(true);
    service.stop();
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

  it("rejects legacy autoDeleteAfterVerification=true before creating any task or deleting files", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const hashFile = vi.fn(async () => "a".repeat(64));
    const service = createService(jobs, repo, { deleteFile, hashFile });

    expect(() => service.submit({ requestId: "verified-auto-delete", plan, autoDeleteAfterVerification: true })).toThrow(/旧自动清理参数已禁用/);
    expect(() => service.submit({ requestId: "verified-auto-delete", plan, autoDeleteAfterVerification: true })).toThrow();
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("rejects CloudDrive API fast deletion without hashing or removing any candidate", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    repo.setSourceFolderProvider(keepVideo.sourceFolderId, { type: "clouddrive", rootPath: "/115", name: "115" });
    expect(repo.updateVideoProviderIdentityIfVersion(keepVideo.id, keepVideo.path, keepVideo.sizeBytes, keepVideo.modifiedAt,
      { fileId: "remote-keep", path: "/115/keep.mp4" })).toBe(true);
    expect(repo.updateVideoProviderIdentityIfVersion(deleteVideo.id, deleteVideo.path, deleteVideo.sizeBytes, deleteVideo.modifiedAt,
      { fileId: "remote-delete", path: "/115/delete.mp4" })).toBe(true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const hashFile = vi.fn();
    const deleteCloudFiles = vi.fn().mockResolvedValue({ success: true, errorMessage: "", resultFilePaths: ["/115/delete.mp4"] });
    const service = createService(jobs, repo, { hashFile, deleteCloudFiles });

    expect(() => service.submit({ requestId: "cloud-fast-delete", plan, autoDeleteAfterVerification: true })).toThrow(/已禁用/);
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    expect(deleteCloudFiles).not.toHaveBeenCalled();
    expect(hashFile).not.toHaveBeenCalled();
    expect(repo.getVideo(deleteVideo.id)).toBeTruthy();
    service.stop();
  });

  it("fails closed for filtered rapid deletion even with a valid query", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteCloudFiles = vi.fn();
    const service = createService(jobs, repo, { deleteCloudFiles });
    await expect(service.submitFiltered({
      requestId: "filtered-fast-disabled",
      query: { page: 1, pageSize: 20, sortField: "sizeBytes", sortDirection: "desc" }
    })).rejects.toThrow(/默认关闭/);
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    expect(deleteCloudFiles).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("refuses replay of an existing unverified fast request as a verified request", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    bindCloudFixture(repo, keepVideo, deleteVideo);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const existing = jobs.submitFast({ requestId: "old-fast-id", plan });
    const service = createService(jobs, repo);
    expect(() => service.submit({ requestId: "old-fast-id", plan })).toThrow(/旧快速永久删除任务已暂停/);
    expect(jobs.getJob(existing.jobId).workflowVersion).toBe(3);
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("persists cancellation across restart and never auto-resumes API deletion", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    bindCloudFixture(repo, keepVideo, deleteVideo);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const accepted = jobs.submitFast({ requestId: "cancel-restart-api", plan });
    jobs.bindCloudDriveConnection(accepted.jobId, "a".repeat(64));
    jobs.start(accepted.jobId);
    const item = jobs.listFastDeletionWorkItems(accepted.jobId)[0];
    jobs.claimFastDeletionItems(accepted.jobId, [item.id]);
    jobs.requestCancel(accepted.jobId);
    expect(jobs.recoverFastJobs()).toEqual([]);
    expect(jobs.getJob(accepted.jobId)).toMatchObject({ status: "cancelled", phase: "finished" });
    expect(jobs.listItems(accepted.jobId, 1, 20).items[0].status).toBe("cancelled");
  });

  it("blocks manual resume and retry of existing unverified CloudDrive jobs even with matching bindings", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    bindCloudFixture(repo, keepVideo, deleteVideo);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const accepted = jobs.submitFast({ requestId: "account-change-api", plan });
    const deleteCloudFiles = vi.fn().mockResolvedValue({ success: true, errorMessage: "", resultFilePaths: [] });
    let binding = "b".repeat(64);
    const service = createService(jobs, repo, { deleteCloudFiles, getCloudConnectionBinding: () => binding });
    expect(jobs.getJob(accepted.jobId).status).toBe("interrupted");
    expect(() => service.resume(accepted.jobId)).toThrow(/旧快速清理任务不能继续/);
    jobs.bindCloudDriveConnection(accepted.jobId, "a".repeat(64));
    expect(() => service.resume(accepted.jobId)).toThrow(/旧快速清理任务不能继续/);
    jobs.requestCancel(accepted.jobId); jobs.finishCancelled(accepted.jobId);
    expect(() => service.retry(accepted.jobId)).toThrow(/旧快速清理任务不能重试/);
    expect(deleteCloudFiles).not.toHaveBeenCalled();
    binding = "a".repeat(64);
    expect(() => service.retry(accepted.jobId)).toThrow(/旧快速清理任务不能重试/);
    expect(deleteCloudFiles).not.toHaveBeenCalled();
    service.stop();
  });

  it("locks connection changes until retryable or cancelled remote task records are cleared", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    bindCloudFixture(repo, keepVideo, deleteVideo);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const accepted = jobs.submitFast({ requestId: "settings-lock-api", plan });
    jobs.bindCloudDriveConnection(accepted.jobId, crypto.createHash("sha256").update("fixture-connection").digest("hex"));
    expect(() => jobs.assertCloudDriveConnectionChangeAllowed()).toThrow(/清除/);
    jobs.requestCancel(accepted.jobId); jobs.finishCancelled(accepted.jobId);
    expect(() => jobs.assertCloudDriveConnectionChangeAllowed()).toThrow(/清除/);
    expect(JSON.stringify(jobs.getJob(accepted.jobId))).not.toContain("cloud_connection_binding");
    jobs.clear(accepted.jobId);
    expect(() => jobs.assertCloudDriveConnectionChangeAllowed()).not.toThrow();
  });

  it("rejects unverified CloudDrive batches without emitting any removal events", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const secondDelete = await createVideo(repo, keepVideo.sourceFolderId, path.join(path.dirname(deleteVideo.path), "delete-2.mp4"), 1);
    plan.groups[0]!.deleteVideoIds.push(secondDelete.id);
    repo.setSourceFolderProvider(keepVideo.sourceFolderId, { type: "clouddrive", rootPath: "/115", name: "115" });
    for (const [record, fileId, remotePath] of [
      [keepVideo, "remote-keep", "/115/keep.mp4"],
      [deleteVideo, "remote-delete-1", "/115/delete.mp4"],
      [secondDelete, "remote-delete-2", "/115/delete-2.mp4"]
    ] as const) {
      expect(repo.updateVideoProviderIdentityIfVersion(record.id, record.path, record.sizeBytes, record.modifiedAt,
        { fileId, path: remotePath })).toBe(true);
    }
    const jobs = new DuplicateCleanupRepository(db, repo);
    const publish = vi.fn();
    const service = createService(jobs, repo, {
      deleteCloudFiles: vi.fn().mockResolvedValue({ success: true, errorMessage: "", resultFilePaths: ["/115/delete.mp4", "/115/delete-2.mp4"] }),
      domainEvents: { publish }
    });

    expect(() => service.submit({ requestId: "cloud-batch-delete", plan, autoDeleteAfterVerification: true })).toThrow(/已禁用/);
    const removalEvents = publish.mock.calls.map(([event]) => event).filter((event) => event.type === "video:removed");
    expect(removalEvents).toEqual([]);
    expect(repo.getVideo(deleteVideo.id)).toBeTruthy();
    expect(repo.getVideo(secondDelete.id)).toBeTruthy();
    expect(jobs.listJobs(1, 20).totalItems).toBe(0);
    service.stop();
  });

  it("uses only size and duration to classify duplicate files, without hashing content", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, false);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const hashFile = vi.fn(async () => { throw new Error("content hash must never run"); });
    const service = createService(jobs, repo, { deleteFile, hashFile });

    const accepted = service.submit({ requestId: "size-duration-only", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");

    expect(verified).toMatchObject({ identicalItems: 1, differentItems: 0, unverifiableItems: 0, status: "completed" });
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);

    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    expect(await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished")).toMatchObject({ status: "completed", successItems: 1 });
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("does not let a failing hash implementation block size-duration verification", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const hashFile = vi.fn().mockRejectedValue(Object.assign(new Error("offline"), { code: "EIO" }));
    const service = createService(jobs, repo, { deleteFile, hashFile });

    const accepted = service.submit({ requestId: "no-hash-required", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");

    expect(verified).toMatchObject({ identicalItems: 1, differentItems: 0, unverifiableItems: 0 });
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("rejects a candidate when its recorded duration changes before verification", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const hashFile = vi.fn();
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { hashFile, deleteFile });

    const accepted = service.submit({ requestId: "duration-changed", plan });
    db!.prepare("UPDATE videos SET duration_ms = 6000 WHERE id = ?").run(deleteVideo.id);
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ identicalItems: 0, differentItems: 1, unverifiableItems: 0, status: "completed_with_errors" });
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await stat(deleteVideo.path)).isFile()).toBe(true);
    service.stop();
  });

  it("cancels a queued size-duration verification without deleting any file", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const hashFile = vi.fn();
    const deleteFile = vi.fn();
    const service = createService(jobs, repo, { hashFile, deleteFile });

    const accepted = service.submit({ requestId: "cancel-verification", plan });
    const cancelled = service.cancel(accepted.jobId);

    expect(cancelled).toMatchObject({ status: "cancelled", phase: "finished" });
    expect(hashFile).not.toHaveBeenCalled();
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

  it("detects a target path replacement during isolation using file identity without hashing", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const renameFile = vi.fn(async (source: string, destination: string) => {
      const replacement = `${source}.replacement`;
      await writeFile(replacement, Buffer.alloc(64, 8));
      await utimes(replacement, new Date(deleteVideo.modifiedAt), new Date(deleteVideo.modifiedAt));
      await rm(source, { force: true });
      await rename(replacement, source);
      await rename(source, destination);
    });
    const hashFile = vi.fn();
    const service = createService(jobs, repo, { deleteFile, renameFile, hashFile });
    const accepted = service.submit({ requestId: "path-swap-window", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    const item = jobs.listItems(accepted.jobId, 1, 20).items[0];

    expect(finished).toMatchObject({ successItems: 0, failedItems: 1, status: "completed_with_errors" });
    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(item.stagedDeletePath).toMatch(/movie-delete/);
    expect(await readFile(item.stagedDeletePath!)).toEqual(Buffer.alloc(64, 8));
    service.stop();
  });

  it("restores the isolated target if the kept file identity changes before deletion", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, keepVideo, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const hashFile = vi.fn();
    const renameFile = vi.fn(async (source: string, destination: string) => {
      await rename(source, destination);
      const replacement = `${keepVideo.path}.replacement`;
      await writeFile(replacement, Buffer.alloc(64, 6));
      await utimes(replacement, new Date(keepVideo.modifiedAt), new Date(keepVideo.modifiedAt));
      await rm(keepVideo.path, { force: true });
      await rename(replacement, keepVideo.path);
    });
    const service = createService(jobs, repo, { deleteFile, hashFile, renameFile });
    const accepted = service.submit({ requestId: "keep-final-race", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ successItems: 0, skippedItems: 1, status: "completed_with_errors" });
    expect(hashFile).not.toHaveBeenCalled();
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

  it("retry after a delete failure requires a new size-duration review and another confirmation", async () => {
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

  it("invalidates queued deletion authorization across restart and resume requires a new size-duration review", async () => {
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

  it("rejects direct authorization without a fresh size-duration review", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    expect(() => jobs.assertVideosAvailable([deleteVideo.id])).not.toThrow();
    expect(() => jobs.assertGenericPermanentDeleteAllowed([deleteVideo.id])).toThrow(/大小与时长重复条件/);
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

  it("verifies multiple jobs without reading or hashing video contents", async () => {
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
    const hashFile = vi.fn(async () => { throw new Error("video content hashing is disabled"); });
    const first = createService(jobs, repo, { hashFile });
    const acceptedFirst = first.submit({ requestId: "metadata-first", plan: plans[0] });
    const acceptedSecond = first.submit({ requestId: "metadata-second", plan: plans[1] });

    await waitFor(jobs, acceptedFirst.jobId, (job) => job.phase === "awaiting_confirmation");
    await waitFor(jobs, acceptedSecond.jobId, (job) => job.phase === "awaiting_confirmation");
    expect(hashFile).not.toHaveBeenCalled();
    first.stop();
  });

  it("continues the FIFO after an unexpected task error and persists that task as interrupted", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const plans: DuplicateResolvePlan[] = [];
    const targets: VideoRecord[] = [];
    for (const [name, sizeBytes] of [["first", 64], ["second", 128]] as const) {
      const directory = path.join(tempDir, name);
      await mkdir(directory, { recursive: true });
      const folder = repo.addSourceFolder(directory, true);
      const keep = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1, sizeBytes);
      const target = await createVideo(repo, folder.id, path.join(directory, "delete.mp4"), 1, sizeBytes);
      const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups
        .find((candidate) => candidate.items.some((item) => item.video.id === target.id))!;
      plans.push({ groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [target.id] }] });
      targets.push(target);
    }

    const jobs = new DuplicateCleanupRepository(db, repo);
    const originalProgress = jobs.progress.bind(jobs);
    let firstJobId = "";
    let injected = false;
    vi.spyOn(jobs, "progress").mockImplementation((jobId) => {
      if (jobId === firstJobId && !injected) {
        injected = true;
        throw new Error("synthetic progress persistence fault");
      }
      return originalProgress(jobId);
    });
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const first = service.submit({ requestId: "pump-error-first", plan: plans[0]! });
    firstJobId = first.jobId;
    const second = service.submit({ requestId: "pump-error-second", plan: plans[1]! });

    const firstVerified = await waitFor(jobs, first.jobId, (job) => job.phase === "awaiting_confirmation");
    const secondVerified = await waitFor(jobs, second.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: first.jobId, verificationRevision: firstVerified.verificationRevision!, confirmation: "DELETE" });
    service.confirm({ jobId: second.jobId, verificationRevision: secondVerified.verificationRevision!, confirmation: "DELETE" });

    const interrupted = await waitFor(jobs, first.jobId, (job) => job.status === "interrupted");
    const completed = await waitFor(jobs, second.jobId, (job) => job.phase === "finished");
    expect(injected).toBe(true);
    expect(interrupted).toMatchObject({ status: "interrupted", phase: "deletion", authorizedRevision: null });
    expect(jobs.listItems(first.jobId, 1, 20).items[0]).toMatchObject({ status: "deleted" });
    await expect(stat(targets[0]!.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(completed).toMatchObject({ status: "completed", successItems: 1 });
    expect(jobs.listItems(second.jobId, 1, 20).items[0]).toMatchObject({ status: "deleted" });
    await expect(stat(targets[1]!.path)).rejects.toMatchObject({ code: "ENOENT" });
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

  it("retains an isolated target if its size changes, without hashing video content", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const hashFile = vi.fn();
    const renameFile = vi.fn(async (source: string, destination: string) => {
      await rename(source, destination);
      await writeFile(destination, Buffer.alloc(65, 9));
    });
    const service = createService(jobs, repo, { deleteFile, hashFile, renameFile });
    const accepted = service.submit({ requestId: "isolated-size-change", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    const item = jobs.listItems(accepted.jobId, 1, 20).items[0];

    expect(finished).toMatchObject({ successItems: 0, status: "completed_with_errors" });
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(item.outcomeCode).toBe("isolated-target-mismatch");
    expect(item.stagedDeletePath).toBeTruthy();
    expect(path.dirname(item.stagedDeletePath!)).toBe(path.dirname(deleteVideo.path)); // stage beside source: rename never crosses volumes
    expect(await stat(item.stagedDeletePath!)).toBeTruthy();
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("keeps the confirmed deletion result when refreshing the video index fails", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const removeVideo = vi.spyOn(repo, "removeVideo").mockImplementation(() => {
      throw new Error("synthetic index refresh failure");
    });
    const service = createService(jobs, repo);
    const accepted = service.submit({ requestId: "delete-index-refresh-failure", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });

    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    const item = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(finished.status).toBe("completed");
    expect(item).toMatchObject({ status: "deleted", outcomeCode: "deleted-index-refresh-failed" });
    expect(item.message).toMatch(/源文件已永久删除，但资料库索引更新失败/);
    expect(item.message).toMatch(/重新扫描来源/);
    expect(removeVideo).toHaveBeenCalledWith(deleteVideo.id);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();
  });

  it("records an unknown outcome if the delete call errors after the isolated path disappears", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn(async (filePath: string) => {
      await rm(filePath, { force: true });
      throw new Error("synthetic ambiguous delete result");
    });
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "ambiguous-local-delete", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });

    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");
    const item = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(finished.status).toBe("completed_with_errors");
    expect(item).toMatchObject({ status: "failed", outcomeCode: "delete-outcome-unknown", stagedDeletePath: null });
    expect(item.message).toMatch(/系统不会自动重试/);
    expect(item.message).not.toMatch(/隔离文件仍可能位于/);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("restores an isolated target when deletion is cancelled before the irreversible call", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const deleteFile = vi.fn();
    const hashFile = vi.fn();
    let service!: DuplicateCleanupService;
    let activeJobId = "";
    let signalIsolated: () => void = () => undefined;
    const isolatedReached = new Promise<void>((resolve) => { signalIsolated = resolve; });
    const renameFile = vi.fn(async (source: string, destination: string) => {
      await rename(source, destination);
      signalIsolated();
      service.cancel(activeJobId);
    });
    service = createService(jobs, repo, { deleteFile, hashFile, renameFile });
    const accepted = service.submit({ requestId: "cancel-isolated", plan });
    activeJobId = accepted.jobId;
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    await isolatedReached;
    const finished = await waitFor(jobs, accepted.jobId, (job) => job.phase === "finished");

    expect(finished).toMatchObject({ status: "cancelled", successItems: 0 });
    expect(hashFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
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

  it("accepts another cleanup queue while a prior job is deleting and keeps each job isolated in FIFO order", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const plans: DuplicateResolvePlan[] = [];
    const keepTargets: VideoRecord[] = [];
    const deleteTargets: VideoRecord[] = [];
    for (const [name, sizeBytes] of [["first-queue", 64], ["second-queue", 128]] as const) {
      const directory = path.join(tempDir, name);
      await mkdir(directory, { recursive: true });
      const folder = repo.addSourceFolder(directory, true);
      const keep = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1, sizeBytes);
      const target = await createVideo(repo, folder.id, path.join(directory, "delete.mp4"), 1, sizeBytes);
      const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups
        .find((candidate) => candidate.items.some((item) => item.video.id === target.id))!;
      plans.push({ groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [target.id] }] });
      keepTargets.push(keep);
      deleteTargets.push(target);
    }
    const jobs = new DuplicateCleanupRepository(db, repo);
    let releaseFirstDelete!: () => void;
    const firstDeleteGate = new Promise<void>((resolve) => { releaseFirstDelete = resolve; });
    const deleteFile = vi.fn(async (filePath: string) => {
      if (path.dirname(filePath) === path.dirname(deleteTargets[0]!.path)) await firstDeleteGate;
      await rm(filePath, { force: true });
    });
    const service = createService(jobs, repo, { deleteFile });
    const first = service.submit({ requestId: "independent-queue-first", plan: plans[0]! });
    const second = service.submit({ requestId: "independent-queue-second", plan: plans[1]! });
    const firstVerified = await waitFor(jobs, first.jobId, (job) => job.phase === "awaiting_confirmation");
    const secondVerified = await waitFor(jobs, second.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: first.jobId, verificationRevision: firstVerified.verificationRevision!, confirmation: "DELETE" });
    await waitUntil(() => deleteFile.mock.calls.length === 1 && jobs.getJob(first.jobId).status === "running");
    service.confirm({ jobId: second.jobId, verificationRevision: secondVerified.verificationRevision!, confirmation: "DELETE" });
    await waitUntil(() => jobs.getJob(second.jobId).status === "queued");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect((await stat(deleteFile.mock.calls[0]![0])).isFile()).toBe(true);
    await expect(stat(deleteTargets[0]!.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(deleteTargets[1]!.path)).isFile()).toBe(true);
    releaseFirstDelete();
    const firstFinished = await waitFor(jobs, first.jobId, (job) => job.phase === "finished");
    expect(firstFinished).toMatchObject({ status: "completed", successItems: 1, failedItems: 0 });
    const secondFinished = await waitFor(jobs, second.jobId, (job) => job.phase === "finished");
    expect(secondFinished).toMatchObject({ status: "completed", successItems: 1, failedItems: 0 });
    expect(deleteFile).toHaveBeenCalledTimes(2);
    for (const target of deleteTargets) await expect(stat(target.path)).rejects.toMatchObject({ code: "ENOENT" });
    for (const keep of keepTargets) expect((await stat(keep.path)).isFile()).toBe(true);
    service.stop();
  });

  it("fails closed and leaves later queued jobs untouched when interrupted state cannot be persisted", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const repo = new VideoRepository(db);
    const plans: DuplicateResolvePlan[] = [];
    const targets: VideoRecord[] = [];
    for (const [name, sizeBytes] of [["first", 64], ["second", 128]] as const) {
      const directory = path.join(tempDir, name);
      await mkdir(directory, { recursive: true });
      const folder = repo.addSourceFolder(directory, true);
      const keep = await createVideo(repo, folder.id, path.join(directory, "keep.mp4"), 1, sizeBytes);
      const target = await createVideo(repo, folder.id, path.join(directory, "delete.mp4"), 1, sizeBytes);
      const group = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups
        .find((candidate) => candidate.items.some((item) => item.video.id === target.id))!;
      plans.push({ groups: [{ groupKey: group.groupKey, keepVideoId: keep.id, deleteVideoIds: [target.id] }] });
      targets.push(target);
    }

    const jobs = new DuplicateCleanupRepository(db, repo);
    const originalProgress = jobs.progress.bind(jobs);
    let firstJobId = "";
    let injected = false;
    vi.spyOn(jobs, "progress").mockImplementation((jobId) => {
      if (jobId === firstJobId && !injected) {
        injected = true;
        throw new Error("synthetic progress failure before queue recovery");
      }
      return originalProgress(jobId);
    });
    vi.spyOn(jobs, "interruptJob").mockImplementation(() => {
      throw new Error("synthetic interrupted-state persistence failure");
    });
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const first = service.submit({ requestId: "fail-closed-first", plan: plans[0]! });
    firstJobId = first.jobId;
    const second = service.submit({ requestId: "fail-closed-second", plan: plans[1]! });
    const firstVerified = await waitFor(jobs, first.jobId, (job) => job.phase === "awaiting_confirmation");
    const secondVerified = await waitFor(jobs, second.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: first.jobId, verificationRevision: firstVerified.verificationRevision!, confirmation: "DELETE" });
    service.confirm({ jobId: second.jobId, verificationRevision: secondVerified.verificationRevision!, confirmation: "DELETE" });

    await waitUntil(() => injected && jobs.getJob(second.jobId).status === "queued");
    expect(jobs.getJob(first.jobId).status).toBe("running");
    expect(jobs.getJob(second.jobId).status).toBe("queued");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    await expect(stat(targets[0]!.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(targets[1]!.path)).isFile()).toBe(true);
    service.stop();
  });

  it("records an unknown outcome after the delete succeeds but persisting its result fails", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const originalUpdateItem = jobs.updateItem.bind(jobs);
    let failOnce = true;
    const updateItem = vi.spyOn(jobs, "updateItem").mockImplementation((itemId, status, outcomeCode, message) => {
      if (failOnce && status === "deleted" && outcomeCode === "deleted") {
        failOnce = false;
        throw new Error("synthetic delete-result persistence failure");
      }
      return originalUpdateItem(itemId, status, outcomeCode, message);
    });
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "delete-result-record-failure", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });

    const interrupted = await waitFor(jobs, accepted.jobId, (job) => job.status === "interrupted");
    const afterFailure = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(interrupted.status).toBe("interrupted");
    expect(afterFailure.status).toBe("pending");
    expect(afterFailure.stagedDeletePath).not.toBeNull();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    const stagedPath = afterFailure.stagedDeletePath!;
    await expect(stat(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();

    const restarted = createService(jobs, repo, { deleteFile });
    await waitUntil(() => jobs.listItems(accepted.jobId, 1, 20).items[0]?.outcomeCode === "isolation-recovery-required");
    const recovered = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(recovered.status).toBe("failed");
    expect(recovered.message).toMatch(/The deletion outcome cannot be confirmed/);
    expect(recovered.message).toMatch(/no automatic retry will occur/);
    expect((await jobs.getJob(accepted.jobId)).status).toBe("interrupted");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(updateItem).toHaveBeenCalled();
    restarted.stop();
  });

  it("clears a stale isolation marker after a confirmed delete when marker cleanup initially fails", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const originalClearIsolation = jobs.clearIsolation.bind(jobs);
    let failOnce = true;
    const clearIsolation = vi.spyOn(jobs, "clearIsolation").mockImplementation((itemId) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("synthetic isolation marker cleanup failure");
      }
      return originalClearIsolation(itemId);
    });
    const deleteFile = vi.fn(async (filePath: string) => rm(filePath, { force: true }));
    const service = createService(jobs, repo, { deleteFile });
    const accepted = service.submit({ requestId: "stale-marker-after-delete", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    service.confirm({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });

    const interrupted = await waitFor(jobs, accepted.jobId, (job) => job.status === "interrupted");
    const afterFailure = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(interrupted.status).toBe("interrupted");
    expect(afterFailure).toMatchObject({ status: "deleted", outcomeCode: "deleted" });
    expect(afterFailure.stagedDeletePath).not.toBeNull();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    service.stop();

    const restarted = createService(jobs, repo, { deleteFile });
    await waitUntil(() => jobs.listStagedItems().length === 0);
    const recovered = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(recovered).toMatchObject({ status: "deleted", outcomeCode: "deleted", stagedDeletePath: null });
    expect((await jobs.getJob(accepted.jobId)).status).toBe("interrupted");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(clearIsolation).toHaveBeenCalledTimes(2);
    restarted.stop();
  });

  it("does not claim an isolated file remains when both original and staged paths are missing", async () => {
    ({ tempDir, db } = await fixtureRoot());
    const { repo, plan, deleteVideo } = await duplicateFixture(db, tempDir, true);
    const jobs = new DuplicateCleanupRepository(db, repo);
    const verifier = createService(jobs, repo);
    const accepted = verifier.submit({ requestId: "startup-both-paths-missing", plan });
    const verified = await waitFor(jobs, accepted.jobId, (job) => job.phase === "awaiting_confirmation");
    verifier.stop();
    jobs.authorizeDeletion({ jobId: accepted.jobId, verificationRevision: verified.verificationRevision!, confirmation: "DELETE" });
    expect(jobs.start(accepted.jobId)).toBe(true);
    const item = jobs.listDeletionWorkItems(accepted.jobId)[0]!;
    const stagedPath = path.join(path.dirname(deleteVideo.path), ".startup-both-paths-missing-stage");
    expect(jobs.prepareIsolation(accepted.jobId, item.id, stagedPath)).toBe(true);
    await rename(deleteVideo.path, stagedPath);
    await rm(stagedPath, { force: true });

    const restarted = createService(jobs, repo);
    await waitUntil(() => jobs.listItems(accepted.jobId, 1, 20).items[0]?.outcomeCode === "isolation-recovery-required");
    const recovered = jobs.listItems(accepted.jobId, 1, 20).items[0]!;
    expect(recovered.message).toMatch(/Neither the original path nor the recorded isolated path exists/);
    expect(recovered.message).not.toMatch(/remains at/);
    await expect(stat(deleteVideo.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
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
  getCloudConnectionBinding?: () => string | null;
  deleteFile?: (filePath: string) => Promise<void>;
  hashFile?: (filePath: string, signal?: AbortSignal) => Promise<string>;
  renameFile?: (source: string, destination: string) => Promise<void>;
  deleteCloudFiles?: (remotePaths: readonly string[], permanently?: boolean, isCancelled?: () => boolean) => Promise<{ success: boolean; errorMessage: string; resultFilePaths: string[] }>;
  domainEvents?: { publish(event: unknown): unknown };
} = {}) {
  const { domainEvents, ...serviceOptions } = options;
  return new DuplicateCleanupService(jobs, repo, { enqueue: vi.fn(() => true) } as never,
    { scheduleMaintenance: vi.fn() } as never, (domainEvents ?? { publish: vi.fn() }) as never, serviceOptions);
}

function bindCloudFixture(repo: VideoRepository, keepVideo: VideoRecord, deleteVideo: VideoRecord) {
  repo.setSourceFolderProvider(keepVideo.sourceFolderId, { type: "clouddrive", rootPath: "/qa-fixtures", name: "QA" });
  for (const video of [keepVideo, deleteVideo]) {
    expect(repo.updateVideoProviderIdentityIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt,
      { fileId: `fixture-${video.id}`, path: `/qa-fixtures/${video.filename}` })).toBe(true);
  }
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
