import { Worker } from "node:worker_threads";
import type { LibraryPage, LibraryPageQuery } from "../../shared/videoTypes.js";
import { CoalescingReadQueue } from "../queries/coalescingReadQueue.js";

interface LibraryPageWorkerResponse { id: number; result?: LibraryPage; error?: string }
interface LibraryPageWorkerRequest { id: number; query: LibraryPageQuery }
export interface LibraryPageQueryWorker {
  postMessage(request: LibraryPageWorkerRequest): void;
  on(event: "message", listener: (response: LibraryPageWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export class LibraryPageQueryService {
  private worker: LibraryPageQueryWorker | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve(page: LibraryPage): void; reject(error: Error): void }>();
  private disposed = false;
  private readonly reads = new CoalescingReadQueue<LibraryPage>();

  constructor(
    private readonly databasePath: string,
    private readonly workerFactory?: (databasePath: string) => LibraryPageQueryWorker
  ) {}

  page(query: LibraryPageQuery): Promise<LibraryPage> {
    if (this.disposed) return Promise.reject(new Error("Library page service has stopped"));
    const snapshot = structuredClone(query);
    return this.reads.run(JSON.stringify(snapshot), () => this.dispatch(snapshot));
  }

  private dispatch(query: LibraryPageQuery): Promise<LibraryPage> {
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
    const error = new Error("Library page service has stopped");
    this.reads.rejectAll(error);
    this.failPending(error);
    if (this.worker) void this.worker.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): LibraryPageQueryWorker {
    if (this.worker) return this.worker;
    const worker = this.workerFactory?.(this.databasePath) ?? new Worker(new URL("./libraryPageWorker.js", import.meta.url), {
      workerData: { databasePath: this.databasePath }
    });
    worker.on("message", (response) => {
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

  private failWorker(worker: LibraryPageQueryWorker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.reads.rejectAll(error);
    this.failPending(error);
    void worker.terminate();
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
