import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, Database, FileWarning, FolderSearch, HardDrive, LoaderCircle, RefreshCw, X } from "lucide-react";
import type {
  DuplicateCleanupJob,
  DuplicateCleanupJobPage,
  FolderScanStatus,
  MetadataQueueStatus,
  MediaCacheTaskStatus,
  ReviewedDeleteBackgroundJob,
  ScanFailureBatchJob,
  SourceFolder
} from "../../shared/videoTypes";

interface Props {
  open: boolean;
  onClose(): void;
  folders: SourceFolder[];
  scanStatuses: FolderScanStatus[];
  pendingMetadataVideos: number;
  loadMetadataQueueStatus?: () => Promise<MetadataQueueStatus>;
  loadDuplicateCleanupJobs?: (page: number, pageSize: 20 | 50 | 100) => Promise<DuplicateCleanupJobPage>;
  loadReviewedDeleteBackground?: () => Promise<ReviewedDeleteBackgroundJob | null>;
  loadScanFailureBatches?: () => Promise<ScanFailureBatchJob[]>;
  loadMediaCacheTaskStatus?: () => Promise<MediaCacheTaskStatus>;
  onOpenCacheSettings(): void;
  onOpenAssetCenter(): void;
  onOpenMetadataTasks(): void;
  onOpenDuplicateCleanup(): void;
  onOpenScanFailures(): void;
}

const ACTIVE_SCAN_STATES = new Set(["queued", "scanning", "paused"]);
const ATTENTION_SCAN_STATES = new Set(["offline", "error", "completed-with-errors"]);
const ACTIVE_DUPLICATE_STATES = new Set(["queued", "running", "cancelling"]);
const ATTENTION_DUPLICATE_STATES = new Set(["completed_with_errors", "interrupted"]);
const ACTIVE_BATCH_STATES = new Set(["queued", "running", "cancelling"]);
const ATTENTION_BATCH_STATES = new Set(["completed-with-errors", "interrupted"]);

