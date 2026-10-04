import { describe, expect, it } from "vitest";
import { playerQueueWindow } from "../../src/shared/playerQueue";
import type { VideoRecord } from "../../src/shared/videoTypes";
describe("bounded playback window", () => {
  const videos = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) } as VideoRecord));
  it("accepts selections anywhere in an unbounded directory with at most 300 entries", () => {
    for (const index of [0, 299, 300, 999, 1999]) {
      const queue = playerQueueWindow(videos, String(index));
      expect(queue).toHaveLength(300); expect(queue.some(video => video.id === String(index))).toBe(true);
      expect(new Set(queue.map(video => video.id)).size).toBe(300);
    }
  });
  it("preserves order for short queues and rejects unavailable selections", () => {
    expect(playerQueueWindow([...videos.slice(0, 2), videos[0]], "1")).toEqual(videos.slice(0, 2));
    expect(() => playerQueueWindow(videos, "missing")).toThrow();
  });
});
