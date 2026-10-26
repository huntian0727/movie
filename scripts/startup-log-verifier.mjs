import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ISO_TIMESTAMP_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

export function parseZonedTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_WITH_ZONE.test(value)) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function verifyStartupCompletion(logLines, {
  notBefore,
  maxWaitMs = 180_000,
  expectedAppVersion
} = {}) {
  const notBeforeMs = parseZonedTimestamp(notBefore);
  if (notBeforeMs === null) {
    return {
      ok: false,
      reason: "invalid_not_before_timestamp",
      message: "notBefore must be an ISO-8601 timestamp with an explicit UTC offset."
    };
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    return { ok: false, reason: "invalid_max_wait_ms" };
  }

  const events = [];
  let malformedJsonLines = 0;
  let invalidTimestampLines = 0;
  for (const line of logLines) {
    if (typeof line !== "string" || line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      malformedJsonLines += 1;
      continue;
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      malformedJsonLines += 1;
      continue;
    }
    const timestampMs = parseZonedTimestamp(event.timestamp);
    if (timestampMs === null) {
      invalidTimestampLines += 1;
      continue;
    }
    events.push({ ...event, timestampMs });
  }

  const deadlineMs = notBeforeMs + maxWaitMs;
  const starts = events
    .filter((event) =>
      event.event === "startup_started" &&
      typeof event.operationId === "string" &&
      event.operationId.length > 0 &&
      event.timestampMs >= notBeforeMs &&
      event.timestampMs <= deadlineMs
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const completions = events
    .filter((event) =>
      event.event === "startup_completed" &&
      typeof event.operationId === "string" &&
      event.timestampMs >= notBeforeMs &&
      event.timestampMs <= deadlineMs
    )
    .sort((left, right) => right.timestampMs - left.timestampMs);

  for (const completed of completions) {
    const started = starts
      .filter((candidate) =>
        candidate.operationId === completed.operationId &&
        candidate.timestampMs <= completed.timestampMs
      )
      .sort((left, right) => right.timestampMs - left.timestampMs)[0];
    if (!started) continue;

    const appVersion = typeof started.context?.appVersion === "string"
      ? started.context.appVersion
      : undefined;
    if (expectedAppVersion && appVersion !== expectedAppVersion) {
      return {
        ok: false,
        reason: "app_version_mismatch",
        expectedAppVersion,
        observedAppVersion: appVersion,
        operationId: completed.operationId,
        startedAt: started.timestamp,
        completedAt: completed.timestamp,
        malformedJsonLines,
        invalidTimestampLines
      };
    }
    return {
      ok: true,
      operationId: completed.operationId,
      startedAt: started.timestamp,
      completedAt: completed.timestamp,
      durationMs: Number.isFinite(completed.durationMs)
        ? completed.durationMs
        : completed.timestampMs - started.timestampMs,
      appVersion,
      malformedJsonLines,
      invalidTimestampLines
    };
  }

  return {
    ok: false,
    reason: starts.length === 0 ? "startup_started_not_found" : "startup_completed_not_found",
    startupStartsSeen: starts.length,
    startupCompletionsSeen: completions.length,
    malformedJsonLines,
    invalidTimestampLines
  };
}

function parseArgs(argv) {
  const options = { logs: [], maxWaitMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--log" && value) {
      options.logs.push(value);
      index += 1;
    } else if (arg === "--not-before" && value) {
      options.notBefore = value;
      index += 1;
    } else if (arg === "--max-wait-ms" && value) {
      options.maxWaitMs = Number(value);
      index += 1;
    } else if (arg === "--app-version" && value) {
      options.expectedAppVersion = value;
      index += 1;
    } else {
      throw new Error("Unknown or incomplete argument: " + arg);
    }
  }
  if (options.logs.length === 0) throw new Error("At least one --log path is required.");
  if (!options.notBefore) throw new Error("--not-before is required.");
  return options;
}

export function runStartupLogVerifier(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const lines = options.logs.flatMap((logPath) =>
      readFileSync(logPath, "utf8").split(/\r?\n/)
    );
    const result = verifyStartupCompletion(lines, options);
    process.stdout.write(JSON.stringify({ ...result, logFiles: options.logs }, null, 2) + "\n");
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      reason: "invalid_arguments_or_io_error",
      message: error instanceof Error ? error.message : String(error)
    }, null, 2) + "\n");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runStartupLogVerifier();
}