export function BackgroundTaskCenter({
  open,
  onClose,
  folders,
  scanStatuses,
  pendingMetadataVideos,
  loadMetadataQueueStatus,
  loadDuplicateCleanupJobs,
  loadReviewedDeleteBackground,
  loadScanFailureBatches,
  loadMediaCacheTaskStatus,
  onOpenCacheSettings,
  onOpenAssetCenter,
  onOpenMetadataTasks,
  onOpenDuplicateCleanup,
  onOpenScanFailures
}: Props) {
  const [metadataQueue, setMetadataQueue] = useState<MetadataQueueStatus | null>(null);
  const [duplicatePage, setDuplicatePage] = useState<DuplicateCleanupJobPage | null>(null);
  const [reviewedJob, setReviewedJob] = useState<ReviewedDeleteBackgroundJob | null>(null);
  const [batchJobs, setBatchJobs] = useState<ScanFailureBatchJob[] | null>(null);
  const [mediaCacheStatus, setMediaCacheStatus] = useState<MediaCacheTaskStatus | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestIdRef = useRef(0);

  const activeScans = useMemo(
    () => scanStatuses.filter((status) => ACTIVE_SCAN_STATES.has(status.state)),
    [scanStatuses]
  );
  const attentionScans = useMemo(
    () => scanStatuses.filter((status) => ATTENTION_SCAN_STATES.has(status.state)),
    [scanStatuses]
  );
  const duplicateJobs = duplicatePage?.items ?? [];
  const activeDuplicateJobs = duplicateJobs.filter((job) => ACTIVE_DUPLICATE_STATES.has(job.status) && job.phase !== "awaiting_confirmation" && job.phase !== "legacy_blocked");
  const attentionDuplicateJobs = duplicateJobs.filter((job) =>
    ATTENTION_DUPLICATE_STATES.has(job.status) || job.phase === "awaiting_confirmation" || job.phase === "legacy_blocked"
  );
  const activeBatchJobs = (batchJobs ?? []).filter((job) => ACTIVE_BATCH_STATES.has(job.status));
  const attentionBatchJobs = (batchJobs ?? []).filter((job) => ATTENTION_BATCH_STATES.has(job.status));
  const reviewedActive = reviewedJob !== null && (reviewedJob.status === "queued" || reviewedJob.status === "running");
  const reviewedNeedsAttention = reviewedJob !== null && ["partial", "blocked", "interrupted"].includes(reviewedJob.status);
  const mediaCacheGenerationCount = mediaCacheStatus
    ? mediaCacheStatus.generation.queued + mediaCacheStatus.generation.active + mediaCacheStatus.generation.interrupted
    : 0;
  const mediaCacheMaintenanceActive = mediaCacheStatus !== null && ["scheduled", "running", "clearing"].includes(mediaCacheStatus.maintenance.state);
  const mediaCacheWorkCount = mediaCacheGenerationCount + (mediaCacheMaintenanceActive ? 1 : 0);
  const mediaCacheNeedsAttention = Boolean(mediaCacheStatus && (
    mediaCacheStatus.maintenance.lastError || (mediaCacheStatus.cache.lastCleanup?.failureCount ?? 0) > 0
  ));
  const queuedMetadata = metadataQueue?.queued ?? 0;
  const activeMetadata = metadataQueue?.active ?? 0;
  const activeWorkCount = activeScans.length + queuedMetadata + activeMetadata +
    activeDuplicateJobs.length + activeBatchJobs.length + (reviewedActive ? 1 : 0) + mediaCacheWorkCount;
  const attentionCount = attentionScans.length + attentionDuplicateJobs.length +
    attentionBatchJobs.length + (reviewedNeedsAttention ? 1 : 0) + (mediaCacheNeedsAttention ? 1 : 0);
  const hasActiveWork = activeWorkCount > 0;

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    const [metadataResult, duplicateResult, reviewedResult, batchResult, mediaCacheResult] = await Promise.allSettled([
      loadMetadataQueueStatus ? loadMetadataQueueStatus() : Promise.resolve(null),
      loadDuplicateCleanupJobs ? loadDuplicateCleanupJobs(1, 20) : Promise.resolve(null),
      loadReviewedDeleteBackground ? loadReviewedDeleteBackground() : Promise.resolve(null),
      loadScanFailureBatches ? loadScanFailureBatches() : Promise.resolve(null),
      loadMediaCacheTaskStatus ? loadMediaCacheTaskStatus() : Promise.resolve(null)
    ]);
    if (requestId !== requestIdRef.current) return;

    const nextErrors: string[] = [];
    if (metadataResult.status === "fulfilled") setMetadataQueue(metadataResult.value);
    else nextErrors.push("元数据队列");
    if (duplicateResult.status === "fulfilled") setDuplicatePage(duplicateResult.value);
    else nextErrors.push("重复清理任务");
    if (reviewedResult.status === "fulfilled") setReviewedJob(reviewedResult.value);
    else nextErrors.push("已审核删除队列");
    if (batchResult.status === "fulfilled") setBatchJobs(batchResult.value);
    else nextErrors.push("扫描异常批处理");
    if (mediaCacheResult.status === "fulfilled") setMediaCacheStatus(mediaCacheResult.value);
    else nextErrors.push("缓存与封面生成");
    setErrors(nextErrors);
    setHasLoaded(true);
    setRefreshing(false);
  }, [loadMetadataQueueStatus, loadDuplicateCleanupJobs, loadReviewedDeleteBackground, loadScanFailureBatches, loadMediaCacheTaskStatus]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    return () => { requestIdRef.current += 1; };
  }, [open, refresh, refreshVersion]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setRefreshVersion((value) => value + 1), hasActiveWork ? 2000 : 8000);
    return () => window.clearTimeout(timer);
  }, [open, hasActiveWork, refreshVersion]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const navigate = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      className="dialog-backdrop background-task-center-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="dialog background-task-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="background-task-center-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="background-task-center__header">
          <div>
            <span className="background-task-center__eyebrow">后台状态总览</span>
            <h2 id="background-task-center-title">后台任务中心</h2>
            <p>统一查看扫描、元数据、重复清理、扫描异常和缓存/封面生成状态；失败项会提示下一步处理方式，危险操作仍在原模块完成。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭后台任务中心" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="background-task-center__toolbar">
          <div className="background-task-center__summary" aria-live="polite">
            <span className={hasActiveWork ? "task-summary-chip is-active" : "task-summary-chip"}>
              {hasActiveWork ? "活动/排队 " + activeWorkCount + " 项" : "当前无活动任务"}
            </span>
            <span className={attentionCount > 0 ? "task-summary-chip is-warning" : "task-summary-chip"}>
              需关注 {attentionCount} 项
            </span>
          </div>
          <button type="button" className="secondary-button" aria-label="刷新任务状态" onClick={() => setRefreshVersion((value) => value + 1)} disabled={refreshing}>
            {refreshing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            {refreshing ? "刷新中" : "刷新状态"}
          </button>
        </div>

        {errors.length > 0 && (
          <div className="background-task-center__warning" role="status">
            <AlertTriangle size={16} />
            <span>部分任务状态读取失败：{errors.join("、")}。其他任务仍可查看，请稍后刷新重试。</span>
          </div>
        )}

        <div className="background-task-center__grid">
          <section className="background-task-card">
            <header>
              <span className="background-task-card__icon"><FolderSearch size={18} /></span>
              <div><h3>资料扫描</h3><p>目录发现、增量扫描与异常重试</p></div>
              <strong>{activeScans.length}</strong>
            </header>
            {activeScans.length === 0 && attentionScans.length === 0
              ? <>
                <p className="background-task-card__empty">{hasLoaded ? "当前没有进行中的扫描" : "正在读取扫描状态…"}</p>
                {hasLoaded && <span className="background-task-card__meta">需要更新资料库时，可到资产中心启动扫描。</span>}
              </>
              : <ul className="background-task-card__list">
                {[...activeScans, ...attentionScans].slice(0, 4).map((status) => {
                  const folder = folders.find((item) => item.id === status.folderId);
                  const recoveryHint = scanRecoveryHint(status.state);
                  return (
                    <li key={status.folderId}>
                      <div className="background-task-card__item-title">
                        <strong>{folder ? pathLeaf(folder.path) : status.folderId}</strong>
                        <span className={ATTENTION_SCAN_STATES.has(status.state) ? "task-status-tag is-warning" : "task-status-tag"}>{scanStateLabel(status.state)}</span>
                      </div>
                      <span className="background-task-card__meta">{status.processedFiles.toLocaleString("zh-CN")} / {status.totalFiles.toLocaleString("zh-CN") || "?"} · {status.message || status.phase || "等待更新"}</span>
                      {status.currentPath && <span className="background-task-card__path" title={status.currentPath}>{pathLeaf(status.currentPath)}</span>}
                      {recoveryHint && <span className="background-task-card__meta">下一步：{recoveryHint}</span>}
                    </li>
                  );
                })}
              </ul>}
            <button type="button" className="background-task-card__action" onClick={() => navigate(onOpenAssetCenter)}>打开资产中心 <ChevronRight size={15} /></button>
          </section>

          <section className="background-task-card">
            <header>
              <span className="background-task-card__icon"><Database size={18} /></span>
              <div><h3>元数据分析</h3><p>全局队列与资料库待处理量（含暂缓）</p></div>
              <strong>{activeMetadata + queuedMetadata}</strong>
            </header>
            {metadataQueue
              ? <div className="background-task-card__metrics">
                <span>正在处理 <strong>{activeMetadata}</strong></span>
                <span>等待队列 <strong>{queuedMetadata}</strong></span>
                <span>资料库待处理（含暂缓） <strong>{pendingMetadataVideos.toLocaleString("zh-CN")}</strong></span>
              </div>
              : <p className="background-task-card__empty">{hasLoaded ? "元数据队列状态暂不可用" : "正在读取元数据队列…"}</p>}
            <button type="button" className="background-task-card__action" onClick={() => navigate(onOpenMetadataTasks)}>打开元数据任务 <ChevronRight size={15} /></button>
          </section>

          <section className="background-task-card">
            <header>
              <span className="background-task-card__icon"><CheckCircle2 size={18} /></span>
              <div><h3>重复文件清理</h3><p>核对、待确认与后台删除任务</p></div>
              <strong>{activeDuplicateJobs.length + (reviewedActive ? 1 : 0)}</strong>
            </header>
            {reviewedJob && reviewedJob.status !== "completed" && (
              <div className="background-task-card__job">
                <div className="background-task-card__item-title">
                  <strong>已审核删除队列</strong>
                  <span className={reviewedNeedsAttention ? "task-status-tag is-warning" : "task-status-tag"}>{reviewedStatusLabel(reviewedJob.status)}</span>
                </div>
                <span className="background-task-card__meta">已处理 {reviewedJob.processed} / {reviewedJob.total} · 删除 {reviewedJob.successCount} · 失败 {reviewedJob.failureCount} · 结果未知 {reviewedJob.uncertainCount}</span>
                {reviewedJob.waitingJobs ? <span className="background-task-card__meta">后续排队 {reviewedJob.waitingJobs} 项</span> : null}
                {reviewedNeedsAttention && <span className="background-task-card__meta">下一步：{reviewedRecoveryHint(reviewedJob.status)}</span>}
              </div>
            )}
            {duplicatePage && [...activeDuplicateJobs, ...attentionDuplicateJobs].length > 0
              ? <ul className="background-task-card__list">
                {[...activeDuplicateJobs, ...attentionDuplicateJobs].slice(0, 3).map((job) => {
                  const recoveryHint = duplicateRecoveryHint(job);
                  return (
                    <li key={job.id}>
                      <div className="background-task-card__item-title">
                        <strong>{duplicatePhaseLabel(job)}</strong>
                        <span className={ATTENTION_DUPLICATE_STATES.has(job.status) || job.phase === "awaiting_confirmation" || job.phase === "legacy_blocked" ? "task-status-tag is-warning" : "task-status-tag"}>{duplicateStatusLabel(job)}</span>
                      </div>
                      <span className="background-task-card__meta">{job.processedItems.toLocaleString("zh-CN")} / {job.totalItems.toLocaleString("zh-CN")} · {job.errorSummary || formatTaskDate(job.createdAt)}</span>
                      {recoveryHint && <span className="background-task-card__meta">下一步：{recoveryHint}</span>}
                    </li>
                  );
                })}
              </ul>
              : (errors.includes("重复清理任务") || errors.includes("已审核删除队列"))
                ? <p className="background-task-card__empty">重复清理状态暂不可用；请刷新任务状态或打开重复文件核对。</p>
                : !reviewedJob || reviewedJob.status === "completed"
                  ? <>
                    <p className="background-task-card__empty">{hasLoaded ? "当前没有活动的重复清理任务" : "正在读取重复清理状态…"}</p>
                    {hasLoaded && <span className="background-task-card__meta">如需处理重复候选，请打开重复文件查看候选项与历史结果。</span>}
                  </>
                  : null}
            <button type="button" className="background-task-card__action" onClick={() => navigate(onOpenDuplicateCleanup)}>打开重复文件 <ChevronRight size={15} /></button>
          </section>

          <section className="background-task-card">
            <header>
              <span className="background-task-card__icon"><FileWarning size={18} /></span>
              <div><h3>扫描异常批处理</h3><p>重新检查、元数据重试与清理任务</p></div>
              <strong>{activeBatchJobs.length}</strong>
            </header>
            {batchJobs && [...activeBatchJobs, ...attentionBatchJobs].length > 0
              ? <ul className="background-task-card__list">
                {[...activeBatchJobs, ...attentionBatchJobs].slice(0, 3).map((job) => {
                  const recoveryHint = batchRecoveryHint(job.status);
                  return (
                    <li key={job.id}>
                      <div className="background-task-card__item-title">
                        <strong>{batchOperationLabel(job.operation)}</strong>
                        <span className={ATTENTION_BATCH_STATES.has(job.status) ? "task-status-tag is-warning" : "task-status-tag"}>{batchStatusLabel(job.status)}</span>
                      </div>
                      <span className="background-task-card__meta">{job.processedCount.toLocaleString("zh-CN")} / {job.totalCount.toLocaleString("zh-CN")} · 成功 {job.successCount} · 失败 {job.failureCount}</span>
                      {job.currentPath && <span className="background-task-card__path" title={job.currentPath}>{pathLeaf(job.currentPath)}</span>}
                      {recoveryHint && <span className="background-task-card__meta">下一步：{recoveryHint}</span>}
                    </li>
                  );
                })}
              </ul>
              : errors.includes("扫描异常批处理")
                ? <p className="background-task-card__empty">扫描异常任务状态暂不可用；请刷新任务状态后再判断是否有待处理任务。</p>
                : <>
                  <p className="background-task-card__empty">{hasLoaded ? "当前没有活动的异常批处理" : "正在读取扫描异常任务…"}</p>
                  {hasLoaded && <span className="background-task-card__meta">如需处理异常记录，请打开扫描异常查看明细并选择合适操作。</span>}
                </>}
            <button type="button" className="background-task-card__action" onClick={() => navigate(onOpenScanFailures)}>打开扫描异常 <ChevronRight size={15} /></button>
          </section>

          <section className="background-task-card">
            <header>
              <span className="background-task-card__icon"><HardDrive size={18} /></span>
              <div><h3>缓存与封面生成</h3><p>封面/时间轴生成队列与缓存维护</p></div>
              <strong>{mediaCacheWorkCount}</strong>
            </header>
            {mediaCacheStatus ? (
              <div className="background-task-card__metrics">
                <span>图片生成：执行 <strong>{mediaCacheStatus.generation.active}</strong> · 排队 <strong>{mediaCacheStatus.generation.queued}</strong> · 中断 <strong>{mediaCacheStatus.generation.interrupted}</strong></span>
                {mediaCacheStatus.generation.playbackPaused && <span>播放优先：新图片生成暂缓，已中断任务将在播放结束后继续</span>}
                <span>缓存占用：<strong>{formatCacheBytes(mediaCacheStatus.cache.totalBytes)} / {formatCacheBytes(mediaCacheStatus.cache.maxBytes)}</strong></span>
                <span>封面 {formatCacheBytes(mediaCacheStatus.cache.coverBytes)} · 时间轴 {formatCacheBytes(mediaCacheStatus.cache.timelineBytes)} · {mediaCacheStatus.cache.itemCount.toLocaleString("zh-CN")} 项</span>
                <span>维护状态：<strong>{maintenanceStateLabel(mediaCacheStatus.maintenance.state)}</strong></span>
                {mediaCacheStatus.maintenance.lastStartedAt && <span>最近开始：{formatTaskDate(mediaCacheStatus.maintenance.lastStartedAt)}</span>}
                {mediaCacheStatus.maintenance.lastCompletedAt && <span>最近完成：{formatTaskDate(mediaCacheStatus.maintenance.lastCompletedAt)}</span>}
                {mediaCacheStatus.cache.lastCleanup && <span>最近清理：移除 {mediaCacheStatus.cache.lastCleanup.removedCount} 项 · 回收 {formatCacheBytes(mediaCacheStatus.cache.lastCleanup.reclaimedBytes)} · 失败 {mediaCacheStatus.cache.lastCleanup.failureCount} 项</span>}
                {mediaCacheStatus.maintenance.lastError && <span className="background-task-center__warning">{mediaCacheStatus.maintenance.lastError}</span>}
                {(mediaCacheStatus.cache.lastCleanup?.failureCount ?? 0) > 0 && <span className="background-task-center__warning">上次清理存在未完成项，请查看诊断日志。</span>}
                {mediaCacheNeedsAttention && <span className="background-task-card__meta">下一步：打开缓存设置检查维护配置；若持续失败，请查看诊断日志。</span>}
              </div>
            ) : <p className="background-task-card__empty">{hasLoaded ? "缓存与封面生成状态暂不可用" : "正在读取缓存与封面生成状态…"}</p>}
            <button type="button" className="background-task-card__action" onClick={() => navigate(onOpenCacheSettings)}>打开缓存设置 <ChevronRight size={15} /></button>
          </section>
        </div>

        <footer className="background-task-center__footer">
          <Clock3 size={14} />
          <span>打开时自动刷新：有活动任务约每 2 秒，无活动任务约每 8 秒；关闭后停止刷新。</span>
        </footer>
      </section>
    </div>
  );
}

