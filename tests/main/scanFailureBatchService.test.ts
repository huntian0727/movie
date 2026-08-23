// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { ScanFailureBatchService } from "../../src/main/files/scanFailureBatchService";

let database: DatabaseConnection | undefined;
let temporaryDirectory = "";

afterEach(() => {
  database?.close();
  database = undefined;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("ScanFailureBatchService", () => {
  it("runs an operation against every matching filtered result, not only the visible page", async () => {
    const { repo, source } = setup();
    for (let index = 0; index < 135; index += 1) {
      record(repo, source.id, path.join(source.path, `broken-${index}.mp4`), "moov atom not found");
    }
    const analyzeFailure = vi.fn(async (failureId: string) => { repo.resolveScanFailure(failureId); });
    const service = createService(repo, { analyzeFailure });

    const submitted = service.submit({
      operation: "analyze-metadata",
      scope: { mode: "filtered", query: { kind: "all", cleanupCategory: "confirmed-corrupt" } }
    });
    const completed = await waitForCompletion(service, submitted.id);

    expect(completed).toMatchObject({ status: "completed", totalCount: 135, processedCount: 135, successCount: 135 });
    expect(analyzeFailure).toHaveBeenCalledTimes(135);
  });

  it("rechecks accessibility without invoking metadata analysis", async () => {
    const { repo, source } = setup();
    const failure = record(repo, source.id, path.join(source.path, "accessible.mp4"), "network read failed: ETIMEDOUT");
    const analyzeFailure = vi.fn();
    const confirmRemoteMissing = vi.fn().mockResolvedValue("present");
    const service = createService(repo, { analyzeFailure, confirmRemoteMissing });

    const submitted = service.submit({ operation: "recheck-accessibility", scope: { mode: "selected", failureIds: [failure.id] } });
    const completed = await waitForCompletion(service, submitted.id);

    expect(completed).toMatchObject({ status: "completed", successCount: 1 });
    expect(confirmRemoteMissing).toHaveBeenCalledOnce();
    expect(analyzeFailure).not.toHaveBeenCalled();
    expect(repo.getScanFailure(failure.id)).toMatchObject({ errorCode: "ACCESSIBLE", failureStage: "file-processing", status: "unresolved" });
  });

  it("cleans all filtered missing records with one grouped remote validation", async () => {
    const { repo, source } = setup();
    for (let index = 0; index < 135; index += 1) {
      repo.recordScanFailure({
        sourceFolderId: source.id,
        scanTaskId: "batch-test",
        objectType: "file",
        objectPath: path.join(source.path, `missing-${index}.mp4`),
        failureStage: "file-processing",
        errorCode: "ENOENT",
        errorSummary: "ENOENT: no such file or directory"
      });
    }
    const confirmRemoteMissing = vi.fn();
    const confirmRemoteMissingBatch = vi.fn(async (targetPaths: readonly string[]) =>
      new Map(targetPaths.map((targetPath) => [targetPath, "missing" as const]))
    );
    const service = createService(repo, { confirmRemoteMissing, confirmRemoteMissingBatch });

    const submitted = service.submit({
      operation: "remove-missing-record",
      scope: { mode: "filtered", query: { kind: "all", cleanupCategory: "missing" } }
    });
    const completed = await waitForCompletion(service, submitted.id);

    expect(completed).toMatchObject({ status: "completed", totalCount: 135, processedCount: 135, successCount: 135 });
    expect(confirmRemoteMissingBatch).toHaveBeenCalledOnce();
    expect(confirmRemoteMissingBatch.mock.calls[0]?.[0]).toHaveLength(135);
    expect(confirmRemoteMissing).not.toHaveBeenCalled();
    expect(repo.listScanFailures(source.id)).toHaveLength(0);
  });

  it("does not clean any missing record when grouped validation is cancelled", async () => {
    const { repo, source } = setup();
    const failures = [0, 1].map((index) => repo.recordScanFailure({
      sourceFolderId: source.id,
      scanTaskId: "batch-test",
      objectType: "file",
      objectPath: path.join(source.path, `cancel-missing-${index}.mp4`),
      failureStage: "file-processing",
      errorCode: "ENOENT",
      errorSummary: "ENOENT: no such file or directory"
    }));
    let releaseValidation!: () => void;
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const confirmRemoteMissingBatch = vi.fn(async (_targetPaths: readonly string[], isCancelled: () => boolean) => {
      await validationGate;
      if (isCancelled()) {
        const error = new Error("cancelled") as Error & { code: string };
        error.code = "ABORT_ERR";
        throw error;
      }
      return new Map<string, "missing">();
    });
    const service = createService(repo, { confirmRemoteMissingBatch });

    const submitted = service.submit({ operation: "remove-missing-record", scope: { mode: "selected", failureIds: failures.map((failure) => failure.id) } });
    await waitUntil(() => confirmRemoteMissingBatch.mock.calls.length === 1);
    service.cancel(submitted.id);
    releaseValidation();
    const completed = await waitForCompletion(service, submitted.id);

    expect(completed).toMatchObject({ status: "cancelled", successCount: 0, processedCount: 0 });
    expect(repo.listScanFailures(source.id)).toHaveLength(2);
  });

  it("cancels between files and leaves remaining items untouched", async () => {
    const { repo, source } = setup();
    const failures = [0, 1, 2].map((index) => record(repo, source.id, path.join(source.path, `cancel-${index}.mp4`), "network read failed"));
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const analyzeFailure = vi.fn(async () => first);
    const service = createService(repo, { analyzeFailure });

    const submitted = service.submit({ operation: "analyze-metadata", scope: { mode: "selected", failureIds: failures.map((failure) => failure.id) } });
    await waitUntil(() => analyzeFailure.mock.calls.length === 1);
    expect(service.cancel(submitted.id).status).toBe("cancelling");
    releaseFirst();
    const cancelled = await waitForCompletion(service, submitted.id);

    expect(cancelled).toMatchObject({ status: "cancelled", processedCount: 1, totalCount: 3 });
    expect(analyzeFailure).toHaveBeenCalledTimes(1);
  });
});

function setup() {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "scan-failure-batch-"));
  database = createDatabase(path.join(temporaryDirectory, "library.sqlite"));
  const repo = new VideoRepository(database);
  const sourcePath = path.join(temporaryDirectory, "media");
  mkdirSync(sourcePath);
  return { repo, source: repo.addSourceFolder(sourcePath, true) };
}

