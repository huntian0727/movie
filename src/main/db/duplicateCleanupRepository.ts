import crypto from "node:crypto";
import type {
  DuplicateCleanupAccepted, DuplicateCleanupConfirmRequest, DuplicateCleanupItem, DuplicateCleanupItemPage,
  DuplicateCleanupItemStatus, DuplicateCleanupJob, DuplicateCleanupJobPage, DuplicateCleanupSubmitRequest,
  DuplicateVerificationStatus
} from "../../shared/videoTypes.js";
import type { DatabaseConnection } from "./database.js";
import type { VideoRepository } from "./videoRepository.js";

interface JobRow {
  id: string; request_id: string; status: DuplicateCleanupJob["status"]; source_view: string | null;
  total_groups: number; total_items: number; processed_items: number; success_items: number; failed_items: number;
  skipped_items: number; planned_reclaimable_bytes: number; reclaimed_bytes: number; created_at: string;
  started_at: string | null; completed_at: string | null; updated_at: string; error_summary: string | null;
  workflow_version: number; phase: DuplicateCleanupJob["phase"]; verification_revision: string | null;
  verification_processed_items: number; identical_items: number; different_items: number; unverifiable_items: number;
  verification_completed_at: string | null; authorized_revision: string | null; authorized_at: string | null;
}

interface ItemRow {
  id: string; job_id: string; group_key: string; keep_video_id: string; delete_video_id: string;
  keep_path: string; delete_path: string; filename: string; directory: string;
  expected_keep_size_bytes: number; expected_keep_modified_at: string;
  expected_delete_size_bytes: number; expected_delete_modified_at: string;
  planned_reclaimable_bytes: number; status: DuplicateCleanupItemStatus;
  outcome_code: string | null; message: string | null; created_at: string; updated_at: string;
  verification_status: DuplicateVerificationStatus; verification_revision: string | null;
  keep_sha256: string | null; delete_sha256: string | null; verified_at: string | null;
  keep_file_identity: string | null; delete_file_identity: string | null;
  staged_delete_path: string | null; staged_at: string | null;
  verification_error: string | null; authorized_revision: string | null;
  delete_transport: "local" | "clouddrive";
  delete_provider_file_id: string | null;
  delete_provider_path: string | null;
}

export type DuplicateCleanupWorkItem = ItemRow;

export class DuplicateCleanupRepository {
  constructor(private readonly db: DatabaseConnection, private readonly videos: VideoRepository) {}

  preview(request: DuplicateCleanupSubmitRequest): Omit<DuplicateCleanupAccepted, "jobId" | "requestId" | "status"> {
    const entries = this.videos.validateDuplicateResolvePlan(request.plan);
    this.assertVideosAvailable(entries.flatMap((entry) => [entry.keepVideo.id, ...entry.deleteVideos.map((video) => video.id)]));
    return {
      totalGroups: entries.length,
      totalItems: entries.reduce((total, entry) => total + entry.deleteVideos.length, 0),
      plannedReclaimableBytes: entries.reduce((total, entry) => total + entry.deleteVideos.reduce((sum, video) => sum + video.sizeBytes, 0), 0)
    };
  }

  submit(request: DuplicateCleanupSubmitRequest): DuplicateCleanupAccepted {
    const existing = this.findByRequestId(request.requestId);
    if (existing) return toAccepted(existing);
    return this.db.transaction(() => {
      const raced = this.findByRequestId(request.requestId);
      if (raced) return toAccepted(raced);
      const entries = this.videos.validateDuplicateResolvePlan(request.plan);
      const videoIds = entries.flatMap((entry) => [entry.keepVideo.id, ...entry.deleteVideos.map((video) => video.id)]);
      this.assertVideosAvailable(videoIds);
      const now = new Date().toISOString();
      const jobId = crypto.randomUUID();
      const verificationRevision = crypto.randomUUID();
      const totalItems = entries.reduce((total, entry) => total + entry.deleteVideos.length, 0);
      const plannedReclaimableBytes = entries.reduce((total, entry) => total + entry.deleteVideos.reduce((sum, video) => sum + video.sizeBytes, 0), 0);
      this.db.prepare(`INSERT INTO duplicate_cleanup_jobs (
        id, request_id, status, source_view, total_groups, total_items, planned_reclaimable_bytes, created_at, updated_at,
        workflow_version, phase, verification_revision
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, 2, 'verification', ?)`)
        .run(jobId, request.requestId, request.sourceView ?? null, entries.length, totalItems, plannedReclaimableBytes, now, now, verificationRevision);
      const insertItem = this.db.prepare(`INSERT INTO duplicate_cleanup_items (
        id, job_id, group_key, keep_video_id, delete_video_id, keep_path, delete_path, filename, directory,
        expected_keep_size_bytes, expected_keep_modified_at, expected_delete_size_bytes, expected_delete_modified_at,
        planned_reclaimable_bytes, status, created_at, updated_at, verification_status, verification_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'pending', ?)`);
      for (const entry of entries) {
        for (const video of entry.deleteVideos) {
          insertItem.run(crypto.randomUUID(), jobId, entry.groupKey, entry.keepVideo.id, video.id,
            entry.keepVideo.path, video.path, video.filename, video.directory,
            entry.keepVideo.sizeBytes, entry.keepVideo.modifiedAt, video.sizeBytes, video.modifiedAt,
            video.sizeBytes, now, now, verificationRevision);
        }
      }
      const insertReservation = this.db.prepare(`INSERT INTO duplicate_cleanup_reservations
        (id, job_id, video_id, role, created_at, released_at) VALUES (?, ?, ?, ?, ?, NULL)`);
      for (const entry of entries) {
        insertReservation.run(crypto.randomUUID(), jobId, entry.keepVideo.id, "keep", now);
        for (const video of entry.deleteVideos) insertReservation.run(crypto.randomUUID(), jobId, video.id, "delete", now);
      }
      return { jobId, requestId: request.requestId, status: "queued" as const, totalGroups: entries.length, totalItems, plannedReclaimableBytes };
    })();
  }

