import crypto from "node:crypto";
import path from "node:path";
import type {
  DuplicateGroup,
  DuplicateDirectoryOption,
  DuplicateGroupPage,
  DuplicateGroupPageQuery,
  DuplicateResolvePlan,
  DuplicateResolvePreview,
  FingerprintStatus,
  LibraryNavigationSnapshot,
  LibraryPage,
  LibraryPageQuery,
  LibraryQuery,
  MetadataStatus,
  PlayHistoryEntry,
  SortField,
  SourceFolder,
  SourceFolderRemovalPreview,
  SourceFolderRemovalResult,
  VideoRecord
} from "../../shared/videoTypes.js";
import type { DatabaseConnection } from "./database.js";

interface UpsertVideoInput {
  sourceFolderId: string;
  path: string;
  directory: string;
  filename: string;
  basename: string;
  extension: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  modifiedAt: string;
  metadataStatus?: MetadataStatus;
}

interface SourceFolderRow {
  id: string;
  path: string;
  recursive: number;
  enabled: number;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
  scan_error: string | null;
}

interface VideoRow {
  id: string;
  source_folder_id: string;
  path: string;
  directory: string;
  filename: string;
  basename: string;
  extension: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  modified_at: string;
  imported_at: string;
  updated_at: string;
  is_favorite: number;
  is_pending_delete: number;
  is_missing: number;
  metadata_status: VideoRecord["metadataStatus"];
  thumbnail_status: VideoRecord["thumbnailStatus"];
  timeline_preview_status: VideoRecord["timelinePreviewStatus"];
  cover_cache_path: string | null;
  content_fingerprint: string | null;
  fingerprint_status: FingerprintStatus;
  fingerprint_updated_at: string | null;
  fingerprint_error: string | null;
}

interface PlayHistoryRow {
  video_id: string;
  played_at: string;
  position_ms: number;
}

interface DuplicateFingerprintRow {
  size_bytes: number;
  content_fingerprint: string;
}

interface DuplicateDirectoryRow {
  directory: string;
  source_folder_path: string;
  size_bytes: number;
  content_fingerprint: string;
  file_count: number;
}

interface DuplicateStatsRow {
  total_groups: number;
  total_candidate_files: number;
}

interface CountRow {
  count: number;
}

interface LibraryNavigationRow {
  total_videos: number;
  favorite_videos: number;
  pending_delete_videos: number;
  pending_delete_bytes: number;
  pending_metadata_videos: number;
}

interface ExistingVideoRow {
  id: string;
  imported_at: string;
  is_favorite: number;
  size_bytes: number;
  modified_at: string;
  thumbnail_status: VideoRecord["thumbnailStatus"];
  timeline_preview_status: VideoRecord["timelinePreviewStatus"];
  cover_cache_path: string | null;
  content_fingerprint: string | null;
  fingerprint_status: FingerprintStatus;
  fingerprint_updated_at: string | null;
  fingerprint_error: string | null;
}

const SORT_COLUMNS: Record<SortField, string> = {
  filename: "filename",
  sizeBytes: "size_bytes",
  durationMs: "duration_ms",
  modifiedAt: "modified_at"
};

export class VideoRepository {
  constructor(private readonly db: DatabaseConnection) {}

  addSourceFolder(folderPath: string, recursive: boolean): SourceFolder {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    this.db
      .prepare(`
        INSERT INTO source_folders (id, path, recursive, enabled, last_scanned_at, created_at, updated_at, scan_error)
        VALUES (@id, @path, @recursive, 1, NULL, @now, @now, NULL)
        ON CONFLICT(path) DO UPDATE SET
          recursive = excluded.recursive,
          enabled = 1,
          updated_at = excluded.updated_at
      `)
      .run({
        id,
        path: folderPath,
        recursive: recursive ? 1 : 0,
        now
      });

    const folder = this.getSourceFolderByPath(folderPath);
    this.reassignVideosToMostSpecificSources();
    return folder;
  }

  getSourceFolderByPath(folderPath: string): SourceFolder {
    const row = this.db.prepare("SELECT * FROM source_folders WHERE path = ?").get(folderPath) as SourceFolderRow | undefined;

    if (!row) {
      throw new Error(`Source folder not found: ${folderPath}`);
    }

    return mapSourceFolder(row);
  }

  listSourceFolders(): SourceFolder[] {
    const rows = this.db.prepare("SELECT * FROM source_folders ORDER BY path ASC").all() as SourceFolderRow[];
    return rows.map(mapSourceFolder);
  }

  removeSourceFolder(folderId: string): SourceFolderRemovalResult {
    const transaction = this.db.transaction(() => {
      const folders = this.listSourceFolders();
      const removedFolder = folders.find((folder) => folder.id === folderId);
      if (!removedFolder) {
        throw new Error(`Source folder not found: ${folderId}`);
      }

      const remainingFolders = folders.filter((folder) => folder.id !== folderId);
      const videos = (this.db.prepare("SELECT * FROM videos ORDER BY path ASC").all() as VideoRow[]).map(mapVideo);
      let removedVideoCount = 0;
      let retainedVideoCount = 0;
      let reassignedVideoCount = 0;
      const now = new Date().toISOString();

      for (const video of videos) {
        const nextFolder = findMostSpecificSourceFolder(video.path, video.directory, remainingFolders);
        if (!nextFolder) {
          this.db.prepare("DELETE FROM videos WHERE id = ?").run(video.id);
          removedVideoCount += 1;
          continue;
        }

        if (folderCoversVideo(removedFolder, video.path, video.directory)) {
          retainedVideoCount += 1;
        }
        if (video.sourceFolderId !== nextFolder.id) {
          this.db.prepare("UPDATE videos SET source_folder_id = ?, updated_at = ? WHERE id = ?").run(nextFolder.id, now, video.id);
          reassignedVideoCount += 1;
        }
      }

      this.db.prepare("DELETE FROM source_folders WHERE id = ?").run(folderId);
      return { removedVideoCount, retainedVideoCount, reassignedVideoCount };
    });

    return transaction();
  }

