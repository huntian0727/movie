// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ImageGenerationQueue, ImageRequestCancelledError } from "../../src/main/media/imageGenerationQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("current-page image generation queue", () => {
  it("bounds concurrency and promotes current interactions ahead of old queued work", async () => {
    const queue = new ImageGenerationQueue(2);
    const gate = deferred();
    const order: string[] = [];
    const a = queue.run("a", () => gate.promise);
    const b = queue.run("b", () => gate.promise);
    const low = queue.run("old", async () => { order.push("old"); }, { priority: 0 });
    const high = queue.run("current", async () => { order.push("current"); }, { priority: 2 });
    expect(order).toEqual([]);
    gate.resolve();
    await Promise.all([a, b, low, high]);
    expect(order).toEqual(["current", "old"]);
  });

  it("removes abandoned queued work without reading its video", async () => {
    const queue = new ImageGenerationQueue(1);
    const gate = deferred();
    const active = queue.run("active", () => gate.promise);
    const controller = new AbortController();
    const generate = vi.fn();
    const queued = queue.run("previous-page", generate, { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toBeInstanceOf(ImageRequestCancelledError);
    gate.resolve();
    await active;
    await queue.whenIdle();
    expect(generate).not.toHaveBeenCalled();
  });

  it("shares one generation and does not abort it while another window still needs it", async () => {
    const queue = new ImageGenerationQueue();
    const gate = deferred();
    let signal!: AbortSignal;
    const generate = vi.fn((value: AbortSignal) => { signal = value; return gate.promise; });
    const first = new AbortController();
    const a = queue.run("same", generate, { signal: first.signal });
    const b = queue.run("same", generate);
    first.abort();
    await expect(a).rejects.toBeInstanceOf(ImageRequestCancelledError);
    expect(signal.aborted).toBe(false);
    gate.resolve();
    await b;
    expect(generate).toHaveBeenCalledOnce();
  });

  it("aborts active work after its last consumer leaves and still runs subsequent work", async () => {
    const queue = new ImageGenerationQueue(1);
    const controller = new AbortController();
    const a = queue.run("old", (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })), { signal: controller.signal });
    const next = vi.fn().mockResolvedValue(undefined);
    const b = queue.run("new", next);
    controller.abort();
    await expect(a).rejects.toBeInstanceOf(ImageRequestCancelledError);
    await b;
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not let an error block later work", async () => {
    const queue = new ImageGenerationQueue(1);
    const bad = queue.run("bad", async () => { throw new Error("offline"); });
    const next = queue.run("next", async () => undefined);
    await expect(bad).rejects.toThrow("offline");
    await next;
    await queue.whenIdle();
  });
});