  submitFast(request: DuplicateCleanupSubmitRequest): DuplicateCleanupAccepted {
    const existing = this.findByRequestId(request.requestId);
    if (existing) return toAccepted(existing);
    return this.db.transaction(() => {
      const raced = this.findByRequestId(request.requestId);
      if (raced) return toAccepted(raced);
      const entries = this.videos.validateDuplicateResolvePlan(request.plan);
      if (entries.length === 0) throw new Error("Duplicate cleanup plan has no deletable CloudDrive candidates.");
      for (const entry of entries) {
        for (const video of entry.deleteVideos) {
          if (!video.providerFileId || !video.providerPath) {
            throw new Error(`Duplicate cleanup target is not managed by CloudDrive API: ${video.filename}`);
          }
        }
      }
      const videoIds = entries.flatMap((entry) => [entry.keepVideo.id, ...entry.deleteVideos.map((video) => video.id)]);
      this.assertVideosAvailable(videoIds);
      const now = new Date().toISOString();
      const jobId = crypto.randomUUID();
      const totalItems = entries.reduce((total, entry) => total + entry.deleteVideos.length, 0);
      const plannedReclaimableBytes = entries.reduce(
        (total, entry) => total + entry.deleteVideos.reduce((sum, video) => sum + video.sizeBytes, 0),
        0
      );
      this.db.prepare(`INSERT INTO duplicate_cleanup_jobs (
        id, request_id, status, source_view, total_groups, total_items, planned_reclaimable_bytes,
        created_at, updated_at, workflow_version, phase
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, 3, 'deletion')`)
        .run(jobId, request.requestId, request.sourceView ?? "duplicates-api-fast", entries.length,
          totalItems, plannedReclaimableBytes, now, now);
      const insertItem = this.db.prepare(`INSERT INTO duplicate_cleanup_items (
        id, job_id, group_key, keep_video_id, delete_video_id, keep_path, delete_path, filename, directory,
        expected_keep_size_bytes, expected_keep_modified_at, expected_delete_size_bytes, expected_delete_modified_at,
        planned_reclaimable_bytes, status, created_at, updated_at, verification_status,
        delete_transport, delete_provider_file_id, delete_provider_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'unverified', 'clouddrive', ?, ?)`);
      for (const entry of entries) {
        for (const video of entry.deleteVideos) {
          insertItem.run(
            crypto.randomUUID(), jobId, entry.groupKey, entry.keepVideo.id, video.id,
            entry.keepVideo.path, video.path, video.filename, video.directory,
            entry.keepVideo.sizeBytes, entry.keepVideo.modifiedAt, video.sizeBytes, video.modifiedAt,
            video.sizeBytes, now, now, video.providerFileId, video.providerPath
          );
        }
      }
      const insertReservation = this.db.prepare(`INSERT INTO duplicate_cleanup_reservations
        (id, job_id, video_id, role, created_at, released_at) VALUES (?, ?, ?, ?, ?, NULL)`);
      for (const entry of entries) {
        insertReservation.run(crypto.randomUUID(), jobId, entry.keepVideo.id, "keep", now);
        for (const video of entry.deleteVideos) {
          insertReservation.run(crypto.randomUUID(), jobId, video.id, "delete", now);
        }
      }
      return { jobId, requestId: request.requestId, status: "queued" as const,
        totalGroups: entries.length, totalItems, plannedReclaimableBytes };
    })();
  }

