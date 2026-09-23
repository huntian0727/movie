import { Worker } from "node:worker_threads";
import type { SourceFolderRemovalPreview, SourceFolderRemovalResult } from "../../shared/videoTypes.js";

type RemovalResult = SourceFolderRemovalPreview | SourceFolderRemovalResult;

export class SourceFolderRemovalService {
  private worker: Worker | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: RemovalResult): void; reject(error: Error): void }>();
  private removing = false;
  private disposed = false;

  constructor(private readonly databasePath: string) {}

  preview(folderId: string): Promise<SourceFolderRemovalPreview> {
    return this.request("preview", folderId);
  }

  async remove(folderId: string): Promise<SourceFolderRemovalResult> {
    if (this.removing) throw new Error("Another source folder is being removed");
    this.removing = true;
    try {
      return await this.request("remove", folderId);
    } finally {
      this.removing = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error("Source folder removal service has stopped"));
    if (this.worker) void this.worker.terminate();
    this.worker = undefined;
  }

  private request<Result extends RemovalResult>(operation: "preview" | "remove", folderId: string): Promise<Result> {
    if (this.disposed) return Promise.reject(new Error("Source folder removal service has stopped"));
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (result) => resolve(result as Result), reject });
      try {
        worker.postMessage({ id, operation, folderId });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./sourceFolderRemovalWorker.js", import.meta.url), {
      workerData: { databasePath: this.databasePath }
    });
    worker.on("message", (response: { id: number; result?: RemovalResult; error?: string }) => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error));
      else if (response.result) pending.resolve(response.result);
      else pending.reject(new Error("Source folder removal worker returned no result"));
    });
    worker.on("error", (error) => this.failWorker(worker, error));
    worker.on("exit", (code) => {
      if (this.worker === worker) this.failWorker(worker, new Error(`Source folder removal worker exited with code ${code}`));
    });
    this.worker = worker;
    return worker;
  }

  private failWorker(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.failPending(error);
    void worker.terminate();
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