function pathLeaf(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).pop() || value;
}

function scanStateLabel(state: string): string {
  return ({
    queued: "等待扫描",
    scanning: "正在扫描",
    paused: "已暂停",
    offline: "暂时离线",
    error: "扫描失败",
    "completed-with-errors": "完成但有异常"
  } as Record<string, string>)[state] ?? state;
}

function scanRecoveryHint(state: FolderScanStatus["state"]): string | null {
  if (state === "offline") return "先恢复目录连接，再到资产中心查看扫描记录；确认来源可访问后再重试。";
  if (state === "error") return "打开资产中心查看扫描记录；修复路径或权限问题后再重试。";
  if (state === "completed-with-errors") return "查看扫描异常明细，按具体错误处理；不要对所有失败项一键重复重试。";
  return null;
}

function duplicateRecoveryHint(job: DuplicateCleanupJob): string | null {
  if (job.phase === "awaiting_confirmation") return "任务尚未执行；请在重复文件模块核对计划后再确认。";
  if (job.phase === "legacy_blocked") return "旧任务已被安全阻止；请重新创建并核对任务。";
  if (job.status === "interrupted") return "先核对源目录与资料库状态；结果未知的删除项目不要直接重试。";
  if (job.status === "completed_with_errors") return "打开重复文件查看失败明细；只对已确认失败且重新核对通过的项目重试。";
  return null;
}

