import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const cloudDriveDuplicateCleanupMigration: Migration = {
  version: 11,
  description: "persist CloudDrive identities and efficient duplicate cleanup rules",
  assertBefore(db) {
    requireTables(db, ["source_folders", "videos", "duplicate_cleanup_jobs", "duplicate_cleanup_items"]);
  },
  up(db) {
    db.exec(`
      ALTER TABLE source_folders ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE source_folders ADD COLUMN provider_root_path TEXT;
      ALTER TABLE source_folders ADD COLUMN provider_name TEXT;
      ALTER TABLE source_folders ADD COLUMN provider_read_only INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE videos ADD COLUMN provider_file_id TEXT;
      ALTER TABLE videos ADD COLUMN provider_path TEXT;
      ALTER TABLE videos ADD COLUMN duration_source TEXT NOT NULL DEFAULT 'unknown';

      ALTER TABLE duplicate_cleanup_items ADD COLUMN delete_transport TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE duplicate_cleanup_items ADD COLUMN delete_provider_file_id TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN delete_provider_path TEXT;

      CREATE TABLE duplicate_preferred_directories (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL COLLATE NOCASE,
        normalized_path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_source_folders_provider_type
        ON source_folders(provider_type, enabled);
      CREATE INDEX idx_videos_provider_file_id
        ON videos(provider_file_id)
        WHERE provider_file_id IS NOT NULL;
      CREATE INDEX idx_videos_provider_path
        ON videos(provider_path)
        WHERE provider_path IS NOT NULL;
      CREATE INDEX idx_videos_duplicate_seconds
        ON videos(size_bytes, ((duration_ms + 500) / 1000))
        WHERE is_missing = 0 AND metadata_status = 'ready' AND duration_ms IS NOT NULL AND duration_ms > 0;
      CREATE INDEX idx_duplicate_preferred_directories_enabled
        ON duplicate_preferred_directories(enabled, normalized_path);
    `);
  },
  assertAfter(db) {
    requireTables(db, ["duplicate_preferred_directories"]);
    requireColumns(db, "source_folders", [
      "provider_type", "provider_root_path", "provider_name", "provider_read_only"
    ]);
    requireColumns(db, "videos", ["provider_file_id", "provider_path", "duration_source"]);
    requireColumns(db, "duplicate_cleanup_items", [
      "delete_transport", "delete_provider_file_id", "delete_provider_path"
    ]);
    requireColumns(db, "duplicate_preferred_directories", [
      "id", "path", "normalized_path", "enabled", "created_at", "updated_at"
    ]);
  }
};
