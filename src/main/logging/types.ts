export type LogLevel = "debug" | "info" | "warn" | "error";

export type StableErrorCode =
  | "NATIVE_ABI_MISMATCH"
  | "DB_MIGRATION_FAILED"
  | "DB_LOCKED"
  | "OFFLINE"
  | "FILE_LOCKED"
  | "PERMISSION_DENIED"
  | "DISK_FULL"
  | "VALIDATION_FAILED"
  | "FFPROBE_TIMEOUT"
  | "UNKNOWN";

export interface StructuredLogEvent {
  timestamp: string;
  level: LogLevel;
  module: string;
  operationId: string;
  event: string;
  durationMs?: number;
  errorCode?: StableErrorCode;
  message?: string;
  context?: Record<string, unknown>;
}

export interface LogEventInput {
  level: LogLevel;
  module: string;
  operationId?: string;
  event: string;
  durationMs?: number;
  errorCode?: StableErrorCode;
  message?: string;
  context?: Record<string, unknown>;
}

export interface DiagnosticCheck {
  id: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface DiagnosticEnvironment {
  appVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  nodeVersion: string;
  electronVersion: string;
  nodeModuleVersion: string;
  schemaVersion: number;
  packaged: boolean;
  userDataPath: string;
  databasePath: string;
  cachePath: string;
}
