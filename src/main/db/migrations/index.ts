import { coreLibraryMigration } from "./001-core-library.js";
import { playHistoryMigration } from "./002-play-history-and-query-indexes.js";
import { contentFingerprintMigration } from "./003-content-fingerprints.js";
import { pendingDeleteMigration } from "./004-pending-delete.js";
import { scanSnapshotsAndFailuresMigration } from "./005-scan-snapshots-and-failures.js";
import { legacyScanErrorsMigration } from "./006-legacy-scan-errors.js";

export const migrations = [
  coreLibraryMigration,
  playHistoryMigration,
  contentFingerprintMigration,
  pendingDeleteMigration,
  scanSnapshotsAndFailuresMigration,
  legacyScanErrorsMigration
] as const;

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;
