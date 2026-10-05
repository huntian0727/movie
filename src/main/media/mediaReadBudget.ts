import { ImageRequestCancelledError } from "./imageGenerationQueue.js";

interface ReadOptions { sourceKey?: string; remote?: boolean; priority?: number; signal?: AbortSignal }
interface WaitingRead {
  source: string; limit: number; priority: number; sequence: number; signal?: AbortSignal;
  start(): void; cancel(): void;
}

/** One resource budget shared by metadata and screenshot decoding. */
export class MediaReadBudget {
  private readonly waiting: WaitingRead[] = [];
  private readonly activeSources = new Map<string, number>();
  private active = 0;
  private sequence = 0;
  private paused = false;
  constructor(private readonly concurrency = 2) {}

  run<Result>(options: ReadOptions, execute: () => Promise<Result>): Promise<Result> {
    if (options.signal?.aborted) return Promise.reject(new ImageRequestCancelledError());
    return new Promise((resolve, reject) => {
      const detach = () => options.signal?.removeEventListener("abort", job.cancel);
      const job: WaitingRead = {
        source: options.sourceKey ?? (options.remote ? "remote" : "local"),
        limit: options.remote ? 1 : this.concurrency,
        priority: options.priority ?? 0, sequence: this.sequence++, signal: options.signal,
        cancel: () => {
          const index = this.waiting.indexOf(job);
          if (index < 0) return;
          this.waiting.splice(index, 1); detach(); reject(new ImageRequestCancelledError()); this.pump();
        },
        start: () => {
          detach();
          this.active += 1;
          this.activeSources.set(job.source, (this.activeSources.get(job.source) ?? 0) + 1);
          let operation: Promise<Result>;
          try { operation = execute(); } catch (error) { operation = Promise.reject(error); }
          void operation.then(resolve, reject).finally(() => {
            this.active -= 1;
            const remaining = (this.activeSources.get(job.source) ?? 1) - 1;
            if (remaining) this.activeSources.set(job.source, remaining);
            else this.activeSources.delete(job.source);
            this.pump();
          });
        }
      };
      options.signal?.addEventListener("abort", job.cancel, { once: true });
      this.waiting.push(job);
      this.pump();
    });
  }

  setPlaybackPaused(paused: boolean): void { this.paused = paused; if (!paused) this.pump(); }

  private pump(): void {
    while (!this.paused && this.active < this.concurrency) {
      let best = -1;
      for (let index = 0; index < this.waiting.length; index += 1) {
        const job = this.waiting[index]!;
        if ((this.activeSources.get(job.source) ?? 0) >= job.limit) continue;
        const current = this.waiting[best];
        if (!current || job.priority > current.priority || job.priority === current.priority && job.sequence < current.sequence) best = index;
      }
      if (best < 0) return;
      const [job] = this.waiting.splice(best, 1);
      job!.start();
    }
  }
}

export const mediaReadBudget = new MediaReadBudget();
