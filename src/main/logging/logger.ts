import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from "node:fs";
import path from "node:path";
import { classifyError } from "./errorCodes.js";
import { sanitizeForLog } from "./redaction.js";
import type { LogEventInput, LogLevel, StructuredLogEvent } from "./types.js";

export interface LoggerOptions {
  maxFileBytes?: number;
  maxFiles?: number;
  retentionDays?: number;
  now?: () => Date;
}

export class StructuredLogger {
  readonly directory: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly retentionDays: number;
  private readonly now: () => Date;
  private lastFailureCode: string | null = null;

  constructor(directory: string, options: LoggerOptions = {}) {
    this.directory = directory;
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
    this.maxFiles = Math.max(2, options.maxFiles ?? 5);
    this.retentionDays = options.retentionDays ?? 14;
    this.now = options.now ?? (() => new Date());
    try {
      mkdirSync(directory, { recursive: true });
      this.pruneExpired();
    } catch (error) {
      this.recordWriteFailure(error);
    }
  }

  createOperationId(): string {
    return randomUUID();
  }

  debug(input: Omit<LogEventInput, "level">): void {
    this.write({ ...input, level: "debug" });
  }

  info(input: Omit<LogEventInput, "level">): void {
    this.write({ ...input, level: "info" });
  }

  warn(input: Omit<LogEventInput, "level">): void {
    this.write({ ...input, level: "warn" });
  }

  error(input: Omit<LogEventInput, "level" | "errorCode"> & { error?: unknown }): void {
    const { error, ...event } = input;
    this.write({
      ...event,
      level: "error",
      errorCode: classifyError(error),
      context: {
        ...event.context,
        error
      }
    });
  }

  write(input: LogEventInput): void {
    const event: StructuredLogEvent = {
      timestamp: this.now().toISOString(),
      level: input.level,
      module: normalizeLabel(input.module),
      operationId: input.operationId ?? this.createOperationId(),
      event: normalizeLabel(input.event),
      ...(input.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(input.durationMs)) }),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.message ? { message: String(sanitizeForLog(input.message)) } : {}),
      ...(input.context ? { context: sanitizeForLog(input.context) as Record<string, unknown> } : {})
    };
    const line = `${JSON.stringify(event)}\n`;
    try {
      mkdirSync(this.directory, { recursive: true });
      this.rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(this.activePath(), line, "utf8");
      this.lastFailureCode = null;
    } catch (error) {
      this.recordWriteFailure(error);
    }
  }

  isWritable(): boolean {
    return this.lastFailureCode === null;
  }

  getLastFailureCode(): string | null {
    return this.lastFailureCode;
  }

  listLogFiles(): string[] {
    try {
      if (!existsSync(this.directory)) return [];
      return readdirSync(this.directory)
        .filter((filename) => /^app(?:\.\d+)?\.jsonl$/.test(filename))
        .sort((left, right) => logIndex(left) - logIndex(right))
        .map((filename) => path.join(this.directory, filename));
    } catch {
      return [];
    }
  }

  readEntries(maxEntries = 5_000): StructuredLogEvent[] {
    const entries: StructuredLogEvent[] = [];
    for (const filePath of this.listLogFiles().reverse()) {
      let lines: string[];
      try {
        lines = readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
      } catch {
        continue;
      }
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as StructuredLogEvent);
        } catch {
          // A partially written last line is ignored; prior valid events remain exportable.
        }
      }
    }
    return entries.slice(-maxEntries);
  }

  private activePath(): string {
    return path.join(this.directory, "app.jsonl");
  }

  private rotateIfNeeded(incomingBytes: number): void {
    const active = this.activePath();
    if (!existsSync(active) || statSync(active).size + incomingBytes <= this.maxFileBytes) return;
    const oldest = path.join(this.directory, `app.${this.maxFiles - 1}.jsonl`);
    rmSync(oldest, { force: true });
    for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
      const source = path.join(this.directory, `app.${index}.jsonl`);
      if (existsSync(source)) renameSync(source, path.join(this.directory, `app.${index + 1}.jsonl`));
    }
    renameSync(active, path.join(this.directory, "app.1.jsonl"));
  }

  private pruneExpired(): void {
    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const filePath of this.listLogFiles()) {
      if (statSync(filePath).mtimeMs < cutoff) rmSync(filePath, { force: true });
    }
  }

  private recordWriteFailure(error: unknown): void {
    this.lastFailureCode = classifyError(error);
    console.error("[logging] structured log unavailable", { errorCode: this.lastFailureCode });
  }
}

export function summarizeOperationResult(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null) return { resultType: typeof result };
  const source = result as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of [
    "successCount", "failureCount", "totalCount", "groupCount", "keepCount", "removedCount",
    "reclaimedBytes", "directCount", "renameCount", "skipCount", "canceled"
  ]) {
    if (typeof source[key] === "number" || typeof source[key] === "boolean") summary[key] = source[key];
  }
  if (Array.isArray(source.failures)) summary.failureCount = source.failures.length;
  return Object.keys(summary).length > 0 ? summary : { resultType: "object" };
}

export function shouldLogLevel(candidate: LogLevel, minimum: LogLevel): boolean {
  return ["debug", "info", "warn", "error"].indexOf(candidate) >= ["debug", "info", "warn", "error"].indexOf(minimum);
}

function normalizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 100) || "unknown";
}

function logIndex(filename: string): number {
  const match = /^app(?:\.(\d+))?\.jsonl$/.exec(filename);
  return match?.[1] ? Number(match[1]) : 0;
}
