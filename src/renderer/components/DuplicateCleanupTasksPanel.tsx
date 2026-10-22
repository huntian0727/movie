import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { FolderOpen, LoaderCircle, PauseCircle, PlayCircle, RotateCcw, Trash2, X } from "lucide-react";
import type {
  DuplicateCleanupConfirmRequest, DuplicateCleanupItemPage, DuplicateCleanupJob, DuplicateCleanupJobPage
} from "../../shared/videoTypes";
import { formatBytes, formatDate } from "./formatters";
import { OperationFeedback, ReadState, operationErrorMessage } from "./OperationFeedback";

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
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const [itemsReadVersion, setItemsReadVersion] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const jobRequestRef = useRef(0);
  const actionGuardRef = useRef(false);

  const reload = async () => {
    const request = ++jobRequestRef.current;
    setJobsLoading(true);
    setJobsError(null);
    try {
      const next = await props.loadJobs(page, 20);
      if (request !== jobRequestRef.current) return;
      setJobs(next);
      setSelected((current) => current ? next.items.find((job) => job.id === current.id) ?? null : null);
    } catch (cause) {
      if (request === jobRequestRef.current) setJobsError(toMessage(cause));
    } finally {
      if (request === jobRequestRef.current) setJobsLoading(false);
    }
  };

  useEffect(() => {
    if (!props.open) return;
    void reload();
    return () => { jobRequestRef.current += 1; };
  }, [props.open, page, props.refreshSequence, readVersion]);

  useEffect(() => {
    if (!props.open) return;
    closeButtonRef.current?.focus();
  }, [props.open]);

  useEffect(() => { setItems(null); setItemsError(null); }, [selected?.id]);

  useEffect(() => {
    if (!props.open || !selected) return;
    let disposed = false;
    setItemsLoading(true);
    setItemsError(null);
    void props.loadItems(selected.id, 1, 50).then((next) => { if (!disposed) setItems(next); })
      .catch((cause) => { if (!disposed) setItemsError(toMessage(cause)); })
      .finally(() => { if (!disposed) setItemsLoading(false); });
    return () => { disposed = true; };
  }, [props.open, selected?.id, selected?.updatedAt, props.refreshSequence, itemsReadVersion]);

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
    if (actionGuardRef.current) return false;
    actionGuardRef.current = true;
    setBusy(true); setError(null);
    try { await action(); await reload(); return true; }
    catch (cause) { setError(toMessage(cause)); return false; }
    finally { setBusy(false); actionGuardRef.current = false; }
  };

  const confirmDeletion = async () => {
    if (!selected?.verificationRevision || confirmation !== "DELETE" || !props.onConfirm) return;
    const accepted = await act(() => props.onConfirm!({ jobId: selected.id, verificationRevision: selected.verificationRevision!, confirmation: "DELETE" }));
    if (!accepted) return;
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
        <header><div><h3 id="duplicate-task-title">重复文件清理任务</h3><p>按文件大小与视频时长识别重复项；永久删除仍需单独二次确认。</p></div><button ref={closeButtonRef} type="button" aria-label="关闭任务中心" onClick={closeOuter}><X size={18} /></button></header>
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</p>
        {!confirmOpen && <OperationFeedback message={error} tone="error" onDismiss={() => setError(null)} />}
        <OperationFeedback message={jobsError ? `任务列表读取失败：${jobsError}` : null} tone="error" onRetry={() => setReadVersion((current) => current + 1)} />
        {busy && <LoaderCircle className="spin" size={20} aria-label="处理中" />}
        <div className="duplicate-task-layout">
          <div className="duplicate-task-list">
            <ReadState loading={jobsLoading && !jobs} error={jobsError} empty={Boolean(jobs && jobs.items.length === 0)} loadingText="正在读取清理任务..." emptyTitle="暂无重复文件清理任务" />
            {jobs?.items.map((job) => (
              <button type="button" disabled={busy} className={selected?.id === job.id ? "is-selected" : ""} key={job.id} onClick={() => setSelected(job)}>
                <strong>{phaseLabel(job)} · {progressValue(job)}/{job.totalItems}</strong>
                <span>{formatDate(job.createdAt)} · 已释放 {formatBytes(job.reclaimedBytes)}</span>
                <progress aria-label={`${phaseLabel(job)}进度`} max={Math.max(1, job.totalItems)} value={progressValue(job)} />
              </button>
            ))}
            {jobs && jobs.totalPages > 1 && <div className="pagination-bar"><button disabled={page <= 1 || jobsLoading || busy} onClick={() => setPage(page - 1)}>上一页</button><span>{page}/{jobs.totalPages}</span><button disabled={page >= jobs.totalPages || jobsLoading || busy} onClick={() => setPage(page + 1)}>下一页</button></div>}
          </div>
          <div className="duplicate-task-detail">
            {!selected ? <p>选择任务查看执行结果。</p> : <>
              <h4>{phaseLabel(selected)}</h4>
              {selected.errorSummary && <OperationFeedback message={selected.errorSummary} tone="warning" />}
              <OperationFeedback message={itemsError ? `任务明细读取失败：${itemsError}` : null} tone="error" onRetry={() => setItemsReadVersion((current) => current + 1)} />
              {selected.workflowVersion === 2 && <p>大小/时长一致 {selected.identicalItems} · 不一致 {selected.differentItems} · 无法核对 {selected.unverifiableItems}</p>}
              {selected.workflowVersion === 3 && <p>计划 {selected.totalItems} · 成功 {selected.successItems} · 失败 {selected.failedItems} · 跳过 {selected.skippedItems}</p>}
              {selected.phase === "awaiting_confirmation" && <p role="status">只有文件大小与时长一致的候选项可进入永久删除。其他结果不会删除。</p>}
              {selected.phase === "verification" && ["queued", "running", "cancelling"].includes(selected.status) && <p className="duplicate-task-safety-note">取消核对会等待当前文件状态检查结束；核对阶段不会删除任何文件。</p>}
              {selected.phase === "deletion" && ["queued", "running", "cancelling"].includes(selected.status) && <p className="duplicate-task-safety-note">停止剩余删除只阻止尚未开始的项目；已经完成的永久删除无法撤销。</p>}
              {selected.status === "interrupted" && <p className="duplicate-task-safety-note">{selected.workflowVersion === 3
                ? "旧快速清理任务已暂停，不能恢复或重试。请先停止并清除旧记录，再创建新任务核对大小与时长。"
                : "任务已中断；原删除授权已失效，必须重新核对大小与时长并单独确认永久删除。"}</p>}
              <div className="duplicate-task-actions">
                {selected.phase === "awaiting_confirmation" && props.onConfirm && <button disabled={busy || Boolean(jobsError)} ref={confirmTriggerRef} className="delete-review-action" onClick={() => { setError(null); setConfirmation(""); setConfirmOpen(true); }}>第二次确认永久删除</button>}
                {["queued", "running", "interrupted"].includes(selected.status) && <button disabled={busy} onClick={() => void act(() => props.onCancel(selected.id))}><PauseCircle size={16} />{selected.phase === "deletion" ? "停止剩余删除" : "取消核对"}</button>}
                {selected.status === "interrupted" && selected.workflowVersion !== 3 && <button disabled={busy || Boolean(jobsError)} onClick={() => void act(() => props.onResume(selected.id))}><PlayCircle size={16} />重新核对大小与时长</button>}
                {["completed_with_errors", "cancelled"].includes(selected.status) && selected.phase === "finished" && selected.workflowVersion !== 3 && <button disabled={busy || Boolean(jobsError)} onClick={() => void act(() => props.onRetry(selected.id))}><RotateCcw size={16} />重新核对大小与时长</button>}
                {["completed", "completed_with_errors", "cancelled"].includes(selected.status) && selected.phase !== "awaiting_confirmation" && <button disabled={busy || Boolean(jobsError)} onClick={() => void act(async () => { await props.onClear(selected.id); setSelected(null); setItems(null); })}><Trash2 size={16} />清除记录</button>}
              </div>
              <div className="duplicate-task-items">
                <ReadState loading={itemsLoading && !items} error={itemsError} empty={Boolean(items && items.items.length === 0)} loadingText="正在读取任务明细..." emptyTitle="该任务暂无明细" />
                {items?.items.map((item) => <article key={item.id}><div><strong>{item.filename}</strong><span>{itemResultLabel(item)}</span></div><button aria-label={`打开 ${item.filename} 所在文件夹`} disabled={!props.onOpenItem || busy} onClick={() => void act(() => props.onOpenItem!(item.id))}><FolderOpen size={16} /></button></article>)}
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
            <h3 id="duplicate-delete-confirm-title">确认永久删除大小与时长相同的文件</h3>
            <OperationFeedback message={error} tone="error" />
            <p>任务包含 {selected.totalGroups} 个候选组和最多 {selected.totalGroups} 个计划保留文件；本次只永久删除 {selected.identicalItems} 个按文件大小与时长判定重复的候选项，候选可释放空间上限为 {formatBytes(selected.plannedReclaimableBytes)}。</p>
            <p>注意：本规则不比较视频内容；大小和时长相同不保证内容完全一致。请确认每个候选确实可以删除。</p>
            <p>最终删除前会再次核对文件大小、时长、路径、修改时间与文件身份；任何变化都会阻止删除。此规则不计算视频内容哈希。已经完成的永久删除无法撤销。</p>
            <label>请输入 <strong>DELETE</strong><input ref={confirmInputRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" aria-describedby="duplicate-delete-confirm-help" /></label>
            <small id="duplicate-delete-confirm-help">区分大小写，不忽略空格。</small>
            <div className="dialog-actions"><button type="button" onClick={closeConfirmation} disabled={busy}>取消</button><button className="danger" type="button" onClick={() => void confirmDeletion()} disabled={busy || confirmation !== "DELETE"}>永久删除大小与时长相同项</button></div>
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
  if (job.status === "queued") return "等待执行";
  if (job.workflowVersion === 3 && job.phase === "deletion") return job.status === "cancelling" ? "正在停止旧API删除" : "旧快速API删除已停用";
  if (job.phase === "verification") return job.status === "interrupted" ? "核对已中断" : job.status === "cancelling" ? "正在取消核对" : "正在核对大小与时长";
  if (job.phase === "awaiting_confirmation") return "大小与时长核对完成，等待第二次确认";
  if (job.phase === "deletion") return job.status === "cancelling" ? "正在停止剩余删除" : "正在永久删除已授权项";
  if (job.phase === "legacy_blocked") return "旧任务已安全失效";
  return ({ cancelled: "已取消", completed: "已完成", completed_with_errors: "完成但有异常", interrupted: "已中断", queued: "等待执行", running: "正在执行", cancelling: "正在停止" })[job.status];
}
function verificationLabel(status: DuplicateCleanupItemPage["items"][number]["verificationStatus"]): string {
  return ({ unverified: "未核对", pending: "等待核对", verifying: "正在核对大小与时长", "verified-identical": "大小与时长一致", "content-different": "大小/时长不一致（不删除）", unverifiable: "无法核对（不删除）", cancelled: "核对已取消（不删除）" })[status];
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
    return "未永久删除。旧快速任务没有当前的大小/时长核对授权，已安全停用。请创建新任务重新核对。";
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
    return "未永久删除。文件版本或身份已变化，删除授权已失效。请重新核对大小与时长。";
  }
  if (code === "isolation-failed") {
    return "安全隔离失败；未永久删除。删除授权已失效。请解决文件占用、权限或存储连接问题后重新核对大小与时长。";
  }
  if (code === "delete-stop-requested") {
    return "停止请求已生效；此项未永久删除。删除授权已失效。以后如需清理，请重新核对大小与时长。";
  }
  if (code === "authorization-rejected") {
    return "未永久删除。删除授权已失效。请重新核对大小与时长。";
  }
  if (["failed", "skipped", "cancelled"].includes(item.status)) {
    return "此项未永久删除。删除授权已失效。请检查文件状态后重新核对大小与时长。";
  }
  return verificationLabel(item.verificationStatus);
}
function recoveryRequiredLabel(item: DuplicateCleanupItemPage["items"][number], conclusion: string): string {
  return `${conclusion}。删除授权已失效。请先恢复隔离文件，再重新核对大小与时长。 可恢复文件：${item.stagedDeletePath}`;
}
function trapFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement): void {
  const focusable = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
  if (focusable.length === 0) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function toMessage(cause: unknown): string { return operationErrorMessage(cause); }
