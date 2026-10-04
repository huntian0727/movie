import { z } from "zod";

/** Coordinates are CSS pixels relative to the player's content area. y is the preview bottom. */
export const playerTimelinePreviewSchema = z.object({
  videoId: z.string().min(1).max(512),
  timeMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  cachedOnly: z.boolean().optional()
}).strict().nullable();
export type PlayerTimelinePreviewRequest = z.infer<typeof playerTimelinePreviewSchema>;
export interface PlayerTimelinePreviewContent {
  url: string;
  timeMs: number;
  imageHeight: number;
  cachedOnly?: boolean;
}