  previewRemoveSourceFolder(folderId: string): SourceFolderRemovalPreview {
    const folders = this.listSourceFolders();
    const removedFolder = folders.find((folder) => folder.id === folderId);
    if (!removedFolder) throw new Error(`Source folder not found: ${folderId}`);
    const remainingFolders = folders.filter((folder) => folder.id !== folderId);
    const videos = (this.db.prepare("SELECT * FROM videos ORDER BY path ASC").all() as VideoRow[]).map(mapVideo);
    let removedVideoCount = 0;
    let retainedVideoCount = 0;

    for (const video of videos) {
      const nextFolder = findMostSpecificSourceFolder(video.path, video.directory, remainingFolders);
      if (!nextFolder) {
        removedVideoCount += 1;
      } else if (folderCoversVideo(removedFolder, video.path, video.directory)) {
        retainedVideoCount += 1;
      }
    }

    return { removedVideoCount, retainedVideoCount };
  }

  updateSourceFolderScanState(folderId: string, lastScannedAt: string, scanError: string | null): void {
    this.db
      .prepare(
        `
          UPDATE source_folders
          SET last_scanned_at = @lastScannedAt,
              scan_error = @scanError,
              updated_at = @updatedAt
          WHERE id = @folderId
        `
      )
      .run({
        folderId,
        lastScannedAt,
        scanError,
        updatedAt: new Date().toISOString()
      });
  }

  upsertVideo(input: UpsertVideoInput): VideoRecord {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`
        SELECT
          id,
          imported_at,
          is_favorite,
          size_bytes,
          modified_at,
          thumbnail_status,
          timeline_preview_status,
          cover_cache_path,
          content_fingerprint,
          fingerprint_status,
          fingerprint_updated_at,
          fingerprint_error
        FROM videos
        WHERE path = ?
      `)
      .get(input.path) as ExistingVideoRow | undefined;
    const sourceFolderId = findMostSpecificSourceFolder(input.path, input.directory, this.listSourceFolders().filter((folder) => folder.enabled))?.id ?? input.sourceFolderId;
    const id = existing?.id ?? crypto.randomUUID();
    const importedAt = existing?.imported_at ?? now;
    const isFavorite = existing?.is_favorite ?? 0;
    const metadataChanged =
      existing !== undefined &&
      (existing.size_bytes !== input.sizeBytes || existing.modified_at !== input.modifiedAt);
    const thumbnailStatus = metadataChanged ? "pending" : existing?.thumbnail_status ?? "pending";
    const timelinePreviewStatus = metadataChanged ? "pending" : existing?.timeline_preview_status ?? "pending";
    const coverCachePath = metadataChanged ? null : existing?.cover_cache_path ?? null;
    const contentFingerprint = metadataChanged ? null : existing?.content_fingerprint ?? null;
    const fingerprintStatus = metadataChanged ? "pending" : existing?.fingerprint_status ?? "pending";
    const fingerprintUpdatedAt = metadataChanged ? null : existing?.fingerprint_updated_at ?? null;
    const fingerprintError = metadataChanged ? null : existing?.fingerprint_error ?? null;
    const metadataStatus = input.metadataStatus ?? "ready";

    if (metadataChanged && existing) {
      this.deleteTimelinePreviews(existing.id);
    }

    this.db
      .prepare(`
        INSERT INTO videos (
          id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
          duration_ms, width, height, format, modified_at, imported_at, updated_at,
          is_favorite, is_pending_delete, is_missing, metadata_status, thumbnail_status, timeline_preview_status, cover_cache_path,
          content_fingerprint, fingerprint_status, fingerprint_updated_at, fingerprint_error
        )
        VALUES (
          @id, @sourceFolderId, @path, @directory, @filename, @basename, @extension, @sizeBytes,
          @durationMs, @width, @height, @format, @modifiedAt, @importedAt, @now,
          @isFavorite, 0, 0, @metadataStatus, @thumbnailStatus, @timelinePreviewStatus, @coverCachePath,
          @contentFingerprint, @fingerprintStatus, @fingerprintUpdatedAt, @fingerprintError
        )
        ON CONFLICT(path) DO UPDATE SET
          source_folder_id = excluded.source_folder_id,
          directory = excluded.directory,
          filename = excluded.filename,
          basename = excluded.basename,
          extension = excluded.extension,
          size_bytes = excluded.size_bytes,
          duration_ms = excluded.duration_ms,
          width = excluded.width,
          height = excluded.height,
          format = excluded.format,
          modified_at = excluded.modified_at,
          updated_at = excluded.updated_at,
          is_missing = 0,
          metadata_status = @metadataStatus,
          thumbnail_status = @thumbnailStatus,
          timeline_preview_status = @timelinePreviewStatus,
          cover_cache_path = @coverCachePath,
          content_fingerprint = @contentFingerprint,
          fingerprint_status = @fingerprintStatus,
          fingerprint_updated_at = @fingerprintUpdatedAt,
          fingerprint_error = @fingerprintError
      `)
      .run({
        ...input,
        sourceFolderId,
        id,
        importedAt,
        now,
        isFavorite,
        thumbnailStatus,
        timelinePreviewStatus,
        coverCachePath,
        contentFingerprint,
        fingerprintStatus,
        fingerprintUpdatedAt,
        fingerprintError,
        metadataStatus
      });

