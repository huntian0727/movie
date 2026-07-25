import type { Migration } from "./types.js";
import { requireColumns } from "./types.js";

export const pendingDeleteMigration: Migration = {
  version: 4,
  description: "add the pending-delete review marker",
  assertBefore(db) {
    requireColumns(db, "videos", ["content_fingerprint", "fingerprint_status"]);
  },
  up(db) {
    db.exec(`
      ALTER TABLE videos ADD COLUMN is_pending_delete INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_videos_is_pending_delete ON videos(is_pending_delete);
    `);
  },
  assertAfter(db) {
    requireColumns(db, "videos", ["is_pending_delete"]);
  }
};
