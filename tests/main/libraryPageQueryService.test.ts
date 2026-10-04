// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { LibraryPageQueryService, type LibraryPageQueryWorker } from "../../src/main/libraryPage/libraryPageQueryService";
import type { LibraryPage, LibraryPageQuery } from "../../src/shared/videoTypes";

class FakeWorker extends EventEmitter implements LibraryPageQueryWorker {
  messages: Array<{ id: number; query: LibraryPageQuery }> = [];
  stopped = false;
  postMessage(request: { id: number; query: LibraryPageQuery }) { this.messages.push(request); }
  async terminate() { this.stopped = true; return 0; }
}
const QUERY: LibraryPageQuery = { view: "all", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 100 };
const PAGE: LibraryPage = { videos: [], page: 1, pageSize: 100, totalPages: 1, totalCount: 0 };

describe("library page read queue", () => {
  it("coalesces identical waiting requests without dropping another page or filter", async () => {
    const worker = new FakeWorker();
    const service = new LibraryPageQueryService("test.sqlite", () => worker);
    try {
      const active = service.page(QUERY);
      const pending = service.page({ ...QUERY, page: 2 });
      const same = service.page({ ...QUERY, page: 2 });
      const search = service.page({ ...QUERY, search: "different" });
      expect(worker.messages).toHaveLength(1);
      worker.emit("message", { id: 1, result: PAGE });
      await active;
      expect(worker.messages[1]).toMatchObject({ id: 2, query: { page: 2 } });
      worker.emit("message", { id: 2, result: { ...PAGE, page: 2 } });
      await expect(Promise.all([pending, same])).resolves.toEqual([{ ...PAGE, page: 2 }, { ...PAGE, page: 2 }]);
      expect(worker.messages[2]).toMatchObject({ id: 3, query: { search: "different" } });
      worker.emit("message", { id: 3, result: PAGE });
      await search;
      expect(worker.messages).toHaveLength(3);
    } finally { service.dispose(); }
  });

  it("rejects all reads on worker failure and ignores its late response after replacement", async () => {
    const first = new FakeWorker(); const replacement = new FakeWorker();
    const workers = [first, replacement];
    const service = new LibraryPageQueryService("test.sqlite", () => workers.shift()!);
    try {
      const active = service.page(QUERY);
      const queued = service.page(QUERY);
      first.emit("error", new Error("worker failed"));
      await Promise.all([active, queued].map((result) => expect(result).rejects.toThrow("worker failed")));
      expect(first.stopped).toBe(true);
      const fresh = service.page(QUERY);
      first.emit("message", { id: 2, result: { ...PAGE, totalCount: 99 } });
      replacement.emit("message", { id: 2, result: PAGE });
      await expect(fresh).resolves.toEqual(PAGE);
    } finally { service.dispose(); }
  });

  it("rejects running and waiting reads on disposal and starts no further worker requests", async () => {
    const worker = new FakeWorker();
    const service = new LibraryPageQueryService("test.sqlite", () => worker);
    const active = service.page(QUERY); const queued = service.page(QUERY);
    service.dispose();
    await Promise.all([active, queued].map((result) => expect(result).rejects.toThrow("has stopped")));
    worker.emit("message", { id: 1, result: PAGE });
    await expect(service.page(QUERY)).rejects.toThrow("has stopped");
    expect(worker.messages).toHaveLength(1);
  });
});
