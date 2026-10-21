import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type {
  DuplicateResolvePlan, DuplicateResolveResult, ReviewedDeleteBackgroundJob
} from "../../shared/videoTypes.js";

const CHUNK_SIZE = 30;
const MAX_TOTAL = 500;

type Runner = (plan: DuplicateResolvePlan) => Promise<DuplicateResolveResult>;

/**
 * The confirmation is collected by the renderer BEFORE calling submit().
 * A single running job lives in the Electron main process, independent of
 * renderer pages. State is atomically checkpointed after every chunk.
 * Never replay an interrupted or uncertain destructive request on startup.
 */
export class ReviewedDuplicateBackgroundQueue {
  private current: ReviewedDeleteBackgroundJob | null;
  private active = false;

  constructor(private readonly filePath: string, private readonly runDelete: Runner) {
    this.current = this.load();
    if (this.current?.status === "running") {
      const pending = this.current.total - this.current.processed;
      this.current = {
        ...this.current, status: "interrupted",
        uncertainCount: this.current.uncertainCount + Math.max(0, pending),
        message: "应用在后台删除期间关闭；剩余文件状态未经确认。请核对网盘，绝不能自动重试。",
        updatedAt: new Date().toISOString()
      };
      this.persist();
    }
  }

  get(): ReviewedDeleteBackgroundJob | null {
    return this.current ? {
      ...this.current, failures: this.current.failures.map((f) => ({ ...f }))
    } : null;
  }

  submit(plan: DuplicateResolvePlan): ReviewedDeleteBackgroundJob {
    if (this.active || this.current?.status === "running") {
      throw new Error("已有重复文件后台清理任务正在运行，请等待完成后再提交。");
    }
    const total = plan.groups.reduce((sum, group) => sum + group.deleteVideoIds.length, 0);
    if (total < 1 || total > MAX_TOTAL) {
      throw new Error("一次后台清理仅支持 1–500 个文件。");
    }
    const keepIds = new Set(plan.groups.map((g) => g.keepVideoId));
    const targetIds = plan.groups.flatMap((g) => g.deleteVideoIds);
    if (new Set(targetIds).size !== total || targetIds.some((id) => keepIds.has(id))) {
      throw new Error("清理计划存在重复目标或包含计划保留文件。");
    }
    const now = new Date().toISOString();
    this.current = {
      id: randomUUID(), status: "running", total, processed: 0,
      queuedVideoIds: [...targetIds],
      successCount: 0, failureCount: 0, uncertainCount: 0, unsubmittedCount: total,
      reclaimedBytes: 0, recycledCount: 0, failures: [],
      message: "后台清理已接受，正在核对首批文件。", createdAt: now, updatedAt: now
    };
    this.active = true;
    this.persist();
    // Return the acknowledgment immediately. The IPC caller NEVER awaits deletion.
    setImmediate(() => void this.run(plan));
    return this.get()!;
  }

