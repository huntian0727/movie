import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { LATEST_SCHEMA_VERSION, migrations } from "./migrations/index.js";
import { listColumns, listTables, requireColumns, requireTables } from "./migrations/types.js";

export type DatabaseConnection = Database.Database;

export interface MigrationHooks {
  beforeBackup?(db: DatabaseConnection, backupPath: string): void;
  beforeMigration?(version: number, db: DatabaseConnection): void;
}

export interface CreateDatabaseOptions {
  migrationHooks?: MigrationHooks;
  now?: () => Date;
}

export class DatabaseMigrationError extends Error {
  constructor(
    message: string,
    readonly databasePath: string,
    readonly backupPath?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DatabaseMigrationError";
  }
}

export function createDatabase(dbPath: string, options: CreateDatabaseOptions = {}): DatabaseConnection {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrateDatabase(db, dbPath, options);
    return db;
  } catch (error: unknown) {
    db.close();
    if (error instanceof DatabaseMigrationError) {
      throw error;
    }
    throw new DatabaseMigrationError(
      `Database migration failed. The original database was preserved at ${dbPath}.`,
      dbPath,
      undefined,
      { cause: error }
    );
  }
}

export function migrateDatabase(
  db: DatabaseConnection,
  dbPath: string,
  options: CreateDatabaseOptions = {}
): { fromVersion: number; toVersion: number; backupPath?: string } {
  const storedVersion = readUserVersion(db);
  if (storedVersion > LATEST_SCHEMA_VERSION) {
    throw new DatabaseMigrationError(
      `Database schema version ${storedVersion} is newer than supported version ${LATEST_SCHEMA_VERSION}.`,
      dbPath
    );
  }

  const tables = listTables(db);
  const isFresh = storedVersion === 0 && tables.size === 0;
  const fromVersion = storedVersion === 0 && !isFresh ? detectUnversionedSchema(db, dbPath) : storedVersion;
  const needsUpgrade = fromVersion < LATEST_SCHEMA_VERSION || (storedVersion === 0 && !isFresh);
  let backupPath: string | undefined;

  if (needsUpgrade && !isFresh) {
    backupPath = createMigrationBackup(db, dbPath, fromVersion, options);
  }

  if (!needsUpgrade) {
    validateDatabase(db, dbPath);
    return { fromVersion, toVersion: fromVersion };
  }

  try {
    db.transaction(() => {
      if (storedVersion === 0 && !isFresh) {
        setUserVersion(db, fromVersion);
      }

      for (const migration of migrations) {
        if (migration.version <= fromVersion) {
          continue;
        }
        options.migrationHooks?.beforeMigration?.(migration.version, db);
        migration.assertBefore(db);
        migration.up(db);
        migration.assertAfter(db);
        setUserVersion(db, migration.version);
      }
      // Run structural and integrity checks before commit so a failed check
      // rolls back both the DDL and user_version changes.
      validateDatabase(db, dbPath);
    })();
    // Recheck the committed image rather than assuming the transaction result
    // is readable after SQLite flushes it.
    validateDatabase(db, dbPath);
    return { fromVersion, toVersion: LATEST_SCHEMA_VERSION, backupPath };
  } catch (error: unknown) {
    throw new DatabaseMigrationError(
      `Database migration from version ${fromVersion} failed. The original database and migration backup were preserved.`,
      dbPath,
      backupPath,
      { cause: error }
    );
  }
}

function detectUnversionedSchema(db: DatabaseConnection, dbPath: string): number {
  try {
    const tables = listTables(db);
    const knownTables = new Set(["source_folders", "videos", "timeline_previews", "play_history"]);
    const unknownTables = [...tables].filter((tableName) => !knownTables.has(tableName));
    if (unknownTables.length > 0) {
      throw new Error(`Unknown tables: ${unknownTables.join(", ")}`);
    }

    requireTables(db, ["source_folders", "videos", "timeline_previews"]);
    requireColumns(db, "source_folders", [
      "id", "path", "recursive", "enabled", "last_scanned_at", "created_at", "updated_at", "scan_error"
    ]);
    requireColumns(db, "videos", [
      "id", "source_folder_id", "path", "directory", "filename", "basename", "extension", "size_bytes",
      "duration_ms", "width", "height", "format", "modified_at", "imported_at", "updated_at", "is_favorite",
      "is_missing", "metadata_status", "thumbnail_status", "timeline_preview_status", "cover_cache_path"
    ]);
    requireColumns(db, "timeline_previews", ["id", "video_id", "time_ms", "cache_path", "created_at"]);

    const hasPlayHistory = tables.has("play_history");
    const videoColumns = listColumns(db, "videos");
    const fingerprintColumns = [
      "content_fingerprint", "fingerprint_status", "fingerprint_updated_at", "fingerprint_error"
    ];
    const fingerprintCount = fingerprintColumns.filter((columnName) => videoColumns.has(columnName)).length;
    const hasPendingDelete = videoColumns.has("is_pending_delete");

    if (!hasPlayHistory && fingerprintCount === 0 && !hasPendingDelete) {
      return 1;
    }
    if (hasPlayHistory) {
      requireColumns(db, "play_history", ["video_id", "played_at", "position_ms"]);
      if (fingerprintCount === 0 && !hasPendingDelete) {
        return 2;
      }
      if (fingerprintCount === fingerprintColumns.length) {
        return hasPendingDelete ? 4 : 3;
      }
    }
    throw new Error("Schema features do not match a known historical version");
  } catch (error: unknown) {
    throw new DatabaseMigrationError(
      "Unversioned database schema is not recognized; automatic changes were refused.",
      dbPath,
      undefined,
      { cause: error }
    );
  }
}

