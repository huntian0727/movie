import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const duplicateSha256SafetyMigration: Migration = {
  version: 10,
  description: "require durable full SHA-256 authorization before duplicate cleanup deletion",
  assertBefore(db) {
    requireTables(db, ["duplicate_cleanup_jobs", "duplicate_cleanup_items", "duplicate_cleanup_reservations"]);
  },
  up(db) {
    db.exec(`
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN workflow_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'legacy_blocked';
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN verification_revision TEXT;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN verification_processed_items INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN identical_items INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN different_items INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN unverifiable_items INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN verification_completed_at TEXT;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN authorized_revision TEXT;
      ALTER TABLE duplicate_cleanup_jobs ADD COLUMN authorized_at TEXT;

      ALTER TABLE duplicate_cleanup_items ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
      ALTER TABLE duplicate_cleanup_items ADD COLUMN verification_revision TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN keep_sha256 TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN delete_sha256 TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN keep_file_identity TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN delete_file_identity TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN staged_delete_path TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN staged_at TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN verified_at TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN verification_error TEXT;
      ALTER TABLE duplicate_cleanup_items ADD COLUMN authorized_revision TEXT;

      UPDATE duplicate_cleanup_jobs
      SET status = CASE
            WHEN status IN ('queued','running','cancelling','interrupted') THEN 'cancelled'
            ELSE status
          END,
          phase = 'legacy_blocked',
          completed_at = CASE
            WHEN status IN ('queued','running','cancelling','interrupted') THEN COALESCE(completed_at, updated_at)
            ELSE completed_at
          END,
          error_summary = CASE
            WHEN status IN ('queued','running','cancelling','interrupted')
              THEN 'Legacy cleanup task invalidated by SHA-256 safety migration; create a new verification task.'
            ELSE error_summary
          END;
      UPDATE duplicate_cleanup_items
      SET status = 'cancelled', outcome_code = 'legacy-safety-blocked',
          message = 'Legacy task has no full SHA-256 authorization and cannot delete files.'
      WHERE status IN ('pending','verifying','deleting');
      UPDATE duplicate_cleanup_reservations SET released_at = COALESCE(released_at, created_at);

      CREATE INDEX duplicate_cleanup_jobs_phase_created
        ON duplicate_cleanup_jobs(workflow_version, phase, created_at);
      CREATE INDEX duplicate_cleanup_items_verification
        ON duplicate_cleanup_items(job_id, verification_revision, verification_status, created_at);
    `);
  },
  assertAfter(db) {
    requireColumns(db, "duplicate_cleanup_jobs", [
      "workflow_version", "phase", "verification_revision", "verification_processed_items",
      "identical_items", "different_items", "unverifiable_items", "verification_completed_at",
      "authorized_revision", "authorized_at"
    ]);
    requireColumns(db, "duplicate_cleanup_items", [
      "verification_status", "verification_revision", "keep_sha256", "delete_sha256",
      "keep_file_identity", "delete_file_identity", "staged_delete_path", "staged_at",
      "verified_at", "verification_error", "authorized_revision"
    ]);
  }
};
