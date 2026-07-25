import { coreLibraryMigration } from "./001-core-library.js";
import { playHistoryMigration } from "./002-play-history-and-query-indexes.js";
import { contentFingerprintMigration } from "./003-content-fingerprints.js";
import { pendingDeleteMigration } from "./004-pending-delete.js";

export const migrations = [
  coreLibraryMigration,
  playHistoryMigration,
  contentFingerprintMigration,
  pendingDeleteMigration
] as const;

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;
