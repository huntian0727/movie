import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { FolderOpen, LoaderCircle, PauseCircle, PlayCircle, RotateCcw, Trash2, X } from "lucide-react";
import type {
  DuplicateCleanupConfirmRequest, DuplicateCleanupItemPage, DuplicateCleanupJob, DuplicateCleanupJobPage
} from "../../shared/videoTypes";
import { formatBytes, formatDate } from "./formatters";

interface Props {
  open: boolean;
  onClose(): void;
  loadJobs(page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupJobPage>;
  loadItems(jobId: string, page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupItemPage>;
  onConfirm?(request: DuplicateCleanupConfirmRequest): Promise<DuplicateCleanupJob>;
  onCancel(jobId: string): Promise<DuplicateCleanupJob>;
  onResume(jobId: string): Promise<DuplicateCleanupJob>;
  onRetry(jobId: string): Promise<DuplicateCleanupJob>;
  onClear(jobId: string): Promise<boolean>;
  onOpenItem?(itemId: string): Promise<boolean>;
  refreshSequence?: number;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function DuplicateCleanupTasksPanel(props: Props) {
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState<DuplicateCleanupJobPage | null>(null);
  const [selected, setSelected] = useState<DuplicateCleanupJob | null>(null);
  const [items, setItems] = useState<DuplicateCleanupItemPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);

  const reload = async () => {
    const next = await props.loadJobs(page, 20);
    setJobs(next);
    setSelected((current) => current ? next.items.find((job) => job.id === current.id) ?? null : null);
  };

  useEffect(() => {
    if (!props.open) return;
    closeButtonRef.current?.focus();
    void reload().catch((cause) => setError(toMessage(cause)));
  }, [props.open, page, props.refreshSequence]);

  useEffect(() => {
    if (!props.open || !selected) return;
    void props.loadItems(selected.id, 1, 50).then(setItems).catch((cause) => setError(toMessage(cause)));
  }, [props.open, selected?.id, selected?.updatedAt, props.refreshSequence]);

  useEffect(() => {
    if (confirmOpen) confirmInputRef.current?.focus();
  }, [confirmOpen]);

  useEffect(() => {
    if (!selected) { setLiveMessage(""); return; }
    const timer = setTimeout(() => {
      setLiveMessage(`${phaseLabel(selected)}，已处理 ${progressValue(selected)} / ${selected.totalItems} 项。`);
    }, 500);
    return () => clearTimeout(timer);
  }, [selected?.id, selected?.status, selected?.phase, selected?.updatedAt]);

  if (!props.open) return null;

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await reload(); }
    catch (cause) { setError(toMessage(cause)); }
    finally { setBusy(false); }
  };

  const confirmDeletion = async () => {
    if (!selected?.verificationRevision || confirmation !== "DELETE" || !props.onConfirm) return;
    await act(() => props.onConfirm!({ jobId: selected.id, verificationRevision: selected.verificationRevision!, confirmation: "DELETE" }));
    setConfirmation("");
    setConfirmOpen(false);
    queueMicrotask(() => closeButtonRef.current?.focus());
  };

  const closeConfirmation = () => {
    if (busy) return;
    setConfirmation("");
    setConfirmOpen(false);
    queueMicrotask(() => confirmTriggerRef.current?.focus());
  };

  const closeOuter = () => {
    if (busy || confirmOpen) return;
    props.onClose();
    queueMicrotask(() => props.returnFocusRef?.current?.focus());
  };

