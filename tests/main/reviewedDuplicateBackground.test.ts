// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewedDuplicateBackgroundQueue } from "../../src/main/media/reviewedDuplicateBackground";
import type { DuplicateResolvePlan, DuplicateResolveResult, ReviewedDeleteBackgroundJob } from "../../src/shared/videoTypes";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const result = (count: number): DuplicateResolveResult => ({
  groupCount: count, keepCount: count, successCount: count,
  failureCount: 0, reclaimedBytes: count * 1024, failures: []
});
function createStore(run: (plan: DuplicateResolvePlan) => Promise<DuplicateResolveResult>) {
  const directory = mkdtempSync(path.join(tmpdir(), "reviewed-background-"));
  directories.push(directory);
  const filename = path.join(directory, "job.json");
  return { queue: new ReviewedDuplicateBackgroundQueue(filename, run), filename };
}
function plan(total: number): DuplicateResolvePlan {
  return { groups: Array.from({ length: total }, (_, i) => ({
    groupKey: `key-${i}`, keepVideoId: `keep-${i}`, deleteVideoIds: [`remove-${i}`]
  })) };
}
const until = async (read: () => unknown, matches: (job: any) => boolean) => {
  for (let i = 0; i < 100; i++) {
    const job = read();
    if (matches(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  throw new Error("Background condition timed out");
};

describe("reviewed deletion background queue", () => {
  it("acknowledges immediately without awaiting the real destructive work and counts all 3 chunks", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async (batch: DuplicateResolvePlan) => {
      await gate;
      return result(batch.groups.length);
    });
    const { queue, filename } = createStore(run);
    const accepted = queue.submit(plan(65));
    expect(accepted.status).toBe("running");
    expect(accepted.total).toBe(65);
    expect(accepted.queuedVideoIds).toHaveLength(65);
    expect(accepted.queuedVideoIds).toContain("remove-64");
    expect(accepted.processed).toBe(0);
    await until(() => queue.get(), () => run.mock.calls.length === 1);
    expect(queue.get()?.status).toBe("running");
    expect(() => queue.submit(plan(1))).toThrow(/重复提交/);
    release();
    const completed = await until(() => queue.get(), (job) => job?.status === "completed") as ReviewedDeleteBackgroundJob;
    expect(completed.processed).toBe(65);
    expect(completed.successCount).toBe(65);
    expect(completed.reclaimedBytes).toBe(65 * 1024);
    expect(completed.unsubmittedCount).toBe(0);
    expect(run.mock.calls.map(([batch]) => batch.groups.length)).toEqual([30, 30, 5]);
    expect(JSON.parse(readFileSync(filename, "utf8")).current.status).toBe("completed");
    expect(JSON.parse(readFileSync(filename, "utf8")).current.queuedVideoIds).toHaveLength(65);
  });

  it("keeps acknowledged results and stops unsubmitted chunks when a remote response is unknown", async () => {
    let calls = 0;
    const run = vi.fn(async (batch: DuplicateResolvePlan) => {
      calls++;
      if (calls === 2) return {
        groupCount: batch.groups.length, keepCount: batch.groups.length,
        successCount: 28, failureCount: 0, uncertainCount: 1, unsubmittedCount: 1,
        reclaimedBytes: 28 * 1024, failures: [],
        uncertainMessage: "CloudDrive RPC unknown"
      };
      return result(batch.groups.length);
    });
    const { queue } = createStore(run);
    queue.submit(plan(70));
    const blocked = await until(() => queue.get(), (job) => job?.status === "blocked") as ReviewedDeleteBackgroundJob;
    expect(blocked.successCount).toBe(58);
    expect(blocked.uncertainCount).toBe(1);
    expect(blocked.processed).toBe(58);
    expect(blocked.unsubmittedCount).toBe(11);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("marks an unfinished saved job interrupted on restart without replaying deletion", () => {
    const run = vi.fn(async (batch: DuplicateResolvePlan) => result(batch.groups.length));
    const { filename } = createStore(run);
    const persisted = {
      id: "prior", status: "running", total: 55, processed: 30,
      successCount: 30, failureCount: 0, uncertainCount: 0, unsubmittedCount: 25,
      reclaimedBytes: 30, recycledCount: 0, failures: [],
      message: "running", createdAt: "2026-01-01", updatedAt: "2026-01-01"
    };
    writeFileSync(filename, JSON.stringify(persisted));
    const restarted = new ReviewedDuplicateBackgroundQueue(filename, run);
    expect(restarted.get()).toMatchObject({ status: "interrupted", successCount: 30, uncertainCount: 25 });
    expect(run).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(filename, "utf8")).current.status).toBe("interrupted");
  });

  it("does not claim a thrown RPC batch failed or retry it automatically", async () => {
    const run = vi.fn(async () => { throw Error("network disconnected"); });
    const { queue } = createStore(run);
    queue.submit(plan(46));
    const blocked = await until(() => queue.get(), (job) => job?.status === "blocked") as ReviewedDeleteBackgroundJob;
    expect(blocked.uncertainCount).toBe(30);
    expect(blocked.unsubmittedCount).toBe(16);
    expect(blocked.failureCount).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("accepts more than one distinct deletion task, dispatches strictly FIFO, and survives polling", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let executions = 0;
    const run = vi.fn(async (request: DuplicateResolvePlan) => {
      executions++;
      if (executions === 1) await gate;
      return result(request.groups.reduce((total, group) => total + group.deleteVideoIds.length, 0));
    });
    const { queue, filename } = createStore(run);
    const first = queue.submit(plan(3));
    const second = queue.submit({ groups: [{ groupKey: "next", keepVideoId: "next-keeper", deleteVideoIds: ["next-target"] }] });
    const third = queue.submit({ groups: [{ groupKey: "third", keepVideoId: "third-keeper", deleteVideoIds: ["third-target"] }] });
    expect(first.status).toBe("running");
    expect(second.status).toBe("queued");
    expect(third.status).toBe("queued");
    expect(queue.get()).toMatchObject({ status: "running", waitingJobs: 2 });
    expect(queue.get()?.queuedVideoIds).toEqual(expect.arrayContaining(["remove-0", "next-target", "third-target"]));
    expect(JSON.parse(readFileSync(filename, "utf8")).waiting).toHaveLength(2);
    await until(() => queue.get(), () => run.mock.calls.length === 1);
    expect(run).toHaveBeenCalledTimes(1);
    releaseFirst();
    await until(() => queue.get(), (job) => job?.status === "completed" && job?.waitingJobs === 0);
    expect(run.mock.calls.map(([request]) => request.groups[0]!.groupKey)).toEqual(["key-0", "next", "third"]);
    const stored = JSON.parse(readFileSync(filename, "utf8"));
    expect(stored.current.id).toBe(third.id);
    expect(stored.waiting).toHaveLength(0);
    expect(stored.history.map((job: ReviewedDeleteBackgroundJob) => job.id)).toContain(first.id);
  });

  it("rejects overlapping target/keeper identities but allows unrelated jobs while running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { queue } = createStore(async (request) => { await gate; return result(request.groups.length); });
    queue.submit({ groups: [{ groupKey: "original", keepVideoId: "keeper", deleteVideoIds: ["victim"] }] });
    expect(() => queue.submit({ groups: [{ groupKey: "duplicate", keepVideoId: "other", deleteVideoIds: ["victim"] }] })).toThrow(/重复提交/);
    expect(() => queue.submit({ groups: [{ groupKey: "keeper-conflict", keepVideoId: "other", deleteVideoIds: ["keeper"] }] })).toThrow(/保留文件/);
    queue.submit({ groups: [{ groupKey: "independent", keepVideoId: "independent-keep", deleteVideoIds: ["independent-delete"] }] });
    expect(() => queue.submit({ groups: [{ groupKey: "waiting-conflict", keepVideoId: "independent-delete", deleteVideoIds: ["new-target"] }] })).toThrow(/保留文件/);
    release();
    await until(() => queue.get(), (job) => job?.status === "completed" && job?.waitingJobs === 0);
  });

  it("never resumes a pending queue automatically after restart, even though plans were persisted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { queue, filename } = createStore(async (request) => { await gate; return result(request.groups.length); });
    queue.submit(plan(1));
    queue.submit({ groups: [{ groupKey: "second", keepVideoId: "safe", deleteVideoIds: ["later"] }] });
    const noReplay = vi.fn(async (request: DuplicateResolvePlan) => result(request.groups.length));
    const recovered = new ReviewedDuplicateBackgroundQueue(filename, noReplay);
    expect(recovered.get()).toMatchObject({ status: "interrupted", waitingJobs: 0 });
    expect(recovered.get()?.queueJobs).toHaveLength(2);
    expect(JSON.parse(readFileSync(filename, "utf8")).history.at(-1).status).toBe("interrupted");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(noReplay).not.toHaveBeenCalled();
    release();
    // The original worker belongs to the old process; do not delete its temp
    // directory before it finishes its already-submitted simulation.
    await until(() => queue.get(), (job) => job?.status === "completed" && job?.waitingJobs === 0);
  });

  it("halts all waiting tasks when an earlier remote deletion result is unknown", async () => {
    const run = vi.fn(async () => { throw Error("transport uncertain"); });
    const { queue, filename } = createStore(run);
    queue.submit(plan(1));
    queue.submit({ groups: [{ groupKey: "safe", keepVideoId: "safe-keep", deleteVideoIds: ["later"] }] });
    await until(() => queue.get(), (job) => job?.status === "blocked");
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.get()?.waitingJobs).toBe(0);
    const stored = JSON.parse(readFileSync(filename, "utf8"));
    expect(stored.waiting).toHaveLength(0);
    expect(stored.history.at(-1).status).toBe("interrupted");
  });

  it("rejects a plan that repeats a target or deletes the keeper", async () => {
    const { queue } = createStore(async (batch) => result(batch.groups.length));
    expect(() => queue.submit({ groups: [{ groupKey: "g", keepVideoId: "a", deleteVideoIds: ["a"] }] })).toThrow();
    expect(() => queue.submit({ groups: [
      { groupKey: "one", keepVideoId: "a", deleteVideoIds: ["b"] },
      { groupKey: "two", keepVideoId: "c", deleteVideoIds: ["b"] }
    ] })).toThrow();
  });
});
