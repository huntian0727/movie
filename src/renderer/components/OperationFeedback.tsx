import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";

/** Read retries must never resubmit an operation that can change files. */
export function OperationFeedback({ message, tone = "success", onDismiss, onRetry, retryLabel = "重新读取", autoDismiss = false }: {
  message: string | null;
  tone?: "success" | "info" | "warning" | "error";
  onDismiss?(): void;
  onRetry?(): void;
  retryLabel?: string;
  autoDismiss?: boolean;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!message || !autoDismiss || tone !== "success" || !onDismiss) return;
    const timer = window.setTimeout(() => dismissRef.current?.(), 8_000);
    return () => window.clearTimeout(timer);
  }, [autoDismiss, message, Boolean(onDismiss), tone]);
  if (!message) return null;
  const Icon = tone === "error" || tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return <div className={`operation-feedback operation-feedback-${tone}`} role={tone === "error" ? "alert" : "status"}>
    <Icon size={17} aria-hidden="true" /><span>{message}</span>
    {onRetry && <button type="button" onClick={onRetry}>{retryLabel}</button>}
    {onDismiss && <button type="button" className="operation-feedback-close" aria-label="关闭提示" onClick={onDismiss}><X size={16} /></button>}
  </div>;
}

export function ReadState({ loading, error, empty, loadingText, emptyTitle, emptyText, onRetry }: {
  loading: boolean;
  error?: string | null;
  empty: boolean;
  loadingText: string;
  emptyTitle: string;
  emptyText?: string;
  onRetry?(): void;
}) {
  if (loading) return <div className="read-state" role="status"><LoaderCircle className="spin" size={24} /><strong>{loadingText}</strong></div>;
  // An unread result is not an empty result. The contextual error banner owns retry.
  if (error || !empty) return null;
  return <div className="read-state"><Info size={28} /><strong>{emptyTitle}</strong>{emptyText && <span>{emptyText}</span>}{onRetry && <button type="button" onClick={onRetry}>重新读取</button>}</div>;
}

export function operationErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "操作失败，请稍后重试";
  // Keep the actual backend refusal (including deletion safety rules), not Electron's wrapper.
  return raw.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "").replace(/^Error:\s*/i, "").trim() || "操作失败，请稍后重试";
}
