import type { DatabaseConnection } from "./database.js";

export const QUERY_REVISION_DOMAINS = ["all", "library", "sources", "scan", "cleanup", "tasks", "playback", "images"] as const;
export type QueryRevisionDomain = typeof QUERY_REVISION_DOMAINS[number];

const trackedTables = {
  source_folders: "sources", scan_tasks: "scan", scan_failures: "scan", directory_snapshots: "scan",
  duplicate_cleanup_jobs: "tasks", duplicate_cleanup_items: "tasks",
  duplicate_cleanup_reservations: "cleanup", duplicate_preferred_directories: "cleanup",
  play_history: "playback", timeline_previews: "images"
} as const;

const libraryColumns = [
  "id", "source_folder_id", "path", "directory", "filename", "basename", "extension", "size_bytes",
  "duration_ms", "width", "height", "format", "modified_at", "imported_at", "is_favorite", "is_pending_delete",
  "is_missing", "metadata_status", "video_codec", "video_profile", "pixel_format", "audio_codec",
  "codec_probe_status", "provider_file_id", "provider_path", "duration_source",
  "content_fingerprint", "fingerprint_status", "fingerprint_updated_at", "fingerprint_error"
];
const imageColumns = ["thumbnail_status", "timeline_preview_status", "cover_cache_path", "updated_at"];

export function queryRevisionTriggerNames(): string[] {
  return [
    ...Object.keys(trackedTables).flatMap((table) => ["insert", "update", "delete"].map((event) => `query_revision_${table}_${event}`)),
    "query_revision_videos_insert", "query_revision_videos_update", "query_revision_videos_delete"
  ];
}

export function installQueryRevisionTriggers(db: DatabaseConnection): void {
  // One indexed singleton update per changed record, rather than two domain
  // row updates. Large atomic task admissions must not amplify bookkeeping.
  db.exec(`CREATE TABLE query_cache_revisions (id INTEGER PRIMARY KEY CHECK (id = 1),
    batch_mask INTEGER NOT NULL DEFAULT 0,
    ${QUERY_REVISION_DOMAINS.map((domain) => `"${domain}" INTEGER NOT NULL DEFAULT 0`).join(", ")})`);
  db.exec("INSERT INTO query_cache_revisions(id) VALUES (1)");
  for (const [table, domain] of Object.entries(trackedTables)) {
    for (const event of ["insert", "update", "delete"]) {
      db.exec(`CREATE TRIGGER query_revision_${table}_${event} AFTER ${event.toUpperCase()} ON ${table}
        WHEN ((SELECT batch_mask FROM query_cache_revisions WHERE id = 1) & ${1 << QUERY_REVISION_DOMAINS.indexOf(domain)}) = 0
        BEGIN UPDATE query_cache_revisions SET "all" = "all" + 1, ${domain} = ${domain} + 1 WHERE id = 1; END`);
    }
  }
  for (const event of ["insert", "delete"]) {
    db.exec(`CREATE TRIGGER query_revision_videos_${event} AFTER ${event.toUpperCase()} ON videos
      BEGIN UPDATE query_cache_revisions SET "all" = "all" + 1, library = library + 1, images = images + 1 WHERE id = 1; END`);
  }
  const changed = (columns: string[]) => columns.map((column) => `OLD.${column} IS NOT NEW.${column}`).join(" OR ");
  db.exec(`CREATE TRIGGER query_revision_videos_update AFTER UPDATE ON videos
    BEGIN UPDATE query_cache_revisions SET "all" = "all" + 1,
      library = library + CASE WHEN ${changed(libraryColumns)} THEN 1 ELSE 0 END,
      images = images + CASE WHEN ${changed(imageColumns)} THEN 1 ELSE 0 END WHERE id = 1; END`);
}

/** Coalesce only cleanup counters inside an already atomic admission transaction.
 * The temporary mask and every task write roll back together on failure/crash;
 * other connections can only observe the old or committed revision snapshot. */
export function withCleanupRevisionBatch<Result>(db: DatabaseConnection, execute: () => Result): Result {
  if (!db.inTransaction) throw new Error("Cleanup revision batching requires an atomic transaction");
  const mask = (1 << QUERY_REVISION_DOMAINS.indexOf("cleanup")) | (1 << QUERY_REVISION_DOMAINS.indexOf("tasks"));
  const previous = (db.prepare("SELECT batch_mask FROM query_cache_revisions WHERE id = 1").get() as { batch_mask: number }).batch_mask;
  db.prepare("UPDATE query_cache_revisions SET batch_mask = ? WHERE id = 1").run(previous | mask);
  try { return execute(); }
  finally {
    const increments = ["cleanup", "tasks"].filter((domain) => !(previous & (1 << QUERY_REVISION_DOMAINS.indexOf(domain as QueryRevisionDomain))));
    db.prepare(`UPDATE query_cache_revisions SET batch_mask = ?, "all" = "all" + 1${increments.map((domain) => `, ${domain} = ${domain} + 1`).join("")} WHERE id = 1`).run(previous);
  }
}

/** Uses shared transactional counters, so writes on any SQLite connection are observed. */
export class QueryRevisionMonitor {
  private previous: Record<QueryRevisionDomain, number> | undefined;
  private dataVersion: number | undefined;
  private schemaVersion: number | undefined;
  private trusted = false;

  constructor(private readonly db: DatabaseConnection) {}

  refresh(): { unknown: boolean; changed: ReadonlySet<QueryRevisionDomain> } {
    const dataVersion = this.db.pragma("data_version", { simple: true }) as number;
    const schemaVersion = this.db.pragma("schema_version", { simple: true }) as number;
    const schemaChanged = this.schemaVersion !== undefined && this.schemaVersion !== schemaVersion;
    if (this.schemaVersion !== schemaVersion) {
      this.schemaVersion = schemaVersion;
      const triggers = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>).map((row) => row.name));
      this.trusted = queryRevisionTriggerNames().every((name) => triggers.has(name));
    }
    if (!this.trusted) {
      this.dataVersion = dataVersion;
      this.previous = undefined;
      return { unknown: true, changed: new Set(QUERY_REVISION_DOMAINS) };
    }
    const current = (this.db.prepare("SELECT * FROM query_cache_revisions WHERE id = 1").get() ?? {}) as Record<QueryRevisionDomain, number>;
    const incomplete = QUERY_REVISION_DOMAINS.some((domain) => !Number.isSafeInteger(current[domain])) || (current as Record<string, number>).batch_mask !== 0;
    const changed = new Set(QUERY_REVISION_DOMAINS.filter((domain) => current[domain] !== this.previous?.[domain]));
    const regressed = this.previous && QUERY_REVISION_DOMAINS.some((domain) => current[domain] < this.previous![domain]);
    const unexplainedCommit = this.previous && dataVersion !== this.dataVersion && !changed.has("all");
    const unknown = !this.previous || schemaChanged || incomplete || Boolean(regressed || unexplainedCommit);
    this.previous = incomplete ? undefined : current;
    this.dataVersion = dataVersion;
    return { unknown, changed: unknown ? new Set(QUERY_REVISION_DOMAINS) : changed };
  }
}
