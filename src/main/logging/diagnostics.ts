import os from "node:os";
import type { DatabaseConnection } from "../db/database.js";
import type { DiagnosticsPreview } from "../../shared/videoTypes.js";
import { sanitizeForLog } from "./redaction.js";
import type { DiagnosticCheck, DiagnosticEnvironment, StructuredLogEvent } from "./types.js";
import type { StructuredLogger } from "./logger.js";

export interface DiagnosticBuildOptions {
  includeFullPaths: boolean;
}

export function readSchemaVersion(db: DatabaseConnection): number {
  return Number(db.pragma("user_version", { simple: true }));
}

export function runDiagnosticChecks(db: DatabaseConnection, logger: StructuredLogger): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  try {
    const quickCheck = db.pragma("quick_check") as Array<Record<string, string>>;
    checks.push({
      id: "database.quick_check",
      status: quickCheck.length === 1 && Object.values(quickCheck[0] ?? {})[0] === "ok" ? "ok" : "error",
      detail: quickCheck.length === 1 && Object.values(quickCheck[0] ?? {})[0] === "ok" ? "SQLite quick_check: ok" : "SQLite quick_check reported a problem"
    });
  } catch {
    checks.push({ id: "database.quick_check", status: "error", detail: "SQLite quick_check could not run" });
  }
  checks.push({
    id: "logging.writable",
    status: logger.isWritable() ? "ok" : "error",
    detail: logger.isWritable()
      ? `Structured logging active; ${logger.listLogFiles().length} log file(s)`
      : `Structured logging unavailable (${logger.getLastFailureCode() ?? "UNKNOWN"})`
  });
  return checks;
}

export function buildDiagnosticsPreview(
  environment: DiagnosticEnvironment,
  checks: DiagnosticCheck[],
  logger: StructuredLogger,
  options: DiagnosticBuildOptions
): DiagnosticsPreview {
  return {
    generatedAt: new Date().toISOString(),
    includeFullPaths: options.includeFullPaths,
    contents: [
      "application/runtime version",
      "OS and native ABI",
      "schema version",
      "diagnostic checks",
      "redacted structured logs"
    ],
    environment: {
      appVersion: environment.appVersion,
      platform: environment.platform,
      arch: environment.arch,
      osRelease: environment.osRelease,
      nodeVersion: environment.nodeVersion,
      electronVersion: environment.electronVersion,
      nodeModuleVersion: environment.nodeModuleVersion,
      schemaVersion: environment.schemaVersion,
      packaged: environment.packaged
    },
    checks,
    logEntryCount: logger.readEntries().length,
    paths: options.includeFullPaths
      ? {
          userData: environment.userDataPath,
          database: environment.databasePath,
          cache: environment.cachePath,
          logs: logger.directory
        }
      : undefined,
    exclusions: [
      "video files",
      "video filenames and source paths",
      "database rows or database file",
      "tokens, passwords and environment variable values"
    ]
  };
}

export function buildDiagnosticPackage(
  preview: DiagnosticsPreview,
  logger: StructuredLogger
): Record<string, unknown> {
  return {
    format: "local-video-manager-diagnostics",
    version: 1,
    preview,
    logs: logger.readEntries().map(whitelistLogEntry)
  };
}

export function createDiagnosticEnvironment(input: Omit<DiagnosticEnvironment, "osRelease">): DiagnosticEnvironment {
  return { ...input, osRelease: os.release() };
}

function whitelistLogEntry(event: StructuredLogEvent): StructuredLogEvent {
  return {
    timestamp: event.timestamp,
    level: event.level,
    module: event.module,
    operationId: event.operationId,
    event: event.event,
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.message ? { message: String(sanitizeForLog(event.message)) } : {}),
    ...(event.context ? { context: sanitizeForLog(event.context) as Record<string, unknown> } : {})
  };
}
