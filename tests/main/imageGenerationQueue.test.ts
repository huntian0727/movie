// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ImageGenerationQueue, ImageRequestCancelledError } from "../../src/main/media/imageGenerationQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("current-page image generation queue", () => {
  it("preserves FIFO ties and reprioritizes a shared job when its highest-priority consumer leaves", async () => {
    const queue = new ImageGenerationQueue(1);
    queue.setPlaybackPaused(true);
    const order: string[] = [];
    const promoted = new AbortController();
    const low = queue.run("shared", async () => { order.push("shared"); }, { priority: 0 });
    const high = queue.run("shared", async () => undefined, { priority: 5, signal: promoted.signal });
    const tieA = queue.run("tie-a", async () => { order.push("tie-a"); }, { priority: 2 });
    const tieB = queue.run("tie-b", async () => { order.push("tie-b"); }, { priority: 2 });
    promoted.abort();
    await expect(high).rejects.toBeInstanceOf(ImageRequestCancelledError);
    queue.setPlaybackPaused(false);
    await Promise.all([low, tieA, tieB]);
    await queue.whenIdle();
    expect(order).toEqual(["tie-a", "tie-b", "shared"]);
  });

  it("interrupts active reads, keeps shared consumers pending, and retries after playback startup", async () => {
    const queue = new ImageGenerationQueue(1);
    const states: string[] = [];
    const generate = vi.fn((signal: AbortSignal) => generate.mock.calls.length === 1
      ? new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
      : Promise.resolve());
    const a = queue.run("shared", generate, { onStateChange: (s) => states.push(s) });
    queue.setPlaybackPaused(true);
    const b = queue.run("shared", generate);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generate).toHaveBeenCalledOnce();
    expect(states).toEqual(["queued", "active", "queued"]);
    queue.setPlaybackPaused(false);
    await Promise.all([a, b]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].aborted).toBe(false);
    await queue.whenIdle();
  });
  it("retries only after interrupted file handles settle even if resumed immediately", async () => {
    const queue = new ImageGenerationQueue(1);
    const gate = deferred();
    const generate = vi.fn(() => generate.mock.calls.length === 1 ? gate.promise : Promise.resolve());
    const image = queue.run("same", generate);
    queue.setPlaybackPaused(true); queue.setPlaybackPaused(false);
    expect(generate).toHaveBeenCalledOnce();
    gate.resolve();
    await image;
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("drops cancelled consumers during startup without generating or leaking idle waiters", async () => {
    const queue = new ImageGenerationQueue();
    queue.setPlaybackPaused(true);
    const controller = new AbortController();
    const generate = vi.fn();
    const result = queue.run("gone", generate, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(ImageRequestCancelledError);
    await queue.whenIdle();
    queue.setPlaybackPaused(false);
    expect(generate).not.toHaveBeenCalled();
  });
  it("stops interrupted work without retrying after shutdown", async () => {
    const queue = new ImageGenerationQueue(1);
    const gate = deferred();
    const generate = vi.fn(() => gate.promise);
    const image = queue.run("same", generate);
    queue.setPlaybackPaused(true); queue.stop();
    await expect(image).rejects.toBeInstanceOf(ImageRequestCancelledError);
    gate.resolve(); await queue.whenIdle(); queue.setPlaybackPaused(false);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("serializes remote reads, promotes other videos' first frames, and leaves a slot for local work", async () => {
    const queue = new ImageGenerationQueue(2);
    const gate = deferred();
    const order: string[] = [];
    const states: string[] = [];
    const first = queue.run("remote-1-first", () => gate.promise, { remote: true, priority: 1 });
    const rest = queue.run("remote-1-rest", async () => { order.push("rest"); }, { remote: true, priority: 0 });
    const other = queue.run("remote-2-first", async () => { order.push("other-first"); }, { remote: true, priority: 1, onStateChange: (state) => states.push(state) });
    const local = queue.run("local", async () => { order.push("local"); });
    await local;
    expect(order).toEqual(["local"]);
    expect(states).toEqual(["queued"]);
    gate.resolve();
    await Promise.all([first, rest, other]);
    expect(order).toEqual(["local", "other-first", "rest"]);
    expect(states).toEqual(["queued", "active"]);
  });

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
