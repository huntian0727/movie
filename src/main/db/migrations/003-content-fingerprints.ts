import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const contentFingerprintMigration: Migration = {
  version: 3,
  description: "add sampled content fingerprint state for duplicate screening",
  assertBefore(db) {
    requireTables(db, ["videos", "play_history"]);
    requireColumns(db, "videos", ["size_bytes", "modified_at"]);
  },
  up(db) {
    db.exec(`
      ALTER TABLE videos ADD COLUMN content_fingerprint TEXT;
      ALTER TABLE videos ADD COLUMN fingerprint_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE videos ADD COLUMN fingerprint_updated_at TEXT;
      ALTER TABLE videos ADD COLUMN fingerprint_error TEXT;
      CREATE INDEX idx_videos_fingerprint_status ON videos(fingerprint_status);
      CREATE INDEX idx_videos_content_fingerprint ON videos(content_fingerprint);
    `);
  },
  assertAfter(db) {
    requireColumns(db, "videos", [
      "content_fingerprint",
      "fingerprint_status",
      "fingerprint_updated_at",
      "fingerprint_error"
    ]);
  }
};
