import { createHash } from "node:crypto";
import path from "node:path";

const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|credential|api[-_]?key|environment|envValue)/i;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\r\n)",]+/g;
const UNC_PATH = /\\\\[^\\\r\n]+\\[^\r\n)",]+/g;
const POSIX_HOME_PATH = /\/(?:Users|home)\/[^\r\n)",]+/g;
const MAX_STRING_LENGTH = 4_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 6;

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function redactPath(value: string): string {
  const extension = path.extname(value).toLowerCase();
  const drive = value.startsWith("\\\\") ? "network" : /^[A-Za-z]:\\/.test(value) ? "local" : "posix";
  return `<path drive=${drive} ext=${extension || "none"} id=${hashIdentifier(value.toLowerCase())}>`;
}

export function redactString(value: string): string {
  const bounded = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…<truncated>` : value;
  if (path.win32.isAbsolute(bounded) || path.posix.isAbsolute(bounded)) {
    return redactPath(bounded);
  }
  return bounded
    .replace(UNC_PATH, (match) => redactPath(match))
    .replace(WINDOWS_PATH, (match) => redactPath(match))
    .replace(POSIX_HOME_PATH, (match) => redactPath(match))
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1<redacted>");
}

export function sanitizeForLog(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "<redacted>";
  if (depth > MAX_DEPTH) return "<max-depth>";
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    const errorCode = "code" in value && typeof value.code === "string" ? value.code : undefined;
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
      code: errorCode
    };
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, key, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`<${value.length - MAX_ARRAY_ITEMS} more items>`);
    return items;
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeForLog(childValue, childKey, depth + 1)
      ])
    );
  }
  return String(value);
}
