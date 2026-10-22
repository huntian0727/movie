import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type {
  DuplicateResolvePlan, DuplicateResolveResult, ReviewedDeleteBackgroundJob
} from "../../shared/videoTypes.js";

const CHUNK_SIZE = 30;
const MAX_TOTAL = 500;
const MAX_PENDING_JOBS = 20;

type Runner = (plan: DuplicateResolvePlan) => Promise<DuplicateResolveResult>;

/**
 * The confirmation is collected by the renderer BEFORE calling submit().
 * Multiple durable jobs are accepted; a single worker executes them in FIFO order, independent of
 * renderer pages. State is atomically checkpointed after every chunk.
 * Never replay an interrupted or uncertain destructive request on startup.
 */
export class ReviewedDuplicateBackgroundQueue {
  private current: ReviewedDeleteBackgroundJob | null = null;
  private currentPlan: DuplicateResolvePlan | null = null;
  private active = false;
  private waiting: Array<{ job: ReviewedDeleteBackgroundJob; plan: DuplicateResolvePlan }> = [];
  private history: ReviewedDeleteBackgroundJob[] = [];

  constructor(private readonly filePath: string, private readonly runDelete: Runner) {
    this.load();
    const needsCrashRecovery = this.current?.status === "running" || this.waiting.length > 0;
    if (this.current?.status === "running") {
      const pending = this.current.total - this.current.processed;
      this.current = { ...this.current, status: "interrupted",
        uncertainCount: this.current.uncertainCount + Math.max(0, pending),
        message: "应用在后台删除期间关闭；剩余文件状态未经确认。请核对网盘，绝不能自动重试。",
        updatedAt: new Date().toISOString() };
    }
    // These jobs were acknowledged but NOT DISPATCHED. After a restart,
    // require fresh human confirmation rather than replaying saved plans.
    for (const entry of this.waiting) {
      entry.job.status = "interrupted";
      entry.job.message = "程序重启前排队的任务未发起删除，已暂停；请重新核对并确认。";
      entry.job.updatedAt = new Date().toISOString();
      this.history.push(entry.job);
    }
    if (this.waiting.length) this.waiting = [];
    this.currentPlan = null;
    if (needsCrashRecovery) this.persist();
  }

  get(): ReviewedDeleteBackgroundJob | null {
    if (!this.current) return null;
    const pending = this.current.status === "running" ? [this.current, ...this.waiting.map((entry) => entry.job)]
      : this.waiting.map((entry) => entry.job);
    return { ...this.current, failures: this.current.failures.map((f) => ({ ...f })),
      waitingJobs: this.waiting.length,
      queuedVideoIds: [...new Set(pending.flatMap((job) => job.queuedVideoIds ?? []))],
      queueJobs: [...this.history.slice(-5), this.current, ...this.waiting.map((entry) => entry.job)].map((job) => ({
        id: job.id, status: job.status, total: job.total, processed: job.processed,
        failureCount: job.failureCount, uncertainCount: job.uncertainCount })) };
  }

  hasPending(): boolean { return this.active || this.current?.status === "running" || this.waiting.length > 0; }

