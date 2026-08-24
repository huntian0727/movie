// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { bindLegacyCloudDriveDuplicateCandidates } from "../../src/main/media/cloudDriveLegacyBindingService";
import type { MountedCloudDriveDirectorySource } from "../../src/main/clouddrive/mountedScanner";

let tempDir: string;
let db: DatabaseConnection | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-cloud-binding-"));
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

function createFixture() {
  db = createDatabase(path.join(tempDir, "library.sqlite"));
  const repo = new VideoRepository(db);
  const folder = repo.addSourceFolder("F:\\Cloud\\Movies", true);
  const first = repo.upsertVideo({
    sourceFolderId: folder.id,
    path: "F:\\Cloud\\Movies\\Set\\one.mp4",
    directory: "F:\\Cloud\\Movies\\Set",
    filename: "one.mp4",
    basename: "one",
    extension: ".mp4",
    sizeBytes: 4096,
    durationMs: 90_000,
    width: 1920,
    height: 1080,
    format: "mp4",
    modifiedAt: "2026-08-01T00:00:00.000Z"
  });
  const second = repo.upsertVideo({
    sourceFolderId: folder.id,
    path: "F:\\Cloud\\Movies\\Set\\two.mp4",
    directory: "F:\\Cloud\\Movies\\Set",
    filename: "two.mp4",
    basename: "two",
    extension: ".mp4",
    sizeBytes: 4096,
    durationMs: 90_000,
    width: 1920,
    height: 1080,
    format: "mp4",
    modifiedAt: "2026-08-01T00:00:00.000Z"
  });
  repo.upsertVideo({
    sourceFolderId: folder.id,
    path: "F:\\Cloud\\Movies\\Other\\unique.mp4",
    directory: "F:\\Cloud\\Movies\\Other",
    filename: "unique.mp4",
    basename: "unique",
    extension: ".mp4",
    sizeBytes: 8192,
    durationMs: 30_000,
    width: 1280,
    height: 720,
    format: "mp4",
    modifiedAt: "2026-08-01T00:00:00.000Z"
  });
  return { repo, folder, first, second };
}

describe("bindLegacyCloudDriveDuplicateCandidates", () => {
  it("lists each duplicate-candidate directory once and backfills remote identities", async () => {
    const { repo, folder, first, second } = createFixture();
    const readDirectory = vi.fn(async () => ({
      directoryMtime: "2026-08-10T00:00:00.000Z",
      entries: [first, second].map((video, index) => ({
        name: video.filename,
        kind: "file" as const,
        scanIdentity: `file:remote-${index + 1}:4096`,
        fileInfo: {
          sizeBytes: 4096,
          modifiedAt: "2026-08-10T00:00:00.000Z",
          providerFileId: `remote-${index + 1}`,
          providerPath: `/115/Movies/Set/${video.filename}`
        }
      }))
    }));
    const source: MountedCloudDriveDirectorySource = {
      provider: { type: "clouddrive", rootPath: "/115/Movies", name: "CloudDrive2", readOnly: false },
      readDirectory
    };

    const result = await bindLegacyCloudDriveDuplicateCandidates(repo, {
      createSources: async () => new Map([[folder.id, source]])
    });

    expect(readDirectory).toHaveBeenCalledOnce();
    expect(readDirectory).toHaveBeenCalledWith("F:\\Cloud\\Movies\\Set");
    expect(result).toMatchObject({
      candidateFileCount: 2,
      scannedDirectoryCount: 1,
      matchedFileCount: 2,
      missingFileCount: 0,
      sizeMismatchFileCount: 0,
      failedDirectoryCount: 0
    });
    expect(repo.getVideo(first.id)).toMatchObject({
      providerFileId: "remote-1",
      providerPath: "/115/Movies/Set/one.mp4",
      modifiedAt: "2026-08-10T00:00:00.000Z"
    });
    expect(repo.getVideo(second.id).providerFileId).toBe("remote-2");
    expect(repo.listSourceFolders()[0]).toMatchObject({
      providerType: "clouddrive",
      providerRootPath: "/115/Movies",
      providerName: "CloudDrive2"
    });
    expect(repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" }).groups[0].items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ canAutoDelete: true })]));
  });

  it("reports candidates whose source folder has no CloudDrive mount mapping without changing them", async () => {
    const { repo, first } = createFixture();

    const result = await bindLegacyCloudDriveDuplicateCandidates(repo, {
      createSources: async () => new Map()
    });

    expect(result).toMatchObject({
      sourceFolderCount: 1,
      boundSourceFolderCount: 0,
      unmappedSourceFolderCount: 1,
      unmappedCandidateFileCount: 2,
      matchedFileCount: 0
    });
    expect(repo.getVideo(first.id).providerFileId).toBeNull();
  });
});