    return this.getVideo(id);
  }

  getVideo(id: string): VideoRecord {
    const row = this.db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as VideoRow | undefined;

    if (!row) {
      throw new Error(`Video not found: ${id}`);
    }

    return mapVideo(row);
  }

  getVideoByPath(filePath: string): VideoRecord | null {
    const row = this.db.prepare("SELECT * FROM videos WHERE path = ?").get(filePath) as VideoRow | undefined;
    return row ? mapVideo(row) : null;
  }

  listVideos(query: LibraryQuery): VideoRecord[] {
    if (query.view === "folder" && !query.folderId) {
      return [];
    }

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (!query.includeMissing) {
      where.push("is_missing = 0");
    }

    if (query.view === "favorites") {
      where.push("is_favorite = 1");
    }

    if (query.view === "pendingDelete") {
      where.push("is_pending_delete = 1");
    }

    if (query.view === "folder" && query.folderId) {
      where.push("source_folder_id = @folderId");
      params.folderId = query.folderId;
    }

    if (query.search.trim()) {
      where.push("filename LIKE @search");
      params.search = `%${query.search.trim()}%`;
    }

    const direction = query.sortDirection === "desc" ? "DESC" : "ASC";
    const orderColumn = SORT_COLUMNS[query.sortField];
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = this.db.prepare(`SELECT * FROM videos ${whereClause} ORDER BY ${orderColumn} ${direction}, filename ASC`).all(params) as VideoRow[];
    return rows.map(mapVideo);
  }

  listVideoPage(query: LibraryPageQuery): LibraryPage {
    if (query.view === "folder" && !query.directoryPath) {
      return { videos: [], page: 1, pageSize: query.pageSize, totalPages: 1, totalCount: 0 };
    }

    const joins = query.view === "recent" ? "JOIN play_history history ON history.video_id = videos.id" : "";
    const where = ["videos.is_missing = 0"];
    const params: Record<string, unknown> = {};

    if (query.view === "favorites") {
      where.push("videos.is_favorite = 1");
    }
    if (query.view === "pendingDelete") {
      where.push("videos.is_pending_delete = 1");
    }
    if (query.view === "folder" && query.directoryPath) {
      params.directoryPath = query.directoryPath;
      if (query.folderScope === "exact") {
        where.push("videos.directory = @directoryPath COLLATE NOCASE");
      } else {
        params.directoryPrefix = `${escapeLikePattern(trimTrailingSeparators(query.directoryPath))}\\%`;
        where.push("(videos.directory = @directoryPath COLLATE NOCASE OR videos.directory LIKE @directoryPrefix ESCAPE '!' COLLATE NOCASE)");
      }
    }
    if (query.search.trim()) {
      params.search = `%${escapeLikePattern(query.search.trim())}%`;
      where.push("videos.filename LIKE @search ESCAPE '!' COLLATE NOCASE");
    }

    const fromClause = `FROM videos ${joins} WHERE ${where.join(" AND ")}`;
    const totalCount = (this.db.prepare(`SELECT COUNT(*) AS count ${fromClause}`).get(params) as CountRow).count;
    const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
    const page = Math.min(Math.max(1, query.page), totalPages);
    const direction = query.sortDirection === "desc" ? "DESC" : "ASC";
    const orderClause = query.view === "recent"
      ? "history.played_at DESC, videos.filename ASC"
      : `videos.${SORT_COLUMNS[query.sortField]} ${direction}, videos.filename ASC`;
    const rows = this.db
      .prepare(`SELECT videos.* ${fromClause} ORDER BY ${orderClause} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: query.pageSize, offset: (page - 1) * query.pageSize }) as VideoRow[];

    return { videos: rows.map(mapVideo), page, pageSize: query.pageSize, totalPages, totalCount };
  }

  getLibraryNavigation(): LibraryNavigationSnapshot {
    const counts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_videos,
           COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) AS favorite_videos,
           COALESCE(SUM(CASE WHEN is_pending_delete = 1 THEN 1 ELSE 0 END), 0) AS pending_delete_videos,
           COALESCE(SUM(CASE WHEN is_pending_delete = 1 THEN size_bytes ELSE 0 END), 0) AS pending_delete_bytes,
           COALESCE(SUM(CASE WHEN metadata_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_metadata_videos
         FROM videos
         WHERE is_missing = 0`
      )
      .get() as LibraryNavigationRow;
    const directoryPaths = (this.db
      .prepare("SELECT DISTINCT directory FROM videos WHERE is_missing = 0 ORDER BY directory COLLATE NOCASE ASC")
      .all() as Array<{ directory: string }>).map((row) => row.directory);

    return {
      totalVideos: counts.total_videos,
      favoriteVideos: counts.favorite_videos,
      pendingDeleteVideos: counts.pending_delete_videos,
      pendingDeleteBytes: counts.pending_delete_bytes,
      pendingMetadataVideos: counts.pending_metadata_videos,
      directoryPaths
    };
  }

  listMissingVideos(): VideoRecord[] {
    return (this.db.prepare("SELECT * FROM videos WHERE is_missing = 1 ORDER BY filename COLLATE NOCASE ASC").all() as VideoRow[]).map(mapVideo);
  }

  listVideosByIds(videoIds: string[]): VideoRecord[] {
    const uniqueIds = [...new Set(videoIds)];
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db.prepare(`SELECT * FROM videos WHERE id IN (${placeholders})`).all(...uniqueIds) as VideoRow[];
    const byId = new Map(rows.map((row) => [row.id, mapVideo(row)]));
    return uniqueIds.map((id) => byId.get(id)).filter((video): video is VideoRecord => Boolean(video));
  }

  listVideosBySourceFolder(sourceFolderId: string): VideoRecord[] {
    const rows = this.db.prepare("SELECT * FROM videos WHERE source_folder_id = ? ORDER BY path ASC").all(sourceFolderId) as VideoRow[];
    return rows.map(mapVideo);
  }

  reconcileSourceFolderMissing(sourceFolderId: string, currentPaths: string[]): void {
    const currentPathKeys = new Set(currentPaths.map(normalizePathKey));

    for (const video of this.listVideosBySourceFolder(sourceFolderId)) {
      const shouldBeMissing = !currentPathKeys.has(normalizePathKey(video.path));
      if (video.isMissing !== shouldBeMissing) {
        this.markMissing(video.id, shouldBeMissing);
      }
    }
  }

  markSourceFolderMissing(sourceFolderId: string, missing: boolean): void {
    this.db
      .prepare("UPDATE videos SET is_missing = ?, updated_at = ? WHERE source_folder_id = ?")
      .run(missing ? 1 : 0, new Date().toISOString(), sourceFolderId);
  }

  setFavorite(videoId: string, favorite: boolean): void {
    this.db.prepare("UPDATE videos SET is_favorite = ?, updated_at = ? WHERE id = ?").run(favorite ? 1 : 0, new Date().toISOString(), videoId);
  }

  setPendingDelete(videoId: string, pendingDelete: boolean): void {
    this.db.prepare("UPDATE videos SET is_pending_delete = ?, updated_at = ? WHERE id = ?").run(pendingDelete ? 1 : 0, new Date().toISOString(), videoId);
  }

  listPendingDeleteVideos(): VideoRecord[] {
    return (this.db
      .prepare("SELECT * FROM videos WHERE is_missing = 0 AND is_pending_delete = 1 ORDER BY filename COLLATE NOCASE ASC")
      .all() as VideoRow[]).map(mapVideo);
  }

  updateVideoPath(videoId: string, nextPath: string): VideoRecord {
    const parsed = path.parse(nextPath);
    const nextSourceFolder = findMostSpecificSourceFolder(nextPath, parsed.dir, this.listSourceFolders());
    if (!nextSourceFolder) throw new Error("Moved file is outside managed source folders");
    const result = this.db
      .prepare(`
        UPDATE videos
        SET path = @path,
            source_folder_id = @sourceFolderId,
            directory = @directory,
            filename = @filename,
            basename = @basename,
            extension = @extension,
            updated_at = @updatedAt,
            is_missing = 0
        WHERE id = @videoId
      `)
      .run({
        videoId,
        sourceFolderId: nextSourceFolder.id,
        path: nextPath,
        directory: parsed.dir,
        filename: parsed.base,
        basename: parsed.name,
        extension: parsed.ext.toLowerCase(),
        updatedAt: new Date().toISOString()
      });

    if (result.changes === 0) {
      throw new Error(`Video not found: ${videoId}`);
    }

    return this.getVideo(videoId);
  }

  markMissing(videoId: string, missing: boolean): void {
    this.db.prepare("UPDATE videos SET is_missing = ?, updated_at = ? WHERE id = ?").run(missing ? 1 : 0, new Date().toISOString(), videoId);
  }

  markFingerprintPending(videoId: string): void {
    this.db
      .prepare(
        "UPDATE videos SET content_fingerprint = NULL, fingerprint_status = 'pending', fingerprint_updated_at = NULL, fingerprint_error = NULL, updated_at = ? WHERE id = ?"
      )
      .run(new Date().toISOString(), videoId);
  }

  markFingerprintReady(videoId: string, contentFingerprint: string, expectedPath: string, expectedSizeBytes: number, expectedModifiedAt: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE videos
         SET content_fingerprint = @contentFingerprint, fingerprint_status = 'ready', fingerprint_updated_at = @now, fingerprint_error = NULL, updated_at = @now
         WHERE id = @videoId AND path = @expectedPath AND size_bytes = @expectedSizeBytes AND modified_at = @expectedModifiedAt AND is_missing = 0`
      )
      .run({ contentFingerprint, now, videoId, expectedPath, expectedSizeBytes, expectedModifiedAt });
    return result.changes > 0;
  }

  markFingerprintFailed(videoId: string, error: string, expectedPath?: string, expectedSizeBytes?: number, expectedModifiedAt?: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE videos
         SET content_fingerprint = NULL, fingerprint_status = 'failed', fingerprint_updated_at = @now, fingerprint_error = @error, updated_at = @now
         WHERE id = @videoId
           AND (@expectedPath IS NULL OR (path = @expectedPath AND size_bytes = @expectedSizeBytes AND modified_at = @expectedModifiedAt))`
      )
      .run({ now, error, videoId, expectedPath: expectedPath ?? null, expectedSizeBytes: expectedSizeBytes ?? null, expectedModifiedAt: expectedModifiedAt ?? null });
    return result.changes > 0;
  }

  listVideosPendingFingerprint(limit = 100): VideoRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM videos WHERE fingerprint_status = 'pending' AND is_missing = 0 ORDER BY updated_at ASC LIMIT ?")
      .all(limit) as VideoRow[];
    return rows.map(mapVideo);
  }

  listVideosPendingFingerprintInDuplicateSizes(limit = 100): VideoRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM videos
         WHERE fingerprint_status IN ('pending', 'failed')
           AND is_missing = 0
           AND size_bytes IN (
             SELECT size_bytes FROM videos WHERE is_missing = 0 GROUP BY size_bytes HAVING COUNT(*) >= 2
           )
         ORDER BY size_bytes DESC, updated_at ASC
         LIMIT ?`
      )
      .all(limit) as VideoRow[];
    return rows.map(mapVideo);
  }

  listVideosPendingMetadata(limit = 1000): VideoRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM videos WHERE metadata_status = 'pending' AND is_missing = 0 ORDER BY imported_at ASC LIMIT ?")
      .all(limit) as VideoRow[];
    return rows.map(mapVideo);
  }

  markMetadataReady(
    videoId: string,
    expectedPath: string,
    expectedSizeBytes: number,
    expectedModifiedAt: string,
    metadata: { durationMs: number | null; width: number | null; height: number | null; format: string | null }
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE videos
         SET duration_ms = @durationMs,
             width = @width,
             height = @height,
             format = @format,
             metadata_status = 'ready',
             updated_at = @updatedAt
         WHERE id = @videoId
           AND path = @expectedPath
           AND size_bytes = @expectedSizeBytes
           AND modified_at = @expectedModifiedAt
           AND metadata_status = 'pending'`
      )
      .run({ videoId, expectedPath, expectedSizeBytes, expectedModifiedAt, ...metadata, updatedAt: new Date().toISOString() });
    return result.changes > 0;
  }

  markMetadataFailed(videoId: string, expectedPath: string, expectedSizeBytes: number, expectedModifiedAt: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE videos
         SET metadata_status = 'failed', updated_at = @updatedAt
         WHERE id = @videoId
           AND path = @expectedPath
           AND size_bytes = @expectedSizeBytes
           AND modified_at = @expectedModifiedAt
           AND metadata_status = 'pending'`
      )
      .run({ videoId, expectedPath, expectedSizeBytes, expectedModifiedAt, updatedAt: new Date().toISOString() });
    return result.changes > 0;
  }

  markMetadataPending(videoId: string, expectedPath: string, expectedSizeBytes: number, expectedModifiedAt: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE videos
         SET metadata_status = 'pending', updated_at = @updatedAt
         WHERE id = @videoId
           AND path = @expectedPath
           AND size_bytes = @expectedSizeBytes
           AND modified_at = @expectedModifiedAt
           AND metadata_status = 'failed'`
      )
      .run({ videoId, expectedPath, expectedSizeBytes, expectedModifiedAt, updatedAt: new Date().toISOString() });
    return result.changes > 0;
  }

  listDuplicateGroupsPage(query: DuplicateGroupPageQuery): DuplicateGroupPage {
    const scopedSizeWhere = ["is_missing = 0"];
    const scopedSizeParams: Record<string, unknown> = {};
    if (query.preferredDirectoryPath) {
      scopedSizeParams.preferredDirectoryPath = query.preferredDirectoryPath;
      if (query.preferredDirectoryScope === "exact") {
        scopedSizeWhere.push("directory = @preferredDirectoryPath COLLATE NOCASE");
      } else {
        scopedSizeParams.preferredDirectoryPrefix = `${escapeLikePattern(trimTrailingSeparators(query.preferredDirectoryPath))}\\%`;
        scopedSizeWhere.push("(directory = @preferredDirectoryPath COLLATE NOCASE OR directory LIKE @preferredDirectoryPrefix ESCAPE '!' COLLATE NOCASE)");
      }
    }
    const scopedSizesQuery = `SELECT DISTINCT size_bytes FROM videos WHERE ${scopedSizeWhere.join(" AND ")}`;
    const candidateSizesQuery = `
      SELECT size_bytes, COUNT(*) AS file_count
      FROM videos
      WHERE is_missing = 0
        AND size_bytes IN (${scopedSizesQuery})
      GROUP BY size_bytes
      HAVING COUNT(*) >= 2
    `;
    const candidateStats = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_groups,
           COALESCE(SUM(file_count), 0) AS total_candidate_files
         FROM (${candidateSizesQuery})`
      )
      .get(scopedSizeParams) as DuplicateStatsRow;

    const scopedIdentityWhere = ["is_missing = 0", "fingerprint_status = 'ready'", "content_fingerprint IS NOT NULL"];
    if (query.preferredDirectoryPath) {
      if (query.preferredDirectoryScope === "exact") {
        scopedIdentityWhere.push("directory = @preferredDirectoryPath COLLATE NOCASE");
      } else {
        scopedIdentityWhere.push("(directory = @preferredDirectoryPath COLLATE NOCASE OR directory LIKE @preferredDirectoryPrefix ESCAPE '!' COLLATE NOCASE)");
      }
    }
    const scopedIdentitiesQuery = `SELECT DISTINCT size_bytes, content_fingerprint FROM videos WHERE ${scopedIdentityWhere.join(" AND ")}`;
    const fingerprintGroupsQuery = `
      SELECT size_bytes, content_fingerprint, COUNT(*) AS file_count
      FROM videos
      WHERE is_missing = 0
        AND fingerprint_status = 'ready'
        AND content_fingerprint IS NOT NULL
        AND (size_bytes, content_fingerprint) IN (${scopedIdentitiesQuery})
      GROUP BY size_bytes, content_fingerprint
      HAVING COUNT(*) >= 2
    `;
    const verifiedStats = this.db
      .prepare(`SELECT COUNT(*) AS total_groups, COALESCE(SUM(file_count), 0) AS total_candidate_files FROM (${fingerprintGroupsQuery})`)
      .get(scopedSizeParams) as DuplicateStatsRow;
    const totalPages = Math.max(1, Math.ceil(verifiedStats.total_groups / query.pageSize));
    const page = Math.min(Math.max(1, query.page), totalPages);
    const direction = query.sortDirection === "asc" ? "ASC" : "DESC";
    const fingerprintRows = this.db
      .prepare(
        `SELECT size_bytes, content_fingerprint
         FROM (${fingerprintGroupsQuery})
         ORDER BY size_bytes ${direction}, content_fingerprint ASC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...scopedSizeParams, limit: query.pageSize, offset: (page - 1) * query.pageSize }) as DuplicateFingerprintRow[];
    const groups = fingerprintRows
      .map((group) => this.buildDuplicateGroup(buildFingerprintGroupKey(group.size_bytes, group.content_fingerprint), query.preferredDirectoryPath, query.preferredDirectoryScope))
      .filter((group): group is DuplicateGroup => group !== null);

    return {
      groups,
      page,
      pageSize: query.pageSize,
      totalPages,
      totalGroups: verifiedStats.total_groups,
      totalCandidateGroups: candidateStats.total_groups,
      totalCandidateFiles: candidateStats.total_candidate_files,
      totalReclaimableBytes: 0,
      directoryOptions: this.listDuplicateDirectoryOptions()
    };
  }

  private listDuplicateDirectoryOptions(): DuplicateDirectoryOption[] {
    const rows = this.db.prepare(`
      WITH duplicate_fingerprints AS (
        SELECT size_bytes, content_fingerprint, COUNT(*) AS file_count
        FROM videos
        WHERE is_missing = 0 AND fingerprint_status = 'ready' AND content_fingerprint IS NOT NULL
        GROUP BY size_bytes, content_fingerprint
        HAVING COUNT(*) >= 2
      )
      SELECT videos.directory, source_folders.path AS source_folder_path, videos.size_bytes, videos.content_fingerprint, duplicate_fingerprints.file_count
      FROM videos
      JOIN duplicate_fingerprints ON duplicate_fingerprints.size_bytes = videos.size_bytes AND duplicate_fingerprints.content_fingerprint = videos.content_fingerprint
      JOIN source_folders ON source_folders.id = videos.source_folder_id
      WHERE videos.is_missing = 0
    `).all() as DuplicateDirectoryRow[];
    const byPath = new Map<string, { path: string; groups: Map<string, { sizeBytes: number; fileCount: number }> }>();

    for (const row of rows) {
      for (const directoryPath of listDirectoryAncestors(row.directory, row.source_folder_path)) {
        const key = normalizeManagedPath(directoryPath);
        const entry = byPath.get(key) ?? { path: directoryPath, groups: new Map<string, { sizeBytes: number; fileCount: number }>() };
        entry.groups.set(buildFingerprintGroupKey(row.size_bytes, row.content_fingerprint), { sizeBytes: row.size_bytes, fileCount: row.file_count });
        byPath.set(key, entry);
      }
    }

    return [...byPath.values()]
      .map(({ path: directoryPath, groups }) => ({
        path: directoryPath,
        groupCount: groups.size,
        estimatedReclaimableBytes: [...groups.values()].reduce((total, group) => total + (group.fileCount - 1) * group.sizeBytes, 0)
      }))
      .sort((left, right) =>
        right.estimatedReclaimableBytes - left.estimatedReclaimableBytes ||
        right.groupCount - left.groupCount ||
        left.path.localeCompare(right.path, "zh-CN", { numeric: true })
      );
  }

  previewDuplicateResolve(plan: DuplicateResolvePlan): Omit<DuplicateResolvePreview, "verificationStatus"> {
    const normalized = this.validateDuplicateResolvePlan(plan);
    let reclaimableBytes = 0;
    let deleteCount = 0;

    for (const entry of normalized) {
      deleteCount += entry.deleteVideos.length;
      reclaimableBytes += entry.deleteVideos.reduce((total, video) => total + video.sizeBytes, 0);
    }

    return {
      groupCount: normalized.length,
      keepCount: normalized.length,
      deleteCount,
      reclaimableBytes
    };
  }

  markThumbnailReady(videoId: string, coverCachePath: string): void {
    this.db
      .prepare("UPDATE videos SET thumbnail_status = 'ready', cover_cache_path = ?, updated_at = ? WHERE id = ?")
      .run(coverCachePath, new Date().toISOString(), videoId);
  }

  markThumbnailFailed(videoId: string): void {
    this.db
      .prepare("UPDATE videos SET thumbnail_status = 'failed', cover_cache_path = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), videoId);
  }

  markThumbnailPending(videoId: string): void {
    this.db
      .prepare("UPDATE videos SET thumbnail_status = 'pending', cover_cache_path = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), videoId);
  }

  markTimelinePreviewReady(videoId: string, timeMs: number, cachePath: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO timeline_previews (id, video_id, time_ms, cache_path, created_at)
          VALUES (@id, @videoId, @timeMs, @cachePath, @createdAt)
          ON CONFLICT(video_id, time_ms) DO UPDATE SET
            cache_path = excluded.cache_path,
            created_at = excluded.created_at
        `
      )
      .run({
        id: crypto.randomUUID(),
        videoId,
        timeMs,
        cachePath,
        createdAt: now
      });

    this.db
      .prepare("UPDATE videos SET timeline_preview_status = 'ready', updated_at = ? WHERE id = ?")
      .run(now, videoId);
  }

  markTimelinePreviewFailed(videoId: string): void {
    this.db.prepare("UPDATE videos SET timeline_preview_status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), videoId);
  }

  listMediaCacheIdentities(): Array<{ path: string; sizeBytes: number; modifiedAt: string }> {
    return (
      this.db
        .prepare("SELECT path, size_bytes, modified_at FROM videos")
        .all() as Array<{ path: string; size_bytes: number; modified_at: string }>
    ).map((row) => ({
      path: row.path,
      sizeBytes: row.size_bytes,
      modifiedAt: row.modified_at
    }));
  }

  forgetMediaCachePaths(cachePaths: readonly string[]): void {
    if (cachePaths.length === 0) return;
    const now = new Date().toISOString();
    const findTimelineVideo = this.db.prepare("SELECT video_id FROM timeline_previews WHERE cache_path = ?");
    const deleteTimeline = this.db.prepare("DELETE FROM timeline_previews WHERE cache_path = ?");
    const resetTimeline = this.db.prepare(
      "UPDATE videos SET timeline_preview_status = 'pending', updated_at = ? WHERE id = ?"
    );
    const resetCover = this.db.prepare(
      "UPDATE videos SET thumbnail_status = 'pending', cover_cache_path = NULL, updated_at = ? WHERE cover_cache_path = ?"
    );
    this.db.transaction(() => {
      for (const cachePath of cachePaths) {
        resetCover.run(now, cachePath);
        const timeline = findTimelineVideo.get(cachePath) as { video_id: string } | undefined;
        deleteTimeline.run(cachePath);
        if (timeline) resetTimeline.run(now, timeline.video_id);
      }
    })();
  }

  resetMediaCacheState(): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM timeline_previews").run();
      this.db
        .prepare(
          "UPDATE videos SET thumbnail_status = 'pending', timeline_preview_status = 'pending', cover_cache_path = NULL, updated_at = ?"
        )
        .run(now);
    })();
  }

  removeVideo(videoId: string): void {
    this.db.prepare("DELETE FROM videos WHERE id = ?").run(videoId);
  }

  recordPlayback(videoId: string, positionMs = 0): void {
    this.getVideo(videoId);
    this.db
      .prepare(
        `
          INSERT INTO play_history (video_id, played_at, position_ms)
          VALUES (@videoId, @playedAt, @positionMs)
          ON CONFLICT(video_id) DO UPDATE SET
            played_at = excluded.played_at,
            position_ms = excluded.position_ms
        `
      )
      .run({
        videoId,
        playedAt: new Date().toISOString(),
        positionMs: Math.max(0, Math.trunc(positionMs))
      });
  }

  listPlayHistory(limit = 200): PlayHistoryEntry[] {
    const rows = this.db
      .prepare("SELECT video_id, played_at, position_ms FROM play_history ORDER BY played_at DESC LIMIT ?")
      .all(limit) as PlayHistoryRow[];
    return rows.map((row) => ({
      videoId: row.video_id,
      playedAt: row.played_at,
      positionMs: row.position_ms
    }));
  }

  private deleteTimelinePreviews(videoId: string): void {
    this.db.prepare("DELETE FROM timeline_previews WHERE video_id = ?").run(videoId);
  }

  private reassignVideosToMostSpecificSources(): void {
    const folders = this.listSourceFolders().filter((folder) => folder.enabled);
    const rows = this.db.prepare("SELECT * FROM videos ORDER BY path ASC").all() as VideoRow[];
    const update = this.db.prepare("UPDATE videos SET source_folder_id = ?, updated_at = ? WHERE id = ?");
    const now = new Date().toISOString();

    for (const row of rows) {
      const video = mapVideo(row);
      const folder = findMostSpecificSourceFolder(video.path, video.directory, folders);
      if (folder && folder.id !== video.sourceFolderId) {
        update.run(folder.id, now, video.id);
      }
    }
  }

  private buildDuplicateGroup(groupKey: string, preferredDirectoryPath?: string, preferredDirectoryScope: "recursive" | "exact" = "recursive"): DuplicateGroup | null {
    const identity = parseFingerprintGroupKey(groupKey);
    if (!identity) {
      return null;
    }
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM videos
          WHERE is_missing = 0
            AND size_bytes = ?
            AND fingerprint_status = 'ready'
            AND content_fingerprint = ?
          ORDER BY filename ASC
        `
      )
      .all(identity.sizeBytes, identity.contentFingerprint) as VideoRow[];

    if (rows.length < 2) {
      return null;
    }

    const videos = rows.map(mapVideo);
    const preferredDirectoryVideos = preferredDirectoryPath
      ? videos.filter((video) => isVideoInDirectoryScope(video.directory, preferredDirectoryPath, preferredDirectoryScope))
      : [];
    const keepCandidates = preferredDirectoryVideos.length > 0 ? preferredDirectoryVideos : videos;
    const recommendedKeep = [...keepCandidates].sort(compareDuplicateKeepCandidates)[0];
    const keepReason = preferredDirectoryVideos.length > 0
      ? `选中目录优先；${getKeepReason(recommendedKeep, keepCandidates)}`
      : getKeepReason(recommendedKeep, videos);

    return {
      groupKey,
      identityStatus: "fingerprint_match",
      recommendedKeepVideoId: recommendedKeep.id,
      reclaimableBytes: videos.reduce((total, video) => total + video.sizeBytes, 0) - recommendedKeep.sizeBytes,
      items: videos.map((video) => ({
        video,
        isRecommendedToKeep: video.id === recommendedKeep.id,
        keepReason: video.id === recommendedKeep.id ? keepReason : null
      }))
    };
  }

  validateDuplicateResolvePlan(plan: DuplicateResolvePlan): Array<{
    groupKey: string;
    keepVideo: VideoRecord;
    deleteVideos: VideoRecord[];
  }> {
    const seenGroupKeys = new Set<string>();

    return plan.groups.map((group) => {
      if (seenGroupKeys.has(group.groupKey)) {
        throw new Error(`Duplicate resolve plan contains the same group twice: ${group.groupKey}`);
      }
      seenGroupKeys.add(group.groupKey);

      const duplicateGroup = this.buildDuplicateGroup(group.groupKey);
      if (!duplicateGroup) {
        throw new Error(`Duplicate group not found: ${group.groupKey}`);
      }

      const groupVideos = new Map(duplicateGroup.items.map((item) => [item.video.id, item.video]));
      const keepVideo = groupVideos.get(group.keepVideoId);
      if (!keepVideo) {
        throw new Error(`Keep video ${group.keepVideoId} is not in duplicate group ${group.groupKey}`);
      }

      const deleteVideoIds = [...new Set(group.deleteVideoIds)];
      if (deleteVideoIds.length === 0) {
        throw new Error(`Duplicate group ${group.groupKey} must delete at least one duplicate`);
      }
      if (deleteVideoIds.includes(group.keepVideoId)) {
        throw new Error(`Duplicate group ${group.groupKey} cannot delete the kept video`);
      }

      const deleteVideos = deleteVideoIds.map((videoId) => {
        const video = groupVideos.get(videoId);
        if (!video) {
          throw new Error(`Delete video ${videoId} is not in duplicate group ${group.groupKey}`);
        }
        return video;
      });

      if (deleteVideos.length !== duplicateGroup.items.length - 1) {
        throw new Error(`Duplicate group ${group.groupKey} must keep exactly one file`);
      }

      return {
        groupKey: group.groupKey,
        keepVideo,
        deleteVideos
      };
    });
  }
}

