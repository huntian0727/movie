import type { Migration } from "./types.js";
import { requireTables } from "./types.js";

export const libraryQueryPerformanceMigration: Migration = {
  version: 12,
  description: "add indexes for responsive library sorting and deep paging",
  assertBefore(db) {
    requireTables(db, ["videos"]);
  },
  up(db) {
    db.exec(`
      CREATE INDEX idx_videos_library_modified
        ON videos(is_missing, modified_at DESC, filename ASC, id ASC);
      CREATE INDEX idx_videos_library_size
        ON videos(is_missing, size_bytes DESC, filename ASC, id ASC);
      CREATE INDEX idx_videos_library_duration
        ON videos(is_missing, duration_ms DESC, filename ASC, id ASC);
      CREATE INDEX idx_videos_cover_cache_path
        ON videos(cover_cache_path)
        WHERE cover_cache_path IS NOT NULL;
      CREATE INDEX idx_timeline_previews_cache_path
        ON timeline_previews(cache_path);
    `);
  },
  assertAfter(db) {
    const indexes = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").pluck().all() as string[]));
    for (const indexName of [
      "idx_videos_library_modified",
      "idx_videos_library_size",
      "idx_videos_library_duration",
      "idx_videos_cover_cache_path",
      "idx_timeline_previews_cache_path"
    ]) {
      if (!indexes.has(indexName)) throw new Error(`Missing performance index: ${indexName}`);
    }
  }
};
