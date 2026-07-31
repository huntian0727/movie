// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseConnection } from "../../src/main/db/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";

let tempDir: string;
let db: DatabaseConnection | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-db-"));
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

function createRepo(): { repo: VideoRepository; folderId: string } {
  db = createDatabase(path.join(tempDir, "library.sqlite"));
  const repo = new VideoRepository(db);
  const folder = repo.addSourceFolder("D:\\Movies", true);

  return { repo, folderId: folder.id };
}

function createVideo(repo: VideoRepository, folderId: string, overrides: Partial<Parameters<VideoRepository["upsertVideo"]>[0]> = {}) {
  return repo.upsertVideo({
    sourceFolderId: folderId,
    path: "D:\\Movies\\clip.mp4",
    directory: "D:\\Movies",
    filename: "clip.mp4",
    basename: "clip",
    extension: ".mp4",
    sizeBytes: 1200,
    durationMs: 5000,
    width: 1920,
    height: 1080,
    format: "mov,mp4,m4a,3gp,3g2,mj2",
    modifiedAt: "2026-07-09T00:00:00.000Z",
    ...overrides
  });
}

describe("VideoRepository", () => {
  it("creates a source folder and stores a video record", () => {
    const { repo, folderId } = createRepo();
    createVideo(repo, folderId);

    const videos = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: false
    });

    expect(videos).toHaveLength(1);
    expect(videos[0].filename).toBe("clip.mp4");
    expect(videos[0].isFavorite).toBe(false);
  });

  it("paginates ordinary library queries in SQLite and returns lightweight navigation data", () => {
    const { repo, folderId } = createRepo();
    for (let index = 0; index < 35; index += 1) {
      createVideo(repo, folderId, {
        path: `D:\\Movies\\${index < 5 ? "Series\\" : ""}clip-${String(index).padStart(2, "0")}.mp4`,
        directory: index < 5 ? "D:\\Movies\\Series" : "D:\\Movies",
        filename: `clip-${String(index).padStart(2, "0")}.mp4`,
        basename: `clip-${String(index).padStart(2, "0")}`,
        sizeBytes: 1200 + index
      });
    }
    const favorite = repo.getVideoByPath("D:\\Movies\\clip-34.mp4");
    expect(favorite).not.toBeNull();
    repo.setFavorite(favorite!.id, true);

    const firstPage = repo.listVideoPage({ view: "all", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 30 });
    const secondPage = repo.listVideoPage({ view: "all", search: "", sortField: "filename", sortDirection: "asc", page: 2, pageSize: 30 });
    const exactFolder = repo.listVideoPage({ view: "folder", directoryPath: "D:\\Movies\\Series", folderScope: "exact", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 30 });
    const favorites = repo.listVideoPage({ view: "favorites", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 30 });

    expect(firstPage).toMatchObject({ page: 1, totalPages: 2, totalCount: 35 });
    expect(firstPage.videos).toHaveLength(30);
    expect(secondPage.videos).toHaveLength(5);
    expect(exactFolder.totalCount).toBe(5);
    expect(favorites.videos.map((video) => video.id)).toEqual([favorite!.id]);
    expect(repo.getLibraryNavigation()).toMatchObject({
      totalVideos: 35,
      favoriteVideos: 1,
      directoryPaths: ["D:\\Movies", "D:\\Movies\\Series"]
    });
    expect(repo.listVideosByIds([favorite!.id, firstPage.videos[0].id]).map((video) => video.id)).toEqual([favorite!.id, firstPage.videos[0].id]);
  });

  it("filters favorites and hides missing videos by default", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId, {
      path: "D:\\Movies\\favorite.mkv",
      filename: "favorite.mkv",
      basename: "favorite",
      extension: ".mkv",
      sizeBytes: 2400,
      durationMs: 8000,
      width: 1280,
      height: 720,
      format: "matroska,webm"
    });

    repo.setFavorite(video.id, true);
    repo.markMissing(video.id, true);

    expect(repo.listVideos({ view: "favorites", search: "", sortField: "filename", sortDirection: "asc", includeMissing: false })).toHaveLength(0);
    expect(repo.listVideos({ view: "favorites", search: "", sortField: "filename", sortDirection: "asc", includeMissing: true })).toHaveLength(1);
  });

  it("preserves isFavorite and importedAt when re-upserting the same path", () => {
    const { repo, folderId } = createRepo();
    const first = createVideo(repo, folderId);
    repo.setFavorite(first.id, true);

    const second = createVideo(repo, folderId, {
      sizeBytes: 9999,
      modifiedAt: "2026-07-10T00:00:00.000Z"
    });

    expect(second.id).toBe(first.id);
    expect(second.isFavorite).toBe(true);
    expect(second.importedAt).toBe(first.importedAt);
  });

  it("persists pending-delete marks and exposes their count and size", () => {
    const { repo, folderId } = createRepo();
    const marked = createVideo(repo, folderId, { sizeBytes: 4096 });
    createVideo(repo, folderId, {
      path: "D:\\Movies\\keep.mp4",
      filename: "keep.mp4",
      basename: "keep",
      sizeBytes: 2048
    });

    repo.setPendingDelete(marked.id, true);

    expect(repo.getVideo(marked.id).isPendingDelete).toBe(true);
    expect(repo.listVideoPage({ view: "pendingDelete", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 30 }).videos.map((video) => video.id)).toEqual([marked.id]);
    expect(repo.listPendingDeleteVideos().map((video) => video.id)).toEqual([marked.id]);
    expect(repo.getLibraryNavigation()).toMatchObject({ pendingDeleteVideos: 1, pendingDeleteBytes: 4096 });

    const rescanned = createVideo(repo, folderId, { sizeBytes: 4096 });
    expect(rescanned.isPendingDelete).toBe(true);
  });

  it("returns no rows for folder view without a folder id", () => {
    const { repo, folderId } = createRepo();
    createVideo(repo, folderId);

    expect(
      repo.listVideos({
        view: "folder",
        search: "",
        sortField: "filename",
        sortDirection: "asc",
        includeMissing: false
      })
    ).toEqual([]);
  });

  it("sorts by duration when requested", () => {
    const { repo, folderId } = createRepo();
    createVideo(repo, folderId);
    createVideo(repo, folderId, {
      path: "D:\\Movies\\long.mp4",
      filename: "long.mp4",
      basename: "long",
      durationMs: 20000
    });
    createVideo(repo, folderId, {
      path: "D:\\Movies\\short.mp4",
      filename: "short.mp4",
      basename: "short",
      durationMs: 1000
    });

    const videos = repo.listVideos({
      view: "all",
      search: "",
      sortField: "durationMs",
      sortDirection: "asc",
      includeMissing: false
    });

    expect(videos.map((video) => video.filename)).toEqual(["short.mp4", "clip.mp4", "long.mp4"]);
  });

  it("invalidates cache fields when reimport metadata changes", () => {
    const { repo, folderId } = createRepo();
    const first = createVideo(repo, folderId);

    db!.prepare(
      "UPDATE videos SET thumbnail_status = 'ready', timeline_preview_status = 'ready', cover_cache_path = ? WHERE id = ?"
    ).run("C:\\Cache\\cover.jpg", first.id);

    const second = createVideo(repo, folderId, {
      sizeBytes: 2400,
      modifiedAt: "2026-07-11T00:00:00.000Z"
    });

    expect(second.thumbnailStatus).toBe("pending");
    expect(second.timelinePreviewStatus).toBe("pending");
    expect(second.coverCachePath).toBeNull();
  });

  it("deletes stale timeline previews when reimport metadata changes", () => {
    const { repo, folderId } = createRepo();
    const first = createVideo(repo, folderId);

    db!.prepare(
      "INSERT INTO timeline_previews (id, video_id, time_ms, cache_path, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("preview-1", first.id, 1000, "C:\\Cache\\preview-1.jpg", "2026-07-09T00:00:00.000Z");

    createVideo(repo, folderId, {
      sizeBytes: 2400,
      modifiedAt: "2026-07-11T00:00:00.000Z"
    });

    const previewCount = db!.prepare("SELECT COUNT(*) AS count FROM timeline_previews WHERE video_id = ?").get(first.id) as { count: number };
    expect(previewCount.count).toBe(0);
  });

  it("persists thumbnail readiness and cache path", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);

    repo.markThumbnailReady(video.id, "C:\\Cache\\cover.jpg");

    expect(repo.getVideo(video.id)).toMatchObject({
      thumbnailStatus: "ready",
      coverCachePath: "C:\\Cache\\cover.jpg"
    });
  });

  it("persists pending metadata and completes it only for the matching file version", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId, {
      durationMs: null,
      width: null,
      height: null,
      format: null,
      metadataStatus: "pending"
    });

    expect(repo.listVideosPendingMetadata()).toEqual([expect.objectContaining({ id: video.id, metadataStatus: "pending" })]);
    expect(repo.markMetadataReady(video.id, video.path, video.sizeBytes + 1, video.modifiedAt, {
      durationMs: 5000,
      width: 1920,
      height: 1080,
      format: "mp4"
    })).toBe(false);
    expect(repo.getVideo(video.id).metadataStatus).toBe("pending");

    expect(repo.markMetadataReady(video.id, video.path, video.sizeBytes, video.modifiedAt, {
      durationMs: 5000,
      width: 1920,
      height: 1080,
      format: "mp4"
    })).toBe(true);
    expect(repo.getVideo(video.id)).toMatchObject({
      metadataStatus: "ready",
      durationMs: 5000,
      width: 1920,
      height: 1080,
      format: "mp4"
    });
  });

  it("can retry a failed metadata record without changing a newer file version", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId, { metadataStatus: "pending" });

    expect(repo.markMetadataFailed(video.id, video.path, video.sizeBytes, video.modifiedAt)).toBe(true);
    expect(repo.getVideo(video.id).metadataStatus).toBe("failed");
    expect(repo.markMetadataPending(video.id, video.path, video.sizeBytes + 1, video.modifiedAt)).toBe(false);
    expect(repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt)).toBe(true);
    expect(repo.getVideo(video.id).metadataStatus).toBe("pending");
  });

  it("stores generated timeline preview metadata and marks the video ready", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);

    repo.markTimelinePreviewReady(video.id, 5000, "C:\\Cache\\timeline\\clip\\5000.jpg");

    expect(repo.getVideo(video.id).timelinePreviewStatus).toBe("ready");
    const row = db!
      .prepare("SELECT time_ms, cache_path FROM timeline_previews WHERE video_id = ? AND time_ms = ?")
      .get(video.id, 5000) as { time_ms: number; cache_path: string } | undefined;
    expect(row).toEqual({
      time_ms: 5000,
      cache_path: "C:\\Cache\\timeline\\clip\\5000.jpg"
    });
  });

  it("lists cache identities without exposing unrelated video state", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);

    expect(repo.listMediaCacheIdentities()).toContainEqual({
      path: video.path,
      sizeBytes: video.sizeBytes,
      modifiedAt: video.modifiedAt
    });
  });

  it("forgets only database references for cache files removed by maintenance", () => {
    const { repo, folderId } = createRepo();
    const coverVideo = createVideo(repo, folderId);
    const timelineVideo = createVideo(repo, folderId, {
      path: "D:\\Movies\\timeline.mp4",
      filename: "timeline.mp4",
      basename: "timeline"
    });
    repo.markThumbnailReady(coverVideo.id, "C:\\Cache\\cover.jpg");
    repo.markTimelinePreviewReady(timelineVideo.id, 5000, "C:\\Cache\\timeline\\5000.jpg");

    repo.forgetMediaCachePaths(["C:\\Cache\\cover.jpg", "C:\\Cache\\timeline\\5000.jpg"]);

    expect(repo.getVideo(coverVideo.id)).toMatchObject({ thumbnailStatus: "pending", coverCachePath: null });
    expect(repo.getVideo(timelineVideo.id).timelinePreviewStatus).toBe("pending");
    expect(
      db!.prepare("SELECT COUNT(*) AS count FROM timeline_previews WHERE video_id = ?").get(timelineVideo.id)
    ).toEqual({ count: 0 });
  });

  it("resets all cache metadata after a manual clear without deleting video records", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);
    repo.markThumbnailReady(video.id, "C:\\Cache\\cover.jpg");
    repo.markTimelinePreviewReady(video.id, 5000, "C:\\Cache\\timeline\\5000.jpg");

    repo.resetMediaCacheState();

    expect(repo.getVideo(video.id)).toMatchObject({
      thumbnailStatus: "pending",
      timelinePreviewStatus: "pending",
      coverCachePath: null
    });
    expect(repo.listVideos({ view: "all", search: "", sortField: "modifiedAt", sortDirection: "desc", includeMissing: true })).toHaveLength(1);
  });

  it("treats source folder paths case-insensitively", () => {
    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);

    const first = repo.addSourceFolder("D:\\Movies", true);
    const second = repo.addSourceFolder("d:\\movies", false);

    expect(second.id).toBe(first.id);
    expect(repo.listSourceFolders()).toHaveLength(1);
    expect(repo.getSourceFolderByPath("d:\\movies").id).toBe(first.id);
  });

  it("updates source folder scan state", () => {
    const { repo, folderId } = createRepo();

    repo.updateSourceFolderScanState(folderId, "2026-07-10T12:00:00.000Z", "1 file failed: D:\\Movies\\bad.mp4: ffprobe failed");

    expect(repo.getSourceFolderByPath("D:\\Movies")).toMatchObject({
      id: folderId,
      lastScannedAt: "2026-07-10T12:00:00.000Z",
      scanError: "1 file failed: D:\\Movies\\bad.mp4: ffprobe failed"
    });
  });

  it("updates a renamed path without losing the video identity or favorite", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);
    repo.setFavorite(video.id, true);

    const renamed = repo.updateVideoPath(video.id, "D:\\Movies\\renamed.mp4");

    expect(renamed).toMatchObject({
      id: video.id,
      path: "D:\\Movies\\renamed.mp4",
      directory: "D:\\Movies",
      filename: "renamed.mp4",
      basename: "renamed",
      extension: ".mp4",
      isFavorite: true
    });
  });

  it("treats video paths case-insensitively", () => {
    const { repo, folderId } = createRepo();
    const first = createVideo(repo, folderId, {
      path: "D:\\Movies\\Clip.mp4",
      directory: "D:\\Movies",
      filename: "Clip.mp4",
      basename: "Clip"
    });

    const second = createVideo(repo, folderId, {
      path: "d:\\movies\\clip.mp4",
      directory: "d:\\movies",
      filename: "clip.mp4",
      basename: "clip",
      sizeBytes: 1500
    });

    expect(second.id).toBe(first.id);
    expect(repo.listVideos({ view: "all", search: "", sortField: "filename", sortDirection: "asc", includeMissing: false })).toHaveLength(1);
    expect(repo.getVideo(first.id).sizeBytes).toBe(1500);
  });

  it("keeps one recent playback entry per video", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);

    repo.recordPlayback(video.id, 1000);
    repo.recordPlayback(video.id, 5000);

    expect(repo.listPlayHistory()).toEqual([
      expect.objectContaining({
        videoId: video.id,
        positionMs: 5000
      })
    ]);
  });

  it("initializes new videos with pending fingerprint status", () => {
    const { repo, folderId } = createRepo();
    const stored = createVideo(repo, folderId);

    expect(stored).toMatchObject({
      contentFingerprint: null,
      fingerprintStatus: "pending",
      fingerprintUpdatedAt: null,
      fingerprintError: null
    });
  });

  it("groups videos only when exact size and cached duration match", () => {
    const { repo, folderId } = createRepo();
    const favorite = createVideo(repo, folderId);
    repo.setFavorite(favorite.id, true);
    const duplicate = createVideo(repo, folderId, {
      path: "D:\\Movies\\clip-copy.mp4",
      filename: "clip-copy.mp4",
      basename: "clip-copy"
    });

    const page = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    const groups = page.groups;

    expect(groups).toHaveLength(1);
    expect(page).toMatchObject({
      totalGroups: 1,
      totalCandidateGroups: 1,
      totalCandidateFiles: 2,
      totalReclaimableBytes: favorite.sizeBytes,
      totalPages: 1
    });
    expect(groups[0]).toMatchObject({
      groupKey: `size-duration:${favorite.sizeBytes}:${favorite.durationMs}`,
      identityStatus: "size_duration_match",
      recommendedKeepVideoId: favorite.id
    });
    expect(groups[0].items.map((item) => item.video.id)).toEqual([duplicate.id, favorite.id]);
    expect(groups[0].items.find((item) => item.video.id === favorite.id)).toMatchObject({
      isRecommendedToKeep: true,
      keepReason: "已收藏"
    });
  });

  it("does not group same-size videos when cached durations differ", () => {
    const { repo, folderId } = createRepo();
    const first = createVideo(repo, folderId);
    const second = createVideo(repo, folderId, {
      path: "D:\\Movies\\other.mp4",
      filename: "other.mp4",
      basename: "other",
      durationMs: 6000
    });

    const page = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    expect(page.groups).toEqual([]);
    expect(page).toMatchObject({ totalGroups: 0, totalCandidateGroups: 1, totalCandidateFiles: 2, totalReclaimableBytes: 0 });
    expect(() => repo.previewDuplicateResolve({
      groups: [{ groupKey: `size-duration:${first.sizeBytes}:${first.durationMs}`, keepVideoId: first.id, deleteVideoIds: [second.id] }]
    })).toThrow(/Duplicate group not found/);
  });

  it("excludes videos whose cached duration is unavailable", () => {
    const { repo, folderId } = createRepo();
    createVideo(repo, folderId, { durationMs: null });
    createVideo(repo, folderId, {
      path: "D:\\Movies\\other.mp4",
      filename: "other.mp4",
      basename: "other",
      durationMs: null
    });

    const page = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    expect(page.groups).toEqual([]);
    expect(page).toMatchObject({ totalGroups: 0, totalCandidateGroups: 1, totalCandidateFiles: 2 });
  });

  it("paginates duplicate size groups with global statistics and stable size sorting", () => {
    const { repo, folderId } = createRepo();
    for (let groupIndex = 1; groupIndex <= 11; groupIndex += 1) {
      for (let copyIndex = 1; copyIndex <= 2; copyIndex += 1) {
        const stored = createVideo(repo, folderId, {
          path: `D:\\Movies\\group-${groupIndex}-copy-${copyIndex}.mp4`,
          filename: `group-${groupIndex}-copy-${copyIndex}.mp4`,
          basename: `group-${groupIndex}-copy-${copyIndex}`,
          sizeBytes: groupIndex * 1000
        });
      }
    }

    const firstPage = repo.listDuplicateGroupsPage({ page: 1, pageSize: 10, sortDirection: "desc" });
    const secondPage = repo.listDuplicateGroupsPage({ page: 2, pageSize: 10, sortDirection: "desc" });

    expect(firstPage).toMatchObject({ page: 1, totalPages: 2, totalGroups: 11, totalCandidateFiles: 22 });
    expect(firstPage.groups).toHaveLength(10);
    expect(firstPage.groups[0].groupKey).toBe("size-duration:11000:5000");
    expect(secondPage.groups.map((group) => group.groupKey)).toEqual(["size-duration:1000:5000"]);
  });

  it("filters duplicate groups by a preferred directory while retaining complete groups and preferring its file", () => {
    const { repo, folderId } = createRepo();
    const selected = createVideo(repo, folderId, {
      path: "D:\\Movies\\Series\\keep.mp4",
      directory: "D:\\Movies\\Series",
      filename: "keep.mp4",
      basename: "keep",
      sizeBytes: 9000
    });
    const outsideFolder = repo.addSourceFolder("E:\\Backup", true);
    const outside = createVideo(repo, outsideFolder.id, {
      path: "E:\\Backup\\copy.mp4",
      directory: "E:\\Backup",
      filename: "copy.mp4",
      basename: "copy",
      sizeBytes: 9000
    });
    const insideOther = createVideo(repo, folderId, {
      path: "D:\\Movies\\other.mp4",
      directory: "D:\\Movies",
      filename: "other.mp4",
      basename: "other",
      sizeBytes: 7000
    });
    const outsideOther = createVideo(repo, outsideFolder.id, {
      path: "E:\\Backup\\other.mp4",
      directory: "E:\\Backup",
      filename: "other.mp4",
      basename: "other",
      sizeBytes: 7000
    });
    createVideo(repo, folderId, {
      path: "D:\\Movies\\Solo\\only.mp4",
      directory: "D:\\Movies\\Solo",
      filename: "only.mp4",
      basename: "only",
      sizeBytes: 1234
    });

    const page = repo.listDuplicateGroupsPage({
      page: 1,
      pageSize: 20,
      sortDirection: "desc",
      preferredDirectoryPath: "D:\\Movies\\Series",
      preferredDirectoryScope: "recursive"
    });

    expect(page).toMatchObject({ totalGroups: 1, totalCandidateFiles: 2 });
    expect(page.groups[0]?.items.map((item) => item.video.id)).toEqual(expect.arrayContaining([selected.id, outside.id]));
    expect(page.groups[0]).toMatchObject({ recommendedKeepVideoId: selected.id });
    expect(page.groups[0]?.items.find((item) => item.video.id === selected.id)?.keepReason).toContain("选中目录优先");
    expect(page.directoryOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "D:\\Movies", groupCount: 2, estimatedReclaimableBytes: 16000 }),
      expect.objectContaining({ path: "D:\\Movies\\Series", groupCount: 1, estimatedReclaimableBytes: 9000 }),
      expect.objectContaining({ path: "E:\\Backup", groupCount: 2, estimatedReclaimableBytes: 16000 })
    ]));
    expect(page.directoryOptions.some((option) => option.path === "D:\\Movies\\Solo")).toBe(false);
  });

  it("builds a duplicate resolve preview and rejects invalid plans", () => {
    const { repo, folderId } = createRepo();
    const keep = createVideo(repo, folderId);
    const duplicate = createVideo(repo, folderId, {
      path: "D:\\Movies\\clip-copy.mp4",
      filename: "clip-copy.mp4",
      basename: "clip-copy"
    });

    const groupKey = `size-duration:${keep.sizeBytes}:${keep.durationMs}`;

    expect(
      repo.previewDuplicateResolve({
        groups: [
          {
            groupKey,
            keepVideoId: keep.id,
            deleteVideoIds: [duplicate.id]
          }
        ]
      })
    ).toEqual({
      groupCount: 1,
      keepCount: 1,
      deleteCount: 1,
      reclaimableBytes: duplicate.sizeBytes
    });

    expect(() =>
      repo.previewDuplicateResolve({
        groups: [
          {
            groupKey,
            keepVideoId: keep.id,
            deleteVideoIds: []
          }
        ]
      })
    ).toThrow();
  });

  it("removes an exclusive source folder and its library records without touching other sources", () => {
    const { repo, folderId } = createRepo();
    createVideo(repo, folderId);
    const otherFolder = repo.addSourceFolder("E:\\Archive", true);
    createVideo(repo, otherFolder.id, {
      path: "E:\\Archive\\keep.mp4",
      directory: "E:\\Archive",
      filename: "keep.mp4",
      basename: "keep"
    });

    expect(repo.previewRemoveSourceFolder(folderId)).toEqual({ removedVideoCount: 1, retainedVideoCount: 0 });
    expect(repo.removeSourceFolder(folderId)).toEqual({
      removedVideoCount: 1,
      retainedVideoCount: 0,
      reassignedVideoCount: 0
    });
    expect(repo.listSourceFolders().map((folder) => folder.id)).toEqual([otherFolder.id]);
    expect(repo.listVideos({ view: "all", search: "", sortField: "filename", sortDirection: "asc", includeMissing: true }).map((item) => item.filename)).toEqual(["keep.mp4"]);
  });

  it("keeps videos covered by explicitly added child folders when the parent source is removed", () => {
    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const parent = repo.addSourceFolder("D:\\", true);
    const kept = createVideo(repo, parent.id, {
      path: "D:\\Movies\\keep.mp4",
      directory: "D:\\Movies",
      filename: "keep.mp4",
      basename: "keep"
    });
    createVideo(repo, parent.id, {
      path: "D:\\Downloads\\remove.mp4",
      directory: "D:\\Downloads",
      filename: "remove.mp4",
      basename: "remove"
    });
    const child = repo.addSourceFolder("D:\\Movies", true);

    expect(repo.getVideo(kept.id).sourceFolderId).toBe(child.id);
    expect(repo.removeSourceFolder(parent.id)).toEqual({
      removedVideoCount: 1,
      retainedVideoCount: 1,
      reassignedVideoCount: 0
    });
    expect(repo.getVideo(kept.id).sourceFolderId).toBe(child.id);
    expect(repo.listVideos({ view: "all", search: "", sortField: "filename", sortDirection: "asc", includeMissing: true }).map((item) => item.filename)).toEqual(["keep.mp4"]);
  });
});
