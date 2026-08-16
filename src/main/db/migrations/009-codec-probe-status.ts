import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const codecProbeStatusMigration: Migration = {
  version: 9,
  description: "track whether codec probing is pending, complete, or failed",
  assertBefore(db) {
    requireTables(db, ["videos"]);
    requireColumns(db, "videos", ["video_codec"]);
  },
  up(db) {
    db.exec(`
      ALTER TABLE videos ADD COLUMN codec_probe_status TEXT NOT NULL DEFAULT 'unprobed';
      UPDATE videos SET codec_probe_status = 'ready' WHERE video_codec IS NOT NULL;
    `);
  },
  assertAfter(db) {
    requireColumns(db, "videos", ["codec_probe_status"]);
  }
};