function createMigrationBackup(
  db: DatabaseConnection,
  dbPath: string,
  fromVersion: number,
  options: CreateDatabaseOptions
): string {
  const backupDirectory = `${dbPath}.backups`;
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = (options.now?.() ?? new Date()).toISOString().replaceAll(":", "-");
  const backupPath = path.join(backupDirectory, `${path.basename(dbPath)}.v${fromVersion}.${timestamp}.sqlite`);

  try {
    options.migrationHooks?.beforeBackup?.(db, backupPath);
    db.prepare("VACUUM INTO ?").run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      validateIntegrity(backup);
    } finally {
      backup.close();
    }
    return backupPath;
  } catch (error: unknown) {
    throw new DatabaseMigrationError(
      "Database backup failed; migration was not started and the original database was preserved.",
      dbPath,
      backupPath,
      { cause: error }
    );
  }
}

function validateDatabase(db: DatabaseConnection, dbPath: string): void {
  const version = readUserVersion(db);
  if (version !== LATEST_SCHEMA_VERSION) {
    throw new DatabaseMigrationError(
      `Database schema validation expected version ${LATEST_SCHEMA_VERSION}, received ${version}.`,
      dbPath
    );
  }
  requireTables(db, ["source_folders", "videos", "timeline_previews", "play_history", "directory_snapshots", "scan_failures", "scan_tasks", "duplicate_cleanup_jobs", "duplicate_cleanup_items", "duplicate_cleanup_reservations"]);
  requireColumns(db, "source_folders", [
    "id", "path", "recursive", "enabled", "last_scanned_at", "created_at", "updated_at", "scan_error"
  ]);
  requireColumns(db, "videos", [
    "id", "source_folder_id", "path", "directory", "filename", "basename", "extension", "size_bytes",
    "duration_ms", "width", "height", "format", "modified_at", "imported_at", "updated_at", "is_favorite",
    "is_pending_delete", "is_missing", "metadata_status", "thumbnail_status", "timeline_preview_status",
    "cover_cache_path", "content_fingerprint", "fingerprint_status", "fingerprint_updated_at", "fingerprint_error",
    "video_codec", "video_profile", "pixel_format", "audio_codec", "codec_probe_status"
  ]);
  requireColumns(db, "timeline_previews", ["id", "video_id", "time_ms", "cache_path", "created_at"]);
  requireColumns(db, "play_history", ["video_id", "played_at", "position_ms"]);
  requireColumns(db, "directory_snapshots", [
    "source_folder_id", "directory_path", "normalized_path", "parent_directory_path", "normalized_parent_path",
    "directory_mtime", "direct_video_count", "direct_child_count", "direct_entry_digest",
    "last_successful_scan_at", "is_complete", "has_unresolved_failure", "updated_at"
  ]);
  requireColumns(db, "scan_failures", [
    "id", "source_folder_id", "scan_task_id", "object_type", "object_path", "normalized_path",
    "failure_stage", "error_code", "error_summary", "first_failed_at", "last_failed_at",
    "retry_count", "status", "resolved_at"
  ]);
  requireColumns(db, "scan_tasks", ["id", "source_folder_id", "mode", "status", "started_at", "completed_at", "counters_json"]);
  requireColumns(db, "duplicate_cleanup_jobs", ["id", "request_id", "status", "total_items", "processed_items", "planned_reclaimable_bytes", "created_at", "updated_at"]);
  requireColumns(db, "duplicate_cleanup_items", ["id", "job_id", "group_key", "keep_video_id", "delete_video_id", "status", "outcome_code"]);
  requireColumns(db, "duplicate_cleanup_reservations", ["id", "job_id", "video_id", "role", "released_at"]);
  validateIntegrity(db);
}

function validateIntegrity(db: DatabaseConnection): void {
  const foreignKeyProblems = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeyProblems.length > 0) {
    throw new Error(`foreign_key_check reported ${foreignKeyProblems.length} problem(s)`);
  }
  const quickCheck = db.pragma("quick_check") as Array<Record<string, string>>;
  if (quickCheck.length !== 1 || Object.values(quickCheck[0] ?? {})[0] !== "ok") {
    throw new Error("quick_check did not return ok");
  }
}

function readUserVersion(db: DatabaseConnection): number {
  return db.pragma("user_version", { simple: true }) as number;
}

function setUserVersion(db: DatabaseConnection, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid schema version: ${version}`);
  }
  db.pragma(`user_version = ${version}`);
}
