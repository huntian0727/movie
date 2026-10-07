import type { DatabaseConnection } from "../db/database.js";
import type { DirectoryBrowserItem, DirectoryBrowserQuery, DirectoryBrowserResult } from "../../shared/videoTypes.js";

const normalize = (value: string) => value.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
const nameOf = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;

/** Search registered roots and video-backed ancestors without reading the filesystem. */
export function searchIndexedDirectories(db: DatabaseConnection, query: DirectoryBrowserQuery): DirectoryBrowserResult {
  const keyword = query.search.trim().replace(/\//g, "\\").toLocaleLowerCase();
  const sources = db.prepare(`SELECT id, path FROM source_folders ${query.sourceFolderId ? "WHERE id = ?" : ""}`)
    .all(...(query.sourceFolderId ? [query.sourceFolderId] : [])) as { id: string; path: string }[];
  const roots = new Map(sources.map((source) => [source.id, source.path.replace(/\//g, "\\").replace(/\\+$/, "")]));
  const candidates = new Map<string, DirectoryBrowserItem>();
  const rank = (item: DirectoryBrowserItem) => {
    const name = item.name.toLocaleLowerCase();
    return name === keyword || normalize(item.path) === normalize(keyword) ? 0 : name.startsWith(keyword) ? 1 : name.includes(keyword) ? 2 : 3;
  };
  const compare = (a: DirectoryBrowserItem, b: DirectoryBrowserItem) => rank(a) - rank(b)
    || a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase(), "zh-CN", { numeric: true })
    || normalize(a.path).localeCompare(normalize(b.path), "zh-CN", { numeric: true }) || a.sourceFolderId.localeCompare(b.sourceFolderId);
  const keptLimit = query.limit + 1;
  const add = (sourceFolderId: string, directory: string, count: number, size: number, modifiedAt: string | null) => {
    const path = /^[a-z]:$/i.test(directory) ? `${directory}\\` : directory;
    if (!path.toLocaleLowerCase().includes(keyword)) return;
    const key = JSON.stringify([sourceFolderId, normalize(path)]);
    const current = candidates.get(key);
    if (current) {
      current.videoCount += count;
      current.sizeBytes += size;
      if (modifiedAt && (!current.modifiedAt || modifiedAt > current.modifiedAt)) current.modifiedAt = modifiedAt;
    } else candidates.set(key, { sourceFolderId, path, name: nameOf(path), videoCount: count, sizeBytes: size, modifiedAt });
    // Rank is independent of counts: discarded candidates can never outrank the retained set.
    if (candidates.size > keptLimit * 2) {
      const retained = new Set([...candidates.values()].sort(compare).slice(0, keptLimit).map((item) => JSON.stringify([item.sourceFolderId, normalize(item.path)])));
      for (const key of candidates.keys()) if (!retained.has(key)) candidates.delete(key);
    }
  };
  for (const [source, root] of roots) add(source, root, 0, 0, null);
  const params: Record<string, unknown> = { search: `%${keyword.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_")}%` };
  if (query.sourceFolderId) params.source = query.sourceFolderId;
  const rows = db.prepare(`
    SELECT source_folder_id, directory, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS size, MAX(modified_at) AS modified
    FROM videos
    WHERE is_missing = 0 AND directory IS NOT NULL AND TRIM(directory) != ''
      AND REPLACE(directory, '/', '\\') LIKE @search ESCAPE '!' COLLATE NOCASE
      ${query.sourceFolderId ? "AND source_folder_id = @source" : ""}
    GROUP BY source_folder_id, directory
  `).iterate(params) as Iterable<{ source_folder_id: string; directory: string; count: number; size: number; modified: string | null }>;
  for (const row of rows) {
    const root = roots.get(row.source_folder_id);
    if (root === undefined) continue;
    const directory = row.directory.replace(/\//g, "\\");
    if (normalize(directory) !== normalize(root) && !normalize(directory).startsWith(`${normalize(root)}\\`)) continue;
    let path = root;
    add(row.source_folder_id, path, row.count, row.size, row.modified);
    for (const segment of directory.slice(root.length).split(/[\\/]/).filter(Boolean)) {
      path = `${path}\\${segment}`;
      add(row.source_folder_id, path, row.count, row.size, row.modified);
    }
  }
  const ranked = [...candidates.values()].sort(compare);
  const truncated = ranked.length > query.limit;
  return { items: ranked.slice(0, query.limit), totalCount: truncated ? keptLimit : ranked.length, truncated };
}