  assertVideosAvailable(videoIds: string[]): void {
    const ids = [...new Set(videoIds)];
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT video_id FROM duplicate_cleanup_reservations WHERE released_at IS NULL AND video_id IN (${placeholders})`).all(...ids) as Array<{ video_id: string }>;
    if (rows.length > 0) throw new Error("Selected videos are reserved by a duplicate verification or deletion task.");
  }

  assertSourceFolderVideosAvailable(sourceFolderId: string): void {
    const row = this.db.prepare(`
      SELECT 1
      FROM duplicate_cleanup_reservations reservations
      JOIN videos ON videos.id = reservations.video_id
      WHERE reservations.released_at IS NULL
        AND videos.source_folder_id = ?
      LIMIT 1
    `).get(sourceFolderId);
    if (row) throw new Error("Selected videos are reserved by a duplicate verification or deletion task.");
  }

  assertGenericPermanentDeleteAllowed(videoIds: string[]): void {
    this.assertVideosAvailable(videoIds);
    const ids = [...new Set(videoIds)];
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT candidate.id FROM videos candidate
      WHERE candidate.id IN (${placeholders}) AND candidate.is_missing = 0
        AND candidate.metadata_status = 'ready' AND candidate.duration_ms IS NOT NULL AND candidate.duration_ms > 0
        AND EXISTS (SELECT 1 FROM videos peer WHERE peer.id <> candidate.id AND peer.is_missing = 0
          AND peer.metadata_status = 'ready' AND peer.duration_ms = candidate.duration_ms
          AND peer.size_bytes = candidate.size_bytes)`).all(...ids) as Array<{ id: string }>;
    if (rows.length > 0) {
      throw new Error("A selected video is a duplicate candidate. Permanent deletion requires full SHA-256 verification and separate confirmation.");
    }
  }

  listJobs(page: number, pageSize: number): DuplicateCleanupJobPage {
    const totalItems = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_jobs").get() as { count: number }).count;
    const activeCount = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_jobs WHERE status IN ('queued','running','cancelling','interrupted') OR phase = 'awaiting_confirmation'").get() as { count: number }).count;
    const safePage = Math.max(1, page);
    const rows = this.db.prepare("SELECT * FROM duplicate_cleanup_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?").all(pageSize, (safePage - 1) * pageSize) as JobRow[];
    return { items: rows.map(mapJob), page: safePage, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)), activeCount };
  }

  getJob(jobId: string): DuplicateCleanupJob {
    const row = this.db.prepare("SELECT * FROM duplicate_cleanup_jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!row) throw new Error("Duplicate cleanup task does not exist.");
    return mapJob(row);
  }

  listItems(jobId: string, page: number, pageSize: number): DuplicateCleanupItemPage {
    this.getJob(jobId);
    const totalItems = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_items WHERE job_id = ?").get(jobId) as { count: number }).count;
    const safePage = Math.max(1, page);
    const rows = this.db.prepare("SELECT * FROM duplicate_cleanup_items WHERE job_id = ? ORDER BY created_at LIMIT ? OFFSET ?").all(jobId, pageSize, (safePage - 1) * pageSize) as ItemRow[];
    return { items: rows.map(mapItem), page: safePage, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) };
  }

  getItemDirectory(itemId: string): string {
    const row = this.db.prepare("SELECT directory FROM duplicate_cleanup_items WHERE id = ?").get(itemId) as { directory: string } | undefined;
    if (!row) throw new Error("Duplicate cleanup item does not exist.");
    return row.directory;
  }

  interruptActiveJobs(): number {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const active = this.db.prepare(`SELECT id, phase FROM duplicate_cleanup_jobs
        WHERE workflow_version = 2 AND status IN ('queued','running','cancelling')`).all() as Array<{ id: string; phase: string }>;
      for (const job of active) {
        if (job.phase === "verification") {
          this.db.prepare(`UPDATE duplicate_cleanup_items SET verification_status = 'pending', keep_sha256 = NULL,
            delete_sha256 = NULL, keep_file_identity = NULL, delete_file_identity = NULL,
            verified_at = NULL, verification_error = NULL, authorized_revision = NULL,
            updated_at = ? WHERE job_id = ? AND status <> 'deleted'`).run(now, job.id);
        } else if (job.phase === "deletion") {
          this.db.prepare(`UPDATE duplicate_cleanup_items SET status = CASE WHEN status = 'deleted' THEN status ELSE 'pending' END,
            authorized_revision = NULL, updated_at = ? WHERE job_id = ?`).run(now, job.id);
        }
        this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'interrupted', authorized_revision = NULL,
          authorized_at = NULL, updated_at = ?, error_summary = 'Application exited; verify again before any remaining delete.'
          WHERE id = ?`).run(now, job.id);
      }
      return active.length;
    })();
  }

  recoverFastJobs(): string[] {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT id FROM duplicate_cleanup_jobs
        WHERE workflow_version = 3 AND phase = 'deletion'
          AND status IN ('queued','running','cancelling','interrupted')
        ORDER BY created_at`).all() as Array<{ id: string }>;
      for (const row of rows) {
        this.db.prepare(`UPDATE duplicate_cleanup_items
          SET status = CASE WHEN status = 'deleting' THEN 'pending' ELSE status END,
              updated_at = ?
          WHERE job_id = ? AND status <> 'deleted'`).run(now, row.id);
        this.db.prepare(`UPDATE duplicate_cleanup_jobs
          SET status = 'queued', updated_at = ?, error_summary = 'Continuing API deletion after application restart.'
          WHERE id = ?`).run(now, row.id);
      }
      return rows.map((row) => row.id);
    })();
  }

  start(jobId: string): boolean {
    const now = new Date().toISOString();
    return this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'running', started_at = COALESCE(started_at, ?),
      updated_at = ?, error_summary = NULL WHERE id = ? AND (
        (workflow_version = 2 AND phase IN ('verification','deletion') AND status = 'queued') OR
        (workflow_version = 3 AND phase = 'deletion' AND status IN ('queued','interrupted'))
      )`)
      .run(now, now, jobId).changes > 0;
  }

  listFastDeletionWorkItems(jobId: string): DuplicateCleanupWorkItem[] {
    const job = this.getJob(jobId);
    if (job.workflowVersion !== 3 || job.phase !== "deletion" || job.status !== "running") return [];
    return this.db.prepare(`SELECT * FROM duplicate_cleanup_items
      WHERE job_id = ? AND status = 'pending' AND delete_transport = 'clouddrive'
        AND delete_provider_file_id IS NOT NULL AND delete_provider_path IS NOT NULL
      ORDER BY created_at`).all(jobId) as ItemRow[];
  }

  claimFastDeletionItems(jobId: string, itemIds: readonly string[]): string[] {
    const claimed: string[] = [];
    const update = this.db.prepare(`UPDATE duplicate_cleanup_items SET status = 'deleting', updated_at = ?
      WHERE id = ? AND job_id = ? AND status = 'pending' AND delete_transport = 'clouddrive'
        AND delete_provider_file_id IS NOT NULL AND delete_provider_path IS NOT NULL
        AND EXISTS (SELECT 1 FROM duplicate_cleanup_jobs WHERE id = ? AND workflow_version = 3
          AND phase = 'deletion' AND status = 'running')`);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const itemId of itemIds) {
        if (update.run(now, itemId, jobId, jobId).changes === 1) claimed.push(itemId);
      }
    })();
    return claimed;
  }

  listVerificationItems(jobId: string): DuplicateCleanupWorkItem[] {
    const job = this.getJob(jobId);
    if (job.workflowVersion !== 2 || job.phase !== "verification" || !job.verificationRevision) return [];
    return this.db.prepare(`SELECT * FROM duplicate_cleanup_items WHERE job_id = ? AND status <> 'deleted'
      AND verification_revision = ? ORDER BY created_at`).all(jobId, job.verificationRevision) as ItemRow[];
  }

  markVerificationGroupRunning(jobId: string, groupKey: string, revision: string): void {
    const result = this.db.prepare(`UPDATE duplicate_cleanup_items SET verification_status = 'verifying', updated_at = ?
      WHERE job_id = ? AND group_key = ? AND verification_revision = ? AND status <> 'deleted'
      AND EXISTS (SELECT 1 FROM duplicate_cleanup_jobs WHERE id = ? AND phase = 'verification' AND status = 'running' AND verification_revision = ?)`)
      .run(new Date().toISOString(), jobId, groupKey, revision, jobId, revision);
    if (result.changes === 0) throw new Error("Verification authorization is stale.");
  }

  recordVerificationGroup(
    jobId: string, groupKey: string, revision: string,
    result: Extract<DuplicateVerificationStatus, "verified-identical" | "content-different" | "unverifiable">,
    keepHash: string | null, deleteHashes: ReadonlyMap<string, string>,
    keepIdentity: string | null, deleteIdentities: ReadonlyMap<string, string>, error: string | null
  ): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const job = this.getJob(jobId);
      if (job.workflowVersion !== 2 || job.phase !== "verification" || job.status !== "running" || job.verificationRevision !== revision) {
        throw new Error("Verification result is stale and was rejected.");
      }
      const rows = this.db.prepare("SELECT id FROM duplicate_cleanup_items WHERE job_id = ? AND group_key = ? AND status <> 'deleted'").all(jobId, groupKey) as Array<{ id: string }>;
      const update = this.db.prepare(`UPDATE duplicate_cleanup_items SET verification_status = ?, keep_sha256 = ?, delete_sha256 = ?,
        keep_file_identity = ?, delete_file_identity = ?, verified_at = ?, verification_error = ?,
        authorized_revision = NULL, updated_at = ? WHERE id = ? AND verification_revision = ?`);
      for (const row of rows) update.run(result, keepHash, deleteHashes.get(row.id) ?? null,
        keepIdentity, deleteIdentities.get(row.id) ?? null, now, error, now, row.id, revision);
      this.refreshVerificationCounts(jobId);
    })();
  }

  completeVerification(jobId: string): DuplicateCleanupJob {
    return this.db.transaction(() => {
      const current = this.getJob(jobId);
      if (current.phase !== "verification" || current.status !== "running") return current;
      this.refreshVerificationCounts(jobId);
      const refreshed = this.getJob(jobId);
      const now = new Date().toISOString();
      const hasEligible = refreshed.identicalItems > 0;
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = ?, phase = ?, verification_completed_at = ?,
        completed_at = CASE WHEN ? THEN completed_at ELSE ? END, updated_at = ? WHERE id = ?`)
        .run(hasEligible ? "completed" : "completed_with_errors", hasEligible ? "awaiting_confirmation" : "finished",
          now, hasEligible ? 1 : 0, now, now, jobId);
      if (!hasEligible) this.release(jobId);
      return this.getJob(jobId);
    })();
  }

  authorizeDeletion(request: DuplicateCleanupConfirmRequest): DuplicateCleanupJob {
    return this.db.transaction(() => {
      if (request.confirmation !== "DELETE") throw new Error("Permanent deletion confirmation must be exactly DELETE.");
      const job = this.getJob(request.jobId);
      if (job.workflowVersion !== 2 || job.phase !== "awaiting_confirmation" || job.status !== "completed") {
        throw new Error("This task is not awaiting permanent deletion confirmation.");
      }
      if (!job.verificationRevision || job.verificationRevision !== request.verificationRevision || job.verificationCompletedAt === null) {
        throw new Error("Full SHA-256 verification is missing or stale.");
      }
      const invalid = (this.db.prepare(`SELECT COUNT(*) AS count FROM duplicate_cleanup_items
        WHERE job_id = ? AND verification_status = 'verified-identical'
          AND (verification_revision <> ? OR keep_sha256 IS NULL OR length(keep_sha256) <> 64
            OR delete_sha256 IS NULL OR length(delete_sha256) <> 64 OR keep_sha256 <> delete_sha256
            OR keep_file_identity IS NULL OR delete_file_identity IS NULL)`)
        .get(job.id, job.verificationRevision) as { count: number }).count;
      const eligible = (this.db.prepare(`SELECT COUNT(*) AS count FROM duplicate_cleanup_items
        WHERE job_id = ? AND verification_status = 'verified-identical' AND verification_revision = ?`)
        .get(job.id, job.verificationRevision) as { count: number }).count;
      if (invalid > 0 || eligible === 0) throw new Error("No fresh successful full SHA-256 authorization is available.");
      const authorization = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE duplicate_cleanup_items SET
        status = CASE WHEN verification_status = 'verified-identical' THEN 'pending' ELSE 'skipped' END,
        outcome_code = CASE WHEN verification_status = 'verified-identical' THEN NULL ELSE verification_status END,
        message = CASE WHEN verification_status = 'verified-identical' THEN NULL ELSE 'Not authorized for permanent deletion.' END,
        authorized_revision = CASE WHEN verification_status = 'verified-identical' THEN ? ELSE NULL END,
        updated_at = ? WHERE job_id = ? AND status <> 'deleted'`).run(authorization, now, job.id);
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET phase = 'deletion', status = 'queued', authorized_revision = ?,
        authorized_at = ?, completed_at = NULL, processed_items = 0, success_items = 0, failed_items = 0,
        skipped_items = 0, reclaimed_bytes = 0, updated_at = ?, error_summary = NULL WHERE id = ?`)
        .run(authorization, now, now, job.id);
      return this.getJob(job.id);
    })();
  }

  listDeletionWorkItems(jobId: string): DuplicateCleanupWorkItem[] {
    const job = this.getJob(jobId);
    if (job.workflowVersion !== 2 || job.phase !== "deletion" || !job.authorizedRevision || job.status !== "running") return [];
    return this.db.prepare(`SELECT * FROM duplicate_cleanup_items WHERE job_id = ? AND status = 'pending'
      AND verification_status = 'verified-identical' AND verification_revision = ? AND authorized_revision = ?
      AND keep_sha256 IS NOT NULL AND length(keep_sha256) = 64 AND delete_sha256 = keep_sha256
      AND keep_file_identity IS NOT NULL AND delete_file_identity IS NOT NULL ORDER BY created_at`)
      .all(jobId, job.verificationRevision, job.authorizedRevision) as ItemRow[];
  }

  claimDeletionItem(jobId: string, itemId: string): boolean {
    const now = new Date().toISOString();
    return this.db.prepare(`UPDATE duplicate_cleanup_items SET status = 'deleting', updated_at = ?
      WHERE id = ? AND job_id = ? AND status = 'pending' AND verification_status = 'verified-identical'
        AND keep_sha256 IS NOT NULL AND length(keep_sha256) = 64 AND delete_sha256 = keep_sha256
        AND keep_file_identity IS NOT NULL AND delete_file_identity IS NOT NULL
        AND verification_revision = (SELECT verification_revision FROM duplicate_cleanup_jobs WHERE id = ?)
        AND authorized_revision = (SELECT authorized_revision FROM duplicate_cleanup_jobs WHERE id = ?)
        AND EXISTS (SELECT 1 FROM duplicate_cleanup_jobs WHERE id = ? AND workflow_version = 2
          AND phase = 'deletion' AND status = 'running' AND authorized_revision IS NOT NULL)`)
      .run(now, itemId, jobId, jobId, jobId, jobId).changes === 1;
  }

  prepareIsolation(jobId: string, itemId: string, stagedPath: string): boolean {
    const now = new Date().toISOString();
    return this.db.prepare(`UPDATE duplicate_cleanup_items SET staged_delete_path = ?, staged_at = ?, updated_at = ?
      WHERE id = ? AND job_id = ? AND status = 'pending' AND staged_delete_path IS NULL
        AND verification_status = 'verified-identical' AND keep_sha256 = delete_sha256
        AND verification_revision = (SELECT verification_revision FROM duplicate_cleanup_jobs WHERE id = ?)
        AND authorized_revision = (SELECT authorized_revision FROM duplicate_cleanup_jobs WHERE id = ?)
        AND EXISTS (SELECT 1 FROM duplicate_cleanup_jobs WHERE id = ? AND workflow_version = 2
          AND phase = 'deletion' AND status = 'running' AND authorized_revision IS NOT NULL)`)
      .run(stagedPath, now, now, itemId, jobId, jobId, jobId, jobId).changes === 1;
  }

  listStagedItems(): DuplicateCleanupWorkItem[] {
    return this.db.prepare("SELECT * FROM duplicate_cleanup_items WHERE staged_delete_path IS NOT NULL ORDER BY staged_at")
      .all() as ItemRow[];
  }

  clearIsolation(itemId: string): void {
    this.db.prepare("UPDATE duplicate_cleanup_items SET staged_delete_path = NULL, staged_at = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), itemId);
  }

  recordIsolationRecoveryFailure(itemId: string, message: string): void {
    this.db.prepare(`UPDATE duplicate_cleanup_items SET status = 'failed', outcome_code = 'isolation-recovery-required',
      message = ?, authorized_revision = NULL, updated_at = ? WHERE id = ?`)
      .run(message, new Date().toISOString(), itemId);
  }

  updateItem(itemId: string, status: DuplicateCleanupItemStatus, outcomeCode: string | null = null, message: string | null = null): void {
    this.db.prepare("UPDATE duplicate_cleanup_items SET status = ?, outcome_code = ?, message = ?, updated_at = ? WHERE id = ?")
      .run(status, outcomeCode, message, new Date().toISOString(), itemId);
  }

  requestCancel(jobId: string): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (job.workflowVersion === 3) {
      if (!["queued", "running", "interrupted"].includes(job.status)) return job;
      const now = new Date().toISOString();
      this.db.transaction(() => {
        this.db.prepare("UPDATE duplicate_cleanup_jobs SET status = 'cancelling', updated_at = ? WHERE id = ?")
          .run(now, jobId);
        this.db.prepare(`UPDATE duplicate_cleanup_items SET status = 'cancelled', outcome_code = 'delete-stop-requested',
          message = 'User stopped remaining API deletions.', updated_at = ?
          WHERE job_id = ? AND status = 'pending'`).run(now, jobId);
      })();
      return this.getJob(jobId);
    }
    if (job.workflowVersion !== 2) return job;
    const now = new Date().toISOString();
    if (job.phase === "awaiting_confirmation") {
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'cancelled', phase = 'finished', authorized_revision = NULL,
        authorized_at = NULL, completed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, jobId);
      this.release(jobId);
      return this.getJob(jobId);
    }
    if (!["queued", "running", "interrupted"].includes(job.status)) return job;
    this.db.transaction(() => {
      this.db.prepare("UPDATE duplicate_cleanup_jobs SET status = 'cancelling', updated_at = ? WHERE id = ?").run(now, jobId);
      if (job.phase === "verification") {
        this.db.prepare(`UPDATE duplicate_cleanup_items SET verification_status = 'cancelled', keep_sha256 = NULL,
          delete_sha256 = NULL, keep_file_identity = NULL, delete_file_identity = NULL,
          verified_at = NULL, verification_error = 'Verification cancelled by user.',
          authorized_revision = NULL, updated_at = ? WHERE job_id = ? AND status <> 'deleted'`).run(now, jobId);
      } else {
        this.db.prepare(`UPDATE duplicate_cleanup_items SET status = 'cancelled', outcome_code = 'delete-stop-requested',
          message = 'User stopped remaining deletions.', authorized_revision = NULL, updated_at = ?
          WHERE job_id = ? AND status = 'pending'`).run(now, jobId);
      }
    })();
    return this.getJob(jobId);
  }

  isCancelling(jobId: string): boolean { return this.getJob(jobId).status === "cancelling"; }

  finishCancelled(jobId: string): DuplicateCleanupJob {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const job = this.getJob(jobId);
      if (job.phase === "verification") {
        this.db.prepare(`UPDATE duplicate_cleanup_items SET verification_status = 'cancelled', keep_sha256 = NULL,
          delete_sha256 = NULL, keep_file_identity = NULL, delete_file_identity = NULL,
          verified_at = NULL, authorized_revision = NULL, updated_at = ?
          WHERE job_id = ? AND status <> 'deleted'`).run(now, jobId);
      }
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'cancelled', phase = 'finished', authorized_revision = NULL,
        authorized_at = NULL, completed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, jobId);
      this.release(jobId);
      return this.getJob(jobId);
    })();
  }

  finishDeletion(jobId: string): DuplicateCleanupJob {
    return this.db.transaction(() => {
      const counts = this.deletionCounts(jobId);
      const current = this.getJob(jobId);
      const status = current.status === "cancelling" ? "cancelled" : counts.failed + counts.skipped > 0 ? "completed_with_errors" : "completed";
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = ?, phase = 'finished', processed_items = ?, success_items = ?,
        failed_items = ?, skipped_items = ?, reclaimed_bytes = ?, completed_at = ?, updated_at = ?,
        authorized_revision = NULL, authorized_at = NULL WHERE id = ?`)
        .run(status, counts.succeeded + counts.failed + counts.skipped, counts.succeeded, counts.failed, counts.skipped, counts.reclaimed, now, now, jobId);
      this.db.prepare("UPDATE duplicate_cleanup_items SET authorized_revision = NULL WHERE job_id = ?").run(jobId);
      this.release(jobId);
      return this.getJob(jobId);
    })();
  }

  progress(jobId: string): DuplicateCleanupJob {
    const counts = this.deletionCounts(jobId);
    this.db.prepare("UPDATE duplicate_cleanup_jobs SET processed_items=?, success_items=?, failed_items=?, skipped_items=?, reclaimed_bytes=?, updated_at=? WHERE id=?")
      .run(counts.succeeded + counts.failed + counts.skipped, counts.succeeded, counts.failed, counts.skipped, counts.reclaimed, new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  resume(jobId: string): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (job.workflowVersion === 3) return this.restartFastDeletion(jobId, "interrupted");
    if (job.workflowVersion !== 2) throw new Error("Legacy cleanup tasks cannot be resumed; create a new verification task.");
    if (job.status !== "interrupted") throw new Error("Only interrupted tasks can be resumed.");
    return this.restartVerification(jobId);
  }

  retry(jobId: string): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (job.workflowVersion === 3) return this.restartFastDeletion(jobId, "retry");
    if (job.workflowVersion !== 2) throw new Error("Legacy cleanup tasks cannot be retried; create a new verification task.");
    if (!["completed_with_errors", "cancelled"].includes(job.status) || job.phase !== "finished") throw new Error("This task has no retryable items.");
    return this.restartVerification(jobId);
  }

  clear(jobId: string): boolean {
    const job = this.getJob(jobId);
    if (!["completed", "completed_with_errors", "cancelled"].includes(job.status)) throw new Error("Active tasks cannot be cleared.");
    const staged = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_items WHERE job_id = ? AND staged_delete_path IS NOT NULL")
      .get(jobId) as { count: number }).count;
    if (staged > 0) throw new Error("A recoverable isolated file is still recorded; restore it before clearing this task.");
    this.release(jobId);
    return this.db.prepare("DELETE FROM duplicate_cleanup_jobs WHERE id = ?").run(jobId).changes > 0;
  }

  private restartVerification(jobId: string): DuplicateCleanupJob {
    const staged = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_items WHERE job_id = ? AND staged_delete_path IS NOT NULL")
      .get(jobId) as { count: number }).count;
    if (staged > 0) throw new Error("An isolated file still requires recovery before this task can restart verification.");
    const revision = crypto.randomUUID();
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      this.restoreReservations(jobId);
      this.db.prepare(`UPDATE duplicate_cleanup_items SET status = CASE WHEN status = 'deleted' THEN status ELSE 'pending' END,
        outcome_code = CASE WHEN status = 'deleted' THEN outcome_code ELSE NULL END,
        message = CASE WHEN status = 'deleted' THEN message ELSE NULL END,
        verification_status = CASE WHEN status = 'deleted' THEN verification_status ELSE 'pending' END,
        verification_revision = CASE WHEN status = 'deleted' THEN verification_revision ELSE ? END,
        keep_sha256 = CASE WHEN status = 'deleted' THEN keep_sha256 ELSE NULL END,
        delete_sha256 = CASE WHEN status = 'deleted' THEN delete_sha256 ELSE NULL END,
        keep_file_identity = CASE WHEN status = 'deleted' THEN keep_file_identity ELSE NULL END,
        delete_file_identity = CASE WHEN status = 'deleted' THEN delete_file_identity ELSE NULL END,
        verified_at = CASE WHEN status = 'deleted' THEN verified_at ELSE NULL END,
        verification_error = CASE WHEN status = 'deleted' THEN verification_error ELSE NULL END,
        authorized_revision = NULL, updated_at = ? WHERE job_id = ?`).run(revision, now, jobId);
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'queued', phase = 'verification', verification_revision = ?,
        verification_processed_items = 0, identical_items = 0, different_items = 0, unverifiable_items = 0,
        verification_completed_at = NULL, authorized_revision = NULL, authorized_at = NULL, completed_at = NULL,
        updated_at = ?, error_summary = NULL WHERE id = ?`).run(revision, now, jobId);
      return this.getJob(jobId);
    })();
  }

  private restartFastDeletion(jobId: string, mode: "interrupted" | "retry"): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (mode === "interrupted" && job.status !== "interrupted") {
      throw new Error("Only interrupted API cleanup tasks can be resumed.");
    }
    if (mode === "retry" && !["completed_with_errors", "cancelled"].includes(job.status)) {
      throw new Error("This API cleanup task has no retryable items.");
    }
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      this.restoreReservations(jobId);
      this.db.prepare(`UPDATE duplicate_cleanup_items
        SET status = CASE WHEN status = 'deleted' THEN status ELSE 'pending' END,
            outcome_code = CASE WHEN status = 'deleted' THEN outcome_code ELSE NULL END,
            message = CASE WHEN status = 'deleted' THEN message ELSE NULL END,
            updated_at = ? WHERE job_id = ?`).run(now, jobId);
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'queued', phase = 'deletion',
        completed_at = NULL, updated_at = ?, error_summary = NULL WHERE id = ?`).run(now, jobId);
      return this.getJob(jobId);
    })();
  }

  private refreshVerificationCounts(jobId: string): void {
    const counts = this.db.prepare(`SELECT
      SUM(CASE WHEN verification_status IN ('verified-identical','content-different','unverifiable') THEN 1 ELSE 0 END) AS processed,
      SUM(CASE WHEN verification_status = 'verified-identical' THEN 1 ELSE 0 END) AS identical,
      SUM(CASE WHEN verification_status = 'content-different' THEN 1 ELSE 0 END) AS different,
      SUM(CASE WHEN verification_status = 'unverifiable' THEN 1 ELSE 0 END) AS unverifiable
      FROM duplicate_cleanup_items WHERE job_id = ? AND status <> 'deleted'`).get(jobId) as {
        processed: number | null; identical: number | null; different: number | null; unverifiable: number | null;
      };
    this.db.prepare(`UPDATE duplicate_cleanup_jobs SET verification_processed_items = ?, identical_items = ?,
      different_items = ?, unverifiable_items = ?, updated_at = ? WHERE id = ?`)
      .run(counts.processed ?? 0, counts.identical ?? 0, counts.different ?? 0, counts.unverifiable ?? 0, new Date().toISOString(), jobId);
  }

  private deletionCounts(jobId: string) {
    const counts = this.db.prepare(`SELECT
      SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('skipped','cancelled') THEN 1 ELSE 0 END) AS skipped,
      COALESCE(SUM(CASE WHEN status = 'deleted' AND outcome_code NOT IN ('moved-to-cloud-recycle-bin','already-missing') THEN planned_reclaimable_bytes ELSE 0 END), 0) AS reclaimed
      FROM duplicate_cleanup_items WHERE job_id = ?`).get(jobId) as { succeeded: number | null; failed: number | null; skipped: number | null; reclaimed: number };
    return { succeeded: counts.succeeded ?? 0, failed: counts.failed ?? 0, skipped: counts.skipped ?? 0, reclaimed: counts.reclaimed };
  }

  private restoreReservations(jobId: string): void {
    this.db.transaction(() => {
      this.release(jobId);
      const rows = this.db.prepare("SELECT DISTINCT keep_video_id, delete_video_id FROM duplicate_cleanup_items WHERE job_id = ? AND status <> 'deleted'").all(jobId) as Array<{ keep_video_id: string; delete_video_id: string }>;
      this.assertVideosAvailable(rows.flatMap((row) => [row.keep_video_id, row.delete_video_id]));
      const insert = this.db.prepare("INSERT INTO duplicate_cleanup_reservations (id, job_id, video_id, role, created_at, released_at) VALUES (?, ?, ?, ?, ?, NULL)");
      const now = new Date().toISOString();
      for (const id of new Set(rows.map((row) => row.keep_video_id))) insert.run(crypto.randomUUID(), jobId, id, "keep", now);
      for (const row of rows) insert.run(crypto.randomUUID(), jobId, row.delete_video_id, "delete", now);
    })();
  }

  private release(jobId: string): void {
    this.db.prepare("UPDATE duplicate_cleanup_reservations SET released_at = ? WHERE job_id = ? AND released_at IS NULL").run(new Date().toISOString(), jobId);
  }

  private findByRequestId(requestId: string): JobRow | undefined {
    return this.db.prepare("SELECT * FROM duplicate_cleanup_jobs WHERE request_id = ?").get(requestId) as JobRow | undefined;
  }
}

function mapJob(row: JobRow): DuplicateCleanupJob {
  return { id: row.id, requestId: row.request_id, status: row.status, sourceView: row.source_view,
    totalGroups: row.total_groups, totalItems: row.total_items, processedItems: row.processed_items,
    successItems: row.success_items, failedItems: row.failed_items, skippedItems: row.skipped_items,
    plannedReclaimableBytes: row.planned_reclaimable_bytes, reclaimedBytes: row.reclaimed_bytes, createdAt: row.created_at,
    startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at, errorSummary: row.error_summary,
    workflowVersion: row.workflow_version, phase: row.phase, verificationRevision: row.verification_revision,
    verificationProcessedItems: row.verification_processed_items, identicalItems: row.identical_items,
    differentItems: row.different_items, unverifiableItems: row.unverifiable_items,
    verificationCompletedAt: row.verification_completed_at, authorizedRevision: row.authorized_revision, authorizedAt: row.authorized_at };
}

function mapItem(row: ItemRow): DuplicateCleanupItem {
  return { id: row.id, jobId: row.job_id, groupKey: row.group_key, keepVideoId: row.keep_video_id,
    deleteVideoId: row.delete_video_id, filename: row.filename, directory: row.directory,
    expectedDeleteSizeBytes: row.expected_delete_size_bytes, plannedReclaimableBytes: row.planned_reclaimable_bytes,
    status: row.status, outcomeCode: row.outcome_code, message: row.message, updatedAt: row.updated_at,
    verificationStatus: row.verification_status, verificationRevision: row.verification_revision,
    verifiedAt: row.verified_at, verificationError: row.verification_error,
    stagedDeletePath: row.staged_delete_path };
}

function toAccepted(job: JobRow): DuplicateCleanupAccepted {
  return { jobId: job.id, requestId: job.request_id, status: job.status, totalGroups: job.total_groups,
    totalItems: job.total_items, plannedReclaimableBytes: job.planned_reclaimable_bytes };
}
