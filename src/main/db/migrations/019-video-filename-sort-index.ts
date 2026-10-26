import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

const expectedIndex = [
  { name: "filename", descending: true, collation: "NOCASE" },
  { name: "id", descending: false, collation: "BINARY" }
] as const;

export const videoFilenameSortIndexMigration: Migration = {
  version: 19,
  description: "add a stable case-insensitive filename sort index for large video-data pages",
  assertBefore(db) {
    requireTables(db, ["videos"]);
    requireColumns(db, "videos", ["filename", "id"]);
  },
  up(db) {
    db.exec("CREATE INDEX idx_videos_filename_nocase_id ON videos(filename COLLATE NOCASE DESC, id ASC)");
  },
  assertAfter(db) {
    const actual = db.prepare('PRAGMA index_xinfo("idx_videos_filename_nocase_id")').all() as Array<{
      seqno: number;
      name: string | null;
      desc: number;
      key: number;
      coll: string;
    }>;
    const keyColumns = actual.filter(column => column.key === 1).sort((left, right) => left.seqno - right.seqno);
    const actualShape = keyColumns.map(column => ({ name: column.name, descending: column.desc === 1, collation: column.coll }));
    if (JSON.stringify(actualShape) !== JSON.stringify(expectedIndex)) {
      throw new Error("Filename sort index has an unexpected column order or collation");
    }
  }
};
