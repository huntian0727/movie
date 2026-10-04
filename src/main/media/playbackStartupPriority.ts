import type { StructuredLogger } from "../logging/logger.js";

export const PLAYBACK_STARTUP_PRIORITY_MS = 15_000;

/** A bounded startup reservation, not a permanent pause while a video plays. */
export class PlaybackStartupPriority {
  private current: { videoId: string; startedAt: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly setPaused: (paused: boolean) => void, private readonly logger?: StructuredLogger) {}

  begin(videoId: string): void {
    if (this.current?.videoId === videoId) return;
    if (this.current) clearTimeout(this.current.timer);
    this.current = {
      videoId, startedAt: Date.now(),
      timer: setTimeout(() => this.finish(videoId, "timeout"), PLAYBACK_STARTUP_PRIORITY_MS)
    };
    this.current.timer.unref?.();
    this.setPaused(true);
  }

  finish(videoId?: string, reason = "decode_ready"): void {
    if (!this.current || (videoId !== undefined && this.current.videoId !== videoId)) return;
    const current = this.current;
    this.current = null;
    clearTimeout(current.timer);
    this.setPaused(false);
    this.logger?.info({ module: "media.playback", event: "startup_priority_released",
      durationMs: Date.now() - current.startedAt, context: { reason } });
  }
}
