import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

const expectedIndexes = [
  { name: "idx_videos_size_bytes", columns: [{ name: "size_bytes", descending: true }, { name: "id", descending: false }] },
  { name: "idx_videos_duration_ms_id", columns: [{ name: "duration_ms", descending: true }, { name: "id", descending: false }] }
] as const;

export const videoDataSortIndexesMigration: Migration = {
  version: 18,
  description: "optimize video-data size and duration sorting with stable tie-break indexes",
  assertBefore(db) {
    requireTables(db, ["videos"]);
    requireColumns(db, "videos", ["size_bytes", "duration_ms", "id"]);
  },
  up(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_videos_size_bytes;
      CREATE INDEX idx_videos_size_bytes ON videos(size_bytes DESC, id ASC);
      CREATE INDEX idx_videos_duration_ms_id ON videos(duration_ms DESC, id ASC);
    `);
  },
  assertAfter(db) {
    for (const expected of expectedIndexes) {
      const actual = db.prepare("PRAGMA index_xinfo(\"" + expected.name + "\")").all() as Array<{
        seqno: number;
        name: string | null;
        desc: number;
        key: number;
      }>;
      const keyColumns = actual.filter(column => column.key === 1).sort((left, right) => left.seqno - right.seqno);
      const actualShape = keyColumns.map(column => ({ name: column.name, descending: column.desc === 1 }));
      if (JSON.stringify(actualShape) !== JSON.stringify(expected.columns)) {
        throw new Error("Performance index has an unexpected column order: " + expected.name);
      }
    }
  }
};
