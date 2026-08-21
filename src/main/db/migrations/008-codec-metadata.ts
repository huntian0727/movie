import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

export const codecMetadataMigration: Migration = {
  version: 8,
  description: "add codec metadata used for conservative playback routing",
  assertBefore(db) {
    requireTables(db, ["videos"]);
  },
  up(db) {
    db.exec(`
      ALTER TABLE videos ADD COLUMN video_codec TEXT;
      ALTER TABLE videos ADD COLUMN video_profile TEXT;
      ALTER TABLE videos ADD COLUMN pixel_format TEXT;
      ALTER TABLE videos ADD COLUMN audio_codec TEXT;
    `);
  },
  assertAfter(db) {
    requireColumns(db, "videos", ["video_codec", "video_profile", "pixel_format", "audio_codec"]);
  }
};
