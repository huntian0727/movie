import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const scanFailureBatchHistoryMigration: Migration = {
  version: 16,
  description: "persist scan failure batch operation history",
  assertBefore(db) {
    requireTables(db, ["scan_failures", "scan_tasks"]);
  },
  up(db) {
    db.exec(`
      CREATE TABLE scan_failure_batch_jobs (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('recheck-accessibility','analyze-metadata','permanent-delete','remove-missing-record')),
        status TEXT NOT NULL CHECK (status IN ('queued','running','cancelling','cancelled','completed','completed-with-errors','interrupted')),
        scope_summary TEXT NOT NULL,
        total_count INTEGER NOT NULL CHECK (total_count >= 0),
        processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
        success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
        skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
        failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
        current_path TEXT,
        message TEXT,
        error_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX idx_scan_failure_batch_jobs_created
        ON scan_failure_batch_jobs(created_at DESC);
      CREATE INDEX idx_scan_failure_batch_jobs_status_created
        ON scan_failure_batch_jobs(status, created_at DESC);
    `);
  },
  assertAfter(db) {
    requireTables(db, ["scan_failure_batch_jobs"]);
    requireColumns(db, "scan_failure_batch_jobs", [
      "id", "operation", "status", "scope_summary", "total_count", "processed_count",
      "success_count", "skipped_count", "failure_count", "current_path", "message",
      "error_summary", "created_at", "updated_at", "completed_at"
    ]);
  }
};
