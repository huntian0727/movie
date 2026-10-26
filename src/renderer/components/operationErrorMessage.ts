/** Strip Electron's transport wrapper while preserving the backend's actual refusal message. */
export function operationErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "操作失败，请稍后重试";
  return raw.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "").replace(/^Error:\s*/i, "").trim() || "操作失败，请稍后重试";
}
