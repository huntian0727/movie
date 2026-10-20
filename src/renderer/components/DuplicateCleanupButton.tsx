import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LoaderCircle } from "lucide-react";
import type { DuplicateCleanupAccepted, DuplicateResolvePlan } from "../../shared/videoTypes";

interface Props {
  plan: DuplicateResolvePlan;
  planFileCount: number;
  actionPending: boolean;
  hasGroups: boolean;
  onClearError(): void;
  onSetError(error: string): void;
  onRefresh?(): void;
  onSubmitCleanup?(requestId: string, plan: DuplicateResolvePlan): Promise<DuplicateCleanupAccepted>;
  onRequestCleanup?(): void;
  onResolveStart?(): void;
  onResolveEnd?(): void;
}

export function DuplicateCleanupButton({
  plan, planFileCount, actionPending: parentPending, hasGroups, onClearError, onSetError,
  onRefresh, onSubmitCleanup, onRequestCleanup, onResolveStart, onResolveEnd
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const submitGuardRef = useRef(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (dialogOpen) cancelRef.current?.focus(); }, [dialogOpen]);

  const close = () => {
    if (submitting) return;
    setDialogOpen(false);
    onResolveEnd?.();
    queueMicrotask(() => openerRef.current?.focus());
  };

  const handleSubmit = async () => {
    if (!onSubmitCleanup || submitGuardRef.current) return;
    submitGuardRef.current = true;
    setSubmitting(true);
    onClearError();
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const accepted = await onSubmitCleanup(requestId, plan);
      setAcceptedMessage(`已开始核对 ${accepted.totalItems} 个候选移除文件及其计划保留文件的大小与时长。核对阶段不读取视频内容、不计算哈希，也不会删除文件。`);
      setDialogOpen(false);
      onRefresh?.();
      queueMicrotask(() => openerRef.current?.focus());
    } catch (cause) {
      onSetError(toMessage(cause));
    } finally {
      submitGuardRef.current = false;
      setSubmitting(false);
      onResolveEnd?.();
    }
  };

  return <>
    {acceptedMessage && <div className="success-banner" role="status">{acceptedMessage}</div>}
    <button ref={openerRef} className="verification-action" type="button" onClick={() => {
      if (parentPending || !hasGroups) return;
      onClearError(); onResolveStart?.(); onRequestCleanup?.(); setDialogOpen(true);
    }} disabled={parentPending || !hasGroups}>验证当前页</button>
    {dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-verification-title" onKeyDown={(event) => {
        if (event.key === "Escape") close();
        if (event.key === "Tab") trapFocus(event, event.currentTarget);
      }}>
        {submitting && <LoaderCircle className="spin" size={24} aria-label="正在启动核对" />}
        <h3 id="duplicate-verification-title">开始核对大小与时长？</h3>
        <p>候选按文件大小完全一致、视频时长四舍五入到整秒后相同来识别。本阶段只核对数据库元数据及文件系统的大小、修改时间、路径和身份，不读取整个视频、不计算内容哈希。</p>
        <p>注意：大小和时长一致不保证视频内容完全相同；不同内容但大小/时长相同的视频也可能被识别为重复项，请逐组检查保留项和候选项。</p>
        <p>核对可取消。文件缺失、离线、大小/时长不一致或文件状态变化时不会删除任何文件。核对完成后仍需检查保留/删除计划，并单独进行第二次永久删除确认。</p>
        <p>本次将核对 {planFileCount} 个文件，覆盖 {plan.groups.length} 组候选。</p>
        <div className="dialog-actions"><button ref={cancelRef} type="button" onClick={close} disabled={submitting}>取消</button><button className="verification-primary" type="button" onClick={() => void handleSubmit()} disabled={submitting}>开始核对</button></div>
      </section>
    </div>}
  </>;
}

function trapFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement): void {
  const focusable = [...container.querySelectorAll<HTMLElement>('button:not([disabled])')];
  if (focusable.length === 0) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function toMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
