import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const duplicateCleanupJobsMigration: Migration = {
  version: 7,
  description: "add durable duplicate cleanup jobs and active video reservations",
  assertBefore(db) {
    requireTables(db, ["videos"]);
  },
  up(db) {
    db.exec(`
      CREATE TABLE duplicate_cleanup_jobs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('queued','running','cancelling','cancelled','completed','completed_with_errors','interrupted')),
        source_view TEXT,
        total_groups INTEGER NOT NULL,
        total_items INTEGER NOT NULL,
        processed_items INTEGER NOT NULL DEFAULT 0,
        success_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        skipped_items INTEGER NOT NULL DEFAULT 0,
        planned_reclaimable_bytes INTEGER NOT NULL DEFAULT 0,
        reclaimed_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        error_summary TEXT
      );

      CREATE TABLE duplicate_cleanup_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES duplicate_cleanup_jobs(id) ON DELETE CASCADE,
        group_key TEXT NOT NULL,
        keep_video_id TEXT NOT NULL,
        delete_video_id TEXT NOT NULL,
        keep_path TEXT NOT NULL,
        delete_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        directory TEXT NOT NULL,
        expected_keep_size_bytes INTEGER NOT NULL,
        expected_keep_modified_at TEXT NOT NULL,
        expected_delete_size_bytes INTEGER NOT NULL,
        expected_delete_modified_at TEXT NOT NULL,
        planned_reclaimable_bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','verifying','deleting','deleted','failed','skipped','cancelled')),
        outcome_code TEXT,
        message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE duplicate_cleanup_reservations (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES duplicate_cleanup_jobs(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('keep','delete')),
        created_at TEXT NOT NULL,
        released_at TEXT
      );

      CREATE UNIQUE INDEX duplicate_cleanup_active_reservation
        ON duplicate_cleanup_reservations(video_id) WHERE released_at IS NULL;
      CREATE INDEX duplicate_cleanup_jobs_status_created
        ON duplicate_cleanup_jobs(status, created_at);
      CREATE INDEX duplicate_cleanup_items_job_status
        ON duplicate_cleanup_items(job_id, status, created_at);
      CREATE INDEX duplicate_cleanup_reservations_job
        ON duplicate_cleanup_reservations(job_id, released_at);
    `);
  },
  assertAfter(db) {
    requireTables(db, ["duplicate_cleanup_jobs", "duplicate_cleanup_items", "duplicate_cleanup_reservations"]);
    requireColumns(db, "duplicate_cleanup_jobs", ["id", "request_id", "status", "total_items", "processed_items", "planned_reclaimable_bytes", "created_at", "updated_at"]);
    requireColumns(db, "duplicate_cleanup_items", ["id", "job_id", "group_key", "keep_video_id", "delete_video_id", "status", "outcome_code"]);
    requireColumns(db, "duplicate_cleanup_reservations", ["id", "job_id", "video_id", "role", "released_at"]);
  }
};