function mapSourceFolder(row: SourceFolderRow): SourceFolder {
  return {
    id: row.id,
    path: row.path,
    recursive: Boolean(row.recursive),
    enabled: Boolean(row.enabled),
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scanError: row.scan_error
  };
}

function mapVideo(row: VideoRow): VideoRecord {
  return {
    id: row.id,
    sourceFolderId: row.source_folder_id,
    path: row.path,
    directory: row.directory,
    filename: row.filename,
    basename: row.basename,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    format: row.format,
    modifiedAt: row.modified_at,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    isFavorite: Boolean(row.is_favorite),
    isPendingDelete: Boolean(row.is_pending_delete),
    isMissing: Boolean(row.is_missing),
    metadataStatus: row.metadata_status,
    thumbnailStatus: row.thumbnail_status,
    timelinePreviewStatus: row.timeline_preview_status,
    coverCachePath: row.cover_cache_path,
    contentFingerprint: row.content_fingerprint,
    fingerprintStatus: row.fingerprint_status,
    fingerprintUpdatedAt: row.fingerprint_updated_at,
    fingerprintError: row.fingerprint_error
  };
}

function normalizePathKey(filePath: string): string {
  return filePath.toLowerCase();
}

function escapeLikePattern(value: string): string {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function listDirectoryAncestors(directory: string, sourceFolderPath: string): string[] {
  const result: string[] = [];
  const sourceKey = normalizeManagedPath(sourceFolderPath);
  let current = directory;

  while (true) {
    result.push(current);
    if (normalizeManagedPath(current) === sourceKey) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return result;
}

function isVideoInDirectoryScope(directory: string, directoryPath: string, scope: "recursive" | "exact"): boolean {
  const candidate = normalizeManagedPath(directory);
  const selected = normalizeManagedPath(directoryPath);
  return scope === "exact" ? candidate === selected : candidate === selected || candidate.startsWith(`${selected}\\`);
}

function buildFingerprintGroupKey(sizeBytes: number, contentFingerprint: string): string {
  return `fingerprint:${sizeBytes}:${contentFingerprint}`;
}

function parseFingerprintGroupKey(groupKey: string): { sizeBytes: number; contentFingerprint: string } | null {
  const match = /^fingerprint:(\d+):([^:]+)$/.exec(groupKey);
  if (!match) return null;
  const sizeBytes = Number(match[1]);
  return Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
    ? { sizeBytes, contentFingerprint: match[2] }
    : null;
}

function findMostSpecificSourceFolder(filePath: string, directory: string, folders: SourceFolder[]): SourceFolder | null {
  return folders
    .filter((folder) => folderCoversVideo(folder, filePath, directory))
    .sort((left, right) => normalizeManagedPath(right.path).length - normalizeManagedPath(left.path).length)[0] ?? null;
}

function folderCoversVideo(folder: SourceFolder, filePath: string, directory: string): boolean {
  const folderPath = normalizeManagedPath(folder.path);
  if (folder.recursive) {
    const videoPath = normalizeManagedPath(filePath);
    return videoPath.startsWith(`${folderPath}\\`);
  }
  return normalizeManagedPath(directory) === folderPath;
}

function normalizeManagedPath(input: string): string {
  return input.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

function compareDuplicateKeepCandidates(left: VideoRecord, right: VideoRecord): number {
  const leftResolution = (left.width ?? 0) * (left.height ?? 0);
  const rightResolution = (right.width ?? 0) * (right.height ?? 0);

  if (left.isFavorite !== right.isFavorite) {
    return left.isFavorite ? -1 : 1;
  }
  if (leftResolution !== rightResolution) {
    return rightResolution - leftResolution;
  }
  if (left.sizeBytes !== right.sizeBytes) {
    return right.sizeBytes - left.sizeBytes;
  }
  if (left.modifiedAt !== right.modifiedAt) {
    return right.modifiedAt.localeCompare(left.modifiedAt);
  }
  if (left.importedAt !== right.importedAt) {
    return left.importedAt.localeCompare(right.importedAt);
  }
  return left.path.localeCompare(right.path, "zh-CN", { numeric: true });
}

function getKeepReason(video: VideoRecord, videos: VideoRecord[]): string {
  if (video.isFavorite) {
    return "已收藏";
  }

  const resolution = (video.width ?? 0) * (video.height ?? 0);
  if (resolution > 0 && videos.every((candidate) => candidate.id === video.id || resolution > (candidate.width ?? 0) * (candidate.height ?? 0))) {
    return "分辨率更高";
  }

  if (videos.every((candidate) => candidate.id === video.id || video.sizeBytes > candidate.sizeBytes)) {
    return "文件更大";
  }

  if (videos.every((candidate) => candidate.id === video.id || video.modifiedAt > candidate.modifiedAt)) {
    return "文件更新";
  }

  return "自动规则选中";
}
