import type { LibraryPage, PlaybackDiagnosticSearchQuery } from "../../shared/videoTypes.js";
import type { DatabaseConnection } from "../db/database.js";
import { mapVideo, type VideoRow } from "../db/videoRepository.js";

interface CountRow {
  count: number;
}

export function searchPlaybackDiagnosticVideos(
  database: DatabaseConnection,
  query: PlaybackDiagnosticSearchQuery
): LibraryPage {
  const search = query.search.trim();
  if (!search) return emptyPage();

  const params = { search: `%${escapeLikePattern(search)}%` };
  const whereClause = `
    WHERE videos.is_missing = 0
      AND (
        videos.filename LIKE @search ESCAPE '!' COLLATE NOCASE
        OR videos.path LIKE @search ESCAPE '!' COLLATE NOCASE
      )
  `;
  const totalCount = (database.prepare(`SELECT COUNT(*) AS count FROM videos ${whereClause}`).get(params) as CountRow).count;
  const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
  const page = Math.min(Math.max(1, query.page), totalPages);
  if (totalCount === 0) return { ...emptyPage(), page, totalPages, totalCount };

  const rows = database.prepare(`
    SELECT videos.*
    FROM videos
    ${whereClause}
    ORDER BY videos.filename COLLATE NOCASE ASC, videos.path COLLATE NOCASE ASC, videos.id ASC
    LIMIT @limit OFFSET @offset
  `).all({
    ...params,
    limit: query.pageSize,
    offset: (page - 1) * query.pageSize
  }) as VideoRow[];

  return {
    videos: rows.map(mapVideo),
    page,
    pageSize: query.pageSize,
    totalPages,
    totalCount
  };
}

export function escapePlaybackDiagnosticLikePattern(value: string): string {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}

function escapeLikePattern(value: string): string {
  return escapePlaybackDiagnosticLikePattern(value);
}

function emptyPage(): LibraryPage {
  return { videos: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0 };
}
