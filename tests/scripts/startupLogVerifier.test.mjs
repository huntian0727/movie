import { describe, expect, it } from "vitest";
import { parseZonedTimestamp, verifyStartupCompletion } from "../../scripts/startup-log-verifier.mjs";

const logLine = (entry) => JSON.stringify(entry);

describe("startup log verifier timestamp handling", () => {
  it("compares UTC log timestamps against an explicit UTC+8 launch time by instant", () => {
    const result = verifyStartupCompletion([
      logLine({
        timestamp: "2026-10-25T07:30:42.908Z",
        module: "application",
        event: "startup_started",
        operationId: "startup-2",
        context: { appVersion: "0.1.16", packaged: true }
      }),
      logLine({
        timestamp: "2026-10-25T07:31:17.705Z",
        module: "application",
        event: "startup_completed",
        operationId: "startup-2",
        durationMs: 34_797
      })
    ], {
      notBefore: "2026-10-25T15:30:00.0000000+08:00",
      maxWaitMs: 180_000,
      expectedAppVersion: "0.1.16"
    });

    expect(result).toMatchObject({
      ok: true,
      operationId: "startup-2",
      startedAt: "2026-10-25T07:30:42.908Z",
      completedAt: "2026-10-25T07:31:17.705Z",
      durationMs: 34_797,
      appVersion: "0.1.16"
    });
  });

  it("matches completion to the successful retry, not an earlier interrupted startup", () => {
    const result = verifyStartupCompletion([
      logLine({
        timestamp: "2026-10-25T07:30:21.017Z",
        event: "startup_started",
        operationId: "interrupted",
        context: { appVersion: "0.1.16" }
      }),
      logLine({
        timestamp: "2026-10-25T07:30:42.908Z",
        event: "startup_started",
        operationId: "successful",
        context: { appVersion: "0.1.16" }
      }),
      logLine({
        timestamp: "2026-10-25T07:31:17.705Z",
        event: "startup_completed",
        operationId: "successful",
        durationMs: 34_797
      })
    ], { notBefore: "2026-10-25T15:30:00+08:00" });

    expect(result.ok).toBe(true);
    expect(result.operationId).toBe("successful");
  });

  it("does not accept a completion event from a different operation", () => {
    const result = verifyStartupCompletion([
      logLine({
        timestamp: "2026-10-25T07:30:42.908Z",
        event: "startup_started",
        operationId: "started",
        context: { appVersion: "0.1.16" }
      }),
      logLine({
        timestamp: "2026-10-25T07:31:17.705Z",
        event: "startup_completed",
        operationId: "other",
        durationMs: 34_797
      })
    ], { notBefore: "2026-10-25T15:30:00+08:00" });

    expect(result).toMatchObject({
      ok: false,
      reason: "startup_completed_not_found",
      startupStartsSeen: 1,
      startupCompletionsSeen: 1
    });
  });

  it("requires timestamps to include Z or an explicit UTC offset", () => {
    expect(parseZonedTimestamp("2026-10-25T07:30:42.908Z")).not.toBeNull();
    expect(parseZonedTimestamp("2026-10-25T15:30:42.908+08:00")).not.toBeNull();
    expect(parseZonedTimestamp("2026-10-25T15:30:42.908")).toBeNull();
    expect(parseZonedTimestamp("not-a-date")).toBeNull();

    expect(verifyStartupCompletion([], {
      notBefore: "2026-10-25T15:30:00"
    })).toMatchObject({
      ok: false,
      reason: "invalid_not_before_timestamp"
    });
  });

  it("fails when startup completes after the allowed window", () => {
    const result = verifyStartupCompletion([
      logLine({
        timestamp: "2026-10-25T07:30:42.908Z",
        event: "startup_started",
        operationId: "late",
        context: { appVersion: "0.1.16" }
      }),
      logLine({
        timestamp: "2026-10-25T07:34:00.000Z",
        event: "startup_completed",
        operationId: "late",
        durationMs: 217_092
      })
    ], {
      notBefore: "2026-10-25T15:30:00+08:00",
      maxWaitMs: 180_000
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("startup_completed_not_found");
  });
});