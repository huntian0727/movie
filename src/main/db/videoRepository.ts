import crypto from "node:crypto";
import path from "node:path";
import type {
  DuplicateGroup,
  DuplicateDirectoryOption,
  DuplicateGroupPage,
  DuplicateGroupPageQuery,
  DuplicateResolvePlan,
  DuplicateResolvePreview,
  DirectorySnapshot,
  FingerprintStatus,
  LibraryNavigationSnapshot,
  LibraryPage,
  LibraryPageQuery,
  LibraryQuery,
  MetadataStatus,
  PlayHistoryEntry,
  ScanCounters,
  ScanFailure,
  ScanFailureReviewPage,
  ScanFailureReviewQuery,
  ScanFailureObjectType,
  ScanFailureSummary,
  ScanMode,
  SortField,
  SourceFolder,
  SourceFolderRemovalPreview,
  SourceFolderRemovalResult,
  VideoRecord
} from "../../shared/videoTypes.js";
import type { DatabaseConnection } from "./database.js";
import { isManagedPathWithin, normalizeManagedPath } from "../files/pathNormalization.js";

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
  videoCodec?: string | null;
  videoProfile?: string | null;
  pixelFormat?: string | null;
  audioCodec?: string | null;
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
  video_codec: string | null;
  video_profile: string | null;
  pixel_format: string | null;
  audio_codec: string | null;
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

interface DuplicateIdentityRow {
  size_bytes: number;
  duration_ms: number;
}

interface DuplicateDirectoryRow {
  directory: string;
  source_folder_path: string;
  size_bytes: number;
  duration_ms: number;
  file_count: number;
}

interface DuplicateStatsRow {
  total_groups: number;
  total_candidate_files: number;
  total_reclaimable_bytes?: number;
}

interface CountRow {
  count: number;
}

interface DirectorySnapshotRow {
  source_folder_id: string;
  directory_path: string;
  normalized_path: string;
  parent_directory_path: string | null;
  normalized_parent_path: string | null;
  directory_mtime: string;
  direct_video_count: number;
  direct_child_count: number;
  direct_entry_digest: string;
  last_successful_scan_at: string | null;
  is_complete: number;
  has_unresolved_failure: number;
  updated_at: string;
}

interface ScanFailureRow {
  id: string;
  source_folder_id: string;
  scan_task_id: string;
  object_type: ScanFailureObjectType;
  object_path: string;
  normalized_path: string;
  failure_stage: string;
  error_code: string | null;
  error_summary: string;
  first_failed_at: string;
  last_failed_at: string;
  retry_count: number;
  status: ScanFailure["status"];
  resolved_at: string | null;
}

export interface UpsertDirectorySnapshotInput {
  sourceFolderId: string;
  directoryPath: string;
  parentDirectoryPath: string | null;
  directoryMtime: string;
  directVideoCount: number;
  directChildCount: number;
  directEntryDigest: string;
  isComplete: boolean;
  hasUnresolvedFailure: boolean;
  successful: boolean;
}

export interface RecordScanFailureInput {
  sourceFolderId: string;
  scanTaskId: string;
  objectType: ScanFailureObjectType;
  objectPath: string;
  failureStage: string;
  errorCode?: string | null;
  errorSummary: string;
  incrementRetry?: boolean;
}

interface LibraryNavigationRow {
  total_videos: number;
  favorite_videos: number;
  pending_delete_videos: number;
  pending_delete_bytes: number;
  pending_metadata_videos: number;
  scan_failure_count: number;
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
  video_codec: string | null;
  video_profile: string | null;
  pixel_format: string | null;
  audio_codec: string | null;
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

  getDirectorySnapshot(sourceFolderId: string, directoryPath: string): DirectorySnapshot | null {
    const row = this.db
      .prepare("SELECT * FROM directory_snapshots WHERE source_folder_id = ? AND normalized_path = ?")
      .get(sourceFolderId, normalizeManagedPath(directoryPath)) as DirectorySnapshotRow | undefined;
    return row ? mapDirectorySnapshot(row) : null;
  }

  listDirectorySnapshots(sourceFolderId: string): DirectorySnapshot[] {
    return (this.db
      .prepare("SELECT * FROM directory_snapshots WHERE source_folder_id = ? ORDER BY normalized_path")
      .all(sourceFolderId) as DirectorySnapshotRow[]).map(mapDirectorySnapshot);
  }

