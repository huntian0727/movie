import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Info, ListTodo, LoaderCircle, Play, Trash2 } from "lucide-react";
import type {
  DuplicateGroup,
  DuplicateDirectoryOption,
  DuplicatePageSize,
  DuplicateResolveChangedItem,
  DuplicateResolvePlan,
  DuplicateResolvePreview,
  DuplicateResolvePreviewResult,
  DuplicateResolveResult,
  DuplicateMissingCheckResult,
  DuplicateCleanupAccepted,
  DuplicateCleanupConfirmRequest,
  DuplicateCleanupItemPage,
  DuplicateCleanupJob,
  DuplicateCleanupJobPage,
  DuplicatePreferredDirectory,
  SortDirection,
  VideoRecord
} from "../../shared/videoTypes";
import { formatBytes, formatDate, formatDuration } from "./formatters";
import { DirectoryPicker } from "./DirectoryPicker";
import { DuplicateCleanupTasksPanel } from "./DuplicateCleanupTasksPanel";
import { DuplicateCleanupButton } from "./DuplicateCleanupButton";

interface DuplicateGroupsPageProps {
  groups: DuplicateGroup[];
  loading?: boolean;
  page?: number;
  pageSize?: DuplicatePageSize;
  totalPages?: number;
  totalGroups?: number;
  totalCandidateGroups?: number;
  totalCandidateFiles?: number;
  totalReclaimableBytes?: number;
  sizeSortDirection?: SortDirection;
  directoryOptions?: DuplicateDirectoryOption[];
  preferredDirectoryPath?: string;
  preferredDirectories?: DuplicatePreferredDirectory[];
  onPage?(page: number): void;
  onPageSize?(pageSize: DuplicatePageSize): void;
  onSizeSortDirection?(direction: SortDirection): void;
  onPreferredDirectoryPathChange?(path: string): void;
  onRemovePreferredDirectory?(id: string): void | Promise<void>;
  onOpen(video: VideoRecord, groupVideos: VideoRecord[]): void;
  onViewDetails(video: VideoRecord): void;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onRefresh?(): void;
  onPreviewResolve?(plan: DuplicateResolvePlan): Promise<DuplicateResolvePreviewResult>;
  onCheckMissing?(plan: DuplicateResolvePlan): Promise<DuplicateMissingCheckResult>;
  onResolve?(plan: DuplicateResolvePlan): Promise<DuplicateResolveResult>;
  onAutoDelete?(plan: DuplicateResolvePlan): Promise<DuplicateCleanupAccepted>;
  onAutoDeleteFiltered?(): Promise<DuplicateCleanupAccepted>;
  onSubmitCleanup?(requestId: string, plan: DuplicateResolvePlan): Promise<DuplicateCleanupAccepted>;
  onConfirmCleanup?(request: DuplicateCleanupConfirmRequest): Promise<DuplicateCleanupJob>;
  onLoadCleanupJobs?(page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupJobPage>;
  onLoadCleanupItems?(jobId: string, page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupItemPage>;
  onCancelCleanup?(jobId: string): Promise<DuplicateCleanupJob>;
  onResumeCleanup?(jobId: string): Promise<DuplicateCleanupJob>;
  onRetryCleanup?(jobId: string): Promise<DuplicateCleanupJob>;
  onClearCleanup?(jobId: string): Promise<boolean>;
  onOpenCleanupItem?(itemId: string): Promise<boolean>;
  cleanupRefreshSequence?: number;
}

export function DuplicateGroupsPage({
  groups,
  loading = false,
  page = 1,
  pageSize = 20,
  totalPages = 1,
  totalGroups = groups.length,
  totalCandidateGroups = totalGroups,
  totalCandidateFiles = groups.reduce((total, group) => total + group.items.length, 0),
  totalReclaimableBytes = groups.reduce((total, group) => total + group.reclaimableBytes, 0),
  sizeSortDirection: controlledSizeSortDirection,
  directoryOptions = [],
  preferredDirectoryPath,
  preferredDirectories = [],
  onPage,
  onPageSize,
  onSizeSortDirection,
  onPreferredDirectoryPathChange,
  onRemovePreferredDirectory,
  onOpen,
  onViewDetails,
  onRevealInFolder,
  onRefresh,
  onPreviewResolve,
  onCheckMissing,
  onResolve,
  onAutoDelete,
  onAutoDeleteFiltered,
  onSubmitCleanup,
  onConfirmCleanup,
  onLoadCleanupJobs,
  onLoadCleanupItems,
  onCancelCleanup,
  onResumeCleanup,
  onRetryCleanup,
  onClearCleanup,
  onOpenCleanupItem,
  cleanupRefreshSequence
}: DuplicateGroupsPageProps) {
  const [manualKeepByGroup, setManualKeepByGroup] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<DuplicateResolvePreview | null>(null);
  const [staleItems, setStaleItems] = useState<DuplicateResolveChangedItem[] | null>(null);
  const [staleVideosById, setStaleVideosById] = useState<Record<string, VideoRecord>>({});
  const [resolveResult, setResolveResult] = useState<DuplicateResolveResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [internalSizeSortDirection, setInternalSizeSortDirection] = useState<SortDirection>("desc");
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const [directPreviewPending, setDirectPreviewPending] = useState(false);
  const [directPreviewElapsed, setDirectPreviewElapsed] = useState(0);
  const [missingCheckPending, setMissingCheckPending] = useState(false);
  const [missingCheckMessage, setMissingCheckMessage] = useState<string | null>(null);
  const submitGuardRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskCenterOpenerRef = useRef<HTMLButtonElement>(null);
  const sizeSortDirection = controlledSizeSortDirection ?? internalSizeSortDirection;
  const legacyResolveEnabled: boolean = false;
  const previewFileCount = useMemo(() => new Set(planVideoIds(groups, manualKeepByGroup)).size, [groups, manualKeepByGroup]);

  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => {
      const sizeDifference = largestVideoSize(left) - largestVideoSize(right);
      return (sizeSortDirection === "asc" ? sizeDifference : -sizeDifference) || left.groupKey.localeCompare(right.groupKey);
    }),
    [groups, sizeSortDirection]
  );

