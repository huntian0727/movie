// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MediaReadBudget } from "../../src/main/media/mediaReadBudget";

describe("shared media read budget", () => {
  it("limits one remote source while letting another source run, then favors visible work", async () => {
    const budget = new MediaReadBudget(2);
    let releaseA!: () => void; let releaseB!: () => void;
    const order: string[] = [];
    const a = budget.run({ sourceKey: "cloud-a", remote: true }, () => new Promise<void>((done) => { releaseA = done; }));
    const same = budget.run({ sourceKey: "cloud-a", remote: true, priority: 0 }, async () => { order.push("background"); });
    const b = budget.run({ sourceKey: "cloud-b", remote: true }, () => new Promise<void>((done) => { releaseB = done; }));
    const visible = budget.run({ sourceKey: "cloud-a", remote: true, priority: 2 }, async () => { order.push("visible"); });
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseB(); await b;
    expect(order).toEqual([]);
    releaseA();
    await Promise.all([a, same, visible]);
    expect(order).toEqual(["visible", "background"]);
  });

  it("does not start waiting work during playback priority and discards cancelled requests", async () => {
    const budget = new MediaReadBudget();
    const cancelled = new AbortController();
    const execute = vi.fn(async () => 1);
    budget.setPlaybackPaused(true);
    const first = budget.run({ signal: cancelled.signal }, execute);
    const second = budget.run({}, async () => 2);
    cancelled.abort();
    await expect(first).rejects.toThrow("cancelled");
    expect(execute).not.toHaveBeenCalled();
    budget.setPlaybackPaused(false);
    await expect(second).resolves.toBe(2);
  });
});
