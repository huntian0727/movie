import { useState } from "react";
import type { ReviewedDeleteBackgroundJob } from "../../shared/videoTypes";
import { formatBytes } from "./formatters";

export function ReviewedBackgroundStatus({ job }: { job: ReviewedDeleteBackgroundJob | null }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The main process retains completed checkpoints for safety; a successful
  // historical task is not an active notification and must not occupy the UI.
  if (!job || job.status === "completed") return null;
  const active = job.status === "running" || job.status === "queued";
  const label = job.status === "queued" ? "重复文件清理任务排队中"
    : active ? "重复文件后台清理中"
    : job.status === "partial" ? "重复文件清理部分失败"
    : job.status === "blocked" ? "重复文件后台清理已停止"
    : "上次重复文件后台清理中断";
  return (
    <section className={`reviewed-background-status ${active ? "is-running" : ""}`} aria-label="重复文件后台清理状态">
      <div className="reviewed-background-status-head">
        <strong>{label}</strong>
        <span>已确认 {job.processed} / {job.total} · 删除 {job.successCount} · 失败 {job.failureCount}
          {job.uncertainCount ? ` · 结果未知 ${job.uncertainCount}` : ""}
          {job.waitingJobs ? ` · 后面排队 ${job.waitingJobs} 个任务` : ""}
        </span>
        <button type="button" onClick={() => setDetailsOpen((shown) => !shown)}>
          {detailsOpen ? "收起详情" : "查看详情"}
        </button>
      </div>
      <progress aria-label="后台重复文件清理进度" max={Math.max(1, job.total)} value={job.processed} />
      {detailsOpen && (
        <div className="reviewed-background-details">
          <p>{job.message}</p>
          <p>确认释放空间 {formatBytes(job.reclaimedBytes)}；移入 CloudDrive 回收站 {job.recycledCount} 个；未提交 {job.unsubmittedCount} 个。</p>
          {active && <p>后台清理采用顺序队列；可继续提交其他文件，队列内每次只执行一个删除任务。完成前请保持程序开启。</p>}
          {(job.queueJobs?.length ?? 0) > 1 && <p>任务顺序：{job.queueJobs!.map((entry, index) =>
            `${index + 1}. ${entry.status === "running" ? "执行中" : entry.status === "queued" ? "等待" : entry.status === "blocked" || entry.status === "interrupted" ? "需核实" : entry.status === "partial" ? "部分失败" : "已结束"} ${entry.processed}/${entry.total}`).join("；")}</p>}
          {job.uncertainCount > 0 && <p className="dialog-error">结果未知的文件不能自动重试；先在网盘中核实。</p>}
          {job.failures.length > 0 && <div className="duplicate-failure-list">
            {job.failures.slice(0, 50).map((failure) => (
              <p key={`${failure.groupKey}:${failure.videoId}`}>{failure.path || failure.videoId}：{failure.message}</p>
            ))}
            {job.failures.length > 50 && <p>仅展示前 50 条失败记录，共 {job.failures.length} 条。</p>}
          </div>}
        </div>
      )}
    </section>
  );
}
