import { Worker } from "node:worker_threads";
import type {
  DuplicateGroupPage,
  DuplicateGroupPageQuery,
  DirectoryBrowserQuery,
  DirectoryBrowserResult,
  LibraryNavigationSnapshot,
  MetadataIssuePage,
  MetadataIssuePageQuery,
  ScanFailureReviewPage,
  ScanFailureReviewQuery,
  SourceFolder
} from "../../shared/videoTypes.js";
import type {
  AssetCenterSourcePage,
  AssetCenterSourceQuery,
  AssetCenterSummary
} from "../../shared/videoTypes.js";
import type { AssetCenterWorkerRequest, AssetCenterWorkerResponse } from "./assetCenterWorkerProtocol.js";
import { CoalescingReadQueue } from "../queries/coalescingReadQueue.js";

export interface AssetCenterQueryWorker {
  postMessage(value: AssetCenterWorkerRequest): void;
  on(event: "message", listener: (response: AssetCenterWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export interface AssetCenterReadService {
  listDirectories(query: DirectoryBrowserQuery, scope?: string): Promise<DirectoryBrowserResult>;
  listDuplicates(query: DuplicateGroupPageQuery, scope?: string): Promise<DuplicateGroupPage>;
  listFolders(): Promise<SourceFolder[]>;
  listMetadataIssues(query: MetadataIssuePageQuery, scope?: string): Promise<MetadataIssuePage>;
  listScanFailures(query: ScanFailureReviewQuery, scope?: string): Promise<ScanFailureReviewPage>;
  getLibraryNavigation(): Promise<LibraryNavigationSnapshot>;
  getSummary(): Promise<AssetCenterSummary>;
  listSources(query: AssetCenterSourceQuery, scope?: string): Promise<AssetCenterSourcePage>;
}

interface AssetCenterQueryServiceOptions {
  workerFactory?: (databasePath: string) => AssetCenterQueryWorker;
}

interface PendingRequest {
  resolve(value: AssetCenterQueryResult): void;
  reject(error: Error): void;
}

type AssetCenterQueryResult =
  | DirectoryBrowserResult
  | AssetCenterSummary
  | AssetCenterSourcePage
  | DuplicateGroupPage
  | LibraryNavigationSnapshot
  | MetadataIssuePage
  | ScanFailureReviewPage
  | SourceFolder[]
  | string[];

type AssetCenterWorkerOperation =
  | { operation: "directories"; query: DirectoryBrowserQuery }
  | { operation: "duplicates"; query: DuplicateGroupPageQuery }
  | { operation: "folders" }
  | { operation: "retainedCachePaths" }
  | { operation: "metadataIssues"; query: MetadataIssuePageQuery }
  | { operation: "scanFailures"; query: ScanFailureReviewQuery }
  | { operation: "navigation" }
  | { operation: "summary" }
  | { operation: "sources"; query: AssetCenterSourceQuery };

export class AssetCenterQueryService implements AssetCenterReadService {
  private worker: AssetCenterQueryWorker | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly reads = new CoalescingReadQueue<AssetCenterQueryResult>();
  private disposed = false;

  constructor(
    private readonly databasePath: string,
    private readonly options: AssetCenterQueryServiceOptions = {}
  ) {}

  getSummary(): Promise<AssetCenterSummary> {
    return this.request<AssetCenterSummary>({ operation: "summary" });
  }

  listDirectories(query: DirectoryBrowserQuery, scope?: string): Promise<DirectoryBrowserResult> {
    return this.request<DirectoryBrowserResult>({ operation: "directories", query }, scope);
  }

  listDuplicates(query: DuplicateGroupPageQuery, scope?: string): Promise<DuplicateGroupPage> {
    return this.request<DuplicateGroupPage>({ operation: "duplicates", query }, scope);
  }

  listFolders(): Promise<SourceFolder[]> {
    return this.request<SourceFolder[]>({ operation: "folders" });
  }

  listRetainedCachePaths(): Promise<string[]> {
    return this.request<string[]>({ operation: "retainedCachePaths" });
  }

  listMetadataIssues(query: MetadataIssuePageQuery, scope?: string): Promise<MetadataIssuePage> {
    return this.request<MetadataIssuePage>({ operation: "metadataIssues", query }, scope);
  }

  listScanFailures(query: ScanFailureReviewQuery, scope?: string): Promise<ScanFailureReviewPage> {
    return this.request<ScanFailureReviewPage>({ operation: "scanFailures", query }, scope);
  }

  getLibraryNavigation(): Promise<LibraryNavigationSnapshot> {
    return this.request<LibraryNavigationSnapshot>({ operation: "navigation" });
  }

  listSources(query: AssetCenterSourceQuery, scope?: string): Promise<AssetCenterSourcePage> {
    return this.request<AssetCenterSourcePage>({ operation: "sources", query }, scope);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.worker = undefined;
    const error = new Error("Asset Center query service has stopped");
    this.reads.rejectAll(error);
    this.rejectPending(error);
    if (worker) void worker.terminate();
  }

  private request<Result extends AssetCenterQueryResult>(
    request: AssetCenterWorkerOperation,
    scope?: string
  ): Promise<Result> {
    if (this.disposed) {
      return Promise.reject(new Error("Asset Center query service has stopped"));
    }
    const snapshot = structuredClone(request);
    const key = JSON.stringify(snapshot);
    return (scope
      ? this.reads.runLatest(scope, key, () => this.dispatch(snapshot))
      : this.reads.run(key, () => this.dispatch(snapshot))) as Promise<Result>;
  }

  private dispatch(request: AssetCenterWorkerOperation): Promise<AssetCenterQueryResult> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<AssetCenterQueryResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject
      });
      try {
        worker.postMessage({ ...request, id } as AssetCenterWorkerRequest);
      } catch (error: unknown) {
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  private ensureWorker(): AssetCenterQueryWorker {
    if (this.worker) return this.worker;
    const worker = this.options.workerFactory?.(this.databasePath) ?? new Worker(
      new URL("./assetCenterWorker.js", import.meta.url),
      { workerData: { databasePath: this.databasePath } }
    );
    worker.on("message", (response) => this.handleMessage(worker, response));
    worker.on("error", (error) => this.handleWorkerFailure(worker, error));
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.handleWorkerFailure(worker, new Error(`Asset Center query worker exited with code ${code}`));
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(worker: AssetCenterQueryWorker, response: AssetCenterWorkerResponse): void {
    if (this.worker !== worker || !isWorkerResponse(response)) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }
    const error = new Error(response.error.message);
    error.name = response.error.name;
    if (response.error.stack) error.stack = response.error.stack;
    pending.reject(error);
  }

  private handleWorkerFailure(worker: AssetCenterQueryWorker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.reads.rejectAll(error);
    this.rejectPending(error);
    void worker.terminate();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

function isWorkerResponse(value: unknown): value is AssetCenterWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AssetCenterWorkerResponse>;
  return Number.isInteger(candidate.id) && typeof candidate.ok === "boolean";
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
