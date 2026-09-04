import type {
  AssetCenterLatestScan,
  AssetCenterSourcePage,
  AssetCenterSourceQuery,
  AssetCenterSourceRow,
  AssetCenterSummary,
  ScanCounters,
  ScanMode
} from "../../shared/videoTypes.js";
import type { DatabaseConnection } from "../db/database.js";

interface AssetCenterSummaryRow {
  total_video_count: number;
  total_size_bytes: number;
  missing_video_count: number;
  metadata_issue_count: number;
  playback_risk_count: number;
  latest_scanned_at: string | null;
  scan_failure_count: number;
}

interface AssetCenterSourceSummaryRow {
  source_count: number;
  enabled_source_count: number;
  reachable_source_count: number;
  offline_source_count: number;
  check_failed_source_count: number;
  unknown_source_count: number;
}

interface AssetCenterScanTaskRow {
  id: string;
  source_folder_id: string | null;
  mode: ScanMode;
  status: AssetCenterLatestScan["status"];
  started_at: string;
  completed_at: string;
  counters_json: string;
  error_summary: string | null;
}

interface AssetCenterSourceDatabaseRow {
  id: string;
  path: string;
  provider_name: string | null;
  source_type: AssetCenterSourceRow["sourceType"];
  enabled: number;
  availability: AssetCenterSourceRow["availability"];
  last_check_at: string | null;
  video_count: number;
  size_bytes: number;
  missing_video_count: number;
  metadata_issue_count: number;
  scan_failure_count: number;
  issue_count: number;
  last_scanned_at: string | null;
  scan_error: string | null;
  total_count: number;
  total_pages: number;
  resolved_page: number;
}

interface CountRow {
  count: number;
}

