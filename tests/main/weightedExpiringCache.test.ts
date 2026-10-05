// @vitest-environment node
import { describe, expect, it } from "vitest";
import { WeightedExpiringCache } from "../../src/main/queries/weightedExpiringCache";

describe("weighted expiring LRU", () => {
  it("enforces entry and payload budgets while preserving recently used entries", () => {
    const cache = new WeightedExpiringCache<string, number>(2, 4, () => 0);
    cache.set("a", 1, 10, 2); cache.set("b", 2, 10, 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 10, 2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    cache.set("large", 9, 10, 5);
    expect(cache.get("large")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    cache.clear(); expect(cache.get("a")).toBeUndefined();
  });
  it("prunes expired values and adjusts the weight when replacing a value", () => {
    let now = 0;
    const cache = new WeightedExpiringCache<string, number>(3, 4, () => now);
    cache.set("a", 1, 10, 4);
    cache.set("a", 2, 10, 1);
    cache.set("b", 3, 10, 3);
    expect(cache.get("a")).toBe(2);
    now = 10; expect(cache.get("a")).toBeUndefined();
    cache.set("c", 4, 20, 4);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(4);
  });
});
