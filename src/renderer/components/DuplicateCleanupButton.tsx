import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { DuplicateCleanupAccepted, DuplicateResolvePlan, DuplicateResolvePreviewResult } from "../../shared/videoTypes";

interface Props {
  plan: DuplicateResolvePlan;
  planFileCount: number;
  actionPending: boolean;
  hasGroups: boolean;
  onClearError(): void;
  onSetError(error: string): void;
  onRefresh?(): void;
  onPreviewResolve?(plan: DuplicateResolvePlan): Promise<DuplicateResolvePreviewResult>;
  onSubmitCleanup?(requestId: string, plan: DuplicateResolvePlan): Promise<DuplicateCleanupAccepted>;
  onRequestCleanup?(): void;
  onResolveStart?(): void;
  onResolveEnd?(): void;
}

export function DuplicateCleanupButton({
  plan,
  planFileCount,
  actionPending: parentPending,
  hasGroups,
  onClearError,
  onSetError,
  onRefresh,
  onPreviewResolve,
  onSubmitCleanup,
  onRequestCleanup,
  onResolveStart,
  onResolveEnd
}: Props) {
  const [buttonState, setButtonState] = useState<"idle" | "pressing" | "confirming" | "submitting" | "accepted">("idle");
  const [previewPending, setPreviewPending] = useState(false);
  const [previewElapsedSeconds, setPreviewElapsedSeconds] = useState(0);
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const submitGuardRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    const startedAt = Date.now();
    setPreviewElapsedSeconds(0);
    previewTimerRef.current = setInterval(() => setPreviewElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
  };
  const stopTimer = () => {
    if (previewTimerRef.current) { clearInterval(previewTimerRef.current); previewTimerRef.current = null; }
    setPreviewElapsedSeconds(0);
  };

  const handlePreview = async () => {
    if (parentPending || submitGuardRef.current) return;
    requestIdRef.current ??= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    onClearError();
    onResolveStart?.();

    if (!onSubmitCleanup && onPreviewResolve) {
      setPreviewPending(true);
      startTimer();
      try {
        const result = await onPreviewResolve(plan);
        if (result.status === "stale") {
          onRefresh?.();
          return;
        }
        setButtonState("confirming");
        onRequestCleanup?.();
      } catch (cause) {
        onSetError(toDuplicateActionMessage(cause));
      } finally {
        stopTimer();
        setPreviewPending(false);
        onResolveEnd?.();
      }
      return;
    }
    setButtonState("confirming");
    onRequestCleanup?.();
  };

  const handleSubmit = async () => {
    if (submitGuardRef.current) return;
    submitGuardRef.current = true;
    setButtonState("submitting");
    onClearError();

    try {
      if (onSubmitCleanup) {
        const accepted = await onSubmitCleanup(
          requestIdRef.current ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
          plan
        );
        setAcceptedMessage(`后台任务已创建：${accepted.totalItems} 个文件将安全复查后依次清理。`);
        setButtonState("accepted");
        requestIdRef.current = null;
        window.setTimeout(() => setButtonState("idle"), 1200);
        onRefresh?.();
      }
    } catch (cause) {
      onSetError(toDuplicateActionMessage(cause));
      setButtonState("idle");
    } finally {
      submitGuardRef.current = false;
      onResolveEnd?.();
    }
  };

  return (
    <>
      {acceptedMessage && <div className="success-banner" role="status">{acceptedMessage}</div>}
      <button
        className="danger"
        type="button"
        data-state={buttonState}
        onPointerDown={() => setButtonState("pressing")}
        onPointerLeave={() => buttonState === "pressing" && setButtonState("idle")}
        onClick={() => void handlePreview()}
        disabled={parentPending || !hasGroups}
      >
        {previewPending ? "正在安全复查..." : buttonState === "submitting" ? "正在加入后台清理…" : buttonState === "accepted" ? "已加入后台" : "清理当前页"}
      </button>
      {previewPending && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog duplicate-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-preflight-title">
            <LoaderCircle className="spin" size={30} aria-hidden="true" />
            <h3 id="duplicate-preflight-title">正在安全复查当前页</h3>
            <p>正在并行检查 {planFileCount} 个文件的存在性、大小和修改时间。网盘响应较慢时需要等待，但不会读取视频内容。</p>
            <strong aria-live="polite">已等待 {previewElapsedSeconds} 秒</strong>
          </section>
        </div>
      )}
      {buttonState === "confirming" && !previewPending && onSubmitCleanup && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleCancel(); }}>
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-confirm-title">
            <h3 id="duplicate-confirm-title">确认批量删除重复文件</h3>
            <p>本次将保留 {plan.groups.length} 个文件，计划删除 {plan.groups.reduce((t, g) => t + g.deleteVideoIds.length, 0)} 个文件。未读取或比较视频内容。确认后任务立即进入后台，再逐项复查文件存在性、大小和修改时间；任何异常项都不会被误删。</p>
            <p>文件将从磁盘永久删除且无法撤销，请确认保留项选择无误。</p>
            <div className="dialog-actions">
              <button type="button" onClick={handleCancel}>取消</button>
              <button className="danger" type="button" aria-label="确认删除" onClick={() => void handleSubmit()}>加入后台清理</button>
            </div>
          </section>
        </div>
      )}
    </>
  );

  function handleCancel() {
    setButtonState("idle");
    onResolveEnd?.();
  }
}

function toDuplicateActionMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/Error invoking remote method|duplicate:preview-resolve|duplicate:resolve/i.test(message)) {
    return "重复项检查失败，请刷新重复项后重试。";
  }
  return message;
}
