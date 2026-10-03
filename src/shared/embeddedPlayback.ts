import { z } from "zod";

export const embeddedRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), videoId: z.string().min(1), sessionKey: z.string().min(1).max(100), positionMs: z.number().int().min(0).max(86_400_000).optional(), autoplay: z.boolean() }).strict(),
  z.object({ op: z.literal("state"), sessionKey: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal("stop"), sessionKey: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal("bounds"), sessionKey: z.string().min(1).max(100), x: z.number().int().min(0).max(16384), y: z.number().int().min(0).max(16384), width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384) }).strict(),
  z.object({ op: z.enum(["seek", "volume", "rotate", "audio-track", "subtitle-track"]), sessionKey: z.string().min(1).max(100), value: z.number().finite().min(0).max(86400) }).strict(),
  z.object({ op: z.enum(["pause", "fullscreen"]), sessionKey: z.string().min(1).max(100), value: z.boolean() }).strict(),
  z.object({ op: z.literal("subtitle-file"), sessionKey: z.string().min(1).max(100) }).strict()
]);
export type EmbeddedRequest = z.infer<typeof embeddedRequestSchema>;
export interface EmbeddedState {
  sessionKey: string;
  phase: "idle" | "loading" | "playing" | "paused" | "reading" | "buffering" | "failed" | "ended";
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  rotation: number;
  fullscreen: boolean;
  tracks: Array<{ type: "audio" | "sub"; id: number; selected: boolean; codec: string }>;
  error?: string;
}
