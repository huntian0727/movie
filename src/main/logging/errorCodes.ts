import type { StableErrorCode } from "./types.js";

export function classifyError(error: unknown): StableErrorCode {
  const chain = readErrorChain(error);
  const code = chain.map((item) => item.code).join(" ").toUpperCase();
  const name = chain.map((item) => item.name).join(" ").toLowerCase();
  const message = chain.map((item) => item.message).join(" ").toLowerCase();

  if (message.includes("node_module_version") || message.includes("module version") || message.includes("was compiled against a different node")) {
    return "NATIVE_ABI_MISMATCH";
  }
  if (name === "databasemigrationerror" || message.includes("database migration") || message.includes("schema validation")) {
    return "DB_MIGRATION_FAILED";
  }
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || message.includes("database is locked")) {
    return "DB_LOCKED";
  }
  if (
    code === "ENETUNREACH" ||
    code === "ENETDOWN" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    message.includes("network path was not found") ||
    message.includes("offline")
  ) {
    return "OFFLINE";
  }
  if (code === "EBUSY" || code === "ETXTBSY" || code === "EPERM" || message.includes("file is being used")) {
    return "FILE_LOCKED";
  }
  if (code === "EACCES" || code === "EROFS" || message.includes("permission denied") || message.includes("access is denied")) {
    return "PERMISSION_DENIED";
  }
  if (code === "ENOSPC" || code === "SQLITE_FULL" || message.includes("disk full") || message.includes("no space left")) {
    return "DISK_FULL";
  }
  if (name === "zoderror" || code === "ERR_INVALID_ARG_VALUE" || message.includes("validation failed")) {
    return "VALIDATION_FAILED";
  }
  if (
    (message.includes("ffprobe") && (message.includes("timeout") || message.includes("timed out"))) ||
    (message.includes("unable to read metadata") && (message.includes("timeout") || message.includes("timed out"))) ||
    code === "FFPROBE_TIMEOUT"
  ) {
    return "FFPROBE_TIMEOUT";
  }
  return "UNKNOWN";
}

function readCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function readErrorChain(error: unknown): Array<{ code: string; name: string; message: string }> {
  const result: Array<{ code: string; name: string; message: string }> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    result.push({
      code: readCode(current),
      name: current instanceof Error ? current.name : "",
      message: current instanceof Error ? current.message : String(current)
    });
    current = current instanceof Error ? current.cause : undefined;
  }
  return result;
}
