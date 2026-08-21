/**
 * A simple token-bucket rate limiter for CloudDrive gRPC calls.
 *
 * CloudDrive2 reports per-cloud limits (e.g. 115 reports
 * maxQueriesPerSecond≈5.0). All gRPC calls that hit the cloud API
 * (GetSubFiles, PrefetchFileRanges, CloseFileReader, etc.) should
 * acquire() before sending to avoid server-side throttling.
 *
 * The limiter is local-only and does not coordinate with other
 * CloudDrive clients — it conservatively stays below the reported QPS.
 */
export class CloudDriveRateLimiter {
  private readonly bucketCapacityMs: number;
  private readonly refillIntervalMs: number;
  private tokens: number;
  private lastRefill: number;
  private waitQueue: Array<() => void> = [];
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param queriesPerSecond Maximum sustained QPS. Values <= 0 mean unlimited.
   * @param burstSize Maximum burst (default = 1, i.e. no bursting beyond QPS).
   */
  constructor(queriesPerSecond: number, burstSize = 1) {
    if (queriesPerSecond <= 0) {
      this.bucketCapacityMs = 0;
      this.refillIntervalMs = 0;
      this.tokens = 0;
      this.lastRefill = 0;
      return;
    }
    this.refillIntervalMs = Math.max(1, Math.floor(1000 / queriesPerSecond));
    this.bucketCapacityMs = this.refillIntervalMs * Math.max(1, burstSize);
    this.tokens = this.bucketCapacityMs;
    this.lastRefill = Date.now();
  }

  /**
   * Returns immediately if a token is available, or waits until the
   * next token is refilled. Multiple concurrent callers are served FIFO.
   */
  async acquire(): Promise<void> {
    if (this.refillIntervalMs <= 0) return;
    this.refill();
    if (this.tokens >= this.refillIntervalMs) {
      this.tokens -= this.refillIntervalMs;
      return;
    }
    // Need to wait.
    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
      this.ensureTimer();
    });
  }

  /**
   * Convenience: run `fn` after acquiring a token. The timer tick also
   * refills tokens, so callers should prefer this over manual acquire.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }

  /**
   * Clears the internal timer and rejects all pending waiters.
   * Call on shutdown.
   */
  close(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    const pending = this.waitQueue;
    this.waitQueue = [];
    for (const resolve of pending) resolve();
  }

  /** Number of callers waiting for a token. Exposed for diagnostics. */
  get pendingCount(): number {
    return this.waitQueue.length;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.bucketCapacityMs, this.tokens + elapsed);
      this.lastRefill = now;
    }
    // Drain as many waiters as possible.
    while (this.waitQueue.length > 0 && this.tokens >= this.refillIntervalMs) {
      const resolve = this.waitQueue.shift()!;
      this.tokens -= this.refillIntervalMs;
      resolve();
    }
  }

  private ensureTimer(): void {
    if (this.refillTimer) return;
    this.refillTimer = setInterval(() => {
      this.refill();
      if (this.waitQueue.length === 0) {
        clearInterval(this.refillTimer!);
        this.refillTimer = null;
      }
    }, Math.max(50, Math.floor(this.refillIntervalMs / 2)));
    this.refillTimer.unref?.();
  }
}

/**
 * Dedicated limiter for the 115 cloud drive.
 *
 * CloudDrive2 reports maxQueriesPerSecond≈5.0 for 115 and
 * maxDownloadThreads=2. We conservatively cap at 4 QPS to leave
 * headroom for the WinFSP mount and any other client access.
 *
 * Directory enumeration (GetSubFiles) and metadata hints
 * (CloseFileReader, PrefetchFileRanges) all go through this limiter.
 */
export const DEFAULT_115_QPS_LIMIT = 4;

/**
 * Concurrency cap for parallel directory traversal on cloud drives.
 * 115 has maxDownloadThreads=2; we use 2 concurrent GetSubFiles streams
 * as a conservative default to avoid saturating both threads with
 * enumeration instead of actual file reads.
 */
export const DEFAULT_CLOUD_DIR_CONCURRENCY = 2;
