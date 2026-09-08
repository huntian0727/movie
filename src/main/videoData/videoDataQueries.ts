import type { DatabaseConnection } from "../db/database.js";
import { mapVideo, type VideoRow } from "../db/videoRepository.js";
import { videoDataStatus, type VideoDataQuery, type VideoDataPage, type VideoDataRow, type VideoDataSelection } from "../../shared/videoDataTable.js";

const sourceExpression = "CASE WHEN s.provider_type = 'clouddrive' THEN 'clouddrive' WHEN substr(s.path, 1, 2) IN (char(92)||char(92), '//') THEN 'nas' ELSE 'local' END";
const sortColumns = { filename: "v.filename COLLATE NOCASE", sizeBytes: "v.size_bytes", durationMs: "v.duration_ms", importedAt: "v.imported_at", modifiedAt: "v.modified_at" };
type Row = VideoRow & { source_type: VideoDataRow["sourceType"]; source_path: string };
const escapeLike = (value: string) => value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
function build(query: VideoDataQuery) {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (query.search.trim()) { where.push("(v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!')"); params.search = `%${escapeLike(query.search.trim())}%`; }
  if (query.sourceFolderId) { where.push("v.source_folder_id = @source"); params.source = query.sourceFolderId; }
  if (query.directory.trim()) {
    const directory = query.directory.trim().replace(/\//g, "\\").replace(/\\+$/, "");
    where.push("(rtrim(replace(v.directory, '/', char(92)), char(92)) = @directory COLLATE NOCASE OR replace(v.directory, '/', char(92)) LIKE @descendant ESCAPE '!')");
    params.directory = directory; params.descendant = `${escapeLike(directory)}\\%`;
  }
  if (query.sourceType !== "all") { where.push(`${sourceExpression} = @type`); params.type = query.sourceType; }
  const statuses = { normal: "v.is_missing=0 AND v.is_pending_delete=0 AND v.metadata_status='ready'", missing: "v.is_missing=1", failed: "v.is_missing=0 AND v.metadata_status='failed'", pending: "v.is_missing=0 AND v.metadata_status='pending'", pendingDelete: "v.is_pending_delete=1" };
  if (query.status !== "all") where.push(`(${statuses[query.status]})`);
  for (const [key, column, op] of [["minSize", "size_bytes", ">="], ["maxSize", "size_bytes", "<="], ["minDuration", "duration_ms", ">="], ["maxDuration", "duration_ms", "<="], ["addedFrom", "imported_at", ">="], ["addedTo", "imported_at", "<"]] as const) {
    if (query[key] !== undefined) { where.push(`v.${column} ${op} @${key}`); params[key] = query[key]; }
  }
  return { from: `FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`, params,
    order: `${sortColumns[query.sort]} ${query.direction === "asc" ? "ASC" : "DESC"}, v.id ASC` };
}
function map(row: Row): VideoDataRow { return { ...mapVideo(row), sourceType: row.source_type, sourcePath: row.source_path }; }
const select = `SELECT v.*, ${sourceExpression} AS source_type, COALESCE(s.path, '') AS source_path`;
export function queryVideoData(database: DatabaseConnection, query: VideoDataQuery): VideoDataPage {
  return database.transaction(() => {
    const { from, params, order } = build(query);
    const totals = database.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(v.size_bytes),0) AS bytes ${from}`).get(params) as { count: number; bytes: number };
    const totalPages = Math.max(1, Math.ceil(totals.count / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const rows = database.prepare(`WITH paged AS (SELECT v.id ${from} ORDER BY ${order} LIMIT @limit OFFSET @offset)
      ${select} FROM paged p JOIN videos v ON v.id=p.id LEFT JOIN source_folders s ON s.id=v.source_folder_id ORDER BY ${order}`)
      .all({ ...params, limit: query.pageSize, offset: (page - 1) * query.pageSize }) as Row[];
    return { items: rows.map(map), page, pageSize: query.pageSize, totalPages, totalCount: totals.count, totalBytes: totals.bytes };
  })();
}
export function* iterateVideoData(database: DatabaseConnection, query: VideoDataQuery, selection: VideoDataSelection): Generator<VideoDataRow> {
  const { from, params, order } = build(query);
  const ids = new Set(selection.ids), excluded = new Set(selection.excludedIds);
  for (const row of database.prepare(`${select} ${from} ORDER BY ${order}`).iterate(params) as Iterable<Row>) {
    if (selection.all ? !excluded.has(row.id) : ids.has(row.id)) yield map(row);
  }
}
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const videoDataCsvHeader = "\uFEFF文件名,完整路径,大小(字节),时长(毫秒),添加时间,来源,状态,分辨率,视频编码,修改时间\r\n";
export function videoDataCsvRow(video: VideoDataRow): string {
  return [video.filename, video.path, video.sizeBytes, video.durationMs, video.importedAt, video.sourceType, videoDataStatus(video), video.width && video.height ? `${video.width}x${video.height}` : "", video.videoCodec, video.modifiedAt].map(csvCell).join(",") + "\r\n";
}
