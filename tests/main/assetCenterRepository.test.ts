// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import type { ScanCounters } from "../../src/shared/videoTypes";

let tempDir: string;
let db: DatabaseConnection | undefined;
let repo: VideoRepository;

const EMPTY_COUNTERS: ScanCounters = {
  totalFolders: 1,
  currentFolderIndex: 1,
  completedFolders: 1,
  failedFolders: 0,
  checkedDirectories: 1,
  changedDirectories: 1,
  skippedDirectories: 0,
  processedVideos: 0,
  skippedVideos: 0,
  addedVideos: 0,
  updatedVideos: 0,
  missingVideos: 0,
  fileFailures: 0,
  directoryFailures: 0,
  pendingFailures: 0,
  retriedFailures: 0,
  resolvedFailures: 0
};

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-asset-center-"));
  db = createDatabase(path.join(tempDir, "library.sqlite"));
  repo = new VideoRepository(db);
});

afterEach(() => {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Asset Center repository", () => {
  it("aggregates cached library data and the latest completed scan without accessing files", () => {
    const local = repo.addSourceFolder("D:\\Movies", true);
    const cloud = repo.addCloudDriveSourceFolder({
      localPath: "F:\\Cloud",
      remotePath: "/cloud",
      name: "Cloud archive",
      readOnly: false,
      recursive: true
    });
    createVideo(local.id, "D:\\Movies\\native.mp4", 1000, 10_000, {
      videoCodec: "h264", videoProfile: "High", pixelFormat: "yuv420p", audioCodec: "aac", codecProbeStatus: "ready"
    });
    createVideo(local.id, "D:\\Movies\\risky.mkv", 2000, 20_000, {
      videoCodec: "hevc", videoProfile: "Main", pixelFormat: "yuv420p10le", audioCodec: "dts", codecProbeStatus: "ready"
    });
    createVideo(cloud.id, "F:\\Cloud\\copy-a.mp4", 4096, 30_000, {
      videoCodec: "h264", videoProfile: "Main", pixelFormat: "yuv420p", audioCodec: "aac", codecProbeStatus: "ready"
    });
    createVideo(cloud.id, "F:\\Cloud\\copy-b.mp4", 4096, 30_000, {
      videoCodec: "h264", videoProfile: "Main", pixelFormat: "yuv420p", audioCodec: "aac", codecProbeStatus: "ready"
    });
    const missing = createVideo(local.id, "D:\\Movies\\gone.mp4", 8192, 40_000);
    repo.markMissing(missing.id, true);
    createVideo(local.id, "D:\\Movies\\pending.mp4", 512, null, { metadataStatus: "pending" });

    insertScanTask("older", local.id, "completed", "2026-09-03T09:00:00.000Z", EMPTY_COUNTERS);
    insertScanTask("latest", cloud.id, "completed-with-errors", "2026-09-04T09:00:00.000Z", {
      ...EMPTY_COUNTERS,
      processedVideos: 7,
      addedVideos: 3,
      updatedVideos: 2,
      missingVideos: 1,
      fileFailures: 1,
      directoryFailures: 2
    });

    const summary = repo.getAssetCenterSummary();

    expect(summary).toMatchObject({
      totalVideoCount: 5,
      totalSizeBytes: 11_704,
      sourceCount: 2,
      enabledSourceCount: 2,
      reachableSourceCount: 2,
      offlineSourceCount: 0,
      checkFailedSourceCount: 0,
      unknownSourceCount: 0,
      missingVideoCount: 1,
      metadataIssueCount: 1,
      playbackRiskCount: 1,
      duplicateCandidateGroupCount: 1,
      latestCompletedScan: {
        taskId: "latest",
        status: "completed-with-errors",
        addedVideos: 3,
        updatedVideos: 2,
        missingVideos: 1,
        failureCount: 3
      }
    });
  });

  it("keeps availability separate from issues and paginates source rows on the database side", () => {
    const reachable = repo.addSourceFolder("D:\\Reachable", true);
    const nas = repo.addSourceFolder("\\\\server\\Videos", true);
    const failed = repo.addCloudDriveSourceFolder({
      localPath: "F:\\Cloud",
      remotePath: "/cloud",
      name: "Cloud archive",
      readOnly: false,
      recursive: true
    });
    const disabled = repo.addSourceFolder("E:\\Disabled", true);
    db!.prepare("UPDATE source_folders SET enabled = 0 WHERE id = ?").run(disabled.id);
    const missing = createVideo(reachable.id, "D:\\Reachable\\gone.mp4", 100, 1000);
    repo.markMissing(missing.id, true);
    repo.recordScanFailure({
      sourceFolderId: reachable.id,
      scanTaskId: "reachable-task",
      objectType: "file",
      objectPath: "D:\\Reachable\\bad.mp4",
      failureStage: "metadata",
      errorCode: "EIO",
      errorSummary: "single file failed"
    });
    insertScanTask("reachable-task", reachable.id, "completed-with-errors", "2026-09-04T08:00:00.000Z", EMPTY_COUNTERS);
    db!.prepare(`
      INSERT INTO scan_tasks (id, source_folder_id, mode, status, started_at, completed_at, counters_json, error_summary)
      VALUES ('running-task', ?, 'current-folder', 'running', '2026-09-04T09:00:00.000Z', NULL, '{}', NULL)
    `).run(reachable.id);
    insertScanTask("offline-task", nas.id, "offline", "2026-09-04T08:10:00.000Z", EMPTY_COUNTERS);
    insertScanTask("error-task", failed.id, "error", "2026-09-04T08:20:00.000Z", EMPTY_COUNTERS);

    const all = repo.listAssetCenterSources(defaultQuery());
    expect(all).toMatchObject({ page: 1, pageSize: 30, totalPages: 1, totalCount: 4 });
    expect(all.items.find((item) => item.id === reachable.id)).toMatchObject({
      availability: "reachable",
      scanFailureCount: 1,
      missingVideoCount: 1,
      issueCount: 2
    });
    expect(all.items.find((item) => item.id === nas.id)).toMatchObject({ sourceType: "nas", availability: "offline", issueCount: 0 });
    expect(all.items.find((item) => item.id === failed.id)).toMatchObject({ sourceType: "clouddrive", availability: "checkFailed", issueCount: 0 });
    expect(all.items.find((item) => item.id === disabled.id)).toMatchObject({ availability: "disabled" });

    const offlineOnly = repo.listAssetCenterSources({ ...defaultQuery(), availability: "offline" });
    expect(offlineOnly.items.map((item) => item.id)).toEqual([nas.id]);
    const cloudOnly = repo.listAssetCenterSources({ ...defaultQuery(), search: "archive", type: "clouddrive" });
    expect(cloudOnly.items.map((item) => item.id)).toEqual([failed.id]);
  });
});

