import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { IPC_CHANNELS } from "../../shared/videoTypes.js";
import type { AssetCenterReadService } from "./assetCenterQueryService.js";
import type { MetadataQueue } from "../media/metadataQueue.js";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export interface IpcHandlerRegistry {
  handle(channel: string, listener: IpcHandler): void;
}

export type ReadScope = (event: IpcMainInvokeEvent, operation: string, purpose: unknown) => string;

export interface AssetCenterQueryIpcDependencies {
  assetCenterQueries: Pick<AssetCenterReadService,
    | "listDirectories"
    | "getLibraryNavigation"
    | "getSummary"
    | "listSources"
    | "listMetadataIssues"
    | "listDuplicates"
    | "listScanFailures"
  >;
  metadataQueue: Pick<MetadataQueue, "getStatus" | "getVideoState">;
}

export const directoryBrowserQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  parentPath: z.string().min(1).max(32767).optional(),
  search: z.string().trim().max(500),
  limit: z.union([z.literal(50), z.literal(100), z.literal(200)])
}).strict();

export const assetCenterSourceQuerySchema = z.object({
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)]),
  search: z.string().trim().max(500),
  type: z.enum(["all", "localOrMounted", "nas", "clouddrive"]),
  availability: z.enum(["all", "reachable", "offline", "checkFailed", "unknown", "disabled"]),
  sort: z.enum(["path", "videoCount", "sizeBytes", "lastScannedAt", "issueCount"]),
  direction: z.enum(["asc", "desc"])
}).strict();

export const metadataIssuePageQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  status: z.enum(["all", "automatic", "deferred", "failed"]),
  zeroBytesOnly: z.boolean(),
  search: z.string().trim().max(500),
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)])
}).strict();

export const duplicateGroupPageQuerySchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100), z.literal(200), z.literal(300), z.literal(500)]),
  sortField: z.enum(["reclaimableBytes", "sizeBytes", "duplicateCount", "durationMs"]).default("sizeBytes"),
  sortDirection: z.enum(["asc", "desc"]),
  preferredDirectoryPath: z.string().min(1).optional(),
  preferredDirectoryPaths: z.array(z.string().min(1)).max(100).optional(),
  filterDirectoryPath: z.string().min(1).optional()
}).strict();

export const scanFailureReviewQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  kind: z.enum(["all", "video", "unindexed-file", "directory"]),
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)])
}).strict();

export function registerAssetCenterQueryHandlers(
  registry: IpcHandlerRegistry,
  dependencies: AssetCenterQueryIpcDependencies,
  readScope: ReadScope
): void {
  registry.handle(IPC_CHANNELS.libraryDirectoryBrowser, (event, query, purpose) =>
    dependencies.assetCenterQueries.listDirectories(directoryBrowserQuerySchema.parse(query), readScope(event, "directories", purpose))
  );
  registry.handle(IPC_CHANNELS.libraryNavigation, () => dependencies.assetCenterQueries.getLibraryNavigation());
  registry.handle(IPC_CHANNELS.assetCenterSummary, () => dependencies.assetCenterQueries.getSummary());
  registry.handle(IPC_CHANNELS.assetCenterSources, (event, query, purpose) =>
    dependencies.assetCenterQueries.listSources(assetCenterSourceQuerySchema.parse(query), readScope(event, "sources", purpose))
  );
  registry.handle(IPC_CHANNELS.libraryMetadataIssuePage, async (event, query, purpose) => {
    const page = await dependencies.assetCenterQueries.listMetadataIssues(metadataIssuePageQuerySchema.parse(query), readScope(event, "metadata-issues", purpose));
    const queueStatus = dependencies.metadataQueue.getStatus();
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, queueState: dependencies.metadataQueue.getVideoState(item.video.id) })),
      queuedCount: queueStatus.queued,
      activeCount: queueStatus.active
    };
  });
  registry.handle(IPC_CHANNELS.duplicateList, (event, query, purpose) =>
    dependencies.assetCenterQueries.listDuplicates(duplicateGroupPageQuerySchema.parse(query), readScope(event, "duplicates", purpose))
  );
  registry.handle(IPC_CHANNELS.scanFailureReviewPage, (event, query, purpose) =>
    dependencies.assetCenterQueries.listScanFailures(scanFailureReviewQuerySchema.parse(query), readScope(event, "scan-failures", purpose))
  );
}
