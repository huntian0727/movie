import { Worker } from "node:worker_threads";
import type { LibraryPage, LibraryPageQuery } from "../../shared/videoTypes.js";

export class LibraryPageQueryService {
  private worker: Worker | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve(page: LibraryPage): void; reject(error: Error): void }>();
  private disposed = false;

  constructor(private readonly databasePath: string) {}

  page(query: LibraryPageQuery): Promise<LibraryPage> {
    if (this.disposed) return Promise.reject(new Error("Library page service has stopped"));
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, query });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error("Library page service has stopped"));
    if (this.worker) void this.worker.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./libraryPageWorker.js", import.meta.url), {
      workerData: { databasePath: this.databasePath }
    });
    worker.on("message", (response: { id: number; result?: LibraryPage; error?: string }) => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error));
      else if (response.result) pending.resolve(response.result);
      else pending.reject(new Error("Library page worker returned no result"));
    });
    worker.on("error", (error) => this.failWorker(worker, error));
    worker.on("exit", (code) => {
      if (this.worker === worker) this.failWorker(worker, new Error(`Library page worker exited with code ${code}`));
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
