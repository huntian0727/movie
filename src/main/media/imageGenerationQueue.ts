export class ImageRequestCancelledError extends Error {
  constructor() { super("Image request cancelled"); this.name = "ImageRequestCancelledError"; }
}

export interface ImageRequestOptions { signal?: AbortSignal; priority?: number; cachedOnly?: boolean }
type Subscriber = { priority: number; resolve(): void; reject(error: unknown): void; detach(): void };
type Job = {
  key: string; sequence: number; active: boolean; controller: AbortController;
  execute(signal: AbortSignal): Promise<void>; subscribers: Set<Subscriber>;
  finished: Promise<void>; finish(): void;
};

/** Shared work is cancelled only when its last consumer leaves. */
export class ImageGenerationQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly idleWaiters = new Set<() => void>();
  private active = 0;
  private sequence = 0;
  private stopped = false;
  constructor(private readonly concurrency = 2) {}

  run(key: string, execute: Job["execute"], options: ImageRequestOptions = {}): Promise<void> {
    if (this.stopped || options.signal?.aborted) return Promise.reject(new ImageRequestCancelledError());
    const previous = this.jobs.get(key);
    // An aborted FFmpeg may still be closing its file handles. Do not overlap a replacement.
    if (previous?.controller.signal.aborted) {
      return previous.finished.then(() => this.run(key, execute, options));
    }
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const job = previous ?? { key, sequence: this.sequence++, active: false, controller: new AbortController(), execute, subscribers: new Set<Subscriber>(), finished, finish };
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
        priority: options.priority ?? 1, resolve, reject,
        detach: () => options.signal?.removeEventListener("abort", cancel)
      };
      job.subscribers.add(subscriber);
      options.signal?.addEventListener("abort", cancel, { once: true });
    });
    this.pump();
    return result;
  }

  whenIdle(): Promise<void> {
    return this.jobs.size === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.add(resolve));
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
    while (!this.stopped && this.active < this.concurrency) {
      const priority = (job: Job) => Math.max(...[...job.subscribers].map((subscriber) => subscriber.priority));
      const job = [...this.jobs.values()].filter((entry) => !entry.active && entry.subscribers.size > 0)
        .sort((a, b) => priority(b) - priority(a) || a.sequence - b.sequence)[0];
      if (!job) break;
      job.active = true;
      this.active += 1;
      void job.execute(job.controller.signal).then(
        () => this.finishSubscribers(job), (error) => this.finishSubscribers(job, error)
      ).finally(() => {
        this.jobs.delete(job.key);
        job.finish();
        this.active -= 1;
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