export function getAssetCenterSummary(db: DatabaseConnection): AssetCenterSummary {
  const library = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN videos.is_missing = 0 THEN 1 ELSE 0 END), 0) AS total_video_count,
      COALESCE(SUM(CASE WHEN videos.is_missing = 0 THEN videos.size_bytes ELSE 0 END), 0) AS total_size_bytes,
      COALESCE(SUM(CASE WHEN videos.is_missing = 1 THEN 1 ELSE 0 END), 0) AS missing_video_count,
      COALESCE(SUM(CASE
        WHEN videos.is_missing = 0 AND videos.metadata_status IN ('pending', 'failed') THEN 1 ELSE 0
      END), 0) AS metadata_issue_count,
      COALESCE(SUM(CASE
        WHEN videos.is_missing = 1 THEN 0
        WHEN videos.metadata_status = 'pending'
          AND LOWER(videos.extension) IN ('.mp4', '.m4v', '.mov', '.webm') THEN 0
        WHEN videos.metadata_status = 'ready' AND videos.codec_probe_status = 'ready' AND (
          (LOWER(videos.extension) = '.webm'
            AND LOWER(TRIM(COALESCE(videos.video_codec, ''))) IN ('vp8', 'vp9')
            AND LOWER(TRIM(COALESCE(videos.pixel_format, ''))) = 'yuv420p'
            AND (videos.audio_codec IS NULL OR TRIM(videos.audio_codec) = ''
              OR LOWER(TRIM(videos.audio_codec)) IN ('opus', 'vorbis')))
          OR
          (LOWER(videos.extension) IN ('.mp4', '.m4v', '.mov')
            AND LOWER(TRIM(COALESCE(videos.video_codec, ''))) = 'h264'
            AND LOWER(TRIM(COALESCE(videos.video_profile, ''))) IN ('baseline', 'constrained baseline', 'main', 'high')
            AND LOWER(TRIM(COALESCE(videos.pixel_format, ''))) = 'yuv420p'
            AND (videos.audio_codec IS NULL OR TRIM(videos.audio_codec) = ''
              OR LOWER(TRIM(videos.audio_codec)) IN ('aac', 'mp3')))
        ) THEN 0
        ELSE 1
      END), 0) AS playback_risk_count,
      (SELECT MAX(last_scanned_at) FROM source_folders WHERE enabled = 1) AS latest_scanned_at,
      (SELECT COUNT(*)
        FROM scan_failures failures
        JOIN source_folders sources ON sources.id = failures.source_folder_id
        WHERE failures.status != 'resolved' AND sources.enabled = 1) AS scan_failure_count
    FROM videos
  `).get() as AssetCenterSummaryRow;
  const sources = db.prepare(`
    WITH latest_source_scan AS (
      SELECT source_folder_id, status,
        ROW_NUMBER() OVER (PARTITION BY source_folder_id ORDER BY started_at DESC, id DESC) AS row_number
      FROM scan_tasks
      WHERE source_folder_id IS NOT NULL
        AND status IN ('completed', 'completed-with-errors', 'offline', 'error')
    )
    SELECT
      COUNT(*) AS source_count,
      COALESCE(SUM(CASE WHEN source.enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled_source_count,
      COALESCE(SUM(CASE WHEN source.enabled = 1 AND latest.status IN ('completed', 'completed-with-errors') THEN 1 ELSE 0 END), 0) AS reachable_source_count,
      COALESCE(SUM(CASE WHEN source.enabled = 1 AND latest.status = 'offline' THEN 1 ELSE 0 END), 0) AS offline_source_count,
      COALESCE(SUM(CASE WHEN source.enabled = 1 AND latest.status = 'error' THEN 1 ELSE 0 END), 0) AS check_failed_source_count,
      COALESCE(SUM(CASE WHEN source.enabled = 1 AND (latest.status IS NULL OR latest.status NOT IN ('completed', 'completed-with-errors', 'offline', 'error')) THEN 1 ELSE 0 END), 0) AS unknown_source_count
    FROM source_folders source
    LEFT JOIN latest_source_scan latest ON latest.source_folder_id = source.id AND latest.row_number = 1
  `).get() as AssetCenterSourceSummaryRow;
  const latestScanRow = db.prepare(`
    SELECT id, source_folder_id, mode, status, started_at, completed_at, counters_json, error_summary
    FROM scan_tasks
    WHERE completed_at IS NOT NULL AND status IN ('completed', 'completed-with-errors', 'offline', 'error')
    ORDER BY completed_at DESC, started_at DESC, id DESC
    LIMIT 1
  `).get() as AssetCenterScanTaskRow | undefined;

  return {
    generatedAt: new Date().toISOString(),
    totalVideoCount: library.total_video_count,
    totalSizeBytes: library.total_size_bytes,
    sourceCount: sources.source_count,
    enabledSourceCount: sources.enabled_source_count,
    reachableSourceCount: sources.reachable_source_count,
    offlineSourceCount: sources.offline_source_count,
    checkFailedSourceCount: sources.check_failed_source_count,
    unknownSourceCount: sources.unknown_source_count,
    latestScannedAt: library.latest_scanned_at,
    latestCompletedScan: latestScanRow ? mapAssetCenterLatestScan(latestScanRow) : null,
    scanFailureCount: library.scan_failure_count,
    missingVideoCount: library.missing_video_count,
    metadataIssueCount: library.metadata_issue_count,
    playbackRiskCount: library.playback_risk_count,
    duplicateCandidateGroupCount: countAllDuplicateGroups(db)
  };
}

export function listAssetCenterSources(
  db: DatabaseConnection,
  query: AssetCenterSourceQuery
): AssetCenterSourcePage {
  const params: Record<string, unknown> = {
    requestedPage: query.page,
    limit: query.pageSize
  };
  const filters: string[] = [];
  const search = query.search.trim();
  if (search) {
    params.search = `%${escapeLikePattern(search)}%`;
    filters.push("(path LIKE @search ESCAPE '!' COLLATE NOCASE OR provider_name LIKE @search ESCAPE '!' COLLATE NOCASE)");
  }
  if (query.type !== "all") {
    params.sourceType = query.type;
    filters.push("source_type = @sourceType");
  }
  if (query.availability !== "all") {
    params.availability = query.availability;
    filters.push("availability = @availability");
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const sortColumns: Record<AssetCenterSourceQuery["sort"], string> = {
    path: "path COLLATE NOCASE",
    videoCount: "video_count",
    sizeBytes: "size_bytes",
    lastScannedAt: "last_scanned_at",
    issueCount: "issue_count"
  };
  const direction = query.direction === "desc" ? "DESC" : "ASC";
  const rows = db.prepare(`
    WITH latest_source_scan AS MATERIALIZED (
      SELECT source_folder_id, status, completed_at,
        ROW_NUMBER() OVER (PARTITION BY source_folder_id ORDER BY started_at DESC, id DESC) AS row_number
      FROM scan_tasks
      WHERE source_folder_id IS NOT NULL
        AND status IN ('completed', 'completed-with-errors', 'offline', 'error')
    ), video_stats AS MATERIALIZED (
      SELECT source_folder_id,
        SUM(CASE WHEN is_missing = 0 THEN 1 ELSE 0 END) AS video_count,
        SUM(CASE WHEN is_missing = 0 THEN size_bytes ELSE 0 END) AS size_bytes,
        SUM(CASE WHEN is_missing = 1 THEN 1 ELSE 0 END) AS missing_video_count,
        SUM(CASE WHEN is_missing = 0 AND metadata_status IN ('pending', 'failed') THEN 1 ELSE 0 END) AS metadata_issue_count
      FROM videos
      GROUP BY source_folder_id
    ), failure_stats AS MATERIALIZED (
      SELECT source_folder_id, COUNT(*) AS scan_failure_count
      FROM scan_failures
      WHERE status != 'resolved'
      GROUP BY source_folder_id
    ), source_rows AS MATERIALIZED (
      SELECT source.id, source.path, source.provider_name,
        CASE
          WHEN source.provider_type = 'clouddrive' THEN 'clouddrive'
          WHEN source.path LIKE '\\\\%' THEN 'nas'
          ELSE 'localOrMounted'
        END AS source_type,
        source.enabled,
        CASE
          WHEN source.enabled = 0 THEN 'disabled'
          WHEN latest.status IN ('completed', 'completed-with-errors') THEN 'reachable'
          WHEN latest.status = 'offline' THEN 'offline'
          WHEN latest.status = 'error' THEN 'checkFailed'
          ELSE 'unknown'
        END AS availability,
        latest.completed_at AS last_check_at,
        COALESCE(video.video_count, 0) AS video_count,
        COALESCE(video.size_bytes, 0) AS size_bytes,
        COALESCE(video.missing_video_count, 0) AS missing_video_count,
        COALESCE(video.metadata_issue_count, 0) AS metadata_issue_count,
        COALESCE(failure.scan_failure_count, 0) AS scan_failure_count,
        COALESCE(video.missing_video_count, 0) + COALESCE(video.metadata_issue_count, 0)
          + COALESCE(failure.scan_failure_count, 0)
          + CASE WHEN source.scan_error IS NOT NULL AND TRIM(source.scan_error) != ''
            AND COALESCE(failure.scan_failure_count, 0) = 0 THEN 1 ELSE 0 END AS issue_count,
        source.last_scanned_at, source.scan_error
      FROM source_folders source
      LEFT JOIN latest_source_scan latest ON latest.source_folder_id = source.id AND latest.row_number = 1
      LEFT JOIN video_stats video ON video.source_folder_id = source.id
      LEFT JOIN failure_stats failure ON failure.source_folder_id = source.id
    ), filtered_rows AS MATERIALIZED (
      SELECT *, COUNT(*) OVER () AS total_count
      FROM source_rows
      ${where}
    ), numbered_rows AS (
      SELECT *,
        MAX(1, CAST((total_count + @limit - 1) / @limit AS INTEGER)) AS total_pages,
        MIN(@requestedPage, MAX(1, CAST((total_count + @limit - 1) / @limit AS INTEGER))) AS resolved_page,
        ROW_NUMBER() OVER (ORDER BY ${sortColumns[query.sort]} ${direction}, path COLLATE NOCASE ASC) AS result_row_number
      FROM filtered_rows
    )
    SELECT * FROM numbered_rows
    WHERE result_row_number > ((resolved_page - 1) * @limit)
      AND result_row_number <= (resolved_page * @limit)
    ORDER BY result_row_number
  `).all(params) as AssetCenterSourceDatabaseRow[];

  const first = rows[0];
  const totalCount = first?.total_count ?? 0;
  const totalPages = first?.total_pages ?? 1;
  const page = first?.resolved_page ?? 1;
  return {
    items: rows.map(mapAssetCenterSource),
    page,
    pageSize: query.pageSize,
    totalPages,
    totalCount
  };
}

export function countAllDuplicateGroups(db: DatabaseConnection): number {
  return (db.prepare(`
    WITH active_reserved_identities AS MATERIALIZED (
      SELECT DISTINCT reserved_video.size_bytes,
             ((reserved_video.duration_ms + 500) / 1000) AS duration_seconds
      FROM duplicate_cleanup_reservations reservation
      JOIN videos reserved_video ON reserved_video.id = reservation.video_id
      WHERE reservation.released_at IS NULL
    )
    SELECT COUNT(*) AS count
    FROM (
      SELECT videos.size_bytes, ((videos.duration_ms + 500) / 1000) AS duration_seconds
      FROM videos
      WHERE videos.is_missing = 0
        AND videos.metadata_status = 'ready'
        AND videos.duration_ms IS NOT NULL
        AND videos.duration_ms > 0
        AND NOT EXISTS (
          SELECT 1 FROM active_reserved_identities reserved
          WHERE reserved.size_bytes = videos.size_bytes
            AND reserved.duration_seconds = ((videos.duration_ms + 500) / 1000)
        )
      GROUP BY videos.size_bytes, duration_seconds
      HAVING COUNT(*) >= 2
    )
  `).get() as CountRow).count;
}

function mapAssetCenterSource(row: AssetCenterSourceDatabaseRow): AssetCenterSourceRow {
  return {
    id: row.id,
    path: row.path,
    providerName: row.provider_name,
    sourceType: row.source_type,
    enabled: Boolean(row.enabled),
    availability: row.availability,
    lastCheckAt: row.last_check_at,
    videoCount: row.video_count,
    sizeBytes: row.size_bytes,
    missingVideoCount: row.missing_video_count,
    metadataIssueCount: row.metadata_issue_count,
    scanFailureCount: row.scan_failure_count,
    issueCount: row.issue_count,
    lastScannedAt: row.last_scanned_at,
    scanError: row.scan_error
  };
}

function mapAssetCenterLatestScan(row: AssetCenterScanTaskRow): AssetCenterLatestScan {
  let counters: Partial<ScanCounters> = {};
  try {
    const parsed = JSON.parse(row.counters_json) as unknown;
    if (parsed && typeof parsed === "object") counters = parsed as Partial<ScanCounters>;
  } catch {
    // Old or damaged task history must not make the read-only overview unavailable.
  }
  const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
  return {
    taskId: row.id,
    sourceFolderId: row.source_folder_id,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    addedVideos: count(counters.addedVideos),
    updatedVideos: count(counters.updatedVideos),
    missingVideos: count(counters.missingVideos),
    failureCount: count(counters.fileFailures) + count(counters.directoryFailures),
    errorSummary: row.error_summary
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}
