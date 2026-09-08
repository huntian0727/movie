import { z } from "zod";
import type { VideoRecord } from "./videoTypes.js";

export const videoDataQuerySchema = z.object({
  search: z.string().max(2000).default(""),
  sourceFolderId: z.string().max(200).default(""),
  directory: z.string().max(4000).default(""),
  sourceType: z.enum(["all", "local", "nas", "clouddrive"]).default("all"),
  status: z.enum(["all", "normal", "missing", "failed", "pending", "pendingDelete"]).default("all"),
  minSize: z.number().finite().nonnegative().optional(),
  maxSize: z.number().finite().nonnegative().optional(),
  minDuration: z.number().finite().nonnegative().optional(),
  maxDuration: z.number().finite().nonnegative().optional(),
  addedFrom: z.string().datetime().optional(),
  addedTo: z.string().datetime().optional(),
  sort: z.enum(["filename", "sizeBytes", "durationMs", "importedAt", "modifiedAt"]).default("importedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10000000).default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100)
}).strict();
export type VideoDataQuery = z.infer<typeof videoDataQuerySchema>;
export const videoDataSelectionSchema = z.object({
  all: z.boolean(),
  ids: z.array(z.string().max(200)).max(100000),
  excludedIds: z.array(z.string().max(200)).max(100000)
}).strict();
export type VideoDataSelection = z.infer<typeof videoDataSelectionSchema>;
export interface VideoDataRow extends VideoRecord { sourceType: "local" | "nas" | "clouddrive"; sourcePath: string }
export interface VideoDataPage { items: VideoDataRow[]; page: number; pageSize: number; totalPages: number; totalCount: number; totalBytes: number }
export interface VideoDataExportResult { cancelled: boolean; count: number; path?: string }
export function videoDataStatus(video: VideoRecord): string {
  if (video.isMissing) return "文件缺失";
  if (video.isPendingDelete) return "待删除";
  if (video.metadataStatus === "failed") return "元数据异常";
  if (video.metadataStatus === "pending") return "元数据待处理";
  return "正常";
}
