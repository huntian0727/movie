import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import type { VideoDataPage, VideoDataQuery, VideoDataSelection } from "../../shared/videoDataTable.js";

export class VideoDataService {
  private worker: Worker | undefined;
  private running = false;
  private queued: { query: VideoDataQuery; resolve: (page: VideoDataPage) => void; reject: (error: Error) => void } | undefined;
  private exporting = false;
  private disposed = false;
  private workers = new Set<Worker>();
  constructor(private readonly databasePath: string) {}
  private createWorker(): Worker {
    const worker = new Worker(new URL("./videoDataWorker.js", import.meta.url), { workerData: { databasePath: this.databasePath } });
    this.workers.add(worker);
    worker.once("exit", () => { this.workers.delete(worker); if (this.worker === worker) this.worker = undefined; });
    return worker;
  }
  private request<T>(worker: Worker, payload: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { worker.off("message", message); worker.off("error", fail); worker.off("exit", exit); };
      const message = (response: { result: T; error?: string }) => { cleanup(); if (response.error) reject(new Error(response.error)); else resolve(response.result); };
      const fail = (error: Error) => { cleanup(); if (this.worker === worker) this.worker = undefined; void worker.terminate(); reject(error); };
      const exit = () => fail(new Error("数据查询进程已停止，请重试"));
      worker.once("message", message); worker.once("error", fail); worker.once("exit", exit);
      try { worker.postMessage({ id: 1, ...payload }); } catch (error) { fail(error as Error); }
    });
  }
  page(query: VideoDataQuery): Promise<VideoDataPage> {
    if (this.disposed) return Promise.reject(new Error("数据服务已停止"));
    if (this.running) return new Promise((resolve, reject) => { this.queued?.reject(new Error("查询已被更新")); this.queued = { query, resolve, reject }; });
    this.worker ??= this.createWorker();
    this.running = true;
    return this.request<VideoDataPage>(this.worker, { query }).finally(() => {
      this.running = false;
      const next = this.queued; this.queued = undefined;
      if (next) void this.page(next.query).then(next.resolve, next.reject);
    });
  }
  async export(query: VideoDataQuery, selection: VideoDataSelection, outputPath: string): Promise<number> {
    if (this.exporting || this.disposed) throw new Error("已有导出正在进行，请稍后重试");
    const tempPath = `${outputPath}.${randomUUID()}.tmp`;
    const worker = this.createWorker();
    this.exporting = true;
    try {
      const result = await this.request<{ count: number }>(worker, { query, selection, outputPath: tempPath });
      await rename(tempPath, outputPath);
      return result.count;
    } finally { await worker.terminate(); await rm(tempPath, { force: true }); this.exporting = false; }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.queued?.reject(new Error("数据服务已停止")); this.queued = undefined;
    await Promise.all([...this.workers].map(worker => worker.terminate()));
  }
}
