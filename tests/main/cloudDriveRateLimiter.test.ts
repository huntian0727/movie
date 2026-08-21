// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { CloudDriveRateLimiter } from "../../src/main/clouddrive/rateLimiter";

describe("CloudDriveRateLimiter", () => {
  const limiters: CloudDriveRateLimiter[] = [];

  afterEach(() => {
    for (const limiter of limiters.splice(0)) limiter.close();
  });

  it("returns immediately when QPS is unlimited (0 or negative)", async () => {
    const limiter = new CloudDriveRateLimiter(0);
    limiters.push(limiter);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("allows the first request immediately", async () => {
    const limiter = new CloudDriveRateLimiter(10); // 100ms per token
    limiters.push(limiter);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("throttles subsequent requests to QPS rate", async () => {
    const limiter = new CloudDriveRateLimiter(20); // 50ms per token
    limiters.push(limiter);
    await limiter.acquire(); // first token
    const start = Date.now();
    await limiter.acquire(); // second token must wait ~50ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(300);
  });

  it("processes concurrent waiters in FIFO order", async () => {
    const limiter = new CloudDriveRateLimiter(10); // 100ms per token
    limiters.push(limiter);
    const order: number[] = [];
    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));
    const p3 = limiter.acquire().then(() => order.push(3));
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("run() executes the provided function after acquiring", async () => {
    const limiter = new CloudDriveRateLimiter(100);
    limiters.push(limiter);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
  });

  it("supports burst up to burstSize", async () => {
    const limiter = new CloudDriveRateLimiter(10, 5); // 100ms per token, burst 5
    limiters.push(limiter);
    const start = Date.now();
    // First 5 should be near-instant
    for (let i = 0; i < 5; i++) await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("close() resolves all pending waiters", async () => {
    const limiter = new CloudDriveRateLimiter(1); // 1000ms per token
    limiters.push(limiter);
    let resolved = false;
    const p = limiter.acquire().then(() => { resolved = true; });
    limiter.close();
    await p;
    expect(resolved).toBe(true);
  });
});
