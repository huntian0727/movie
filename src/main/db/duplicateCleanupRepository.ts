import crypto from "node:crypto";
import type {
  DuplicateCleanupAccepted,
  DuplicateCleanupItem,
  DuplicateCleanupItemPage,
  DuplicateCleanupItemStatus,
  DuplicateCleanupJob,
  DuplicateCleanupJobPage,
  DuplicateCleanupSubmitRequest
} from "../../shared/videoTypes.js";
import type { DatabaseConnection } from "./database.js";
import type { VideoRepository } from "./videoRepository.js";

interface JobRow {
  id: string; request_id: string; status: DuplicateCleanupJob["status"]; source_view: string | null;
  total_groups: number; total_items: number; processed_items: number; success_items: number;
  failed_items: number; skipped_items: number; planned_reclaimable_bytes: number; reclaimed_bytes: number; created_at: string;
  started_at: string | null; completed_at: string | null; updated_at: string; error_summary: string | null;
}

interface ItemRow {
  id: string; job_id: string; group_key: string; keep_video_id: string; delete_video_id: string;
  keep_path: string; delete_path: string; filename: string; directory: string;
  expected_keep_size_bytes: number; expected_keep_modified_at: string;
  expected_delete_size_bytes: number; expected_delete_modified_at: string;
  planned_reclaimable_bytes: number; status: DuplicateCleanupItemStatus;
  outcome_code: string | null; message: string | null; created_at: string; updated_at: string;
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
      const totalItems = entries.reduce((total, entry) => total + entry.deleteVideos.length, 0);
      const plannedReclaimableBytes = entries.reduce((total, entry) => total + entry.deleteVideos.reduce((sum, video) => sum + video.sizeBytes, 0), 0);
      this.db.prepare(`INSERT INTO duplicate_cleanup_jobs (
        id, request_id, status, source_view, total_groups, total_items, planned_reclaimable_bytes, created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)`)
        .run(jobId, request.requestId, request.sourceView ?? null, entries.length, totalItems, plannedReclaimableBytes, now, now);
      const insertItem = this.db.prepare(`INSERT INTO duplicate_cleanup_items (
        id, job_id, group_key, keep_video_id, delete_video_id, keep_path, delete_path, filename, directory,
        expected_keep_size_bytes, expected_keep_modified_at, expected_delete_size_bytes, expected_delete_modified_at,
        planned_reclaimable_bytes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`);
      for (const entry of entries) {
        for (const video of entry.deleteVideos) {
          insertItem.run(crypto.randomUUID(), jobId, entry.groupKey, entry.keepVideo.id, video.id,
            entry.keepVideo.path, video.path, video.filename, video.directory,
            entry.keepVideo.sizeBytes, entry.keepVideo.modifiedAt, video.sizeBytes, video.modifiedAt,
            video.sizeBytes, now, now);
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

  assertVideosAvailable(videoIds: string[]): void {
    const ids = [...new Set(videoIds)];
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT video_id FROM duplicate_cleanup_reservations WHERE released_at IS NULL AND video_id IN (${placeholders})`).all(...ids) as Array<{ video_id: string }>;
    if (rows.length > 0) throw new Error("所选视频正在后台清理任务中，请等待任务结束后再操作");
  }

  listJobs(page: number, pageSize: number): DuplicateCleanupJobPage {
    const totalItems = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_jobs").get() as { count: number }).count;
    const activeCount = (this.db.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_jobs WHERE status IN ('queued','running','cancelling','interrupted')").get() as { count: number }).count;
    const safePage = Math.max(1, page);
    const rows = this.db.prepare("SELECT * FROM duplicate_cleanup_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?").all(pageSize, (safePage - 1) * pageSize) as JobRow[];
    return { items: rows.map(mapJob), page: safePage, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)), activeCount };
  }

  getJob(jobId: string): DuplicateCleanupJob {
    const row = this.db.prepare("SELECT * FROM duplicate_cleanup_jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!row) throw new Error("后台清理任务不存在");
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
    if (!row) throw new Error("后台清理任务项目不存在");
    return row.directory;
  }

  interruptActiveJobs(): number {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      this.db.prepare("UPDATE duplicate_cleanup_items SET status = 'pending', updated_at = ? WHERE status IN ('verifying','deleting')").run(now);
      const result = this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = 'interrupted', updated_at = ?, error_summary = '应用退出，需手动恢复' WHERE status IN ('queued','running','cancelling')`).run(now);
      return result.changes;
    })();
  }

  start(jobId: string): boolean {
    const now = new Date().toISOString();
    return this.db.prepare("UPDATE duplicate_cleanup_jobs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error_summary = NULL WHERE id = ? AND status = 'queued'").run(now, now, jobId).changes > 0;
  }

  listWorkItems(jobId: string): DuplicateCleanupWorkItem[] {
    return this.db.prepare("SELECT * FROM duplicate_cleanup_items WHERE job_id = ? AND status = 'pending' ORDER BY created_at").all(jobId) as ItemRow[];
  }

  updateItem(itemId: string, status: DuplicateCleanupItemStatus, outcomeCode: string | null = null, message: string | null = null): void {
    this.db.prepare("UPDATE duplicate_cleanup_items SET status = ?, outcome_code = ?, message = ?, updated_at = ? WHERE id = ?")
      .run(status, outcomeCode, message, new Date().toISOString(), itemId);
  }

  requestCancel(jobId: string): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (!["queued", "running", "interrupted"].includes(job.status)) return job;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE duplicate_cleanup_jobs SET status = 'cancelling', updated_at = ? WHERE id = ?").run(now, jobId);
      this.db.prepare("UPDATE duplicate_cleanup_items SET status = 'cancelled', outcome_code = 'cancelled', message = '用户取消', updated_at = ? WHERE job_id = ? AND status = 'pending'").run(now, jobId);
    })();
    return this.getJob(jobId);
  }

  isCancelling(jobId: string): boolean {
    return this.getJob(jobId).status === "cancelling";
  }

  finish(jobId: string): DuplicateCleanupJob {
    return this.db.transaction(() => {
      const counts = this.db.prepare(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status IN ('skipped','cancelled') THEN 1 ELSE 0 END) AS skipped,
        COALESCE(SUM(CASE WHEN status = 'deleted' THEN planned_reclaimable_bytes ELSE 0 END), 0) AS reclaimed
        FROM duplicate_cleanup_items WHERE job_id = ?`).get(jobId) as { total: number; succeeded: number; failed: number; skipped: number; reclaimed: number };
      const current = this.getJob(jobId);
      const status = current.status === "cancelling" ? "cancelled" : counts.failed + counts.skipped > 0 ? "completed_with_errors" : "completed";
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE duplicate_cleanup_jobs SET status = ?, processed_items = ?, success_items = ?, failed_items = ?, skipped_items = ?, reclaimed_bytes = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, counts.succeeded + counts.failed + counts.skipped, counts.succeeded, counts.failed, counts.skipped, counts.reclaimed, now, now, jobId);
      this.release(jobId);
      return this.getJob(jobId);
    })();
  }

  progress(jobId: string): DuplicateCleanupJob {
    const counts = this.db.prepare(`SELECT
      SUM(CASE WHEN status IN ('deleted','failed','skipped','cancelled') THEN 1 ELSE 0 END) AS processed,
      SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('skipped','cancelled') THEN 1 ELSE 0 END) AS skipped,
      COALESCE(SUM(CASE WHEN status = 'deleted' THEN planned_reclaimable_bytes ELSE 0 END), 0) AS reclaimed
      FROM duplicate_cleanup_items WHERE job_id = ?`).get(jobId) as { processed: number; succeeded: number; failed: number; skipped: number; reclaimed: number };
    this.db.prepare("UPDATE duplicate_cleanup_jobs SET processed_items=?, success_items=?, failed_items=?, skipped_items=?, reclaimed_bytes=?, updated_at=? WHERE id=?")
      .run(counts.processed, counts.succeeded, counts.failed, counts.skipped, counts.reclaimed, new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  resume(jobId: string): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (job.status !== "interrupted") throw new Error("只有已中断任务可以恢复");
    this.restoreReservations(jobId);
    this.db.prepare("UPDATE duplicate_cleanup_jobs SET status='queued', completed_at=NULL, updated_at=?, error_summary=NULL WHERE id=?").run(new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  retry(jobId: string): DuplicateCleanupJob {
    const job = this.getJob(jobId);
    if (!["completed_with_errors", "cancelled"].includes(job.status)) throw new Error("当前任务没有可重试项目");
    this.db.prepare("UPDATE duplicate_cleanup_items SET status='pending', outcome_code=NULL, message=NULL, updated_at=? WHERE job_id=? AND status IN ('failed','cancelled')")
      .run(new Date().toISOString(), jobId);
    this.restoreReservations(jobId);
    this.db.prepare("UPDATE duplicate_cleanup_jobs SET status='queued', completed_at=NULL, updated_at=?, error_summary=NULL WHERE id=?").run(new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  clear(jobId: string): boolean {
    const job = this.getJob(jobId);
    if (!["completed", "completed_with_errors", "cancelled"].includes(job.status)) throw new Error("进行中的任务不能清除");
    return this.db.prepare("DELETE FROM duplicate_cleanup_jobs WHERE id = ?").run(jobId).changes > 0;
  }

  private restoreReservations(jobId: string): void {
    this.db.transaction(() => {
      this.release(jobId);
      const rows = this.db.prepare("SELECT DISTINCT keep_video_id, delete_video_id FROM duplicate_cleanup_items WHERE job_id = ? AND status NOT IN ('deleted','skipped')").all(jobId) as Array<{ keep_video_id: string; delete_video_id: string }>;
      this.assertVideosAvailable(rows.flatMap((row) => [row.keep_video_id, row.delete_video_id]));
      const insert = this.db.prepare("INSERT INTO duplicate_cleanup_reservations (id, job_id, video_id, role, created_at, released_at) VALUES (?, ?, ?, ?, ?, NULL)");
      const now = new Date().toISOString();
      const keepIds = new Set(rows.map((row) => row.keep_video_id));
      for (const id of keepIds) insert.run(crypto.randomUUID(), jobId, id, "keep", now);
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
    plannedReclaimableBytes: row.planned_reclaimable_bytes, reclaimedBytes: row.reclaimed_bytes, createdAt: row.created_at, startedAt: row.started_at,
    completedAt: row.completed_at, updatedAt: row.updated_at, errorSummary: row.error_summary };
}

function mapItem(row: ItemRow): DuplicateCleanupItem {
  return { id: row.id, jobId: row.job_id, groupKey: row.group_key, keepVideoId: row.keep_video_id,
    deleteVideoId: row.delete_video_id, filename: row.filename, directory: row.directory,
    expectedDeleteSizeBytes: row.expected_delete_size_bytes, plannedReclaimableBytes: row.planned_reclaimable_bytes,
    status: row.status, outcomeCode: row.outcome_code, message: row.message, updatedAt: row.updated_at };
}

function toAccepted(job: JobRow): DuplicateCleanupAccepted {
  return { jobId: job.id, requestId: job.request_id, status: job.status, totalGroups: job.total_groups, totalItems: job.total_items, plannedReclaimableBytes: job.planned_reclaimable_bytes };
}
