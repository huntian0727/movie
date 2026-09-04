// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetCenterQueryService,
  type AssetCenterQueryWorker
} from "../../src/main/assetCenter/assetCenterQueryService.js";
import { openAssetCenterReadonlyDatabase } from "../../src/main/assetCenter/assetCenterReadonlyDatabase.js";
import type { AssetCenterWorkerRequest, AssetCenterWorkerResponse } from "../../src/main/assetCenter/assetCenterWorkerProtocol.js";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import type { AssetCenterSummary } from "../../src/shared/videoTypes.js";

let tempDirectory: string | undefined;
let database: DatabaseConnection | undefined;
let service: AssetCenterQueryService | undefined;

afterEach(() => {
  service?.dispose();
  service = undefined;
  database?.close();
  database = undefined;
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("AssetCenterQueryService", () => {
  it("returns immediately with a pending promise and resolves only from the worker response", async () => {
    const worker = new FakeQueryWorker();
    service = new AssetCenterQueryService("C:\\library.sqlite", { workerFactory: () => worker });

    let settled = false;
    const result = service.getSummary().finally(() => { settled = true; });
    expect(worker.messages).toEqual([{ id: 1, operation: "summary" }]);
    await Promise.resolve();
    expect(settled).toBe(false);

    worker.emitMessage({ id: 1, ok: true, result: SUMMARY });
    await expect(result).resolves.toEqual(SUMMARY);
  });

  it("rejects pending work on worker failure and lazily replaces the worker", async () => {
    const firstWorker = new FakeQueryWorker();
    const secondWorker = new FakeQueryWorker();
    const workers = [firstWorker, secondWorker];
    service = new AssetCenterQueryService("C:\\library.sqlite", { workerFactory: () => workers.shift()! });

    const first = service.getSummary();
    firstWorker.emitError(new Error("worker failed"));
    await expect(first).rejects.toThrow("worker failed");

    const replacement = service.getSummary();
    expect(workers).toHaveLength(0);
    // The replacement starts request IDs after the failed request, preventing stale responses from matching.
    expect(secondWorker.messages[0]).toEqual({ id: 2, operation: "summary" });
    secondWorker.emitMessage({ id: 2, ok: true, result: SUMMARY });
    await expect(replacement).resolves.toEqual(SUMMARY);
  });

  it("rejects pending work and terminates the worker when disposed", async () => {
    const worker = new FakeQueryWorker();
    service = new AssetCenterQueryService("C:\\library.sqlite", { workerFactory: () => worker });
    const pending = service.getSummary();

    service.dispose();
    await expect(pending).rejects.toThrow("has stopped");
    expect(worker.terminateCount).toBe(1);
    await expect(service.getSummary()).rejects.toThrow("has stopped");
  });
});

describe("Asset Center worker database connection", () => {
  it("opens an independent query-only connection that cannot modify the primary database", () => {
    tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-asset-worker-"));
    const databasePath = path.join(tempDirectory, "library.sqlite");
    database = createDatabase(databasePath);
    const readonly = openAssetCenterReadonlyDatabase(databasePath);
    try {
      expect(readonly.pragma("query_only", { simple: true })).toBe(1);
      expect(() => readonly.prepare("DELETE FROM source_folders").run()).toThrow();
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_folders").get()).toEqual({ count: 0 });
    } finally {
      readonly.close();
    }
  });
});

class FakeQueryWorker implements AssetCenterQueryWorker {
  static instances: FakeQueryWorker[] = [];
  readonly messages: AssetCenterWorkerRequest[] = [];
  terminateCount = 0;
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  constructor() {
    FakeQueryWorker.instances.push(this);
  }

  postMessage(value: AssetCenterWorkerRequest): void {
    this.messages.push(value);
  }

  on(event: "message", listener: (response: AssetCenterWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  async terminate(): Promise<number> {
    this.terminateCount += 1;
    return 0;
  }

  emitMessage(response: AssetCenterWorkerResponse): void {
    this.emit("message", response);
  }

  emitError(error: Error): void {
    this.emit("error", error);
  }

  private emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

const SUMMARY: AssetCenterSummary = {
  generatedAt: "2026-09-04T00:00:00.000Z",
  totalVideoCount: 0,
  totalSizeBytes: 0,
  sourceCount: 0,
  enabledSourceCount: 0,
  reachableSourceCount: 0,
  offlineSourceCount: 0,
  checkFailedSourceCount: 0,
  unknownSourceCount: 0,
  latestScannedAt: null,
  latestCompletedScan: null,
  scanFailureCount: 0,
  missingVideoCount: 0,
  metadataIssueCount: 0,
  playbackRiskCount: 0,
  duplicateCandidateGroupCount: 0
};
