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
      codecProbeStatus: "ready",
      durationMs: 5000,
      width: 1920,
      height: 1080,
      format: "mp4"
    });
  });

  it("persists codec metadata and clears it when the file version changes", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId, {
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      codecProbeStatus: "ready"
    });

    expect(repo.getVideo(video.id)).toMatchObject({
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac"
    });

    const changed = repo.refreshVideoFileVersion(
      video.id,
      video.path,
      video.sizeBytes,
      video.modifiedAt,
      video.sizeBytes + 1,
      "2026-07-10T00:00:00.000Z"
    );
    expect(changed).toBe(true);
    expect(repo.getVideo(video.id)).toMatchObject({
      metadataStatus: "pending",
      durationMs: null,
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null,
      codecProbeStatus: "unprobed"
    });
  });

  it("can retry a failed metadata record without changing a newer file version", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId, { metadataStatus: "pending" });

    expect(repo.markMetadataFailed(video.id, video.path, video.sizeBytes, video.modifiedAt)).toBe(true);
    expect(repo.getVideo(video.id)).toMatchObject({ metadataStatus: "failed", codecProbeStatus: "failed" });
    expect(repo.markMetadataPending(video.id, video.path, video.sizeBytes + 1, video.modifiedAt)).toBe(false);
    expect(repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt)).toBe(true);
    expect(repo.getVideo(video.id)).toMatchObject({ metadataStatus: "pending", codecProbeStatus: "unprobed" });
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

  it("adds a CloudDrive API folder with mounted and remote identities", () => {
    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);

    const folder = repo.addCloudDriveSourceFolder({
      localPath: "Z:\\电影\\动作",
      remotePath: "/115/电影/动作",
      name: "115 网盘",
      readOnly: false,
      recursive: true
    });

    expect(folder).toMatchObject({
      path: "Z:\\电影\\动作",
      recursive: true,
      providerType: "clouddrive",
      providerRootPath: "/115/电影/动作",
      providerName: "115 网盘",
      providerReadOnly: false
    });
  });

  it("reports CloudDrive identity and targeted duration coverage per source folder", () => {
    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const folder = repo.addCloudDriveSourceFolder({
      localPath: "Z:\\Cloud",
      remotePath: "/115/Cloud",
      name: "115",
      readOnly: false,
      recursive: true
    });
    createVideo(repo, folder.id, {
      path: "Z:\\Cloud\\ready.mp4",
      directory: "Z:\\Cloud",
      filename: "ready.mp4",
      basename: "ready",
      sizeBytes: 2048,
      providerFileId: "remote-ready",
      providerPath: "/115/Cloud/ready.mp4"
    });
    const pending = createVideo(repo, folder.id, {
      path: "Z:\\Cloud\\pending.mp4",
      directory: "Z:\\Cloud",
      filename: "pending.mp4",
      basename: "pending",
      sizeBytes: 2048,
      durationMs: null,
      metadataStatus: "pending",
      providerFileId: "remote-pending",
      providerPath: "/115/Cloud/pending.mp4"
    });

    expect(repo.listSourceFoldersWithStats()[0]).toMatchObject({
      videoCount: 2,
      providerIdentityCount: 2,
      duplicateSizeCandidateCount: 2,
      duplicateDurationReadyCount: 1
    });
    expect(repo.markDurationReady(pending.id, pending.path, pending.sizeBytes, pending.modifiedAt, 6789)).toBe(true);
    expect(repo.getVideo(pending.id)).toMatchObject({
      durationMs: 6789,
      durationSource: "local-probe",
      metadataStatus: "ready",
      codecProbeStatus: "unprobed"
    });
    expect(repo.listSourceFoldersWithStats()[0]?.duplicateDurationReadyCount).toBe(2);
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
      totalReclaimableBytes: 0,
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

  it("filters duplicate groups explicitly while retaining complete groups and preferring its file", () => {
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
      filterDirectoryPath: "D:\\Movies\\Series"
    });

    expect(page).toMatchObject({ totalGroups: 1, overallTotalGroups: 2, totalCandidateFiles: 2 });
    expect(page.groups[0]?.items.map((item) => item.video.id)).toEqual(expect.arrayContaining([selected.id, outside.id]));
    expect(page.groups[0]).toMatchObject({ recommendedKeepVideoId: selected.id });
    expect(page.groups[0]?.items.find((item) => item.video.id === selected.id)?.keepReason).toContain("选中目录优先");
    expect(page.directoryOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "D:\\Movies", groupCount: 2, estimatedReclaimableBytes: 16000 }),
      expect.objectContaining({ path: "D:\\Movies\\Series", groupCount: 1, estimatedReclaimableBytes: 9000 }),
      expect.objectContaining({ path: "E:\\Backup", groupCount: 2, estimatedReclaimableBytes: 16000 })
    ]));
    expect(page.directoryOptions.some((option) => option.path === "D:\\Movies\\Solo")).toBe(false);

    const unfiltered = repo.listDuplicateGroupsPage({
      page: 1,
      pageSize: 20,
      sortDirection: "desc",
      preferredDirectoryPath: "D:\\Movies\\Series"
    });
    expect(unfiltered.totalGroups).toBe(2);
    expect(unfiltered.groups.find((group) => group.groupKey === "size-duration:9000:5000")?.recommendedKeepVideoId).toBe(selected.id);
  });

  it("recursively matches descendants without matching a sibling path prefix", () => {
    const { repo, folderId } = createRepo();
    const descendant = createVideo(repo, folderId, {
      path: "D:\\Movies\\Series\\Season 1\\keep.mp4",
      directory: "D:\\Movies\\Series\\Season 1",
      filename: "keep.mp4",
      basename: "keep",
      sizeBytes: 9100
    });
    const outsideFolder = repo.addSourceFolder("E:\\Backup", true);
    const outside = createVideo(repo, outsideFolder.id, {
      path: "E:\\Backup\\copy.mp4",
      directory: "E:\\Backup",
      filename: "copy.mp4",
      basename: "copy",
      sizeBytes: 9100
    });
    createVideo(repo, folderId, {
      path: "D:\\Movies\\Series Archive\\other.mp4",
      directory: "D:\\Movies\\Series Archive",
      filename: "other.mp4",
      basename: "other",
      sizeBytes: 9200
    });
    createVideo(repo, outsideFolder.id, {
      path: "E:\\Backup\\other.mp4",
      directory: "E:\\Backup",
      filename: "other.mp4",
      basename: "other",
      sizeBytes: 9200
    });

    const page = repo.listDuplicateGroupsPage({
      page: 1,
      pageSize: 20,
      sortDirection: "desc",
      preferredDirectoryPath: "D:\\Movies\\Series",
      filterDirectoryPath: "D:\\Movies\\Series"
    });

    expect(page.totalGroups).toBe(1);
    expect(page.groups[0]?.recommendedKeepVideoId).toBe(descendant.id);
    expect(page.groups[0]?.items.map((item) => item.video.id)).toEqual(expect.arrayContaining([descendant.id, outside.id]));
    expect(page.groups.some((group) => group.groupKey === "size-duration:9200:5000")).toBe(false);
  });

  it("prioritizes multiple preferred directory trees and still plans other CloudDrive duplicates", () => {
    const { repo, folderId } = createRepo();
    const firstProtected = createVideo(repo, folderId, {
      path: "D:\\Movies\\Keep A\\Season 1\\a.mp4", directory: "D:\\Movies\\Keep A\\Season 1", filename: "a.mp4",
      sizeBytes: 12_000, durationMs: 5001, providerFileId: "a", providerPath: "/115/Keep A/Season 1/a.mp4"
    });
    const secondProtected = createVideo(repo, folderId, {
      path: "D:\\Movies\\Keep B\\b.mp4", directory: "D:\\Movies\\Keep B", filename: "b.mp4",
      sizeBytes: 12_000, durationMs: 5499, providerFileId: "b", providerPath: "/115/Keep B/b.mp4"
    });
    const outside = createVideo(repo, folderId, {
      path: "D:\\Movies\\Other\\copy.mp4", directory: "D:\\Movies\\Other", filename: "copy.mp4",
      sizeBytes: 12_000, durationMs: 5200, providerFileId: "copy", providerPath: "/115/Other/copy.mp4"
    });
    const query = {
      page: 1 as const,
      pageSize: 20 as const,
      sortDirection: "desc" as const,
      preferredDirectoryPaths: ["D:\\Movies\\Keep A", "D:\\Movies\\Keep B"]
    };

    const page = repo.listDuplicateGroupsPage(query);
    expect(page.groups).toHaveLength(1);
    expect(page.groups[0]?.groupKey).toBe("size-duration:12000:5000");
    expect(repo.buildDuplicateResolvePlanForQuery(query)).toEqual({
      groups: [{ groupKey: "size-duration:12000:5000", keepVideoId: expect.any(String), deleteVideoIds: expect.arrayContaining([outside.id]) }]
    });

    const fullyProtectedPage = repo.listDuplicateGroupsPage({
      page: 1,
      pageSize: 20,
      sortDirection: "desc",
      preferredDirectoryPath: "D:\\Movies"
    });
    expect(fullyProtectedPage).toMatchObject({
      totalGroups: 1,
      totalDeletableFiles: 2,
      totalUnboundDeletionCandidateFiles: 0,
      totalReclaimableBytes: 24_000
    });
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
    expect(repo.previewRemoveSourceFolder(parent.id)).toEqual({
      removedVideoCount: 1,
      retainedVideoCount: 1
    });
    expect(repo.removeSourceFolder(parent.id)).toEqual({
      removedVideoCount: 1,
      retainedVideoCount: 1,
      reassignedVideoCount: 0
    });
    expect(repo.getVideo(kept.id).sourceFolderId).toBe(child.id);
    expect(repo.listVideos({ view: "all", search: "", sortField: "filename", sortDirection: "asc", includeMissing: true }).map((item) => item.filename)).toEqual(["keep.mp4"]);
  });

  it("bulk reassigns child-source videos to a remaining recursive parent", () => {
    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const parent = repo.addSourceFolder("D:\\", true);
    const child = repo.addSourceFolder("D:\\Movies", true);
    const first = createVideo(repo, child.id, {
      path: "D:\\Movies\\first.mp4",
      directory: "D:\\Movies",
      filename: "first.mp4",
      basename: "first"
    });
    const second = createVideo(repo, child.id, {
      path: "D:\\Movies\\second.mp4",
      directory: "D:\\Movies",
      filename: "second.mp4",
      basename: "second"
    });

    expect(repo.previewRemoveSourceFolder(child.id)).toEqual({
      removedVideoCount: 0,
      retainedVideoCount: 2
    });
    expect(repo.removeSourceFolder(child.id)).toEqual({
      removedVideoCount: 0,
      retainedVideoCount: 2,
      reassignedVideoCount: 2
    });
    expect(repo.getVideo(first.id).sourceFolderId).toBe(parent.id);
    expect(repo.getVideo(second.id).sourceFolderId).toBe(parent.id);
  });

  it("persists directory snapshots with normalized path identity", () => {
    const { repo, folderId } = createRepo();
    repo.upsertDirectorySnapshot({
      sourceFolderId: folderId,
      directoryPath: "D:\\Movies\\Series",
      parentDirectoryPath: "D:\\Movies",
      directoryMtime: "2026-08-01T00:00:00.000Z",
      directVideoCount: 12,
      directChildCount: 2,
      directEntryDigest: "digest-1",
      isComplete: true,
      hasUnresolvedFailure: false,
      successful: true
    });

    expect(repo.getDirectorySnapshot(folderId, "d:\\movies\\series\\")).toMatchObject({
      directoryPath: "D:\\Movies\\Series",
      normalizedPath: "d:\\movies\\series",
      normalizedParentPath: "d:\\movies",
      directVideoCount: 12,
      isComplete: true
    });
    expect(repo.listDirectChildSnapshots(folderId, "D:\\MOVIES")).toHaveLength(1);
  });

  it("persists unresolved scan failures and records retry resolution", () => {
    const { repo, folderId } = createRepo();
    repo.upsertDirectorySnapshot({
      sourceFolderId: folderId,
      directoryPath: "D:\\Movies",
      parentDirectoryPath: null,
      directoryMtime: "2026-08-01T00:00:00.000Z",
      directVideoCount: 1,
      directChildCount: 0,
      directEntryDigest: "digest",
      isComplete: true,
      hasUnresolvedFailure: false,
      successful: true
    });
    const failure = repo.recordScanFailure({
      sourceFolderId: folderId,
      scanTaskId: "task-1",
      objectType: "file",
      objectPath: "D:\\Movies\\broken.mp4",
      failureStage: "metadata",
      errorCode: "ETIMEDOUT",
      errorSummary: "ffprobe timed out"
    });

    repo.markScanFailureRetrying(failure.id);
    repo.recordScanFailure({
      sourceFolderId: folderId,
      scanTaskId: "task-2",
      objectType: "file",
      objectPath: "d:\\movies\\BROKEN.mp4",
      failureStage: "metadata",
      errorSummary: "ffprobe timed out again",
      incrementRetry: true
    });
    expect(repo.getScanFailureSummary(folderId)).toMatchObject({
      failedFileCount: 1,
      totalUnresolved: 1,
      totalRetryCount: 1
    });
    expect(repo.getDirectorySnapshot(folderId, "D:\\Movies")?.hasUnresolvedFailure).toBe(true);

    expect(repo.resolveScanFailuresForObjectStage(folderId, "D:\\Movies\\broken.mp4", "file", "metadata")).toBe(1);
    expect(repo.listScanFailures(folderId)).toEqual([]);
    expect(repo.getDirectorySnapshot(folderId, "D:\\Movies")?.hasUnresolvedFailure).toBe(false);
    expect(repo.listScanFailures(folderId, true)).toEqual([
      expect.objectContaining({ status: "resolved", retryCount: 1, resolvedAt: expect.any(String) })
    ]);
  });

  it("keeps unresolved scan failures after the database is reopened", () => {
    const databasePath = path.join(tempDir, "library.sqlite");
    db = createDatabase(databasePath);
    let repo = new VideoRepository(db);
    const folder = repo.addSourceFolder("Z:\\Cloud", true);
    repo.recordScanFailure({
      sourceFolderId: folder.id,
      scanTaskId: "task-before-restart",
      objectType: "directory",
      objectPath: "Z:\\Cloud\\Offline",
      failureStage: "directory-enumeration",
      errorSummary: "network unavailable"
    });
    db.close();

    db = createDatabase(databasePath);
    repo = new VideoRepository(db);
    expect(repo.listScanFailures(folder.id)).toEqual([
      expect.objectContaining({
        objectPath: "Z:\\Cloud\\Offline",
        status: "unresolved",
        errorSummary: "network unavailable"
      })
    ]);
    expect(repo.getSourceFolderByPath("z:\\cloud")?.scanError).toBe("network unavailable");
  });

  it("reconciles only a completely enumerated direct directory or confirmed subtree", () => {
    const { repo, folderId } = createRepo();
    const direct = createVideo(repo, folderId);
    const nested = createVideo(repo, folderId, {
      path: "D:\\Movies\\Series\\episode.mp4",
      directory: "D:\\Movies\\Series",
      filename: "episode.mp4",
      basename: "episode"
    });
    const sibling = createVideo(repo, folderId, {
      path: "D:\\Movies-Backup\\keep.mp4",
      directory: "D:\\Movies-Backup",
      filename: "keep.mp4",
      basename: "keep"
    });

    expect(repo.reconcileDirectoryMissing(folderId, "d:\\movies", [])).toBe(1);
    expect(repo.getVideo(direct.id).isMissing).toBe(true);
    expect(repo.getVideo(nested.id).isMissing).toBe(false);
    expect(repo.markDirectorySubtreeMissing(folderId, "D:\\Movies\\Series")).toBe(1);
    expect(repo.getVideo(nested.id).isMissing).toBe(true);
    expect(repo.getVideo(sibling.id).isMissing).toBe(false);
  });

  it("atomically marks a confirmed missing file and resolves all failures for its exact path", () => {
    const { repo, folderId } = createRepo();
    const video = createVideo(repo, folderId);
    repo.upsertDirectorySnapshot({
      sourceFolderId: folderId,
      directoryPath: "D:\\Movies",
      parentDirectoryPath: null,
      directoryMtime: "2026-08-01T00:00:00.000Z",
      directVideoCount: 1,
      directChildCount: 0,
      directEntryDigest: "before-delete",
      isComplete: true,
      hasUnresolvedFailure: false,
      successful: true
    });
    for (const failureStage of ["file-processing", "metadata", "custom-stage"]) {
      repo.recordScanFailure({
        sourceFolderId: folderId,
        scanTaskId: `task-${failureStage}`,
        objectType: "file",
        objectPath: video.path,
        failureStage,
        errorSummary: `${failureStage} failed`
      });
    }

    expect(repo.reconcileDirectoryMissing(folderId, video.directory, [])).toBe(1);

    expect(repo.getVideo(video.id).isMissing).toBe(true);
    expect(repo.listScanFailures(folderId)).toEqual([]);
    expect(repo.listScanFailures(folderId, true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ failureStage: "file-processing", status: "resolved", resolvedAt: expect.any(String) }),
      expect.objectContaining({ failureStage: "metadata", status: "resolved", resolvedAt: expect.any(String) }),
      expect.objectContaining({ failureStage: "custom-stage", status: "resolved", resolvedAt: expect.any(String) })
    ]));
    expect(repo.listSourceFolders().find((folder) => folder.id === folderId)?.scanError).toBeNull();
    expect(repo.getDirectorySnapshot(folderId, video.directory)?.hasUnresolvedFailure).toBe(false);
  });
});
