// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { MetadataFileRefreshService } from "../../src/main/media/metadataFileRefreshService";

const databases: DatabaseConnection[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("MetadataFileRefreshService", () => {
  it("updates a recovered CloudDrive size and enqueues metadata analysis", async () => {
    const { repo, video } = createFixture();
    repo.markMetadataFailed(video.id, video.path, video.sizeBytes, video.modifiedAt);
    repo.recordScanFailure({
      sourceFolderId: video.sourceFolderId, scanTaskId: `metadata:${video.id}`, objectType: "file", objectPath: video.path,
      failureStage: "metadata", errorCode: "EMPTY_FILE", errorSummary: "old failure", incrementRetry: false
    });
    const enqueueMetadata = vi.fn();
    const onVideosUpdated = vi.fn();
    const service = new MetadataFileRefreshService(repo, {
      refreshRemote: async () => new Map([[video.path, {
        status: "present" as const, sizeBytes: 8192, modifiedAt: "2026-09-07T01:00:00.000Z",
        providerFileId: "fresh-id", providerPath: "/115/Movies/zero.mp4"
      }]]),
      enqueueMetadata,
      onVideosUpdated
    });

    await expect(service.refreshZeroByteFiles([video.id])).resolves.toMatchObject({ updatedCount: 1, stillZeroCount: 0, failureCount: 0 });
    expect(repo.getVideo(video.id)).toMatchObject({
      sizeBytes: 8192, metadataStatus: "pending", providerFileId: "fresh-id", providerPath: "/115/Movies/zero.mp4"
    });
    expect(repo.getScanFailureSummary(video.sourceFolderId).totalUnresolved).toBe(0);
    expect(enqueueMetadata).toHaveBeenCalledWith(video.id);
    expect(onVideosUpdated).toHaveBeenCalledWith([video.id]);
  });

  it("classifies a remote file that remains zero bytes without invoking analysis", async () => {
    const { repo, video } = createFixture();
    const enqueueMetadata = vi.fn();
    const service = new MetadataFileRefreshService(repo, {
      refreshRemote: async () => new Map([[video.path, {
        status: "present" as const, sizeBytes: 0, modifiedAt: video.modifiedAt,
        providerFileId: "remote-id", providerPath: "/115/Movies/zero.mp4"
      }]]),
      enqueueMetadata
    });

    await expect(service.refreshZeroByteFiles([video.id])).resolves.toMatchObject({ updatedCount: 0, stillZeroCount: 1 });
    expect(repo.getVideo(video.id).metadataStatus).toBe("failed");
    expect(repo.getScanFailureSummary(video.sourceFolderId)).toMatchObject({ totalUnresolved: 1, latestError: expect.stringContaining("仍为 0B") });
    expect(enqueueMetadata).not.toHaveBeenCalled();
  });

  it("moves a remotely confirmed absence into missing-file review", async () => {
    const { repo, video } = createFixture();
    const service = new MetadataFileRefreshService(repo, {
      refreshRemote: async () => new Map([[video.path, { status: "missing" as const }]]),
      enqueueMetadata: vi.fn()
    });

    await expect(service.refreshZeroByteFiles([video.id])).resolves.toMatchObject({ missingCount: 1 });
    expect(repo.getVideo(video.id).isMissing).toBe(true);
  });
});

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "video-manager-size-refresh-"));
  directories.push(directory);
  const database = createDatabase(path.join(directory, "library.sqlite"));
  databases.push(database);
  const repo = new VideoRepository(database);
  const source = repo.addCloudDriveSourceFolder({ localPath: "Z:\\Movies", remotePath: "/115/Movies", name: "115", readOnly: true, recursive: true });
  const video = repo.upsertVideo({
    sourceFolderId: source.id, path: "Z:\\Movies\\zero.mp4", directory: "Z:\\Movies", filename: "zero.mp4",
    basename: "zero", extension: ".mp4", sizeBytes: 0, durationMs: null, width: null, height: null, format: null,
    modifiedAt: "2026-09-07T00:00:00.000Z", metadataStatus: "pending", providerFileId: "remote-id", providerPath: "/115/Movies/zero.mp4"
  });
  return { repo, video };
}