  upsertDirectorySnapshot(input: UpsertDirectorySnapshotInput): DirectorySnapshot {
    const now = new Date().toISOString();
    const normalizedPath = normalizeManagedPath(input.directoryPath);
    const normalizedParentPath = input.parentDirectoryPath ? normalizeManagedPath(input.parentDirectoryPath) : null;
    const existing = this.getDirectorySnapshot(input.sourceFolderId, input.directoryPath);
    const lastSuccessfulScanAt = input.successful ? now : existing?.lastSuccessfulScanAt ?? null;
    this.db.prepare(`
      INSERT INTO directory_snapshots (
        source_folder_id, directory_path, normalized_path, parent_directory_path, normalized_parent_path,
        directory_mtime, direct_video_count, direct_child_count, direct_entry_digest,
        last_successful_scan_at, is_complete, has_unresolved_failure, updated_at
      ) VALUES (
        @sourceFolderId, @directoryPath, @normalizedPath, @parentDirectoryPath, @normalizedParentPath,
        @directoryMtime, @directVideoCount, @directChildCount, @directEntryDigest,
        @lastSuccessfulScanAt, @isComplete, @hasUnresolvedFailure, @now
      )
      ON CONFLICT(source_folder_id, normalized_path) DO UPDATE SET
        directory_path = excluded.directory_path,
        parent_directory_path = excluded.parent_directory_path,
        normalized_parent_path = excluded.normalized_parent_path,
        directory_mtime = excluded.directory_mtime,
        direct_video_count = excluded.direct_video_count,
        direct_child_count = excluded.direct_child_count,
        direct_entry_digest = excluded.direct_entry_digest,
        last_successful_scan_at = excluded.last_successful_scan_at,
        is_complete = excluded.is_complete,
        has_unresolved_failure = excluded.has_unresolved_failure,
        updated_at = excluded.updated_at
    `).run({
      ...input,
      normalizedPath,
      normalizedParentPath,
      lastSuccessfulScanAt,
      isComplete: input.isComplete ? 1 : 0,
      hasUnresolvedFailure: input.hasUnresolvedFailure ? 1 : 0,
      now
    });
    return this.getDirectorySnapshot(input.sourceFolderId, input.directoryPath)!;
  }

  markDirectorySnapshotIncomplete(sourceFolderId: string, directoryPath: string): void {
    const now = new Date().toISOString();
    const normalizedPath = normalizeManagedPath(directoryPath);
    this.db.prepare(`
      INSERT INTO directory_snapshots (
        source_folder_id, directory_path, normalized_path,
        directory_mtime, direct_video_count, direct_child_count, direct_entry_digest,
        is_complete, has_unresolved_failure, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 1, ?)
      ON CONFLICT(source_folder_id, normalized_path) DO UPDATE SET
        is_complete = 0, has_unresolved_failure = 1, updated_at = excluded.updated_at
    `).run(sourceFolderId, directoryPath, normalizedPath, now, '', now);
  }

  listDirectChildSnapshots(sourceFolderId: string, parentDirectoryPath: string): DirectorySnapshot[] {
    return (this.db.prepare(`
      SELECT * FROM directory_snapshots
      WHERE source_folder_id = ? AND normalized_parent_path = ?
      ORDER BY normalized_path
    `).all(sourceFolderId, normalizeManagedPath(parentDirectoryPath)) as DirectorySnapshotRow[]).map(mapDirectorySnapshot);
  }

  deleteDirectorySnapshotSubtree(sourceFolderId: string, directoryPath: string): void {
    const snapshots = this.listDirectorySnapshots(sourceFolderId)
      .filter((snapshot) => isManagedPathWithin(snapshot.directoryPath, directoryPath));
    const remove = this.db.prepare("DELETE FROM directory_snapshots WHERE source_folder_id = ? AND normalized_path = ?");
    const transaction = this.db.transaction(() => {
      for (const snapshot of snapshots) remove.run(sourceFolderId, snapshot.normalizedPath);
    });
    transaction();
  }

  reconcileDirectoryMissing(sourceFolderId: string, directoryPath: string, currentPaths: string[]): number {
    return this.db.transaction(() => {
      const current = new Set(currentPaths.map(normalizeManagedPath));
      let changed = 0;
      const rows = this.db.prepare(`
        SELECT * FROM videos
        WHERE source_folder_id = ? AND directory = ? COLLATE NOCASE
      `).all(sourceFolderId, path.win32.normalize(directoryPath)) as VideoRow[];
      for (const video of rows.map(mapVideo)) {
        const shouldBeMissing = !current.has(normalizeManagedPath(video.path));
        if (video.isMissing !== shouldBeMissing) {
          this.markMissing(video.id, shouldBeMissing);
          changed += 1;
        }
        if (shouldBeMissing) {
          this.resolveScanFailuresForObject(sourceFolderId, video.path);
        }
      }
      return changed;
    })();
  }