  submit(plan: DuplicateResolvePlan): ReviewedDeleteBackgroundJob {
    const total = plan.groups.reduce((sum, group) => sum + group.deleteVideoIds.length, 0);
    if (total < 1 || total > MAX_TOTAL) throw new Error("一次后台清理仅支持 1–500 个文件。");
    const keepIds = new Set(plan.groups.map((g) => g.keepVideoId));
    const targetIds = plan.groups.flatMap((g) => g.deleteVideoIds);
    if (new Set(targetIds).size !== total || targetIds.some((id) => keepIds.has(id))) {
      throw new Error("清理计划存在重复目标或包含计划保留文件。");
    }
    if (this.waiting.length >= MAX_PENDING_JOBS) throw new Error("待执行队列已达到 20 个任务上限，请稍后提交。");
    const reservedPlans = [this.current?.status === "running" ? this.current.queuedVideoIds ?? [] : [],
      ...this.waiting.map((entry) => entry.job.queuedVideoIds ?? [])];
    if (targetIds.some((id) => reservedPlans.some((existing) => existing.includes(id)))) {
      throw new Error("清理计划中包含正在删除或已排队的文件，已阻止重复提交。");
    }
    // Keepers in pending work are reserved against new tasks as well.
    const pendingPlans = [this.current?.status === "running" ? this.currentPlan : null, ...this.waiting.map((entry) => entry.plan)];
    for (const pending of pendingPlans) {
      if (pending?.groups.some((group) => targetIds.includes(group.keepVideoId) ||
          group.deleteVideoIds.some((id) => keepIds.has(id)))) {
        throw new Error("新任务与正在执行或待执行任务的保留文件发生冲突。");
      }
    }
    for (const waiting of this.waiting) {
      if (waiting.plan.groups.some((group) => targetIds.includes(group.keepVideoId) ||
          group.deleteVideoIds.some((id) => keepIds.has(id)))) {
        throw new Error("新任务与待执行任务的保留文件发生冲突，已阻止提交。");
      }
    }
    const now = new Date().toISOString();
    const queued = this.hasPending();
    const job: ReviewedDeleteBackgroundJob = {
      id: randomUUID(), status: queued ? "queued" : "running", total, processed: 0,
      queuedVideoIds: [...targetIds], successCount: 0, failureCount: 0, uncertainCount: 0,
      unsubmittedCount: total, reclaimedBytes: 0, recycledCount: 0, failures: [],
      message: queued ? "已加入后台等待队列，前一个清理任务结束后自动开始。" : "后台清理已接受，正在核对首批文件。",
      createdAt: now, updatedAt: now
    };
    const savedPlan: DuplicateResolvePlan = { groups: plan.groups.map((group) => ({
      groupKey: group.groupKey, keepVideoId: group.keepVideoId, deleteVideoIds: [...group.deleteVideoIds]
    })) };
    if (queued) {
      this.waiting.push({ job, plan: savedPlan });
      try { this.persist(); } catch (error) { this.waiting.pop(); throw error; }
    } else {
      const prior = this.current;
      if (prior) this.history.push(prior);
      this.current = job;
      this.currentPlan = savedPlan;
      try { this.persist(); } catch (error) { this.current = prior; this.currentPlan = null; if (prior) this.history.pop(); throw error; }
      this.active = true;
      setImmediate(() => void this.run(savedPlan));
    }
    return { ...job, queuedVideoIds: [...targetIds], failures: [] };
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
      const ended = this.current;
      this.currentPlan = null;
      if (ended?.status === "blocked" || ended?.status === "interrupted") {
        // Ambiguous remote results: NEVER dispatch later queued tasks blindly.
        for (const waiting of this.waiting) {
          waiting.job.status = "interrupted";
          waiting.job.message = "前一个任务结果未知；该任务尚未开始，需再次核对确认。";
          this.history.push(waiting.job);
        }
        this.waiting = [];
        this.persist();
      } else if (this.waiting.length) {
        const next = this.waiting.shift()!;
        if (ended) this.history.push(ended);
        this.current = next.job;
        this.currentPlan = next.plan;
        this.current.status = "running";
        this.current.message = "排队结束，后台开始清理当前任务。";
        this.touch();
        this.active = true;
        setImmediate(() => void this.run(next.plan));
      }
    }
  }

  private touch(): void {
    if (!this.current) return;
    this.current.updatedAt = new Date().toISOString();
    this.persist();
  }

  private load(): void {
    this.current = null;
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ReviewedDeleteBackgroundJob | {
        version: 2; current: ReviewedDeleteBackgroundJob | null; currentPlan?: DuplicateResolvePlan | null;
        waiting: Array<{ job: ReviewedDeleteBackgroundJob; plan: DuplicateResolvePlan }>;
        history: ReviewedDeleteBackgroundJob[];
      };
      const legacy = !('version' in parsed);
      const job = legacy ? parsed as ReviewedDeleteBackgroundJob : parsed.current;
      if (job && (typeof job.id !== "string" || !Array.isArray(job.failures) ||
          !Number.isFinite(job.total) || !Number.isFinite(job.processed))) throw Error("invalid checkpoint");
      this.current = job;
      if (!legacy) {
        this.currentPlan = parsed.currentPlan && Array.isArray(parsed.currentPlan.groups) ? parsed.currentPlan : null;
        if (!Array.isArray(parsed.waiting) || !Array.isArray(parsed.history) ||
          !parsed.waiting.every((entry) => entry?.job?.status === "queued" &&
            Array.isArray(entry.job.queuedVideoIds) && Array.isArray(entry.plan?.groups))) {
          throw Error("invalid queued checkpoint");
        }
        this.waiting = parsed.waiting;
        this.history = parsed.history.slice(-25);
      }
    } catch {
      this.current = {
        id: "checkpoint-unreadable", status: "interrupted", total: 0, processed: 0,
        successCount: 0, failureCount: 0, uncertainCount: 0, unsubmittedCount: 0,
        reclaimedBytes: 0, recycledCount: 0, failures: [],
        message: "旧的后台清理记录无法读取，请先核对网盘删除结果。",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
    }
  }

  private persist(): void {
    const pendingFile = `${this.filePath}.tmp`;
    writeFileSync(pendingFile, JSON.stringify({ version: 2, current: this.current, currentPlan: this.currentPlan,
      waiting: this.waiting, history: this.history.slice(-25) }), "utf8");
    renameSync(pendingFile, this.filePath);
  }

}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
