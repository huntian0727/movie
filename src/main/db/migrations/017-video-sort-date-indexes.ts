import type { Migration } from "./types.js";
import { requireColumns, requireTables } from "./types.js";

const expectedIndexes = [
  { name: "idx_videos_imported_at_id", columns: [{ name: "imported_at", descending: true }, { name: "id", descending: false }] },
  { name: "idx_videos_modified_at_id", columns: [{ name: "modified_at", descending: true }, { name: "id", descending: false }] }
] as const;

export const videoSortDateIndexesMigration: Migration = {
  version: 17,
  description: "add direct indexes for added-time and modified-time sorting",
  assertBefore(db) {
    requireTables(db, ["videos"]);
    requireColumns(db, "videos", ["id", "imported_at", "modified_at"]);
  },
  up(db) {
    db.exec("CREATE INDEX idx_videos_imported_at_id ON videos(imported_at DESC, id ASC); CREATE INDEX idx_videos_modified_at_id ON videos(modified_at DESC, id ASC);");
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