  markDirectorySubtreeMissing(sourceFolderId: string, directoryPath: string): number {
    let changed = 0;
    const normalizedDirectory = path.win32.normalize(directoryPath).replace(/[\\/]+$/, "");
    const escapedLike = `${escapeSqlLike(normalizedDirectory)}\\%`;
    const rows = this.db.prepare(`
      SELECT * FROM videos
      WHERE source_folder_id = ? AND is_missing = 0
        AND (directory = ? COLLATE NOCASE OR directory LIKE ? ESCAPE '\\')
    `).all(sourceFolderId, normalizedDirectory, escapedLike) as VideoRow[];
    for (const video of rows.map(mapVideo)) {
      if (!video.isMissing && isManagedPathWithin(video.directory, directoryPath)) {
        this.markMissing(video.id, true);
        changed += 1;
      }
    }
    return changed;
  }

  recordScanFailure(input: RecordScanFailureInput): ScanFailure {
    const now = new Date().toISOString();
    const normalizedPath = normalizeManagedPath(input.objectPath);
    const existing = this.db.prepare(`
      SELECT * FROM scan_failures
      WHERE source_folder_id = ? AND normalized_path = ? AND failure_stage = ? AND status != 'resolved'
    `).get(input.sourceFolderId, normalizedPath, input.failureStage) as ScanFailureRow | undefined;
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      this.db.prepare(`
        UPDATE scan_failures
        SET scan_task_id = @scanTaskId, object_type = @objectType, object_path = @objectPath,
            error_code = @errorCode, error_summary = @errorSummary, last_failed_at = @now,
            retry_count = retry_count + @retryIncrement, status = 'unresolved', resolved_at = NULL
        WHERE id = @id
      `).run({ ...input, id, errorCode: input.errorCode ?? null, now, retryIncrement: input.incrementRetry ? 1 : 0 });
    } else {
      this.db.prepare(`
        INSERT INTO scan_failures (
          id, source_folder_id, scan_task_id, object_type, object_path, normalized_path,
          failure_stage, error_code, error_summary, first_failed_at, last_failed_at,
          retry_count, status, resolved_at
        ) VALUES (
          @id, @sourceFolderId, @scanTaskId, @objectType, @objectPath, @normalizedPath,
          @failureStage, @errorCode, @errorSummary, @now, @now, @retryCount, 'unresolved', NULL
        )
      `).run({ ...input, id, normalizedPath, errorCode: input.errorCode ?? null, now, retryCount: input.incrementRetry ? 1 : 0 });
    }
    const failure = this.getScanFailure(id)!;
    this.refreshSourceFolderFailureState(input.sourceFolderId);
    this.refreshDirectoryFailureState(input.sourceFolderId, input.objectPath, input.objectType);
    return failure;
  }

  getScanFailure(id: string): ScanFailure | null {
    const row = this.db.prepare("SELECT * FROM scan_failures WHERE id = ?").get(id) as ScanFailureRow | undefined;
    return row ? mapScanFailure(row) : null;
  }

  listScanFailures(sourceFolderId: string, includeResolved = false): ScanFailure[] {
    const rows = this.db.prepare(`
      SELECT * FROM scan_failures
      WHERE source_folder_id = ? ${includeResolved ? "" : "AND status != 'resolved'"}
      ORDER BY last_failed_at DESC, id ASC
    `).all(sourceFolderId) as ScanFailureRow[];
    return rows.map(mapScanFailure);
  }

  listScanFailureReviewPage(query: ScanFailureReviewQuery): ScanFailureReviewPage {
    const params: Record<string, string | number> = {};
    const where = ["failures.status != 'resolved'"];
    if (query.sourceFolderId) {
      where.push("failures.source_folder_id = @sourceFolderId");
      params.sourceFolderId = query.sourceFolderId;
    }

    const joinedFrom = `
      FROM scan_failures failures
      JOIN source_folders sources ON sources.id = failures.source_folder_id
      LEFT JOIN videos ON videos.path = failures.object_path
      WHERE sources.enabled = 1 AND ${where.join(" AND ")}`;
    const kindExpression = `CASE
      WHEN failures.object_type = 'directory' THEN 'directory'
      WHEN videos.id IS NOT NULL THEN 'video'
      ELSE 'unindexed-file'
    END`;
    const countRows = this.db.prepare(`
      SELECT ${kindExpression} AS kind, COUNT(*) AS count
      ${joinedFrom}
      GROUP BY kind
    `).all(params) as Array<{ kind: "video" | "unindexed-file" | "directory"; count: number }>;
    const countMap = new Map(countRows.map((row) => [row.kind, row.count]));
    const counts = {
      video: countMap.get("video") ?? 0,
      unindexedFile: countMap.get("unindexed-file") ?? 0,
      directory: countMap.get("directory") ?? 0,
      all: countRows.reduce((total, row) => total + row.count, 0)
    };

    const kindWhere = query.kind === "all" ? "" : ` AND ${kindExpression} = @kind`;
    if (query.kind !== "all") params.kind = query.kind;
    const totalCount = query.kind === "all"
      ? counts.all
      : query.kind === "unindexed-file"
        ? counts.unindexedFile
        : counts[query.kind];
    const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
    const page = Math.min(Math.max(1, query.page), totalPages);
    const rows = this.db.prepare(`
      SELECT failures.*
      ${joinedFrom}${kindWhere}
      ORDER BY failures.last_failed_at DESC, failures.id ASC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: query.pageSize, offset: (page - 1) * query.pageSize }) as ScanFailureRow[];

    return {
      items: rows.map((row) => {
        const failure = mapScanFailure(row);
        const video = failure.objectType === "file" ? this.getVideoByPath(failure.objectPath) : null;
        return {
          failure,
          video,
          kind: failure.objectType === "directory" ? "directory" : video ? "video" : "unindexed-file"
        };
      }),
      page,
      pageSize: query.pageSize,
      totalPages,
      totalCount,
      counts
    };
  }

  markScanFailureRetrying(failureId: string): void {
    this.db.prepare("UPDATE scan_failures SET status = 'retrying' WHERE id = ? AND status != 'resolved'").run(failureId);
  }

  resolveScanFailure(failureId: string): number {
    const failure = this.getScanFailure(failureId);
    const now = new Date().toISOString();
    const changes = this.db.prepare("UPDATE scan_failures SET status = 'resolved', resolved_at = ? WHERE id = ? AND status != 'resolved'").run(now, failureId).changes;
    if (changes > 0 && failure) {
      this.refreshSourceFolderFailureState(failure.sourceFolderId);
      this.refreshDirectoryFailureState(failure.sourceFolderId, failure.objectPath, failure.objectType);
    }
    return changes;
  }

  resolveScanFailuresForObject(sourceFolderId: string, objectPath: string, objectType?: ScanFailureObjectType): number {
    const matchingFailures = this.listScanFailures(sourceFolderId).filter((failure) =>
      failure.normalizedPath === normalizeManagedPath(objectPath) && (!objectType || failure.objectType === objectType)
    );
    const now = new Date().toISOString();
    const result = objectType
      ? this.db.prepare(`UPDATE scan_failures SET status = 'resolved', resolved_at = ? WHERE source_folder_id = ? AND normalized_path = ? AND object_type = ? AND status != 'resolved'`)
        .run(now, sourceFolderId, normalizeManagedPath(objectPath), objectType)
      : this.db.prepare(`UPDATE scan_failures SET status = 'resolved', resolved_at = ? WHERE source_folder_id = ? AND normalized_path = ? AND status != 'resolved'`)
        .run(now, sourceFolderId, normalizeManagedPath(objectPath));
    if (result.changes > 0) {
      this.refreshSourceFolderFailureState(sourceFolderId);
      for (const failure of matchingFailures) this.refreshDirectoryFailureState(sourceFolderId, failure.objectPath, failure.objectType);
    }
    return result.changes;
  }

  resolveScanFailuresForObjectStage(
    sourceFolderId: string,
    objectPath: string,
    objectType: ScanFailureObjectType,
    failureStage: string
  ): number {
    const result = this.db.prepare(`
      UPDATE scan_failures
      SET status = 'resolved', resolved_at = ?
      WHERE source_folder_id = ? AND normalized_path = ? AND object_type = ?
        AND failure_stage = ? AND status != 'resolved'
    `).run(
      new Date().toISOString(),
      sourceFolderId,
      normalizeManagedPath(objectPath),
      objectType,
      failureStage
    );
    if (result.changes > 0) {
      this.refreshSourceFolderFailureState(sourceFolderId);
      this.refreshDirectoryFailureState(sourceFolderId, objectPath, objectType);
    }
    return result.changes;
  }

  resolveScanFailuresInSubtree(sourceFolderId: string, directoryPath: string): number {
    let resolved = 0;
    for (const failure of this.listScanFailures(sourceFolderId)) {
      if (isManagedPathWithin(failure.objectPath, directoryPath)) {
        this.resolveScanFailure(failure.id);
        resolved += 1;
      }
    }
    return resolved;
  }

  getScanFailureSummary(sourceFolderId: string): ScanFailureSummary {
    const failures = this.listScanFailures(sourceFolderId);
    const latest = failures[0];
    return {
      sourceFolderId,
      failedFileCount: failures.filter((failure) => failure.objectType === "file").length,
      failedDirectoryCount: failures.filter((failure) => failure.objectType === "directory").length,
      totalUnresolved: failures.length,
      latestError: latest?.errorSummary ?? null,
      latestFailedAt: latest?.lastFailedAt ?? null,
      totalRetryCount: failures.reduce((total, failure) => total + failure.retryCount, 0)
    };
  }

  private refreshSourceFolderFailureState(sourceFolderId: string): void {
    const latest = this.db.prepare(`
      SELECT error_summary FROM scan_failures
      WHERE source_folder_id = ? AND status != 'resolved'
      ORDER BY last_failed_at DESC, id ASC LIMIT 1
    `).get(sourceFolderId) as { error_summary: string } | undefined;
    this.db.prepare("UPDATE source_folders SET scan_error = ?, updated_at = ? WHERE id = ?")
      .run(latest?.error_summary ?? null, new Date().toISOString(), sourceFolderId);
  }

  private refreshDirectoryFailureState(
    sourceFolderId: string,
    objectPath: string,
    objectType: ScanFailureObjectType
  ): void {
    const directoryPath = objectType === "directory" ? objectPath : path.win32.dirname(objectPath);
    const normalizedDirectory = normalizeManagedPath(directoryPath);
    const hasUnresolvedFailure = this.listScanFailures(sourceFolderId).some((failure) => {
      const failureDirectory = failure.objectType === "directory"
        ? failure.objectPath
        : path.win32.dirname(failure.objectPath);
      return normalizeManagedPath(failureDirectory) === normalizedDirectory;
    });
    this.db.prepare(`
      UPDATE directory_snapshots
      SET has_unresolved_failure = ?, updated_at = ?
      WHERE source_folder_id = ? AND normalized_path = ?
    `).run(hasUnresolvedFailure ? 1 : 0, new Date().toISOString(), sourceFolderId, normalizedDirectory);
  }

  createScanTask(id: string, sourceFolderId: string | null, mode: ScanMode): void {
    this.db.prepare(`
      INSERT INTO scan_tasks (id, source_folder_id, mode, status, started_at, completed_at, counters_json, error_summary)
      VALUES (?, ?, ?, 'running', ?, NULL, '{}', NULL)
    `).run(id, sourceFolderId, mode, new Date().toISOString());
  }

  completeScanTask(id: string, status: string, counters: ScanCounters, errorSummary: string | null): void {
    this.db.prepare(`
      UPDATE scan_tasks SET status = ?, completed_at = ?, counters_json = ?, error_summary = ? WHERE id = ?
    `).run(status, new Date().toISOString(), JSON.stringify(counters), errorSummary, id);
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
          fingerprint_error,
          video_codec,
          video_profile,
          pixel_format,
          audio_codec
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
    const videoCodec = metadataChanged ? input.videoCodec ?? null : input.videoCodec ?? existing?.video_codec ?? null;
    const videoProfile = metadataChanged ? input.videoProfile ?? null : input.videoProfile ?? existing?.video_profile ?? null;
    const pixelFormat = metadataChanged ? input.pixelFormat ?? null : input.pixelFormat ?? existing?.pixel_format ?? null;
    const audioCodec = metadataChanged ? input.audioCodec ?? null : input.audioCodec ?? existing?.audio_codec ?? null;

    if (metadataChanged && existing) {
      this.deleteTimelinePreviews(existing.id);
    }

    this.db
      .prepare(`
        INSERT INTO videos (
          id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
          duration_ms, width, height, format, modified_at, imported_at, updated_at,
          video_codec, video_profile, pixel_format, audio_codec,
          is_favorite, is_pending_delete, is_missing, metadata_status, thumbnail_status, timeline_preview_status, cover_cache_path,
          content_fingerprint, fingerprint_status, fingerprint_updated_at, fingerprint_error
        )
        VALUES (
          @id, @sourceFolderId, @path, @directory, @filename, @basename, @extension, @sizeBytes,
          @durationMs, @width, @height, @format, @modifiedAt, @importedAt, @now,
          @videoCodec, @videoProfile, @pixelFormat, @audioCodec,
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
          video_codec = excluded.video_codec,
          video_profile = excluded.video_profile,
          pixel_format = excluded.pixel_format,
          audio_codec = excluded.audio_codec,
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
        metadataStatus,
        videoCodec,
        videoProfile,
        pixelFormat,
        audioCodec
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
           COALESCE(SUM(CASE WHEN metadata_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_metadata_videos,
           (SELECT COUNT(*) FROM scan_failures failures JOIN source_folders sources ON sources.id = failures.source_folder_id WHERE failures.status != 'resolved' AND sources.enabled = 1) AS scan_failure_count
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
      scanFailureCount: counts.scan_failure_count,
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

  markMissingIfVersion(videoId: string, expectedPath: string, expectedSizeBytes: number, expectedModifiedAt: string): boolean {
    const result = this.db.prepare(`
      UPDATE videos
      SET is_missing = 1, updated_at = @updatedAt
      WHERE id = @videoId
        AND path = @expectedPath
        AND size_bytes = @expectedSizeBytes
        AND modified_at = @expectedModifiedAt
    `).run({ videoId, expectedPath, expectedSizeBytes, expectedModifiedAt, updatedAt: new Date().toISOString() });
    return result.changes > 0;
  }

  refreshVideoFileVersion(
    videoId: string,
    expectedPath: string,
    expectedSizeBytes: number,
    expectedModifiedAt: string,
    currentSizeBytes: number,
    currentModifiedAt: string
  ): boolean {
    return this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE videos
        SET size_bytes = @currentSizeBytes,
            modified_at = @currentModifiedAt,
            duration_ms = NULL,
            width = NULL,
            height = NULL,
            format = NULL,
            video_codec = NULL,
            video_profile = NULL,
            pixel_format = NULL,
            audio_codec = NULL,
            is_missing = 0,
            metadata_status = 'pending',
            thumbnail_status = 'pending',
            timeline_preview_status = 'pending',
            cover_cache_path = NULL,
            content_fingerprint = NULL,
            fingerprint_status = 'pending',
            fingerprint_updated_at = NULL,
            fingerprint_error = NULL,
            updated_at = @updatedAt
        WHERE id = @videoId
          AND path = @expectedPath
          AND size_bytes = @expectedSizeBytes
          AND modified_at = @expectedModifiedAt
      `).run({
        videoId,
        expectedPath,
        expectedSizeBytes,
        expectedModifiedAt,
        currentSizeBytes,
        currentModifiedAt,
        updatedAt: new Date().toISOString()
      });
      if (result.changes > 0) this.deleteTimelinePreviews(videoId);
      return result.changes > 0;
    })();
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
    metadata: { durationMs: number | null; width: number | null; height: number | null; format: string | null; videoCodec?: string | null; videoProfile?: string | null; pixelFormat?: string | null; audioCodec?: string | null }
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE videos
         SET duration_ms = @durationMs,
             width = @width,
             height = @height,
             format = @format,
             video_codec = @videoCodec,
             video_profile = @videoProfile,
             pixel_format = @pixelFormat,
             audio_codec = @audioCodec,
             metadata_status = 'ready',
             updated_at = @updatedAt
         WHERE id = @videoId
           AND path = @expectedPath
           AND size_bytes = @expectedSizeBytes
           AND modified_at = @expectedModifiedAt
           AND metadata_status = 'pending'`
      )
      .run({
        videoId,
        expectedPath,
        expectedSizeBytes,
        expectedModifiedAt,
        ...metadata,
        videoCodec: metadata.videoCodec ?? null,
        videoProfile: metadata.videoProfile ?? null,
        pixelFormat: metadata.pixelFormat ?? null,
        audioCodec: metadata.audioCodec ?? null,
        updatedAt: new Date().toISOString()
      });
    return result.changes > 0;
  }

  updateCodecMetadataIfVersion(
    videoId: string,
    expectedPath: string,
    expectedSizeBytes: number,
    expectedModifiedAt: string,
    metadata: { videoCodec: string | null; videoProfile: string | null; pixelFormat: string | null; audioCodec: string | null }
  ): boolean {
    const result = this.db.prepare(`
      UPDATE videos
      SET video_codec = @videoCodec,
          video_profile = @videoProfile,
          pixel_format = @pixelFormat,
          audio_codec = @audioCodec,
          updated_at = @updatedAt
      WHERE id = @videoId
        AND path = @expectedPath
        AND size_bytes = @expectedSizeBytes
        AND modified_at = @expectedModifiedAt
        AND metadata_status = 'ready'
        AND video_codec IS NULL
    `).run({ videoId, expectedPath, expectedSizeBytes, expectedModifiedAt, ...metadata, updatedAt: new Date().toISOString() });
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

    const scopedIdentityWhere = [
      "is_missing = 0",
      "metadata_status = 'ready'",
      "duration_ms IS NOT NULL",
      "duration_ms > 0"
    ];
    if (query.preferredDirectoryPath) {
      if (query.preferredDirectoryScope === "exact") {
        scopedIdentityWhere.push("directory = @preferredDirectoryPath COLLATE NOCASE");
      } else {
        scopedIdentityWhere.push("(directory = @preferredDirectoryPath COLLATE NOCASE OR directory LIKE @preferredDirectoryPrefix ESCAPE '!' COLLATE NOCASE)");
      }
    }
    const scopedIdentitiesQuery = `SELECT DISTINCT size_bytes, duration_ms FROM videos WHERE ${scopedIdentityWhere.join(" AND ")}`;
    const duplicateGroupsQuery = `
      SELECT size_bytes, duration_ms, COUNT(*) AS file_count
      FROM videos
      WHERE is_missing = 0
        AND metadata_status = 'ready'
        AND duration_ms IS NOT NULL
        AND duration_ms > 0
        AND NOT EXISTS (
          SELECT 1 FROM duplicate_cleanup_reservations active_reservation
          JOIN videos reserved_video ON reserved_video.id = active_reservation.video_id
          WHERE active_reservation.released_at IS NULL
            AND reserved_video.size_bytes = videos.size_bytes
            AND reserved_video.duration_ms = videos.duration_ms
        )
        AND (size_bytes, duration_ms) IN (${scopedIdentitiesQuery})
      GROUP BY size_bytes, duration_ms
      HAVING COUNT(*) >= 2
    `;
    const verifiedStats = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_groups,
           COALESCE(SUM(file_count), 0) AS total_candidate_files,
           COALESCE(SUM((file_count - 1) * size_bytes), 0) AS total_reclaimable_bytes
         FROM (${duplicateGroupsQuery})`
      )
      .get(scopedSizeParams) as DuplicateStatsRow;
    const totalPages = Math.max(1, Math.ceil(verifiedStats.total_groups / query.pageSize));
    const page = Math.min(Math.max(1, query.page), totalPages);
    const direction = query.sortDirection === "asc" ? "ASC" : "DESC";
    const identityRows = this.db
      .prepare(
        `SELECT size_bytes, duration_ms
         FROM (${duplicateGroupsQuery})
         ORDER BY size_bytes ${direction}, duration_ms ASC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...scopedSizeParams, limit: query.pageSize, offset: (page - 1) * query.pageSize }) as DuplicateIdentityRow[];
    const groups = identityRows
      .map((group) => this.buildDuplicateGroup(buildSizeDurationGroupKey(group.size_bytes, group.duration_ms), query.preferredDirectoryPath, query.preferredDirectoryScope))
      .filter((group): group is DuplicateGroup => group !== null);

    return {
      groups,
      page,
      pageSize: query.pageSize,
      totalPages,
      totalGroups: verifiedStats.total_groups,
      totalCandidateGroups: candidateStats.total_groups,
      totalCandidateFiles: candidateStats.total_candidate_files,
      totalReclaimableBytes: verifiedStats.total_reclaimable_bytes ?? 0,
      directoryOptions: this.listDuplicateDirectoryOptions()
    };
  }

  private listDuplicateDirectoryOptions(): DuplicateDirectoryOption[] {
    const rows = this.db.prepare(`
      WITH duplicate_identities AS (
        SELECT size_bytes, duration_ms, COUNT(*) AS file_count
        FROM videos
        WHERE is_missing = 0
          AND metadata_status = 'ready'
          AND duration_ms IS NOT NULL
          AND duration_ms > 0
          AND NOT EXISTS (
            SELECT 1 FROM duplicate_cleanup_reservations active_reservation
            JOIN videos reserved_video ON reserved_video.id = active_reservation.video_id
            WHERE active_reservation.released_at IS NULL
              AND reserved_video.size_bytes = videos.size_bytes
              AND reserved_video.duration_ms = videos.duration_ms
          )
        GROUP BY size_bytes, duration_ms
        HAVING COUNT(*) >= 2
      )
      SELECT videos.directory, source_folders.path AS source_folder_path, videos.size_bytes, videos.duration_ms, duplicate_identities.file_count
      FROM videos
      JOIN duplicate_identities ON duplicate_identities.size_bytes = videos.size_bytes AND duplicate_identities.duration_ms = videos.duration_ms
      JOIN source_folders ON source_folders.id = videos.source_folder_id
      WHERE videos.is_missing = 0
        AND videos.metadata_status = 'ready'
        AND videos.duration_ms IS NOT NULL
        AND videos.duration_ms > 0
    `).all() as DuplicateDirectoryRow[];
    const byPath = new Map<string, { path: string; groups: Map<string, { sizeBytes: number; fileCount: number }> }>();

    for (const row of rows) {
      for (const directoryPath of listDirectoryAncestors(row.directory, row.source_folder_path)) {
        const key = normalizeManagedPath(directoryPath);
        const entry = byPath.get(key) ?? { path: directoryPath, groups: new Map<string, { sizeBytes: number; fileCount: number }>() };
        entry.groups.set(buildSizeDurationGroupKey(row.size_bytes, row.duration_ms), { sizeBytes: row.size_bytes, fileCount: row.file_count });
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
    const identity = parseSizeDurationGroupKey(groupKey);
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
            AND metadata_status = 'ready'
            AND duration_ms = ?
            AND NOT EXISTS (
              SELECT 1 FROM duplicate_cleanup_reservations active_reservation
              JOIN videos reserved_video ON reserved_video.id = active_reservation.video_id
              WHERE active_reservation.released_at IS NULL
                AND reserved_video.size_bytes = videos.size_bytes
                AND reserved_video.duration_ms = videos.duration_ms
            )
          ORDER BY filename ASC
        `
      )
      .all(identity.sizeBytes, identity.durationMs) as VideoRow[];

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
      identityStatus: "size_duration_match",
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
    videoCodec: row.video_codec,
    videoProfile: row.video_profile,
    pixelFormat: row.pixel_format,
    audioCodec: row.audio_codec,
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

function mapDirectorySnapshot(row: DirectorySnapshotRow): DirectorySnapshot {
  return {
    sourceFolderId: row.source_folder_id,
    directoryPath: row.directory_path,
    normalizedPath: row.normalized_path,
    parentDirectoryPath: row.parent_directory_path,
    normalizedParentPath: row.normalized_parent_path,
    directoryMtime: row.directory_mtime,
    directVideoCount: row.direct_video_count,
    directChildCount: row.direct_child_count,
    directEntryDigest: row.direct_entry_digest,
    lastSuccessfulScanAt: row.last_successful_scan_at,
    isComplete: Boolean(row.is_complete),
    hasUnresolvedFailure: Boolean(row.has_unresolved_failure),
    updatedAt: row.updated_at
  };
}

function mapScanFailure(row: ScanFailureRow): ScanFailure {
  return {
    id: row.id,
    sourceFolderId: row.source_folder_id,
    scanTaskId: row.scan_task_id,
    objectType: row.object_type,
    objectPath: row.object_path,
    normalizedPath: row.normalized_path,
    failureStage: row.failure_stage,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    firstFailedAt: row.first_failed_at,
    lastFailedAt: row.last_failed_at,
    retryCount: row.retry_count,
    status: row.status,
    resolvedAt: row.resolved_at
  };
}

function normalizePathKey(filePath: string): string {
  return normalizeManagedPath(filePath);
}

function escapeSqlLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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

function buildSizeDurationGroupKey(sizeBytes: number, durationMs: number): string {
  return `size-duration:${sizeBytes}:${durationMs}`;
}

function parseSizeDurationGroupKey(groupKey: string): { sizeBytes: number; durationMs: number } | null {
  const match = /^size-duration:(\d+):(\d+)$/.exec(groupKey);
  if (!match) return null;
  const sizeBytes = Number(match[1]);
  const durationMs = Number(match[2]);
  return Number.isSafeInteger(sizeBytes) && sizeBytes >= 0 && Number.isSafeInteger(durationMs) && durationMs > 0
    ? { sizeBytes, durationMs }
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