function defaultQuery() {
  return {
    page: 1,
    pageSize: 30 as const,
    search: "",
    type: "all" as const,
    availability: "all" as const,
    sort: "path" as const,
    direction: "asc" as const
  };
}

function createVideo(
  sourceFolderId: string,
  videoPath: string,
  sizeBytes: number,
  durationMs: number | null,
  overrides: Partial<Parameters<VideoRepository["upsertVideo"]>[0]> = {}
) {
  const parsed = path.win32.parse(videoPath);
  return repo.upsertVideo({
    sourceFolderId,
    path: videoPath,
    directory: parsed.dir,
    filename: parsed.base,
    basename: parsed.name,
    extension: parsed.ext,
    sizeBytes,
    durationMs,
    width: 1920,
    height: 1080,
    format: parsed.ext.slice(1),
    modifiedAt: "2026-09-04T00:00:00.000Z",
    ...overrides
  });
}

function insertScanTask(
  id: string,
  sourceFolderId: string,
  status: string,
  completedAt: string,
  counters: ScanCounters
) {
  db!.prepare(`
    INSERT INTO scan_tasks (id, source_folder_id, mode, status, started_at, completed_at, counters_json, error_summary)
    VALUES (?, ?, 'current-folder', ?, ?, ?, ?, NULL)
  `).run(id, sourceFolderId, status, completedAt, completedAt, JSON.stringify(counters));
  db!.prepare("UPDATE source_folders SET last_scanned_at = ? WHERE id = ?").run(completedAt, sourceFolderId);
}