function reviewedRecoveryHint(status: ReviewedDeleteBackgroundJob["status"]): string | null {
  if (status === "partial") return "打开重复文件查看失败项；确认失败原因后再决定是否重试。";
  if (status === "blocked") return "安全校验已阻止任务；请在重复文件模块重新核对候选文件。";
  if (status === "interrupted") return "先核对源目录与资料库状态；结果未知项目不要直接重试。";
  return null;
}

function batchRecoveryHint(status: ScanFailureBatchJob["status"]): string | null {
  if (status === "completed-with-errors") return "打开扫描异常查看失败项；修复原因后再重新提交。";
  if (status === "interrupted") return "先核对已处理和未处理数量，再决定是否重试。";
  return null;
}

function duplicatePhaseLabel(job: DuplicateCleanupJob): string {
  if (job.phase === "awaiting_confirmation") return "等待二次确认";
  if (job.phase === "verification") return "核对大小与时长";
  if (job.phase === "deletion") return "后台删除";
  if (job.phase === "legacy_blocked") return "旧任务已安全阻止";
  return "重复清理任务";
}

function duplicateStatusLabel(job: DuplicateCleanupJob): string {
  if (job.status === "queued") return "排队中";
  if (job.status === "running") return "进行中";
  if (job.status === "cancelling") return "正在取消";
  if (job.status === "cancelled") return "已取消";
  if (job.status === "completed_with_errors") return "完成但有异常";
  if (job.status === "interrupted") return "已中断";
  return job.status === "completed" ? "已完成" : job.status;
}

function reviewedStatusLabel(status: ReviewedDeleteBackgroundJob["status"]): string {
  return ({
    queued: "排队中",
    running: "进行中",
    completed: "已完成",
    partial: "部分失败",
    blocked: "已阻止",
    interrupted: "已中断"
  })[status];
}

function batchOperationLabel(operation: ScanFailureBatchJob["operation"]): string {
  return ({
    "recheck-accessibility": "重新检查访问",
    "analyze-metadata": "重新分析元数据",
    "permanent-delete": "永久删除",
    "remove-missing-record": "移除缺失记录"
  })[operation];
}

function batchStatusLabel(status: ScanFailureBatchJob["status"]): string {
  return ({
    queued: "排队中",
    running: "进行中",
    cancelling: "正在取消",
    cancelled: "已取消",
    completed: "已完成",
    "completed-with-errors": "完成但有异常",
    interrupted: "已中断"
  })[status];
}

function formatTaskDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function maintenanceStateLabel(state: MediaCacheTaskStatus["maintenance"]["state"]): string {
  return ({ idle: "空闲", scheduled: "等待维护", running: "维护中", clearing: "清理缓存中", stopping: "准备停止" })[state];
}

function formatCacheBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} ${units[unit]}`;
}
