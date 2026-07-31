import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const scanSnapshotsAndFailuresMigration: Migration = {
  version: 5,
  description: "add incremental directory snapshots, persistent scan failures, and scan task history",
  assertBefore(db) {
    requireColumns(db, "videos", ["is_pending_delete"]);
    requireColumns(db, "source_folders", ["id", "path", "scan_error"]);
  },
  up(db) {
    db.exec(`
      CREATE TABLE directory_snapshots (
        source_folder_id TEXT NOT NULL,
        directory_path TEXT NOT NULL,
        normalized_path TEXT NOT NULL,
        parent_directory_path TEXT,
        normalized_parent_path TEXT,
        directory_mtime TEXT NOT NULL,
        direct_video_count INTEGER NOT NULL,
        direct_child_count INTEGER NOT NULL,
        direct_entry_digest TEXT NOT NULL,
        last_successful_scan_at TEXT,
        is_complete INTEGER NOT NULL DEFAULT 0,
        has_unresolved_failure INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_folder_id, normalized_path),
        FOREIGN KEY (source_folder_id) REFERENCES source_folders(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_directory_snapshots_parent
        ON directory_snapshots(source_folder_id, normalized_parent_path);

      CREATE TABLE scan_failures (
        id TEXT PRIMARY KEY,
        source_folder_id TEXT NOT NULL,
        scan_task_id TEXT NOT NULL,
        object_type TEXT NOT NULL CHECK (object_type IN ('file', 'directory')),
        object_path TEXT NOT NULL,
        normalized_path TEXT NOT NULL,
        failure_stage TEXT NOT NULL,
        error_code TEXT,
        error_summary TEXT NOT NULL,
        first_failed_at TEXT NOT NULL,
        last_failed_at TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('unresolved', 'retrying', 'resolved')),
        resolved_at TEXT,
        FOREIGN KEY (source_folder_id) REFERENCES source_folders(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_scan_failures_active_object
        ON scan_failures(source_folder_id, normalized_path, failure_stage)
        WHERE status != 'resolved';
      CREATE INDEX idx_scan_failures_source_status
        ON scan_failures(source_folder_id, status, last_failed_at DESC);

      CREATE TABLE scan_tasks (
        id TEXT PRIMARY KEY,
        source_folder_id TEXT,
        mode TEXT NOT NULL CHECK (mode IN ('current-folder', 'retry-failures', 'scan-all')),
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        counters_json TEXT NOT NULL DEFAULT '{}',
        error_summary TEXT,
        FOREIGN KEY (source_folder_id) REFERENCES source_folders(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_scan_tasks_source_started
        ON scan_tasks(source_folder_id, started_at DESC);
    `);
  },
  assertAfter(db) {
    requireTables(db, ["directory_snapshots", "scan_failures", "scan_tasks"]);
    requireColumns(db, "directory_snapshots", [
      "source_folder_id", "directory_path", "normalized_path", "parent_directory_path",
      "directory_mtime", "direct_video_count", "direct_child_count", "direct_entry_digest",
      "last_successful_scan_at", "is_complete", "has_unresolved_failure", "updated_at"
    ]);
    requireColumns(db, "scan_failures", [
      "id", "source_folder_id", "scan_task_id", "object_type", "object_path", "normalized_path",
      "failure_stage", "error_code", "error_summary", "first_failed_at", "last_failed_at",
      "retry_count", "status", "resolved_at"
    ]);
    requireColumns(db, "scan_tasks", ["id", "source_folder_id", "mode", "status", "started_at", "completed_at", "counters_json"]);
  }
};
