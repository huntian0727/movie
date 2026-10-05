import crypto from "node:crypto";
import Database from "better-sqlite3";
import type { PreparedDuplicateResolveEntry } from "./videoRepository.js";

/** Disposable local task plan, never a second library or an executable job.
 * Only the existing writer may atomically admit it into the real library. */
export function writeCleanupPreparationStage(filePath: string, entries: PreparedDuplicateResolveEntry[]): void {
  const stage = new Database(filePath);
  try {
    stage.exec(`CREATE TABLE expected (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_at TEXT NOT NULL,
      duration_ms INTEGER, provider_file_id TEXT, provider_path TEXT, role TEXT NOT NULL, reservation_id TEXT NOT NULL);
      CREATE TABLE items (
      id TEXT PRIMARY KEY, group_key TEXT NOT NULL, keep_video_id TEXT NOT NULL, delete_video_id TEXT NOT NULL UNIQUE,
      keep_path TEXT NOT NULL, delete_path TEXT NOT NULL, filename TEXT NOT NULL, directory TEXT NOT NULL,
      expected_keep_size_bytes INTEGER NOT NULL, expected_keep_modified_at TEXT NOT NULL,
      expected_delete_size_bytes INTEGER NOT NULL, expected_delete_modified_at TEXT NOT NULL,
      planned_reclaimable_bytes INTEGER NOT NULL, delete_provider_file_id TEXT NOT NULL, delete_provider_path TEXT NOT NULL);
      CREATE TABLE summary (total_groups INTEGER NOT NULL, total_items INTEGER NOT NULL, planned_bytes INTEGER NOT NULL);`);
    const insertExpected = stage.prepare("INSERT INTO expected VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertItem = stage.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stage.transaction(() => {
      const seen = new Map<string, string>();
      const expect = (video: PreparedDuplicateResolveEntry["keepVideo"], role: string) => {
        if (seen.has(video.id)) {
          if (seen.get(video.id) !== role) throw new Error("Conflicting cleanup roles");
          return;
        }
        seen.set(video.id, role);
        insertExpected.run(video.id, video.path, video.sizeBytes, video.modifiedAt, video.durationMs,
          video.providerFileId ?? null, video.providerPath ?? null, role, crypto.randomUUID());
      };
      let totalItems = 0; let plannedBytes = 0;
      for (const entry of entries) {
        expect(entry.keepVideo, "keep");
        for (const video of entry.deleteVideos) {
          if (!video.providerFileId || !video.providerPath) throw new Error("Cleanup target is not managed by CloudDrive API");
          expect(video, "delete");
          insertItem.run(crypto.randomUUID(), entry.groupKey, entry.keepVideo.id, video.id,
            entry.keepVideo.path, video.path, video.filename, video.directory, entry.keepVideo.sizeBytes,
            entry.keepVideo.modifiedAt, video.sizeBytes, video.modifiedAt, video.sizeBytes,
            video.providerFileId, video.providerPath);
          totalItems++; plannedBytes += video.sizeBytes;
        }
      }
      stage.prepare("INSERT INTO summary VALUES (?, ?, ?)").run(entries.length, totalItems, plannedBytes);
    })();
  } finally { stage.close(); }
}
