export class ImageRequestCancelledError extends Error {
  constructor() { super("Image request cancelled"); this.name = "ImageRequestCancelledError"; }
}

export interface ImageRequestOptions {
  signal?: AbortSignal; priority?: number; cachedOnly?: boolean; remote?: boolean;
  onStateChange?(state: "queued" | "active"): void;
}
type Subscriber = { priority: number; onStateChange?: ImageRequestOptions["onStateChange"]; resolve(): void; reject(error: unknown): void; detach(): void };
type Job = {
  key: string; sequence: number; active: boolean; remote: boolean; controller: AbortController;
  execute(signal: AbortSignal): Promise<void>; subscribers: Set<Subscriber>;
  finished: Promise<void>; finish(): void;
  interrupted: boolean;
};

/** Shared work is cancelled only when its last consumer leaves. */
export class ImageGenerationQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly idleWaiters = new Set<() => void>();
  private active = 0;
  private activeRemote = 0;
  private sequence = 0;
  private stopped = false;
  private playbackPaused = false;
  constructor(private readonly concurrency = 2) {}

  run(key: string, execute: Job["execute"], options: ImageRequestOptions = {}): Promise<void> {
    if (this.stopped || options.signal?.aborted) return Promise.reject(new ImageRequestCancelledError());
    const previous = this.jobs.get(key);
    // An aborted FFmpeg may still be closing its file handles. Do not overlap a replacement.
    if (previous?.controller.signal.aborted && !previous.interrupted) {
      return previous.finished.then(() => this.run(key, execute, options));
    }
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const job = previous ?? { key, sequence: this.sequence++, active: false, remote: Boolean(options.remote), controller: new AbortController(), execute, subscribers: new Set<Subscriber>(), finished, finish, interrupted: false };
    this.jobs.set(key, job);
    const result = new Promise<void>((resolve, reject) => {
      const cancel = () => {
        subscriber.detach();
        job.subscribers.delete(subscriber);
        reject(new ImageRequestCancelledError());
        if (job.subscribers.size === 0) {
          job.controller.abort();
          if (!job.active) { this.jobs.delete(job.key); job.finish(); }
          this.pump();
        }
      };
      const subscriber: Subscriber = {
        priority: options.priority ?? 1, onStateChange: options.onStateChange, resolve, reject,
        detach: () => options.signal?.removeEventListener("abort", cancel)
      };
      job.subscribers.add(subscriber);
      options.signal?.addEventListener("abort", cancel, { once: true });
      options.onStateChange?.(job.active && !job.interrupted ? "active" : "queued");
    });
    this.pump();
    return result;
  }

  whenIdle(): Promise<void> {
    return this.jobs.size === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  /** Stop source-video reads without failing image consumers; retry after startup. */
  setPlaybackPaused(paused: boolean): void {
    this.playbackPaused = paused;
    if (paused) {
      for (const job of this.jobs.values()) {
        if (job.active && !job.controller.signal.aborted) {
          job.interrupted = true;
          job.controller.abort();
          for (const subscriber of job.subscribers) subscriber.onStateChange?.("queued");
        }
      }
    } else this.pump();
  }

  stop(): void {
    this.stopped = true;
    for (const job of this.jobs.values()) {
      job.controller.abort();
      this.finishSubscribers(job, new ImageRequestCancelledError());
      if (!job.active) { this.jobs.delete(job.key); job.finish(); }
    }
    this.notifyIdle();
  }

  private pump(): void {
    while (!this.stopped && !this.playbackPaused && this.active < this.concurrency) {
      let job: Job | undefined;
      let highestPriority = -Infinity;
      for (const entry of this.jobs.values()) {
        if (entry.active || entry.subscribers.size === 0 || (entry.remote && this.activeRemote > 0)) continue;
        let priority = -Infinity;
        for (const subscriber of entry.subscribers) priority = Math.max(priority, subscriber.priority);
        if (!job || priority > highestPriority || (priority === highestPriority && entry.sequence < job.sequence)) {
          job = entry;
          highestPriority = priority;
        }
      }
      if (!job) break;
      job.active = true;
      this.active += 1;
      if (job.remote) this.activeRemote += 1;
      for (const subscriber of job.subscribers) subscriber.onStateChange?.("active");
      void job.execute(job.controller.signal).then(
        () => { if (!job.interrupted) this.finishSubscribers(job); },
        (error) => { if (!job.interrupted) this.finishSubscribers(job, error); }
      ).finally(() => {
        this.active -= 1;
        if (job.remote) this.activeRemote -= 1;
        if (job.interrupted && !this.stopped && job.subscribers.size > 0) {
          job.active = false;
          job.interrupted = false;
          job.controller = new AbortController();
        } else {
          this.jobs.delete(job.key);
          job.finish();
        }
        this.pump();
      });
    }
    this.notifyIdle();
  }

  private finishSubscribers(job: Job, error?: unknown): void {
    for (const subscriber of job.subscribers) {
      subscriber.detach();
      if (error) subscriber.reject(error); else subscriber.resolve();
    }
    job.subscribers.clear();
  }

  private notifyIdle(): void {
    if (this.jobs.size > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
