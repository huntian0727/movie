// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { confirmCloudDriveFileMissingFromListing, confirmCloudDriveFilesMissingFromListing, findMountMapping, resolveCloudDriveSourceSelection, type MountedCloudDriveDirectorySource } from "../../src/main/clouddrive/mountedScanner";
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

  it("resolves an API-selected remote folder to its mounted playback path", () => {
    expect(resolveCloudDriveSourceSelection({
      mountPoint: "Z:",
      remotePath: "/115/电影/动作"
    }, [mount("Z:", "/115")])).toMatchObject({
      localPath: "Z:\\电影\\动作",
      remotePath: "/115/电影/动作",
      rootRemotePath: "/115"
    });
  });

  it("uses the most specific remote root when one mount exposes nested sources", () => {
    expect(resolveCloudDriveSourceSelection({
      mountPoint: "Z:",
      remotePath: "/115/团队/电影"
    }, [mount("Z:", "/115"), mount("Z:", "/115/团队")])).toMatchObject({
      localPath: "Z:\\电影",
      rootRemotePath: "/115/团队"
    });
  });

  it("rejects a remote folder outside the selected API source", () => {
    expect(() => resolveCloudDriveSourceSelection({
      mountPoint: "Z:",
      remotePath: "/阿里云/电影"
    }, [mount("Z:", "/115")])).toThrow("不属于");
  });

  it("confirms remote absence only after fully listing the mapped parent directory", async () => {
    const calls: string[] = [];
    const listParent = async function* (remoteParent: string) {
      calls.push(remoteParent);
      yield { name: "other.mp4", fullPathName: `${remoteParent}/other.mp4` };
    };
    await expect(confirmCloudDriveFileMissingFromListing(
      "Z:\\Cloud 电影\\子目录\\gone.mp4",
      [mount("Z:", "/115")],
      listParent
    )).resolves.toBe("missing");
    expect(calls).toEqual(["/115/Cloud 电影/子目录"]);
  });

  it("treats a case-insensitive NFC filename match as present", async () => {
    const listParent = async function* () {
      yield { name: "CLIP.MP4", fullPathName: "/115/clip.mp4" };
    };
    await expect(confirmCloudDriveFileMissingFromListing("Z:\\clip.mp4", [mount("Z:", "/115")], listParent)).resolves.toBe("present");
  });

  it("validates every file in the same remote directory with one complete listing", async () => {
    const calls: string[] = [];
    const listParent = async function* (remoteParent: string) {
      calls.push(remoteParent);
      yield { name: "keep.mp4", fullPathName: `${remoteParent}/keep.mp4` };
      yield { name: "unrelated.mkv", fullPathName: `${remoteParent}/unrelated.mkv` };
    };

    const results = await confirmCloudDriveFilesMissingFromListing(
      ["Z:\\Movies\\keep.mp4", "Z:\\Movies\\gone-1.mp4", "Z:\\Movies\\gone-2.mp4"],
      [mount("Z:", "/115")],
      listParent
    );

    expect(calls).toEqual(["/115/Movies"]);
    expect([...results]).toEqual([
      ["Z:\\Movies\\keep.mp4", "present"],
      ["Z:\\Movies\\gone-1.mp4", "missing"],
      ["Z:\\Movies\\gone-2.mp4", "missing"]
    ]);
  });

  it("validates different remote parents with bounded parallel listings", async () => {
    let activeListings = 0;
    let maximumActiveListings = 0;
    const calls: string[] = [];
    const listParent = async function* (remoteParent: string) {
      calls.push(remoteParent);
      activeListings += 1;
      maximumActiveListings = Math.max(maximumActiveListings, activeListings);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeListings -= 1;
      if (false) yield { name: "unused", fullPathName: "unused" };
    };
    const paths = Array.from({ length: 8 }, (_, index) => `Z:\\Directory-${index}\\gone.mp4`);

    const results = await confirmCloudDriveFilesMissingFromListing(paths, [mount("Z:", "/115")], listParent);

    expect(calls).toHaveLength(8);
    expect(maximumActiveListings).toBe(4);
    expect([...results.values()]).toEqual(Array(8).fill("missing"));
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

  it("prefetches remote child directories with bounded concurrency", async () => {
    const { repo, source } = createRepository();
    const childCount = 32;
    let active = 0;
    let maximumActive = 0;
    const calls: string[] = [];
    const cloud: MountedCloudDriveDirectorySource = {
      readDirectory: async (directoryPath) => {
        calls.push(directoryPath);
        if (directoryPath === ROOT) {
          return listing(Array.from({ length: childCount }, (_, index) => directory(`Child-${index}`, MODIFIED)));
        }
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return listing([]);
      }
    };

    const startedAt = performance.now();
    const result = await scanSourceFolder(repo, source, {
      cloudDirectorySource: async () => cloud,
      cloudDirectoryConcurrency: 16
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result).toMatchObject({ state: "completed", failureCount: 0 });
    expect(calls).toHaveLength(childCount + 1);
    expect(maximumActive).toBe(16);
    expect(elapsedMs).toBeLessThan(350);
  });

  it("commits API file imports once per directory instead of once per video", async () => {
    const { repo, source } = createRepository();
    const transaction = vi.spyOn(repo, "runInTransaction");
    const readMetadata = vi.fn();
    const cloud = directorySource({
      [ROOT]: [providerFile("one.mp4", 100, MODIFIED), providerFile("two.mp4", 200, MODIFIED)]
    });

    const result = await scanSourceFolder(repo, source, {
      cloudDirectorySource: async () => cloud,
      onMetadataPending: vi.fn(),
      readMetadata
    });

    expect(result).toMatchObject({ state: "completed", totalFiles: 2, failureCount: 0 });
    expect(transaction).toHaveBeenCalledOnce();
    expect(readMetadata).not.toHaveBeenCalled();
    expect(repo.getVideoByPath(`${ROOT}\\one.mp4`)).toMatchObject({
      metadataStatus: "pending",
      providerFileId: "id-one.mp4",
      providerPath: "/remote/one.mp4"
    });
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

  it("never falls back to mounted filesystem scanning for an explicit API source", async () => {
    const { repo, source } = createRepository();
    repo.setSourceFolderProvider(source.id, { type: "clouddrive", rootPath: "/115/Cloud 电影" });
    const apiSource = repo.listSourceFolders().find((folder) => folder.id === source.id)!;
    const statImpl = vi.fn();

    await expect(scanSourceFolder(repo, apiSource, {
      cloudDirectorySource: async () => null,
      statImpl
    })).rejects.toThrow("已保留数据库中的原有文件索引");
    expect(statImpl).not.toHaveBeenCalled();
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

function providerFile(name: string, sizeBytes: number, modifiedAt: string) {
  return {
    name,
    kind: "file" as const,
    scanIdentity: `file:${sizeBytes}:${modifiedAt}`,
    fileInfo: { sizeBytes, modifiedAt, providerFileId: `id-${name}`, providerPath: `/remote/${name}` }
  };
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
