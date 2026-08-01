import crypto from "node:crypto";
import { normalizeManagedPath } from "../../files/pathNormalization.js";
import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

interface LegacyScanErrorRow {
  id: string;
  path: string;
  scan_error: string;
}

export const legacyScanErrorsMigration: Migration = {
  version: 6,
  description: "backfill unresolved failure details for legacy source folder scan errors",
  assertBefore(db) {
    requireTables(db, ["source_folders", "scan_failures"]);
    requireColumns(db, "source_folders", ["id", "path", "scan_error"]);
    requireColumns(db, "scan_failures", [
      "id", "source_folder_id", "scan_task_id", "object_type", "object_path", "normalized_path",
      "failure_stage", "error_code", "error_summary", "first_failed_at", "last_failed_at",
      "retry_count", "status", "resolved_at"
    ]);
  },
  up(db) {
    const legacyErrors = db.prepare(`
      SELECT id, path, scan_error
      FROM source_folders
      WHERE scan_error IS NOT NULL AND trim(scan_error) != ''
    `).all() as LegacyScanErrorRow[];
    const hasActiveFailure = db.prepare(`
      SELECT 1
      FROM scan_failures
      WHERE source_folder_id = ? AND status != 'resolved'
      LIMIT 1
    `);
    const insertFailure = db.prepare(`
      INSERT INTO scan_failures (
        id, source_folder_id, scan_task_id, object_type, object_path, normalized_path,
        failure_stage, error_code, error_summary, first_failed_at, last_failed_at,
        retry_count, status, resolved_at
      ) VALUES (?, ?, ?, 'directory', ?, ?, 'legacy-scan-error', 'LEGACY_SCAN_ERROR', ?, ?, ?, 0, 'unresolved', NULL)
    `);
    const migratedAt = new Date().toISOString();

    for (const row of legacyErrors) {
      if (hasActiveFailure.get(row.id)) {
        continue;
      }
      insertFailure.run(
        crypto.randomUUID(),
        row.id,
        "migration:v6",
        row.path,
        normalizeManagedPath(row.path),
        row.scan_error,
        migratedAt,
        migratedAt
      );
    }
  },
  assertAfter(db) {
    requireTables(db, ["source_folders", "scan_failures"]);
    requireColumns(db, "scan_failures", ["failure_stage", "error_code", "error_summary", "status"]);
  }
};
