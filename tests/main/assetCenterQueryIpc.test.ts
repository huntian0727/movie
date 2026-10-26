import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/videoTypes";
import type { AssetCenterReadService } from "../../src/main/assetCenter/assetCenterQueryService";
import type { MetadataQueue } from "../../src/main/media/metadataQueue";
import { registerAssetCenterQueryHandlers } from "../../src/main/assetCenter/assetCenterQueryIpc";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function makeHarness() {
  const handlers = new Map<string, Handler>();
  const registry = { handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)) };
  const service = {
    listDirectories: vi.fn().mockResolvedValue({ items: [], totalItems: 0, limit: 50 }),
    getLibraryNavigation: vi.fn().mockResolvedValue({ sources: [], folders: [] }),
    getSummary: vi.fn().mockResolvedValue({ sourceCount: 0, videoCount: 0 }),
    listSources: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 30, totalItems: 0, totalPages: 0 }),
    listMetadataIssues: vi.fn().mockResolvedValue({ items: [{ video: { id: "video-1" } }], page: 1, pageSize: 30, totalItems: 1, totalPages: 1 }),
    listDuplicates: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 0 }),
    listScanFailures: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 30, totalItems: 0, totalPages: 0 })
  };
  const metadataQueue = {
    getStatus: vi.fn(() => ({ queued: 3, active: 1 })),
    getVideoState: vi.fn(() => "queued")
  };
  const readScope = vi.fn((event: IpcMainInvokeEvent, operation: string, purpose: unknown) => `${event.sender.id}:${operation}:${String(purpose)}`);
  registerAssetCenterQueryHandlers(registry, {
    assetCenterQueries: service as unknown as AssetCenterReadService,
    metadataQueue: metadataQueue as unknown as MetadataQueue
  }, readScope);
  const event = { sender: { id: 42 } } as unknown as IpcMainInvokeEvent;
  return { handlers, registry, service, metadataQueue, readScope, event };
}

describe("Asset Center query IPC registrar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers only the seven audited read-query channels", () => {
    const { handlers, registry } = makeHarness();
    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.libraryDirectoryBrowser,
      IPC_CHANNELS.libraryNavigation,
      IPC_CHANNELS.assetCenterSummary,
      IPC_CHANNELS.assetCenterSources,
      IPC_CHANNELS.libraryMetadataIssuePage,
      IPC_CHANNELS.duplicateList,
      IPC_CHANNELS.scanFailureReviewPage
    ]);
    expect(registry.handle).toHaveBeenCalledTimes(7);
  });

  it("parses duplicate-list input and scopes the read by sender and purpose", async () => {
    const { handlers, service, readScope, event } = makeHarness();
    const query = { page: 1, pageSize: 20, sortField: "sizeBytes", sortDirection: "desc" };
    await handlers.get(IPC_CHANNELS.duplicateList)!(event, query, "duplicate-panel");
    expect(readScope).toHaveBeenCalledWith(event, "duplicates", "duplicate-panel");
    expect(service.listDuplicates).toHaveBeenCalledWith({ ...query }, "42:duplicates:duplicate-panel");
  });

  it("rejects unknown duplicate query fields and unsupported page sizes", () => {
    const { handlers, event } = makeHarness();
    expect(() => handlers.get(IPC_CHANNELS.duplicateList)!(event, { page: 1, pageSize: 20, sortDirection: "desc", extra: true }, "panel")).toThrow();
    expect(() => handlers.get(IPC_CHANNELS.duplicateList)!(event, { page: 1, pageSize: 999, sortDirection: "desc" }, "panel")).toThrow();
  });

  it("enriches metadata issue results with current queue state without mutating the query", async () => {
    const { handlers, service, metadataQueue, readScope, event } = makeHarness();
    const query = { status: "all", zeroBytesOnly: false, search: "", page: 1, pageSize: 30 };
    const result = await handlers.get(IPC_CHANNELS.libraryMetadataIssuePage)!(event, query, "metadata-panel") as { items: Array<{ queueState: string }>; queuedCount: number; activeCount: number };
    expect(readScope).toHaveBeenCalledWith(event, "metadata-issues", "metadata-panel");
    expect(service.listMetadataIssues).toHaveBeenCalledWith(query, "42:metadata-issues:metadata-panel");
    expect(metadataQueue.getStatus).toHaveBeenCalledOnce();
    expect(metadataQueue.getVideoState).toHaveBeenCalledWith("video-1");
    expect(result.items[0].queueState).toBe("queued");
    expect(result.queuedCount).toBe(3);
    expect(result.activeCount).toBe(1);
  });

  it("rejects invalid directory/source/failure query parameters before calling services", () => {
    const { handlers, event, service } = makeHarness();
    expect(() => handlers.get(IPC_CHANNELS.libraryDirectoryBrowser)!(event, { search: "", limit: 25 }, "directories")).toThrow();
    expect(() => handlers.get(IPC_CHANNELS.assetCenterSources)!(event, { page: 1, pageSize: 30, search: "", type: "all", availability: "all", sort: "unknown", direction: "asc" }, "sources")).toThrow();
    expect(() => handlers.get(IPC_CHANNELS.scanFailureReviewPage)!(event, { kind: "all", page: 1, pageSize: 20 }, "scan-failures")).toThrow();
    expect(service.listDirectories).not.toHaveBeenCalled();
    expect(service.listSources).not.toHaveBeenCalled();
    expect(service.listScanFailures).not.toHaveBeenCalled();
  });

  it("propagates query-service failures without inventing an empty result", async () => {
    const { handlers, service, event } = makeHarness();
    const failure = new Error("query unavailable");
    service.listDuplicates.mockRejectedValueOnce(failure);
    await expect(handlers.get(IPC_CHANNELS.duplicateList)!(event, { page: 1, pageSize: 10, sortDirection: "asc" }, "panel")).rejects.toBe(failure);
  });
});
