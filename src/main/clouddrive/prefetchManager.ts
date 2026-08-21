import { HINT_PRIORITY, type ByteRange, type HintPriority } from "./grpcClient.js";
import {
  isCloudDrivePath,
  tryCancelFilePrefetch,
  tryPrefetchFileRanges
} from "./mountedScanner.js";

/**
 * Default prefetch window: 8 MiB ahead of the current read position.
 * This covers roughly 30-60 seconds of 1080p H.264 video and is large
 * enough to smooth over seek latency on 115 (2 download threads).
 */
const DEFAULT_PREFETCH_WINDOW_BYTES = 8 * 1024 * 1024;

/**
 * Prefetch the first 4 MiB of the next video in queue when approaching
 * the end of the current one. This is enough for the moov atom + initial
 * segments so playback starts without a stall.
 */
const NEXT_EPISODE_PREFETCH_BYTES = 4 * 1024 * 1024;

/**
 * Maximum number of outstanding prefetch hints per file. Beyond this,
 * older hints are replaced to avoid flooding the server.
 */
const MAX_HINTS_PER_FILE = 4;

interface ActiveHint {
  hintId: number;
  filePath: string;
}

/**
 * Manages CloudDrive2 prefetch hints for media playback.
 *
 * Scenarios:
 * 1. On playback start: prefetch from byte 0 of the current file (HIGH).
 * 2. On seek: prefetch around the seek target (HIGH, replacing existing).
 * 3. On next-episode known: prefetch the head of the next file (NORMAL).
 * 4. On playback end/switch: cancel all hints for the previous file.
 *
 * All methods are fire-and-forget and never throw — prefetch is advisory.
 */
export class CloudDrivePrefetchManager {
  private activeHints = new Map<string, ActiveHint[]>();
  private readonly windowBytes: number;

  constructor(windowBytes: number = DEFAULT_PREFETCH_WINDOW_BYTES) {
    this.windowBytes = windowBytes;
  }

  /**
   * Call when playback starts or when a new video is selected.
   * Prefetches the beginning of the file at HIGH priority and cancels
   * any prior hints for a different file.
   */
  onPlaybackStart(filePath: string, previousFilePath?: string | null): void {
    if (!isCloudDrivePath(filePath)) return;
    if (previousFilePath && previousFilePath !== filePath) {
      void this.cancelAll(previousFilePath);
    }
    const range: ByteRange = { start: 0, length: this.windowBytes };
    void this.sendHint(filePath, [range], HINT_PRIORITY.HIGH, { replaceExisting: true });
  }

  /**
   * Call when the user seeks to a new position. The byte offset is
   * estimated from the seek fraction × file size. Prefetches a window
   * starting at the seek target.
   */
  onSeek(filePath: string, seekByteOffset: number, fileSize?: number): void {
    if (!isCloudDrivePath(filePath)) return;
    const start = Math.max(0, Math.floor(seekByteOffset));
    let length = this.windowBytes;
    if (fileSize && start + length > fileSize) {
      length = Math.max(0, fileSize - start);
    }
    if (length === 0) return;
    const range: ByteRange = { start, length };
    void this.sendHint(filePath, [range], HINT_PRIORITY.HIGH, { replaceExisting: true });
  }

  /**
   * Call when the next video in the queue is known (e.g. right after
   * opening a playlist or when the current video is near its end).
   * Prefetches the head of the next file at NORMAL priority.
   */
  onNextEpisodeKnown(nextFilePath: string): void {
    if (!isCloudDrivePath(nextFilePath)) return;
    const range: ByteRange = { start: 0, length: NEXT_EPISODE_PREFETCH_BYTES };
    void this.sendHint(nextFilePath, [range], HINT_PRIORITY.NORMAL, { replaceExisting: false });
  }

  /**
   * Call when a batch of thumbnail/preview frames is about to be generated
   * for a cloud-drive file. Uses LOW priority so it doesn't compete with
   * active playback reads.
   */
  onThumbnailBatch(filePath: string, byteRanges: ByteRange[]): void {
    if (!isCloudDrivePath(filePath) || byteRanges.length === 0) return;
    void this.sendHint(filePath, byteRanges, HINT_PRIORITY.LOW, { replaceExisting: false });
  }

  /**
   * Cancel all prefetch hints for a file (e.g. on playback stop or
   * when switching to a different video).
   */
  async cancelAll(filePath: string): Promise<void> {
    const hints = this.activeHints.get(filePath);
    if (hints) {
      this.activeHints.delete(filePath);
    }
    await tryCancelFilePrefetch(filePath);
  }

  /**
   * Cancel all active hints across all files. Call on app shutdown.
   */
  async cancelAllFiles(): Promise<void> {
    const paths = [...this.activeHints.keys()];
    this.activeHints.clear();
    await Promise.allSettled(paths.map((p) => tryCancelFilePrefetch(p)));
  }

  /**
   * Returns the number of active hints for a file. Useful for diagnostics.
   */
  activeHintCount(filePath: string): number {
    return this.activeHints.get(filePath)?.length ?? 0;
  }

  private async sendHint(
    filePath: string,
    ranges: ByteRange[],
    priority: HintPriority,
    options: { replaceExisting: boolean }
  ): Promise<void> {
    try {
      const hintId = await tryPrefetchFileRanges(filePath, ranges, priority, {
        replaceExisting: options.replaceExisting,
        ttlSeconds: 60
      });
      if (hintId === 0) return;
      this.recordHint(filePath, hintId);
    } catch {
      // Advisory — never throw from playback path.
    }
  }

  private recordHint(filePath: string, hintId: number): void {
    const existing = this.activeHints.get(filePath) ?? [];
    existing.push({ hintId, filePath });
    // Keep only the most recent hints per file.
    if (existing.length > MAX_HINTS_PER_FILE) {
      existing.splice(0, existing.length - MAX_HINTS_PER_FILE);
    }
    this.activeHints.set(filePath, existing);
  }
}
