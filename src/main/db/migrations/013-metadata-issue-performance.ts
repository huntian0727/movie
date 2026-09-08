import type { Migration } from "./types.js";
import { requireTables } from "./types.js";

const METADATA_FAILURE_LOOKUP_INDEX = "idx_scan_failures_active_object_path";

export const metadataIssuePerformanceMigration: Migration = {
  version: 13,
  description: "add an exact lookup index for metadata issue failure joins",
  assertBefore(db) {
    requireTables(db, ["scan_failures"]);
  },
  up(db) {
    db.exec(`
      CREATE INDEX ${METADATA_FAILURE_LOOKUP_INDEX}
        ON scan_failures(source_folder_id, object_path, failure_stage)
        WHERE status != 'resolved';
    `);
  },
  assertAfter(db) {
    const indexes = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").pluck().all() as string[]));
    if (!indexes.has(METADATA_FAILURE_LOOKUP_INDEX)) {
      throw new Error(`Missing metadata issue performance index: ${METADATA_FAILURE_LOOKUP_INDEX}`);
    }
  }
};
