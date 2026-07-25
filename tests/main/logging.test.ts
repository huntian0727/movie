import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDiagnosticPackage,
  buildDiagnosticsPreview,
  classifyError,
  StructuredLogger,
  summarizeOperationResult
} from "../../src/main/logging/index";
import type { DiagnosticEnvironment } from "../../src/main/logging/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("structured diagnostics logging", () => {
  it("redacts paths, credentials, environment values and stack paths before writing", () => {
    const logger = createLogger();
    logger.error({
      module: "test",
      operationId: "operation-1",
      event: "failed",
      message: "Unable to read C:\\Users\\Private Person\\Movies\\secret-title.mp4",
      context: {
        token: "top-secret-token",
        environment: { API_KEY: "also-secret" },
        sourcePath: "Z:\\Private Share\\secret-title.mp4"
      },
      error: new Error("failure at C:\\Users\\Private Person\\app\\main.js:12:4")
    });

    const raw = readFileSync(logger.listLogFiles()[0]!, "utf8");
    expect(raw).not.toContain("Private Person");
    expect(raw).not.toContain("secret-title");
    expect(raw).not.toContain("top-secret-token");
    expect(raw).not.toContain("also-secret");
    expect(raw).toContain("<redacted>");
    expect(raw).toContain("<path drive=");
    expect(logger.readEntries()[0]).toMatchObject({
      module: "test",
      operationId: "operation-1",
      errorCode: "UNKNOWN"
    });
  });

  it("rotates by size, caps file count and removes expired log files", () => {
    const directory = createTemporaryDirectory();
    mkdirSync(directory, { recursive: true });
    const expiredPath = path.join(directory, "app.2.jsonl");
    writeFileSync(expiredPath, "{}\n", "utf8");
    const old = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(expiredPath, old, old);

    const logger = new StructuredLogger(directory, {
      maxFileBytes: 360,
      maxFiles: 3,
      retentionDays: 2,
      now: () => new Date("2026-07-25T00:00:00.000Z")
    });
    for (let index = 0; index < 30; index += 1) {
      logger.info({ module: "rotation", event: "entry", context: { index, detail: "x".repeat(80) } });
    }

    expect(logger.listLogFiles().length).toBeLessThanOrEqual(3);
    expect(logger.readEntries().at(-1)?.context).toMatchObject({ index: 29 });
  });

  it("does not fail the business operation when the log destination is unavailable", () => {
    const parent = createTemporaryDirectory();
    const blockedPath = path.join(parent, "not-a-directory");
    writeFileSync(blockedPath, "occupied", "utf8");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = new StructuredLogger(blockedPath);

    expect(() => logger.info({ module: "files", event: "operation_completed" })).not.toThrow();
    expect(logger.isWritable()).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "[logging] structured log unavailable",
      expect.objectContaining({ errorCode: expect.any(String) })
    );
  });

  it.each([
    [new Error("NODE_MODULE_VERSION 130 but this Node requires 137"), "NATIVE_ABI_MISMATCH"],
    [Object.assign(new Error("migration failed"), { name: "DatabaseMigrationError" }), "DB_MIGRATION_FAILED"],
    [Object.assign(new Error("locked"), { code: "SQLITE_BUSY" }), "DB_LOCKED"],
    [Object.assign(new Error("offline"), { code: "ENETUNREACH" }), "OFFLINE"],
    [Object.assign(new Error("busy"), { code: "EBUSY" }), "FILE_LOCKED"],
    [Object.assign(new Error("denied"), { code: "EACCES" }), "PERMISSION_DENIED"],
    [Object.assign(new Error("full"), { code: "ENOSPC" }), "DISK_FULL"],
    [Object.assign(new Error("bad input"), { name: "ZodError" }), "VALIDATION_FAILED"],
    [Object.assign(new Error("ffprobe timed out"), { code: "FFPROBE_TIMEOUT" }), "FFPROBE_TIMEOUT"]
  ])("maps operational errors to stable codes", (error, expected) => {
    expect(classifyError(error)).toBe(expected);
  });

  it("summarizes batch operations without serializing successful items", () => {
    const result = {
      successCount: 1_000,
      failureCount: 1,
      itemResults: Array.from({ length: 1_000 }, (_, index) => ({ videoId: `video-${index}`, path: `D:\\file-${index}.mp4` })),
      failures: [{ videoId: "failed", path: "D:\\private.mp4" }]
    };
    const summary = summarizeOperationResult(result);
    expect(summary).toEqual({ successCount: 1_000, failureCount: 1 });
    expect(JSON.stringify(summary)).not.toContain("video-999");
    expect(JSON.stringify(summary)).not.toContain("private.mp4");
  });

  it("builds a diagnostics package from a strict whitelist without database or video contents", () => {
    const logger = createLogger();
    logger.warn({
      module: "library.scan",
      event: "scan_failed",
      context: { sourcePath: "D:\\Personal\\private-video.mp4", password: "secret-password" }
    });
    const environment: DiagnosticEnvironment = {
      appVersion: "0.1.0",
      platform: "win32",
      arch: "x64",
      osRelease: "test",
      nodeVersion: "22.23.1",
      electronVersion: "33.4.11",
      nodeModuleVersion: "130",
      schemaVersion: 4,
      packaged: true,
      userDataPath: "C:\\Users\\Private\\AppData\\VideoManager",
      databasePath: "C:\\Users\\Private\\AppData\\VideoManager\\library.sqlite",
      cachePath: "C:\\Users\\Private\\AppData\\VideoManager\\media-cache"
    };
    const preview = buildDiagnosticsPreview(
      environment,
      [{ id: "database.quick_check", status: "ok", detail: "SQLite quick_check: ok" }],
      logger,
      { includeFullPaths: false }
    );
    const serialized = JSON.stringify(buildDiagnosticPackage(preview, logger));

    expect(preview.paths).toBeUndefined();
    expect(preview.exclusions).toContain("database rows or database file");
    expect(serialized).not.toContain("private-video");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("\"videos\"");
    expect(serialized).not.toContain("C:\\\\Users\\\\Private");
    expect(serialized).toContain("database.quick_check");
  });
});

function createLogger(): StructuredLogger {
  return new StructuredLogger(createTemporaryDirectory());
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "video-manager-logging-"));
  temporaryDirectories.push(directory);
  return directory;
}
