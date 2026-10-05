// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CoalescingReadQueue, SupersededReadError } from "../../src/main/queries/coalescingReadQueue";

function deferred<Result>() {
  let resolve!: (result: Result) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Result>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("coalescing read queue", () => {
  it("runs one read at a time and merges identical waiting reads without reusing an active result", async () => {
    const queue = new CoalescingReadQueue<number>();
    const first = deferred<number>();
    const refresh = vi.fn().mockResolvedValue(2);
    const unexpected = vi.fn();
    const a = queue.run("summary", () => first.promise);
    const b = queue.run("summary", refresh);
    const c = queue.run("summary", unexpected);
    expect(refresh).not.toHaveBeenCalled();
    first.resolve(1);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    await expect(c).resolves.toBe(2);
    expect(refresh).toHaveBeenCalledOnce();
    expect(unexpected).not.toHaveBeenCalled();
  });

  it("preserves distinct operations, filters, consumers and FIFO order", async () => {
    const queue = new CoalescingReadQueue<string>();
    const gate = deferred<string>();
    const order: string[] = [];
    const active = queue.run("active", () => gate.promise);
    const reads = ["page-1", "picker", "page-2"].map((key) =>
      queue.run(key, async () => { order.push(key); return key; }));
    gate.resolve("active");
    await Promise.all([active, ...reads]);
    expect(order).toEqual(["page-1", "picker", "page-2"]);
  });

  it("rejects failed reads but keeps later independent reads working", async () => {
    const queue = new CoalescingReadQueue<number>();
    const gate = deferred<number>();
    const bad = queue.run("bad", () => gate.promise);
    const next = queue.run("next", async () => 2);
    gate.reject(new Error("offline"));
    await expect(bad).rejects.toThrow("offline");
    await expect(next).resolves.toBe(2);
    await expect(queue.run("throws", () => { throw new Error("sync"); })).rejects.toThrow("sync");
    await expect(queue.run("new", async () => 3)).resolves.toBe(3);
  });

  it("supersedes only queued reads from the same scope, preserving other windows and active work", async () => {
    const queue = new CoalescingReadQueue<string>();
    const gate = deferred<string>();
    const active = queue.runLatest("window-1:library", "active", () => gate.promise);
    const staleExecute = vi.fn(async () => "stale");
    const stale = queue.runLatest("window-1:library", "old-filter", staleExecute);
    const otherWindow = queue.runLatest("window-2:library", "old-filter", staleExecute);
    const latest = queue.runLatest("window-1:library", "new-filter", async () => "latest");
    await expect(stale).rejects.toBeInstanceOf(SupersededReadError);
    gate.resolve("active-result");
    await expect(active).resolves.toBe("active-result");
    await expect(otherWindow).resolves.toBe("stale");
    await expect(latest).resolves.toBe("latest");
    expect(staleExecute).toHaveBeenCalledOnce();
  });

  it("does not replace the same pending query or unrelated purposes", async () => {
    const queue = new CoalescingReadQueue<number>();
    const gate = deferred<number>();
    const active = queue.run("gate", () => gate.promise);
    const first = queue.runLatest("window-1:library", "same", async () => 3);
    const second = queue.runLatest("window-1:library", "same", async () => 4);
    const navigation = queue.runLatest("window-1:navigation", "other", async () => 5);
    gate.resolve(1);
    await expect(active).resolves.toBe(1);
    await expect(first).resolves.toBe(3);
    await expect(second).resolves.toBe(3);
    await expect(navigation).resolves.toBe(5);
  });

  it("rejects all consumers on shutdown and ignores late completions from a failed worker", async () => {
    const queue = new CoalescingReadQueue<number>();
    const gate = deferred<number>();
    const replacement = deferred<number>();
    const neverRun = vi.fn();
    const a = queue.run("active", () => gate.promise);
    const b = queue.run("queued", neverRun);
    const c = queue.run("queued", neverRun);
    queue.rejectAll(new Error("stopped"));
    await Promise.all([a, b, c].map((result) => expect(result).rejects.toThrow("stopped")));
    const newRead = queue.run("replacement", () => replacement.promise);
    gate.resolve(1);
    await Promise.resolve();
    expect(neverRun).not.toHaveBeenCalled();
    replacement.resolve(3);
    await expect(newRead).resolves.toBe(3);
  });
});