function record(repo: VideoRepository, sourceFolderId: string, objectPath: string, errorSummary: string) {
  return repo.recordScanFailure({
    sourceFolderId, scanTaskId: "batch-test", objectType: "file", objectPath,
    failureStage: "file-processing", errorCode: "EIO", errorSummary
  });
}

function createService(repo: VideoRepository, overrides: {
  analyzeFailure?: (failureId: string) => Promise<void>;
  confirmRemoteMissing?: () => Promise<"missing" | "present" | "not-cloud-drive">;
  confirmRemoteMissingBatch?: (targetPaths: readonly string[], isCancelled: () => boolean) => Promise<Map<string, "missing" | "present" | "not-cloud-drive">>;
} = {}) {
  return new ScanFailureBatchService(repo, {
    analyzeFailure: overrides.analyzeFailure ?? (async () => undefined),
    confirmRemoteMissing: overrides.confirmRemoteMissing ?? (async () => "present"),
    confirmRemoteMissingBatch: overrides.confirmRemoteMissingBatch ?? (async (targetPaths) => new Map(targetPaths.map((targetPath) => [targetPath, "present"]))),
    assertPermanentDeleteAllowed: () => undefined,
    onLibraryChanged: () => undefined
  });
}

async function waitForCompletion(service: ScanFailureBatchService, jobId: string) {
  await waitUntil(() => !["queued", "running", "cancelling"].includes(service.get(jobId).status));
  return service.get(jobId);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for batch job");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