  useEffect(() => {
    setManualKeepByGroup((current) => {
      let changed = false;
      const next = { ...current };
      for (const group of groups) {
        const selected = next[group.groupKey];
        if (selected && !group.items.some((item) => item.video.id === selected)) {
          delete next[group.groupKey];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [groups]);

  useEffect(() => {
    if (!onLoadCleanupJobs) return;
    void onLoadCleanupJobs(1, 20).then((result) => setActiveTaskCount(result.activeCount)).catch(() => undefined);
  }, [onLoadCleanupJobs, cleanupRefreshSequence]);

  const plan = useMemo<DuplicateResolvePlan>(
    () => {
      const resolutions = groups.map((group) => {
        const keepVideoId = manualKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;
        return {
          groupKey: group.groupKey,
          keepVideoId,
          deleteVideoIds: group.items
            .filter((item) => item.video.id !== keepVideoId && !item.isProtected && item.canAutoDelete !== false)
            .map((item) => item.video.id)
        };
      }).filter((resolution) => resolution.deleteVideoIds.length > 0);
      return { groups: resolutions };
    },
    [groups, manualKeepByGroup]
  );
  const fastDeleteCount = useMemo(
    () => plan.groups.reduce((total, group) => total + group.deleteVideoIds.length, 0),
    [plan]
  );

  const resetSelectionToRecommended = () => {
    const currentGroupKeys = new Set(groups.map((group) => group.groupKey));
    setManualKeepByGroup((current) => Object.fromEntries(Object.entries(current).filter(([groupKey]) => !currentGroupKeys.has(groupKey))));
  };

  const handleResolveFirstParty = async () => {
    setConfirmOpen(false);
    setActionError("候选项不能直接删除；请先运行完整 SHA-256 验证。 ");
  };

  const handleAutoDelete = async (autoPlan: DuplicateResolvePlan, label: string) => {
    if (!onAutoDelete || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const accepted = await onAutoDelete(autoPlan);
      setMissingCheckMessage(`${label}：已启动 CloudDrive API批量删除任务，不读取视频内容。任务 ${accepted.jobId.slice(0, 8)}`);
      setActiveTaskCount((current) => current + 1);
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      setActionPending(false);
    }
  };

  const handleFilteredAutoDelete = async () => {
    if (!onAutoDeleteFiltered || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const accepted = await onAutoDeleteFiltered();
      setMissingCheckMessage(`已对全部筛选结果启动 CloudDrive API 批量删除任务。任务 ${accepted.jobId.slice(0, 8)}`);
      setActiveTaskCount((current) => current + 1);
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      setActionPending(false);
    }
  };

  const handlePreviewDirect = async () => {
    if (!onPreviewResolve) return;
    setActionPending(true);
    setDirectPreviewPending(true);
    setActionError(null);
    setResolveResult(null);
    const startedAt = Date.now();
    setDirectPreviewElapsed(0);
    timerRef.current = setInterval(() => setDirectPreviewElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    try {
      const result = await onPreviewResolve(plan);
      if (result.status === "stale") {
        setStaleVideosById(Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.video.id, item.video]))));
        setStaleItems(result.changedItems);
        onRefresh?.();
        return;
      }
      setPreview(result.preview);
      setConfirmOpen(true);
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setDirectPreviewPending(false);
      setActionPending(false);
    }
  };

  const handleCheckMissing = async () => {
    if (!onCheckMissing || missingCheckPending) return;
    setMissingCheckPending(true);
    setMissingCheckMessage(null);
    try {
      const result = await onCheckMissing(plan);
      const parts: string[] = [];
      if (result.removedCount > 0) parts.push(`已从列表移除 ${result.removedCount} 个已删除文件`);
      if (result.changedCount > 0) parts.push(`${result.changedCount} 个文件大小或修改时间已变化`);
      setMissingCheckMessage(parts.length > 0 ? parts.join("，") : `未发现缺失文件（共复查 ${result.checkedFileCount} 个）`);
      onRefresh?.();
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      setMissingCheckPending(false);
    }
  };

  if (groups.length === 0) {
    return (
      <section className="duplicate-page">
        {onLoadCleanupJobs && <div className="duplicate-empty-task-action"><button ref={taskCenterOpenerRef} type="button" onClick={() => setTaskCenterOpen(true)}><ListTodo size={16} /> 后台任务 {activeTaskCount}</button></div>}
        <div className="empty-state duplicate-empty-state">
          <div><Trash2 size={36} /></div>
          <h3>{totalCandidateGroups > 0 ? "暂时没有同大小且同时长的文件" : "暂时没有同大小文件"}</h3>
          <p>{loading ? "正在整理候选项..." : totalCandidateGroups > 0 ? "这些同大小文件的缓存时长不同或尚未读取成功。候选项页面不会为了判断而主动读取网盘文件。" : "扫描完成后，这里会显示文件大小和缓存时长完全相同的候选项。"}</p>
          {preferredDirectoryPath && <button type="button" className="empty-state-action" onClick={() => onPreferredDirectoryPathChange?.("")}>返回全部候选项</button>}
        </div>
        {onLoadCleanupJobs && onLoadCleanupItems && onCancelCleanup && onResumeCleanup && onRetryCleanup && onClearCleanup && (
          <DuplicateCleanupTasksPanel open={taskCenterOpen} onClose={() => setTaskCenterOpen(false)} returnFocusRef={taskCenterOpenerRef} loadJobs={onLoadCleanupJobs} loadItems={onLoadCleanupItems} onConfirm={onConfirmCleanup} onCancel={onCancelCleanup} onResume={onResumeCleanup} onRetry={onRetryCleanup} onClear={onClearCleanup} onOpenItem={onOpenCleanupItem} refreshSequence={cleanupRefreshSequence} />
        )}
      </section>
    );
  }

  return (
    <section className="duplicate-page" aria-label="候选项页面">
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}
      {missingCheckMessage && <div className="success-banner" role="status">{missingCheckMessage}</div>}

      <div className="duplicate-summary">
        <p className="duplicate-size-warning">候选发现只使用精确文件大小和整秒时长，不读取视频内容、不计算 SHA-256。批量删除只处理具有 CloudDrive 远端身份的候选项，并通过 API执行。</p>
        <div className="duplicate-summary-card">
          <strong>{totalGroups}</strong>
          <span>大小＋时长匹配组</span>
        </div>
        <div className="duplicate-summary-card">
          <strong>{totalCandidateGroups}</strong>
          <span>同大小候选组</span>
        </div>
        <div className="duplicate-summary-card">
          <strong>{totalCandidateFiles}</strong>
          <span>候选文件</span>
        </div>
        <div className="duplicate-summary-card">
          <strong>{formatBytes(totalReclaimableBytes)}</strong>
          <span>候选可释放空间</span>
        </div>
        <div className="duplicate-summary-actions">
          <div className="duplicate-sort duplicate-directory-filter">
            <span>优先保留目录（包含所有子目录）</span>
            <DirectoryPicker
              directoryOptions={directoryOptions.map((option) => ({
                ...option,
                meta: `${option.groupCount} 个候选组 · 候选可释放空间 ${formatBytes(option.estimatedReclaimableBytes)}`
              }))}
              value={undefined}
              placeholder="添加优先保留目录"
              ariaLabel="选择候选项计划保留目录（包含所有子目录）"
              onChange={(path) => onPreferredDirectoryPathChange?.(path)}
            />
          </div>
          {preferredDirectories.length > 0 && (
            <div className="duplicate-directory-scope" role="list" aria-label="已启用的优先保留目录">
              {preferredDirectories.map((directory) => (
                <p role="listitem" key={directory.id}>
                  <code title={directory.path}>{directory.path}</code>（含子目录）
                  <button type="button" aria-label={`移除优先保留目录 ${directory.path}`} onClick={() => void onRemovePreferredDirectory?.(directory.id)}>移除</button>
                </p>
              ))}
            </div>
          )}
          {preferredDirectoryPath && (
            <div className="duplicate-directory-scope">
              <p role="status">正在优先保留 <code title={preferredDirectoryPath}>{preferredDirectoryPath}</code> 及其所有子目录，并查看包含该目录树文件的候选组。</p>
              <button type="button" onClick={() => onPreferredDirectoryPathChange?.("")}>清除优先目录</button>
            </div>
          )}
          <label className="duplicate-sort">
            <span>按大小排序</span>
            <select aria-label="候选项大小排序" value={sizeSortDirection} onChange={(event) => {
              const direction = event.target.value as SortDirection;
              setInternalSizeSortDirection(direction);
              onSizeSortDirection?.(direction);
            }}>
              <option value="desc">从大到小</option>
              <option value="asc">从小到大</option>
            </select>
          </label>
          <button type="button" onClick={resetSelectionToRecommended}>按推荐选择保留项</button>
          {onCheckMissing && <button type="button" className={missingCheckPending ? "is-pending" : undefined} disabled={missingCheckPending || actionPending || groups.length === 0} onClick={() => void handleCheckMissing()}>
            {missingCheckPending ? `正在复查 ${previewFileCount} 个文件...` : "检查缺失文件"}
          </button>}
          {onLoadCleanupJobs && <button ref={taskCenterOpenerRef} type="button" onClick={() => setTaskCenterOpen(true)}><ListTodo size={16} /> 后台任务 {activeTaskCount}</button>}
          {onAutoDeleteFiltered && <button className="danger" type="button" disabled={actionPending || totalGroups === 0 || totalReclaimableBytes === 0} onClick={() => void handleFilteredAutoDelete()}>
            {actionPending ? "正在创建删除任务..." : `批量删除全部筛选结果（${totalGroups} 组）`}
          </button>}
          {!onAutoDeleteFiltered && onAutoDelete && <button className="danger" type="button" disabled={actionPending || fastDeleteCount === 0} onClick={() => void handleAutoDelete(plan, "批量清理")}>
            {actionPending ? "正在创建删除任务..." : `批量删除候选项（${fastDeleteCount}）`}
          </button>}
          {onSubmitCleanup ? (
            <DuplicateCleanupButton
              plan={plan}
              planFileCount={previewFileCount}
              actionPending={actionPending}
              hasGroups={groups.length > 0}
              onClearError={() => setActionError(null)}
              onSetError={(msg) => setActionError(msg)}
              onRefresh={onRefresh}
              onSubmitCleanup={onSubmitCleanup}
              onResolveStart={() => setActionPending(true)}
              onResolveEnd={() => setActionPending(false)}
            />
          ) : legacyResolveEnabled && onPreviewResolve ? (
            <>
              <button className="danger" type="button" onClick={() => void handlePreviewDirect()} disabled={actionPending || groups.length === 0}>清理当前页</button>
              {directPreviewPending && (
                <div className="dialog-backdrop" role="presentation">
                  <section className="dialog duplicate-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-preflight-title">
                    <LoaderCircle className="spin" size={30} aria-hidden="true" />
                    <h3 id="duplicate-preflight-title">正在安全复查当前页</h3>
                    <p>正在并行检查 {previewFileCount} 个文件的存在性、大小和修改时间。网盘响应较慢时需要等待，但不会读取视频内容。</p>
                    <strong aria-live="polite">已等待 {directPreviewElapsed} 秒</strong>
                  </section>
                </div>
              )}
              {confirmOpen && preview && (
                <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionPending) setConfirmOpen(false); }}>
                  <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-confirm-title">
                    <h3 id="duplicate-confirm-title">确认批量删除重复文件</h3>
                    <p>本次只处理当前第 {page} 页：将保留 {preview.keepCount} 个文件，计划删除 {preview.deleteCount} 个文件，预计释放 {formatBytes(preview.reclaimableBytes)}。未读取或比较视频内容。</p>
                    {preferredDirectoryPath && <p>每个候选组会优先计划保留"{preferredDirectoryPath}"范围内的 1 个文件；同组其他目录的文件仍是候选移除项。</p>}
                    <p>文件将从磁盘永久删除且无法撤销，请确认保留项选择无误。</p>
                    <div className="dialog-actions">
                      <button type="button" onClick={() => setConfirmOpen(false)} disabled={actionPending}>取消</button>
                      <button className="danger" type="button" aria-label="确认删除" onClick={() => void handleResolveFirstParty()} disabled={actionPending}>永久删除</button>
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="duplicate-groups">
        {sortedGroups.map((group, index) => (
          <DuplicateGroupCard
            key={group.groupKey}
            group={group}
            index={index}
            page={page}
            pageSize={pageSize}
            sizeSortDirection={sizeSortDirection}
            selectedKeepByGroup={manualKeepByGroup}
            onSetKeep={(groupId, videoId) => setManualKeepByGroup((current) => ({ ...current, [groupId]: videoId }))}
            onPreferDirectory={(path) => onPreferredDirectoryPathChange?.(path)}
            onOpen={onOpen}
            onViewDetails={onViewDetails}
            onRevealInFolder={onRevealInFolder}
            onDeleteCandidate={(videoId) => {
              const selectedKeep = manualKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;
              const keepVideoId = selectedKeep === videoId
                ? group.items.find((item) => item.video.id !== videoId)?.video.id
                : selectedKeep;
              if (!keepVideoId) return;
              void handleAutoDelete({ groups: [{ groupKey: group.groupKey, keepVideoId, deleteVideoIds: [videoId] }] }, "单项清理");
            }}
          />
        ))}
      </div>

      <div className="pagination-bar duplicate-pagination" aria-label="候选项分页">
        <span>共 {totalGroups} 个大小＋时长候选组</span>
        <button type="button" disabled={page <= 1 || loading} onClick={() => onPage?.(page - 1)}>上一页</button>
        <strong>{page} / {totalPages}</strong>
        <button type="button" disabled={page >= totalPages || loading} onClick={() => onPage?.(page + 1)}>下一页</button>
        <label>
          每页
          <select aria-label="候选项每页数量" value={pageSize} onChange={(event) => onPageSize?.(Number(event.target.value) as DuplicatePageSize)}>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="300">300</option>
            <option value="500">500</option>
          </select>
        </label>
      </div>

      {onLoadCleanupJobs && onLoadCleanupItems && onCancelCleanup && onResumeCleanup && onRetryCleanup && onClearCleanup && (
        <DuplicateCleanupTasksPanel open={taskCenterOpen} onClose={() => setTaskCenterOpen(false)} returnFocusRef={taskCenterOpenerRef} loadJobs={onLoadCleanupJobs} loadItems={onLoadCleanupItems} onConfirm={onConfirmCleanup} onCancel={onCancelCleanup} onResume={onResumeCleanup} onRetry={onRetryCleanup} onClear={onClearCleanup} onOpenItem={onOpenCleanupItem} refreshSequence={cleanupRefreshSequence} />
      )}

      {staleItems && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStaleItems(null); }}>
          <section className="dialog duplicate-stale-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-stale-title">
            <h3 id="duplicate-stale-title">检测到文件状态变化</h3>
            <p>检测到部分文件状态已经变化，本次未执行删除。资料库已刷新，请重新检查候选项并完整验证。</p>
            <p>异常文件可能位于同一候选组的其他目录中。</p>
            <div className="duplicate-stale-list">
              {staleItems.map((item) => (
                <article key={item.videoId}>
                  <strong>{item.filename}</strong>
                  <code>{item.path}</code>
                  <span>{changeTypeLabel(item.changeType)}：{item.message}</span>
                  <span>大小：{formatBytes(item.previousSizeBytes)} → {item.currentSizeBytes === undefined ? "无法读取" : formatBytes(item.currentSizeBytes)}</span>
                  <span>修改时间：{formatDate(item.previousModifiedAt)} → {item.currentModifiedAt ? formatDate(item.currentModifiedAt) : "无法读取"}</span>
                  <button type="button" onClick={() => {
                    const video = staleVideosById[item.videoId];
                    if (video) void onRevealInFolder?.(video);
                  }}><FolderOpen size={16} />打开所在文件夹</button>
                </article>
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setStaleItems(null)}>知道了</button>
              <button type="button" className="primary" onClick={() => { onRefresh?.(); setStaleItems(null); }}>刷新候选项</button>
            </div>
          </section>
        </div>
      )}

      {resolveResult && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResolveResult(null); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-result-title">
            <h3 id="duplicate-result-title">批量清理结果</h3>
            <p>成功删除 {resolveResult.successCount} 个文件，失败 {resolveResult.failureCount} 个，实际释放 {formatBytes(resolveResult.reclaimedBytes)}。</p>
            {resolveResult.failures.length > 0 && (
              <div className="duplicate-failure-list">
                {resolveResult.failures.map((failure) => (
                  <p key={`${failure.groupKey}:${failure.videoId}`}>{failure.path || failure.videoId}：{failure.message}</p>
                ))}
              </div>
            )}
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => setResolveResult(null)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

const DuplicateGroupCard = memo(function DuplicateGroupCard({
  group,
  index,
  page,
  pageSize,
  sizeSortDirection,
  selectedKeepByGroup,
  onSetKeep,
  onPreferDirectory,
  onOpen,
  onViewDetails,
  onRevealInFolder,
  onDeleteCandidate
}: {
  group: DuplicateGroup;
  index: number;
  page: number;
  pageSize: number;
  sizeSortDirection: SortDirection;
  selectedKeepByGroup: Record<string, string>;
  onSetKeep(groupId: string, videoId: string): void;
  onPreferDirectory(path: string): void;
  onOpen(video: VideoRecord, groupVideos: VideoRecord[]): void;
  onViewDetails(video: VideoRecord): void;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onDeleteCandidate(videoId: string): void;
}) {
  const keepVideoId = selectedKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;

  const sortedItems = useMemo(() =>
    [...group.items].sort((left, right) => {
      const sizeDifference = left.video.sizeBytes - right.video.sizeBytes;
      return (sizeSortDirection === "asc" ? sizeDifference : -sizeDifference) || left.video.filename.localeCompare(right.video.filename);
    }),
    [group.items, sizeSortDirection]
  );

  const groupVideos = useMemo(() => sortedItems.map((item) => item.video), [sortedItems]);
  const candidateRemovalCount = group.items.length - 1;
  const reclaimableBytes = useMemo(() =>
    group.items.filter((item) => item.video.id !== keepVideoId).reduce((total, item) => total + item.video.sizeBytes, 0),
    [group.items, keepVideoId]
  );

  return (
    <section className="duplicate-group-card" key={group.groupKey}>
      <header className="duplicate-group-header">
        <div>
          <h3>{`候选组 ${String((page - 1) * pageSize + index + 1).padStart(2, "0")}`}</h3>
          <p>{`${group.items.length} 个大小与时长匹配候选 · 候选移除 ${candidateRemovalCount} 个 · 候选可释放空间 ${formatBytes(reclaimableBytes)}`}</p>
        </div>
      </header>
      <div className="duplicate-group-items">
        {sortedItems.map((item) => {
          const isKeeping = item.video.id === keepVideoId;
          return (
            <article className={`duplicate-item${isKeeping ? " is-keeping" : ""}`} key={item.video.id}>
              <div className="duplicate-item-main">
                <div className="duplicate-item-heading">
                  <strong>{item.video.filename}</strong>
                  <span className={isKeeping ? "duplicate-badge keep" : "duplicate-badge delete"}>
                    {isKeeping ? "计划保留" : "候选移除"}
                  </span>
                  {item.isRecommendedToKeep && <span className="duplicate-badge recommend">推荐计划保留</span>}
                </div>
                <p className="duplicate-path" title={item.video.path}>{item.video.path}</p>
                <p className="duplicate-meta">
                  <span>{item.video.width && item.video.height ? `${item.video.width}×${item.video.height}` : "分辨率未知"}</span>
                  <i />
                  <span>{formatBytes(item.video.sizeBytes)}</span>
                  <i />
                  <span>{formatDuration(item.video.durationMs)}</span>
                  <i />
                  <span>{formatDate(item.video.modifiedAt)}</span>
                  {item.video.isFavorite && (<><i /><span>已收藏</span></>)}
                </p>
                {item.keepReason && <small className="duplicate-keep-reason">{item.keepReason}</small>}
              </div>
              <div className="duplicate-item-actions">
                <button type="button" className={isKeeping ? "primary" : undefined} onClick={() => onSetKeep(group.groupKey, item.video.id)}>设为计划保留</button>
                <button type="button" aria-label={`优先保留 ${item.video.directory} 及其所有子目录（来自 ${item.video.filename}）`} title="筛选包含此目录树文件的候选组，并优先计划保留目录树中的文件" onClick={() => onPreferDirectory(item.video.directory)}><FolderOpen size={16} />优先保留此目录</button>
                <button type="button" aria-label={`播放 ${item.video.filename}`} onClick={() => onOpen(item.video, groupVideos)}><Play size={16} /></button>
                <button type="button" aria-label={`查看 ${item.video.filename} 详情`} onClick={() => onViewDetails(item.video)}><Info size={16} /></button>
                <button type="button" aria-label={`打开 ${item.video.filename} 所在文件夹`} onClick={() => void onRevealInFolder?.(item.video)}><FolderOpen size={16} /></button>
                <button type="button" className="danger" aria-label={`验证并永久删除 ${item.video.filename}`} onClick={() => onDeleteCandidate(item.video.id)}><Trash2 size={16} /></button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
});

function planVideoIds(groups: DuplicateGroup[], selectedKeepByGroup: Record<string, string>): string[] {
  return groups.flatMap((group) => {
    const keepVideoId = selectedKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;
    return [keepVideoId, ...group.items.map((item) => item.video.id).filter((videoId) => videoId !== keepVideoId)];
  });
}

function largestVideoSize(group: DuplicateGroup): number {
  return group.items.reduce((largest, item) => Math.max(largest, item.video.sizeBytes), 0);
}

function changeTypeLabel(changeType: DuplicateResolveChangedItem["changeType"]): string {
  if (changeType === "missing") return "文件不存在";
  if (changeType === "size-changed") return "文件大小变化";
  if (changeType === "mtime-changed") return "修改时间变化";
  if (changeType === "size-and-mtime-changed") return "大小和修改时间变化";
  return "文件无法访问";
}

function toDuplicateActionMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/Error invoking remote method|duplicate:preview-resolve|duplicate:resolve/i.test(message)) {
    return "候选项检查失败，请刷新候选项后重试。";
  }
  return message;
}
