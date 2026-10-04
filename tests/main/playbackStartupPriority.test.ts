// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackStartupPriority, PLAYBACK_STARTUP_PRIORITY_MS } from "../../src/main/media/playbackStartupPriority";

afterEach(() => vi.useRealTimers());

describe("bounded playback startup priority", () => {
  it("ignores obsolete completion and releases only the current startup", () => {
    const pause = vi.fn();
    const priority = new PlaybackStartupPriority(pause);
    priority.begin("a"); priority.begin("b"); priority.finish("a");
    expect(pause.mock.calls).toEqual([[true], [true]]);
    priority.finish("b"); priority.finish("b");
    expect(pause.mock.calls).toEqual([[true], [true], [false]]);
  });
  it("bounds duplicate startup notifications and restores queues on timeout", async () => {
    vi.useFakeTimers();
    const pause = vi.fn();
    const priority = new PlaybackStartupPriority(pause);
    priority.begin("a");
    await vi.advanceTimersByTimeAsync(PLAYBACK_STARTUP_PRIORITY_MS - 1);
    priority.begin("a");
    await vi.advanceTimersByTimeAsync(1);
    expect(pause.mock.calls).toEqual([[true], [false]]);
  });
  it("cancels old timers on replacement, failure, and close", async () => {
    vi.useFakeTimers();
    const pause = vi.fn();
    const priority = new PlaybackStartupPriority(pause);
    priority.begin("a");
    await vi.advanceTimersByTimeAsync(1000);
    priority.begin("b");
    await vi.advanceTimersByTimeAsync(PLAYBACK_STARTUP_PRIORITY_MS - 1000);
    expect(pause).not.toHaveBeenCalledWith(false);
    priority.finish(undefined, "closed");
    await vi.advanceTimersByTimeAsync(2000);
    expect(pause.mock.calls).toEqual([[true], [true], [false]]);
  });
});