  private async run(plan: DuplicateResolvePlan): Promise<void> {
    if (!this.current) return;
    try {
      const work = plan.groups.flatMap((group) => group.deleteVideoIds.map((id) => ({
        groupKey: group.groupKey, keepVideoId: group.keepVideoId, id
      })));
      for (let start = 0; start < work.length; start += CHUNK_SIZE) {
        const chunk = work.slice(start, start + CHUNK_SIZE);
        const grouped = new Map<string, { groupKey: string; keepVideoId: string; deleteVideoIds: string[] }>();
        for (const item of chunk) {
          const entry = grouped.get(item.groupKey);
          if (entry) entry.deleteVideoIds.push(item.id);
          else grouped.set(item.groupKey, {
            groupKey: item.groupKey, keepVideoId: item.keepVideoId, deleteVideoIds: [item.id]
          });
        }
        this.current.unsubmittedCount = work.length - start - chunk.length;
        this.current.message = `正在后台核对第 ${Math.floor(start / CHUNK_SIZE) + 1} 批（${chunk.length} 项）；可继续使用其他页面。`;
        this.touch(); // checkpoint BEFORE submitting irreversible RPCs
        let result: DuplicateResolveResult;
        try {
          result = await this.runDelete({ groups: [...grouped.values()] });
        } catch (cause) {
          // A thrown IPC/service error does not prove a remote operation failed.
          this.current.status = "blocked";
          this.current.uncertainCount += chunk.length;
          this.current.unsubmittedCount = work.length - start - chunk.length;
          this.current.message = `本批次处理结果未知：${message(cause)}。已停止后续提交，请核对网盘。`;
          this.touch();
          return;
        }
        this.current.successCount += result.successCount;
        this.current.failureCount += result.failureCount;
        this.current.uncertainCount += result.uncertainCount ?? 0;
        this.current.processed += result.successCount + result.failureCount;
        this.current.reclaimedBytes += result.reclaimedBytes;
        this.current.recycledCount += result.recycledCount ?? 0;
        this.current.failures.push(...result.failures);
        const unknown = result.uncertainCount ?? 0;
        if (unknown || result.uncertainMessage) {
          this.current.status = "blocked";
          this.current.unsubmittedCount = work.length - start - chunk.length + (result.unsubmittedCount ?? 0);
          this.current.message = result.uncertainMessage || "远端删除结果未知，请核查网盘，禁止自动重试。";
          this.touch();
          return;
        }
        if (result.successCount + result.failureCount !== chunk.length) {
          this.current.status = "blocked";
          this.current.uncertainCount += chunk.length - result.successCount - result.failureCount;
          this.current.unsubmittedCount = work.length - start - chunk.length;
          this.current.message = "后台接口返回的处理数量不完整；已停止，未确认项目不可直接重试。";
          this.touch();
          return;
        }
        this.current.unsubmittedCount = work.length - start - chunk.length;
        this.current.message = `后台清理中：${this.current.processed} / ${work.length} 个文件已有确认结果。`;
        this.touch();
        // Yield to other Electron messages / UI actions between chunks.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.current.status = this.current.failureCount ? "partial" : "completed";
      this.current.unsubmittedCount = 0;
      this.current.message = this.current.failureCount
        ? "后台任务已结束，部分文件明确失败；请检查失败原因。"
        : "后台任务已完成。";
      this.touch();
    } catch (cause) {
      // Do not claim all remaining work was skipped; it might have been sent.
      this.current.status = "interrupted";
      this.current.uncertainCount += Math.max(0, this.current.total - this.current.processed);
      this.current.unsubmittedCount = 0;
      this.current.message = `任务发生异常：${message(cause)}，未确认项目禁止自动重试。`;
      this.touch();
    } finally {
      this.active = false;
    }
  }

  private touch(): void {
    if (!this.current) return;
    this.current.updatedAt = new Date().toISOString();
    this.persist();
  }

  private load(): ReviewedDeleteBackgroundJob | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ReviewedDeleteBackgroundJob;
      if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.failures) ||
          !Number.isFinite(parsed.total) || !Number.isFinite(parsed.processed)) {
        throw new Error("invalid checkpoint");
      }
      return parsed;
    } catch {
      // Corrupt checkpoint is NOT evidence that an unfinished delete was safe.
      return {
        id: "checkpoint-unreadable", status: "interrupted", total: 0, processed: 0,
        successCount: 0, failureCount: 0, uncertainCount: 0, unsubmittedCount: 0,
        reclaimedBytes: 0, recycledCount: 0, failures: [],
        message: "旧的后台清理记录无法读取，请先核对网盘删除结果。",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
    }
  }

  private persist(): void {
    if (!this.current) return;
    const pendingFile = `${this.filePath}.tmp`;
    writeFileSync(pendingFile, JSON.stringify(this.current), "utf8");
    renameSync(pendingFile, this.filePath);
  }
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
