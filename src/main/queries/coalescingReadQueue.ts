interface ReadJob<Result> {
  key: string;
  execute(): Promise<Result>;
  consumers: Array<{ resolve(result: Result): void; reject(error: unknown): void }>;
}

/** Keep work in the parent, not the worker's opaque message queue. */
export class CoalescingReadQueue<Result> {
  private active: ReadJob<Result> | undefined;
  private readonly queued = new Map<string, ReadJob<Result>>();

  run(key: string, execute: () => Promise<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
      const existing = this.queued.get(key);
      if (existing) {
        existing.consumers.push({ resolve, reject });
      } else {
        this.queued.set(key, { key, execute, consumers: [{ resolve, reject }] });
      }
      this.pump();
    });
  }

  rejectAll(error: Error): void {
    const jobs = this.active ? [this.active, ...this.queued.values()] : [...this.queued.values()];
    this.active = undefined;
    this.queued.clear();
    for (const job of jobs) for (const consumer of job.consumers) consumer.reject(error);
  }

  private pump(): void {
    if (this.active) return;
    const job = this.queued.values().next().value;
    if (!job) return;
    this.queued.delete(job.key);
    this.active = job;
    // Never reuse an already-running read: a refresh after a database write
    // must execute again. Only identical reads waiting to start are coalesced.
    let result: Promise<Result>;
    try {
      result = job.execute();
    } catch (error) {
      this.finish(job, false, error);
      return;
    }
    void result.then(
      (value) => this.finish(job, true, value),
      (error: unknown) => this.finish(job, false, error)
    );
  }

  private finish(job: ReadJob<Result>, success: boolean, value: unknown): void {
    if (this.active !== job) return;
    this.active = undefined;
    for (const consumer of job.consumers) {
      if (success) consumer.resolve(value as Result);
      else consumer.reject(value);
    }
    this.pump();
  }
}