  return (
    <div className="dialog-backdrop task-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOuter(); }}>
      <section className="dialog duplicate-task-center" role="dialog" aria-modal="true" aria-labelledby="duplicate-task-title" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy && !confirmOpen) closeOuter();
        if (event.key === "Tab" && !confirmOpen) trapFocus(event, event.currentTarget);
      }}>
        <header><div><h3 id="duplicate-task-title">重复文件清理任务</h3><p>API快速任务不会读取视频内容；历史安全任务仍按原流程显示。</p></div><button ref={closeButtonRef} type="button" aria-label="关闭任务中心" onClick={closeOuter}><X size={18} /></button></header>
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {busy && <LoaderCircle className="spin" size={20} aria-label="处理中" />}
        <div className="duplicate-task-layout">
          <div className="duplicate-task-list">
            {jobs?.items.map((job) => (
              <button type="button" className={selected?.id === job.id ? "is-selected" : ""} key={job.id} onClick={() => setSelected(job)}>
                <strong>{phaseLabel(job)} · {progressValue(job)}/{job.totalItems}</strong>
                <span>{formatDate(job.createdAt)} · 已释放 {formatBytes(job.reclaimedBytes)}</span>
                <progress aria-label={`${phaseLabel(job)}进度`} max={Math.max(1, job.totalItems)} value={progressValue(job)} />
              </button>
            ))}
            {jobs?.items.length === 0 && <p>暂无重复文件清理任务</p>}
            {jobs && jobs.totalPages > 1 && <div className="pagination-bar"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page}/{jobs.totalPages}</span><button disabled={page >= jobs.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>}
          </div>
          <div className="duplicate-task-detail">
            {!selected ? <p>选择任务查看执行结果。</p> : <>
              <h4>{phaseLabel(selected)}</h4>
              {selected.workflowVersion === 2 && <p>相同 {selected.identicalItems} · 不同 {selected.differentItems} · 无法验证 {selected.unverifiableItems}</p>}
              {selected.workflowVersion === 3 && <p>计划 {selected.totalItems} · 成功 {selected.successItems} · 失败 {selected.failedItems} · 跳过 {selected.skippedItems}</p>}
              {selected.phase === "awaiting_confirmation" && <p role="status">只有“完整哈希相同”的文件可进入永久删除。其他结果不会删除。</p>}
              {selected.phase === "verification" && ["queued", "running", "cancelling"].includes(selected.status) && <p className="duplicate-task-safety-note">取消验证会等待当前读取安全停止；验证阶段不会删除任何文件。</p>}
              {selected.phase === "deletion" && ["queued", "running", "cancelling"].includes(selected.status) && <p className="duplicate-task-safety-note">停止剩余删除只阻止尚未开始的项目；已经完成的永久删除无法撤销。</p>}
              {selected.status === "interrupted" && <p className="duplicate-task-safety-note">任务已中断；可以从尚未完成的 API删除项继续。</p>}
              <div className="duplicate-task-actions">
                {selected.phase === "awaiting_confirmation" && props.onConfirm && <button ref={confirmTriggerRef} className="delete-review-action" onClick={() => { setConfirmation(""); setConfirmOpen(true); }}>第二次确认永久删除</button>}
                {["queued", "running", "interrupted"].includes(selected.status) && <button onClick={() => void act(() => props.onCancel(selected.id))}><PauseCircle size={16} />{selected.phase === "deletion" ? "停止剩余删除" : "取消验证"}</button>}
                {selected.status === "interrupted" && <button onClick={() => void act(() => props.onResume(selected.id))}><PlayCircle size={16} />{selected.workflowVersion === 3 ? "继续API删除" : "重新完整验证"}</button>}
                {["completed_with_errors", "cancelled"].includes(selected.status) && selected.phase === "finished" && <button onClick={() => void act(() => props.onRetry(selected.id))}><RotateCcw size={16} />{selected.workflowVersion === 3 ? "重试失败项" : "重新完整验证"}</button>}
                {["completed", "completed_with_errors", "cancelled"].includes(selected.status) && selected.phase !== "awaiting_confirmation" && <button onClick={() => void act(async () => { await props.onClear(selected.id); setSelected(null); setItems(null); })}><Trash2 size={16} />清除记录</button>}
              </div>
              <div className="duplicate-task-items">
                {items?.items.map((item) => <article key={item.id}><div><strong>{item.filename}</strong><span>{itemResultLabel(item)}</span></div><button aria-label={`打开 ${item.filename} 所在文件夹`} onClick={() => void props.onOpenItem?.(item.id)}><FolderOpen size={16} /></button></article>)}
              </div>
            </>}
          </div>
        </div>
      </section>
      {confirmOpen && selected && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmation(); }}>
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-delete-confirm-title" onKeyDown={(event) => {
            if (event.key === "Escape") closeConfirmation();
            if (event.key === "Tab") trapFocus(event, event.currentTarget);
          }}>
            <h3 id="duplicate-delete-confirm-title">确认永久删除已验证相同的文件</h3>
            <p>任务包含 {selected.totalGroups} 个候选组和最多 {selected.totalGroups} 个计划保留文件；本次只永久删除 {selected.identicalItems} 个经完整 SHA-256 验证相同的候选移除项，候选可释放空间上限为 {formatBytes(selected.plannedReclaimableBytes)}。</p>
            <p>最终删除前会再次完整核验哈希、强文件身份、大小和修改时间；任何变化都会阻止删除。已经完成的永久删除无法撤销。</p>
            <label>请输入 <strong>DELETE</strong><input ref={confirmInputRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" aria-describedby="duplicate-delete-confirm-help" /></label>
            <small id="duplicate-delete-confirm-help">区分大小写，不忽略空格。</small>
            <div className="dialog-actions"><button type="button" onClick={closeConfirmation} disabled={busy}>取消</button><button className="danger" type="button" onClick={() => void confirmDeletion()} disabled={busy || confirmation !== "DELETE"}>永久删除已验证相同项</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function progressValue(job: DuplicateCleanupJob): number {
  return job.phase === "verification" || job.phase === "awaiting_confirmation" ? job.verificationProcessedItems : job.processedItems;
}
function phaseLabel(job: DuplicateCleanupJob): string {
  if (job.workflowVersion === 3 && job.phase === "deletion") return job.status === "cancelling" ? "正在停止API删除" : "正在通过CloudDrive API删除";
  if (job.phase === "verification") return job.status === "interrupted" ? "验证已中断" : job.status === "cancelling" ? "正在取消验证" : "正在完整验证";
  if (job.phase === "awaiting_confirmation") return "验证完成，等待第二次确认";
  if (job.phase === "deletion") return job.status === "cancelling" ? "正在停止剩余删除" : "正在永久删除已授权项";
  if (job.phase === "legacy_blocked") return "旧任务已安全失效";
  return ({ cancelled: "已取消", completed: "已完成", completed_with_errors: "完成但有异常", interrupted: "已中断", queued: "等待执行", running: "正在执行", cancelling: "正在停止" })[job.status];
}
function verificationLabel(status: DuplicateCleanupItemPage["items"][number]["verificationStatus"]): string {
  return ({ unverified: "未验证", pending: "等待验证", verifying: "正在完整验证", "verified-identical": "完整哈希相同", "content-different": "内容不同（不删除）", unverifiable: "无法验证（不删除）", cancelled: "验证已取消（不删除）" })[status];
}
function itemResultLabel(item: DuplicateCleanupItemPage["items"][number]): string {
  const code = item.outcomeCode ?? "";
  if (code === "deleted-via-clouddrive-api") return "已通过CloudDrive API永久删除。";
  if (code === "already-missing") return "远端文件已不存在，本地索引已清理。";
  if (code === "provider-identity-changed") return "远端身份或缓存版本已变化，本次已跳过。";
  if (code === "clouddrive-api-delete-failed") return item.message || "CloudDrive API删除失败，可重试。";
  if (item.status === "deleted" || code === "deleted") return "已永久删除。";
  if (["content-different", "unverifiable", "cancelled"].includes(code)) return verificationLabel(item.verificationStatus);
  if (code === "legacy-safety-blocked") {
    return "未永久删除。旧任务没有完整 SHA-256 删除授权，授权已安全失效。请创建新任务并重新完整验证。";
  }
  if (item.stagedDeletePath) {
    if (code === "delete-stop-requested") {
      return recoveryRequiredLabel(item, "停止请求已生效；此项未永久删除");
    }
    if (code === "isolation-recovery-required") {
      return recoveryRequiredLabel(item, "隔离恢复未完成；此项未永久删除");
    }
    return recoveryRequiredLabel(item, "此项未永久删除，隔离文件尚未恢复");
  }
  if (["final-keep-integrity-changed", "final-delete-integrity-changed", "isolated-target-mismatch", "final-version-changed"].includes(code)) {
    return "未永久删除。文件版本或身份已变化，删除授权已失效。请重新完整验证。";
  }
  if (code === "isolation-failed") {
    return "安全隔离失败；未永久删除。删除授权已失效。请解决文件占用、权限或存储连接问题后重新完整验证。";
  }
  if (code === "delete-stop-requested") {
    return "停止请求已生效；此项未永久删除。删除授权已失效。以后如需清理，请重新完整验证。";
  }
  if (code === "authorization-rejected") {
    return "未永久删除。删除授权已失效。请重新完整验证。";
  }
  if (["failed", "skipped", "cancelled"].includes(item.status)) {
    return "此项未永久删除。删除授权已失效。请检查文件状态后重新完整验证。";
  }
  return verificationLabel(item.verificationStatus);
}
function recoveryRequiredLabel(item: DuplicateCleanupItemPage["items"][number], conclusion: string): string {
  return `${conclusion}。删除授权已失效。请先恢复隔离文件，再重新完整验证。 可恢复文件：${item.stagedDeletePath}`;
}
function trapFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement): void {
  const focusable = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
  if (focusable.length === 0) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function toMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
