// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  PlaybackDiagnosticQueryService,
  PlaybackDiagnosticSearchSupersededError,
  type PlaybackDiagnosticQueryWorker
} from "../../src/main/playbackDiagnostic/playbackDiagnosticQueryService.js";
import type { PlaybackDiagnosticWorkerRequest, PlaybackDiagnosticWorkerResponse } from "../../src/main/playbackDiagnostic/playbackDiagnosticWorkerProtocol.js";
import type { LibraryPage, PlaybackDiagnosticSearchQuery } from "../../src/shared/videoTypes.js";

let service: PlaybackDiagnosticQueryService | undefined;

afterEach(async () => {
  await service?.dispose();
  service = undefined;
});

describe("PlaybackDiagnosticQueryService", () => {
  it("keeps only one running search and the newest queued search", async () => {
    const worker = new FakeWorker();
    service = new PlaybackDiagnosticQueryService("C:\\library.sqlite", { workerFactory: () => worker });
    const first = service.search(query("first"));
    const second = service.search(query("second"));
    const third = service.search(query("third"));

    await expect(second).rejects.toBeInstanceOf(PlaybackDiagnosticSearchSupersededError);
    expect(worker.messages.map((message) => message.query.search)).toEqual(["first"]);

    worker.emitMessage({ id: 1, ok: true, result: page("first") });
    await expect(first).resolves.toEqual(page("first"));
    expect(worker.messages.map((message) => message.query.search)).toEqual(["first", "third"]);

    worker.emitMessage({ id: 3, ok: true, result: page("third") });
    await expect(third).resolves.toEqual(page("third"));
  });

  it("rejects running and queued work on worker error, then lazily replaces the worker", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    service = new PlaybackDiagnosticQueryService("C:\\library.sqlite", { workerFactory: () => workers.shift()! });
    const running = service.search(query("running"));
    const queued = service.search(query("queued"));

    firstWorker.emitError(new Error("worker failed"));
    await expect(running).rejects.toThrow("worker failed");
    await expect(queued).rejects.toThrow("worker failed");

    const replacement = service.search(query("replacement"));
    expect(secondWorker.messages[0]?.id).toBe(3);
    secondWorker.emitMessage({ id: 3, ok: true, result: page("replacement") });
    await expect(replacement).resolves.toEqual(page("replacement"));
  });

  it("rejects all work and terminates the worker when disposed", async () => {
    const worker = new FakeWorker();
    service = new PlaybackDiagnosticQueryService("C:\\library.sqlite", { workerFactory: () => worker });
    const running = service.search(query("running"));
    const queued = service.search(query("queued"));

    await service.dispose();

    await expect(running).rejects.toThrow("has stopped");
    await expect(queued).rejects.toThrow("has stopped");
    expect(worker.terminateCount).toBe(1);
    await expect(service.search(query("after"))).rejects.toThrow("has stopped");
  });

  it("forwards a serialized worker query error and continues with the latest request", async () => {
    const worker = new FakeWorker();
    service = new PlaybackDiagnosticQueryService("C:\\library.sqlite", { workerFactory: () => worker });
    const first = service.search(query("bad"));
    const second = service.search(query("good"));

    worker.emitMessage({ id: 1, ok: false, error: { name: "SqliteError", message: "query failed" } });
    await expect(first).rejects.toMatchObject({ name: "SqliteError", message: "query failed" });
    expect(worker.messages[1]?.query.search).toBe("good");
    worker.emitMessage({ id: 2, ok: true, result: page("good") });
    await expect(second).resolves.toEqual(page("good"));
  });

  it("retires a worker that fails to accept a request", async () => {
    const brokenWorker = new FakeWorker();
    brokenWorker.postError = new Error("post failed");
    const replacementWorker = new FakeWorker();
    const workers = [brokenWorker, replacementWorker];
    service = new PlaybackDiagnosticQueryService("C:\\library.sqlite", { workerFactory: () => workers.shift()! });

    await expect(service.search(query("first"))).rejects.toThrow("post failed");
    expect(brokenWorker.terminateCount).toBe(1);

    const replacement = service.search(query("replacement"));
    replacementWorker.emitMessage({ id: 2, ok: true, result: page("replacement") });
    await expect(replacement).resolves.toEqual(page("replacement"));
  });
});

class FakeWorker implements PlaybackDiagnosticQueryWorker {
  readonly messages: PlaybackDiagnosticWorkerRequest[] = [];
  terminateCount = 0;
  postError: Error | undefined;
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  postMessage(value: PlaybackDiagnosticWorkerRequest): void {
    if (this.postError) throw this.postError;
    this.messages.push(value);
  }
  on(event: "message", listener: (response: PlaybackDiagnosticWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  async terminate(): Promise<number> { this.terminateCount += 1; return 0; }
  emitMessage(response: PlaybackDiagnosticWorkerResponse): void { this.emit("message", response); }
  emitError(error: Error): void { this.emit("error", error); }
  private emit(event: string, value: unknown): void { for (const listener of this.listeners.get(event) ?? []) listener(value); }
}

function query(search: string): PlaybackDiagnosticSearchQuery {
  return { search, page: 1, pageSize: 30 };
}

function page(search: string): LibraryPage {
  return { videos: [], page: 1, pageSize: 30, totalPages: 1, totalCount: search.length };
}
