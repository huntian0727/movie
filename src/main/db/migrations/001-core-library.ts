import type { Migration } from "./types.js";
import { listTables, requireColumns, requireTables } from "./types.js";

const CORE_TABLES = ["source_folders", "videos", "timeline_previews"];

export const coreLibraryMigration: Migration = {
  version: 1,
  description: "create the core source-folder, video, and timeline-preview schema",
  assertBefore(db) {
    if (listTables(db).size !== 0) {
      throw new Error("Core schema can only be created in an empty database");
    }
  },
  up(db) {
    db.exec(`
      CREATE TABLE source_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        recursive INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        last_scanned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        scan_error TEXT
      );

      CREATE TABLE videos (
        id TEXT PRIMARY KEY,
        source_folder_id TEXT NOT NULL REFERENCES source_folders(id) ON DELETE CASCADE,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        directory TEXT NOT NULL,
        filename TEXT NOT NULL,
        basename TEXT NOT NULL,
        extension TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        duration_ms INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        modified_at TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_missing INTEGER NOT NULL DEFAULT 0,
        metadata_status TEXT NOT NULL,
        thumbnail_status TEXT NOT NULL,
        timeline_preview_status TEXT NOT NULL,
        cover_cache_path TEXT
      );

      CREATE INDEX idx_videos_source_folder_id ON videos(source_folder_id);
      CREATE INDEX idx_videos_filename ON videos(filename);
      CREATE INDEX idx_videos_is_favorite ON videos(is_favorite);
      CREATE INDEX idx_videos_is_missing ON videos(is_missing);

      CREATE TABLE timeline_previews (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        time_ms INTEGER NOT NULL,
        cache_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(video_id, time_ms)
      );
    `);
  },
  assertAfter(db) {
    requireTables(db, CORE_TABLES);
    requireColumns(db, "videos", ["id", "source_folder_id", "path", "size_bytes", "is_favorite", "is_missing"]);
  }
};
