import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const playHistoryMigration: Migration = {
  version: 2,
  description: "add play history and library query indexes",
  assertBefore(db) {
    requireTables(db, ["source_folders", "videos", "timeline_previews"]);
    requireColumns(db, "videos", ["metadata_status", "directory", "filename", "size_bytes"]);
  },
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_videos_metadata_status ON videos(metadata_status);
      CREATE INDEX IF NOT EXISTS idx_videos_size_bytes ON videos(size_bytes);
      CREATE INDEX IF NOT EXISTS idx_videos_directory ON videos(directory COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_videos_library_filename ON videos(is_missing, filename COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_videos_library_favorite ON videos(is_missing, is_favorite, filename COLLATE NOCASE);

      CREATE TABLE play_history (
        video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
        played_at TEXT NOT NULL,
        position_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_play_history_played_at ON play_history(played_at);
    `);
  },
  assertAfter(db) {
    requireTables(db, ["play_history"]);
    requireColumns(db, "play_history", ["video_id", "played_at", "position_ms"]);
  }
};
