import { z } from "zod";

/** Fixed rates supported by both the browser and the trusted MPV host. */
export const PLAYBACK_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const embeddedRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), videoId: z.string().min(1), sessionKey: z.string().min(1).max(100), positionMs: z.number().int().min(0).max(86_400_000).optional(), autoplay: z.boolean() }).strict(),
  z.object({ op: z.literal("state"), sessionKey: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal("window-state"), sessionKey: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal("stop"), sessionKey: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal("bounds"), sessionKey: z.string().min(1).max(100), x: z.number().int().min(0).max(16384), y: z.number().int().min(0).max(16384), width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384), clipTop: z.number().int().min(0).max(16384).optional(), clipBottom: z.number().int().min(0).max(16384).optional() }).strict(),
  z.object({ op: z.enum(["seek", "volume", "rotate", "audio-track", "subtitle-track"]), sessionKey: z.string().min(1).max(100), value: z.number().finite().min(0).max(86400) }).strict(),
  z.object({ op: z.literal("speed"), sessionKey: z.string().min(1).max(100),
    value: z.number().refine((speed) => PLAYBACK_SPEED_OPTIONS.some((option) => option === speed), "不支持的播放倍速") }).strict(),
  z.object({ op: z.enum(["pause", "fullscreen"]), sessionKey: z.string().min(1).max(100), value: z.boolean() }).strict(),
  z.object({ op: z.literal("visible"), sessionKey: z.string().min(1).max(100), value: z.boolean() }).strict(),
  z.object({ op: z.literal("subtitle-file"), sessionKey: z.string().min(1).max(100) }).strict()
]);
export type EmbeddedRequest = z.infer<typeof embeddedRequestSchema>;
export const embeddedInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), code: z.string().regex(/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Space|Escape|Enter|Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/), control: z.boolean(), shift: z.boolean(), alt: z.boolean() }).strict(),
  z.object({ kind: z.enum(["click", "double-click"]) }).strict(),
  z.object({ kind: z.literal("pointer-move"), x: z.number().int().min(0).max(16384).optional(), y: z.number().int().min(0).max(16384).optional() }).strict()
]);
export type EmbeddedInput = z.infer<typeof embeddedInputSchema>;
export interface EmbeddedState {
  sessionKey: string;
  phase: "idle" | "loading" | "playing" | "paused" | "reading" | "buffering" | "failed" | "ended";
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  speed: number;
  rotation: number;
  fullscreen: boolean;
  tracks: Array<{ type: "audio" | "sub"; id: number; selected: boolean; codec: string }>;
  error?: string;
  subtitleError?: string;
}
