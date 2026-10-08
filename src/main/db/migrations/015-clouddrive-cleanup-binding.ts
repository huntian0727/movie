import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const cloudDriveCleanupBindingMigration: Migration = {
  version: 15,
  description: "bind remote deletion plans to main-only connection identity",
  assertBefore(db) { requireTables(db, ["duplicate_cleanup_jobs"]); },
  up(db) { db.exec("ALTER TABLE duplicate_cleanup_jobs ADD COLUMN cloud_connection_binding TEXT;"); },
  assertAfter(db) { requireColumns(db, "duplicate_cleanup_jobs", ["cloud_connection_binding"]); }
};
