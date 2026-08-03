import { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle, PauseCircle, PlayCircle, RotateCcw, Trash2, X } from "lucide-react";
import type { DuplicateCleanupItemPage, DuplicateCleanupJob, DuplicateCleanupJobPage } from "../../shared/videoTypes";
import { formatBytes, formatDate } from "./formatters";

interface Props {
  open: boolean;
  onClose(): void;
  loadJobs(page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupJobPage>;
  loadItems(jobId: string, page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupItemPage>;
  onCancel(jobId: string): Promise<DuplicateCleanupJob>;
  onResume(jobId: string): Promise<DuplicateCleanupJob>;
  onRetry(jobId: string): Promise<DuplicateCleanupJob>;
  onClear(jobId: string): Promise<boolean>;
  onOpenItem?(itemId: string): Promise<boolean>;
  refreshSequence?: number;
}

export function DuplicateCleanupTasksPanel(props: Props) {
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState<DuplicateCleanupJobPage | null>(null);
  const [selected, setSelected] = useState<DuplicateCleanupJob | null>(null);
  const [items, setItems] = useState<DuplicateCleanupItemPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const next = await props.loadJobs(page, 20);
    setJobs(next);
    setSelected((current) => current ? next.items.find((job) => job.id === current.id) ?? null : null);
  };

  useEffect(() => {
    if (!props.open) return;
    void reload().catch((cause) => setError(toMessage(cause)));
  }, [props.open, page, props.refreshSequence]);

  useEffect(() => {
    if (!props.open || !selected) return;
    void props.loadItems(selected.id, 1, 50).then(setItems).catch((cause) => setError(toMessage(cause)));
  }, [props.open, selected?.id, props.refreshSequence]);

  if (!props.open) return null;

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await reload(); }
    catch (cause) { setError(toMessage(cause)); }
    finally { setBusy(false); }
  };

  return (
    <div className="dialog-backdrop task-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="dialog duplicate-task-center" role="dialog" aria-modal="true" aria-label="后台清理任务">
        <header><div><h3>后台清理任务</h3><p>关闭窗口不会停止已经提交的安全清理。</p></div><button type="button" aria-label="关闭后台任务" onClick={props.onClose}><X size={18} /></button></header>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {busy && <LoaderCircle className="spin" size={20} />}
        <div className="duplicate-task-layout">
          <div className="duplicate-task-list">
            {jobs?.items.map((job) => (
              <button type="button" className={selected?.id === job.id ? "is-selected" : ""} key={job.id} onClick={() => setSelected(job)}>
                <strong>{statusLabel(job.status)} · {job.processedItems}/{job.totalItems}</strong>
                <span>{formatDate(job.createdAt)} · 已释放 {formatBytes(job.reclaimedBytes)}</span>
                <progress max={Math.max(1, job.totalItems)} value={job.processedItems} />
              </button>
            ))}
            {jobs?.items.length === 0 && <p>暂无后台清理任务</p>}
            {jobs && jobs.totalPages > 1 && <div className="pagination-bar"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page}/{jobs.totalPages}</span><button disabled={page >= jobs.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>}
          </div>
          <div className="duplicate-task-detail">
            {!selected ? <p>选择任务查看逐项结果。</p> : <>
              <h4>{statusLabel(selected.status)}</h4>
              <p>成功 {selected.successItems} · 失败 {selected.failedItems} · 跳过 {selected.skippedItems}</p>
              <div className="duplicate-task-actions">
                {["queued", "running", "interrupted"].includes(selected.status) && <button onClick={() => void act(() => props.onCancel(selected.id))}><PauseCircle size={16} />取消</button>}
                {selected.status === "interrupted" && <button onClick={() => void act(() => props.onResume(selected.id))}><PlayCircle size={16} />恢复</button>}
                {["completed_with_errors", "cancelled"].includes(selected.status) && <button onClick={() => void act(() => props.onRetry(selected.id))}><RotateCcw size={16} />重试失败项</button>}
                {["completed", "completed_with_errors", "cancelled"].includes(selected.status) && <button onClick={() => void act(async () => { await props.onClear(selected.id); setSelected(null); setItems(null); })}><Trash2 size={16} />清除记录</button>}
              </div>
              <div className="duplicate-task-items">
                {items?.items.map((item) => <article key={item.id}><div><strong>{item.filename}</strong><span>{item.status}{item.message ? ` · ${item.message}` : ""}</span></div><button aria-label={`打开 ${item.filename} 所在文件夹`} onClick={() => void props.onOpenItem?.(item.id)}><FolderOpen size={16} /></button></article>)}
              </div>
            </>}
          </div>
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: DuplicateCleanupJob["status"]): string {
  return ({ queued: "等待执行", running: "正在清理", cancelling: "正在取消", cancelled: "已取消", completed: "已完成", completed_with_errors: "完成但有异常", interrupted: "已中断，等待恢复" })[status];
}
function toMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
