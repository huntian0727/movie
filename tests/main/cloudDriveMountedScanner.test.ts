// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { findMountMapping, type MountedCloudDriveDirectorySource } from "../../src/main/clouddrive/mountedScanner";
import { scanSourceFolder } from "../../src/main/media/libraryScanner";

const ROOT = "Z:\\Cloud 电影";
const EPOCH = "1970-01-01T00:00:00.000Z";
const MODIFIED = "2026-08-12T00:00:00.000Z";
const databases: DatabaseConnection[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CloudDrive mounted scanner", () => {
  it("maps Windows roots, trailing separators, case, Unicode and the most specific mount", () => {
    const mapping = findMountMapping("z:\\Cloud 电影\\动作", [
      mount("Z:", "/115"),
      mount("Z:\\Cloud 电影\\", "/115/Cloud 电影")
    ]);
    expect(mapping).toMatchObject({ localRoot: "Z:\\Cloud 电影", remoteRoot: "/115/Cloud 电影/动作" });
  });

  it("does not match sibling or unmounted paths", () => {
    expect(findMountMapping("Z:\\CloudBackup", [mount("Z:\\Cloud", "/115")])).toBeNull();
    expect(findMountMapping("Z:\\Cloud", [{ ...mount("Z:", "/115"), isMounted: false }])).toBeNull();
  });

  it("uses CloudDrive size/writeTime without statting video files and keeps Windows paths", async () => {
    const { repo, source } = createRepository();
    const statImpl = vi.fn(async () => { throw new Error("CloudDrive scan must not call fs.stat"); });
    const cloud = directorySource({
      [ROOT]: [file("电影 一.MP4", 123, MODIFIED), directory("子目录", MODIFIED)],
      [`${ROOT}\\子目录`]: [file("第二部.mkv", 456, MODIFIED)]
    });

    const result = await scanSourceFolder(repo, source, {
      cloudDirectorySource: async () => cloud,
      statImpl,
      readMetadata: async () => ({ durationMs: 1, width: 2, height: 3, format: "test" })
    });

    expect(result).toMatchObject({ state: "completed", totalFiles: 2, failureCount: 0 });
    expect(statImpl).not.toHaveBeenCalled();
    expect(repo.getVideoByPath(`${ROOT}\\电影 一.MP4`)).toMatchObject({ sizeBytes: 123, modifiedAt: MODIFIED });
    expect(repo.getVideoByPath(`${ROOT}\\子目录\\第二部.mkv`)).toMatchObject({ sizeBytes: 456, modifiedAt: MODIFIED });
  });

  it("includes cloud metadata in snapshot identity so same-name changes are processed", async () => {
    const { repo, source } = createRepository();
    let size = 100;
    const cloud: MountedCloudDriveDirectorySource = {
      readDirectory: async () => listing([file("same.mp4", size, MODIFIED)])
    };
    const dependencies = {
      cloudDirectorySource: async () => cloud,
      statImpl: vi.fn(async () => { throw new Error("unexpected stat"); }),
      readMetadata: async () => ({ durationMs: 1, width: 2, height: 3, format: "test" })
    };
    await scanSourceFolder(repo, source, dependencies);
    size = 200;
    const result = await scanSourceFolder(repo, source, dependencies);
    expect(result.counters).toMatchObject({ changedDirectories: 1, updatedVideos: 1 });
    expect(repo.getVideoByPath(`${ROOT}\\same.mp4`)?.sizeBytes).toBe(200);
    expect(dependencies.statImpl).not.toHaveBeenCalled();
  });

  it("does not reconcile missing files when a CloudDrive directory stream fails", async () => {
    const { repo, source } = createRepository();
    const initial = directorySource({ [ROOT]: [file("keep.mp4", 100, MODIFIED), file("also-keep.mkv", 200, MODIFIED)] });
    await scanSourceFolder(repo, source, {
      cloudDirectorySource: async () => initial,
      readMetadata: async () => ({ durationMs: 1, width: 2, height: 3, format: "test" })
    });
    const failing: MountedCloudDriveDirectorySource = {
      readDirectory: async () => { throw new Error("gRPC stream disconnected after a partial response"); }
    };

    const result = await scanSourceFolder(repo, source, { cloudDirectorySource: async () => failing });

    expect(result).toMatchObject({ state: "offline", failureCount: 1 });
    expect(repo.getVideoByPath(`${ROOT}\\keep.mp4`)?.isMissing).toBe(false);
    expect(repo.getVideoByPath(`${ROOT}\\also-keep.mkv`)?.isMissing).toBe(false);
    expect(repo.getDirectorySnapshot(source.id, ROOT)?.isComplete).toBe(false);
  });

  it("handles an empty CloudDrive directory as a complete scan", async () => {
    const { repo, source } = createRepository();
    const result = await scanSourceFolder(repo, source, {
      cloudDirectorySource: async () => directorySource({ [ROOT]: [] })
    });
    expect(result).toMatchObject({ state: "completed", totalFiles: 0, failureCount: 0 });
    expect(repo.getDirectorySnapshot(source.id, ROOT)).toMatchObject({ isComplete: true, directVideoCount: 0 });
  });
});

function createRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "video-manager-clouddrive-"));
  temporaryDirectories.push(directory);
  const database = createDatabase(path.join(directory, "library.sqlite"));
  databases.push(database);
  const repo = new VideoRepository(database);
  return { repo, source: repo.addSourceFolder(ROOT, true) };
}

function mount(mountPoint: string, sourceDir: string) {
  return { mountPoint, sourceDir, readOnly: false, isMounted: true, failReason: "", name: "CloudDrive" };
}

function file(name: string, sizeBytes: number, modifiedAt: string) {
  return { name, kind: "file" as const, scanIdentity: `file:${sizeBytes}:${modifiedAt}`, fileInfo: { sizeBytes, modifiedAt } };
}

function directory(name: string, modifiedAt: string) {
  return { name, kind: "directory" as const, scanIdentity: `directory:0:${modifiedAt}` };
}

function listing(entries: ReturnType<typeof file>[] | Array<ReturnType<typeof file> | ReturnType<typeof directory>>) {
  return { entries, directoryMtime: entries.length > 0 ? MODIFIED : EPOCH };
}

function directorySource(directories: Record<string, Array<ReturnType<typeof file> | ReturnType<typeof directory>>>): MountedCloudDriveDirectorySource {
  return {
    readDirectory: async (directoryPath) => {
      const entries = directories[directoryPath];
      if (!entries) throw new Error(`Unexpected directory: ${directoryPath}`);
      return listing(entries);
    }
  };
}
