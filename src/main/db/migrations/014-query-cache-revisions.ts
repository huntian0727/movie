import { installQueryRevisionTriggers, queryRevisionTriggerNames, QUERY_REVISION_DOMAINS } from "../queryRevisions.js";
import { requireColumns, requireTables, type Migration } from "./types.js";

export const queryCacheRevisionsMigration: Migration = {
  version: 14,
  description: "Track query cache dependencies across database connections",
  assertBefore(db) { requireTables(db, ["videos", "source_folders", "play_history", "duplicate_cleanup_reservations"]); },
  up: installQueryRevisionTriggers,
  assertAfter(db) {
    requireColumns(db, "query_cache_revisions", ["id", "batch_mask", ...QUERY_REVISION_DOMAINS]);
    const triggers = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>).map((row) => row.name));
    if (!queryRevisionTriggerNames().every((name) => triggers.has(name))) throw new Error("Query revision triggers are incomplete");
  }
};
