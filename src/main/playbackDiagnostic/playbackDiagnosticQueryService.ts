import { Worker } from "node:worker_threads";
import type { LibraryPage, PlaybackDiagnosticSearchQuery } from "../../shared/videoTypes.js";
import type { PlaybackDiagnosticWorkerRequest, PlaybackDiagnosticWorkerResponse } from "./playbackDiagnosticWorkerProtocol.js";

export interface PlaybackDiagnosticQueryWorker {
  postMessage(value: PlaybackDiagnosticWorkerRequest): void;
  on(event: "message", listener: (response: PlaybackDiagnosticWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export interface PlaybackDiagnosticReadService {
  search(query: PlaybackDiagnosticSearchQuery): Promise<LibraryPage>;
}

interface PlaybackDiagnosticQueryServiceOptions {
  workerFactory?: (databasePath: string) => PlaybackDiagnosticQueryWorker;
}

interface PendingSearch {
  id: number;
  query: PlaybackDiagnosticSearchQuery;
  resolve(result: LibraryPage): void;
  reject(error: Error): void;
}

export class PlaybackDiagnosticSearchSupersededError extends Error {
  constructor() {
    super("Playback Diagnostic search was superseded by a newer query");
    this.name = "PlaybackDiagnosticSearchSupersededError";
  }
}

export class PlaybackDiagnosticQueryService implements PlaybackDiagnosticReadService {
  private worker: PlaybackDiagnosticQueryWorker | undefined;
  private nextRequestId = 1;
  private inFlight: PendingSearch | undefined;
  private queued: PendingSearch | undefined;
  private disposed = false;

  constructor(
    private readonly databasePath: string,
    private readonly options: PlaybackDiagnosticQueryServiceOptions = {}
  ) {}

  search(query: PlaybackDiagnosticSearchQuery): Promise<LibraryPage> {
    if (this.disposed) return Promise.reject(new Error("Playback Diagnostic query service has stopped"));
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<LibraryPage>((resolve, reject) => {
      const pending = { id, query, resolve, reject };
      if (!this.inFlight) {
        this.dispatch(pending);
        return;
      }
      this.queued?.reject(new PlaybackDiagnosticSearchSupersededError());
      this.queued = pending;
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.worker = undefined;
    const error = new Error("Playback Diagnostic query service has stopped");
    this.inFlight?.reject(error);
    this.queued?.reject(error);
    this.inFlight = undefined;
    this.queued = undefined;
    if (worker) await worker.terminate();
  }

  private dispatch(pending: PendingSearch): void {
    if (this.disposed) {
      pending.reject(new Error("Playback Diagnostic query service has stopped"));
      return;
    }
    const worker = this.ensureWorker();
    this.inFlight = pending;
    try {
      worker.postMessage({ id: pending.id, query: pending.query });
    } catch (error: unknown) {
      this.handleWorkerFailure(worker, toError(error));
    }
  }

  private ensureWorker(): PlaybackDiagnosticQueryWorker {
    if (this.worker) return this.worker;
    const worker = this.options.workerFactory?.(this.databasePath) ?? new Worker(
      new URL("./playbackDiagnosticWorker.js", import.meta.url),
      { workerData: { databasePath: this.databasePath } }
    );
    worker.on("message", (response) => this.handleMessage(worker, response));
    worker.on("error", (error) => this.handleWorkerFailure(worker, error));
    worker.on("exit", (code) => {
      if (this.worker === worker) this.handleWorkerFailure(worker, new Error(`Playback Diagnostic query worker exited with code ${code}`));
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(worker: PlaybackDiagnosticQueryWorker, response: PlaybackDiagnosticWorkerResponse): void {
    if (this.worker !== worker || !isWorkerResponse(response) || response.id !== this.inFlight?.id) return;
    const pending = this.inFlight;
    this.inFlight = undefined;
    if (response.ok) pending.resolve(response.result);
    else pending.reject(deserializeError(response.error));
    this.dispatchQueued();
  }

  private dispatchQueued(): void {
    const queued = this.queued;
    this.queued = undefined;
    if (queued) this.dispatch(queued);
  }

  private handleWorkerFailure(worker: PlaybackDiagnosticQueryWorker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.inFlight?.reject(error);
    this.queued?.reject(error);
    this.inFlight = undefined;
    this.queued = undefined;
    void worker.terminate();
  }
}

function isWorkerResponse(value: unknown): value is PlaybackDiagnosticWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlaybackDiagnosticWorkerResponse>;
  return Number.isInteger(candidate.id) && typeof candidate.ok === "boolean";
}

function deserializeError(serialized: { name: string; message: string; stack?: string }): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack) error.stack = serialized.stack;
  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
