import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Info, Play, Trash2 } from "lucide-react";
import type {
  DuplicateGroup,
  DuplicateDirectoryOption,
  DuplicatePageSize,
  DuplicateResolveChangedItem,
  DuplicateResolvePlan,
  DuplicateResolvePreview,
  DuplicateResolvePreviewResult,
  DuplicateResolveResult,
  SortDirection,
  VideoRecord
} from "../../shared/videoTypes";
import { formatBytes, formatDate, formatDuration } from "./formatters";
import { DirectoryPicker } from "./DirectoryPicker";

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
  preferredDirectoryScope?: "recursive" | "exact";
  onPage?(page: number): void;
  onPageSize?(pageSize: DuplicatePageSize): void;
  onSizeSortDirection?(direction: SortDirection): void;
  onPreferredDirectoryPathChange?(path: string): void;
  onPreferredDirectoryScopeChange?(scope: "recursive" | "exact"): void;
  onOpen(video: VideoRecord, groupVideos: VideoRecord[]): void;
  onViewDetails(video: VideoRecord): void;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onDelete?(video: VideoRecord): void | Promise<void>;
  onRefresh?(): void;
  onPreviewResolve(plan: DuplicateResolvePlan): Promise<DuplicateResolvePreviewResult>;
  onResolve(plan: DuplicateResolvePlan): Promise<DuplicateResolveResult>;
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
  preferredDirectoryScope = "recursive",
  onPage,
  onPageSize,
  onSizeSortDirection,
  onPreferredDirectoryPathChange,
  onPreferredDirectoryScopeChange,
  onOpen,
  onViewDetails,
  onRevealInFolder,
  onDelete,
  onRefresh,
  onPreviewResolve,
  onResolve
}: DuplicateGroupsPageProps) {
  const [selectedKeepByGroup, setSelectedKeepByGroup] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<DuplicateResolvePreview | null>(null);
  const [staleItems, setStaleItems] = useState<DuplicateResolveChangedItem[] | null>(null);
  const [staleVideosById, setStaleVideosById] = useState<Record<string, VideoRecord>>({});
  const [resolveResult, setResolveResult] = useState<DuplicateResolveResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [internalSizeSortDirection, setInternalSizeSortDirection] = useState<SortDirection>("desc");
  const [deleteTarget, setDeleteTarget] = useState<VideoRecord | null>(null);
  const sizeSortDirection = controlledSizeSortDirection ?? internalSizeSortDirection;

  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => {
      const sizeDifference = largestVideoSize(left) - largestVideoSize(right);
      return (sizeSortDirection === "asc" ? sizeDifference : -sizeDifference) || left.groupKey.localeCompare(right.groupKey);
    }),
    [groups, sizeSortDirection]
  );

  useEffect(() => {
    setSelectedKeepByGroup(Object.fromEntries(groups.map((group) => [group.groupKey, group.recommendedKeepVideoId])));
  }, [groups]);

  const plan = useMemo<DuplicateResolvePlan>(
    () => ({
      groups: groups.map((group) => {
        const keepVideoId = selectedKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;
        return {
          groupKey: group.groupKey,
          keepVideoId,
          deleteVideoIds: group.items.map((item) => item.video.id).filter((videoId) => videoId !== keepVideoId)
        };
      })
    }),
    [groups, selectedKeepByGroup]
  );

  const resetSelectionToRecommended = () => {
    setSelectedKeepByGroup(Object.fromEntries(groups.map((group) => [group.groupKey, group.recommendedKeepVideoId])));
  };

  const handlePreview = async () => {
    setActionPending(true);
    setActionError(null);
    setResolveResult(null);

    try {
      const nextResult = await onPreviewResolve(plan);
      if (nextResult.status === "ready") {
        setPreview(nextResult.preview);
        setConfirmOpen(true);
      } else {
        setPreview(null);
        setConfirmOpen(false);
        setStaleVideosById(Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.video.id, item.video]))));
        setStaleItems(nextResult.changedItems);
        onRefresh?.();
      }
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      setActionPending(false);
    }
  };

  const handleResolve = async () => {
    setActionPending(true);
    setActionError(null);

    try {
      const result = await onResolve(plan);
      setResolveResult(result);
      setConfirmOpen(false);
      setPreview(null);
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      setActionPending(false);
    }
  };

  const handleDeleteOne = async () => {
    if (!deleteTarget || !onDelete) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onDelete(deleteTarget);
      setDeleteTarget(null);
    } catch (cause) {
      setActionError(toDuplicateActionMessage(cause));
    } finally {
      setActionPending(false);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="empty-state duplicate-empty-state">
        <div><Trash2 size={36} /></div>
        <h3>{totalCandidateGroups > 0 ? "暂时没有同大小且同时长的文件" : "暂时没有同大小文件"}</h3>
        <p>{loading ? "正在整理重复项..." : totalCandidateGroups > 0 ? "这些同大小文件的缓存时长不同或尚未读取成功。重复项页面不会为了判断而主动读取网盘文件。" : "扫描完成后，这里会显示文件大小和缓存时长完全相同的候选项。"}</p>
        {preferredDirectoryPath && (
          <button type="button" className="empty-state-action" onClick={() => onPreferredDirectoryPathChange?.("")}>
            返回全部重复项
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="duplicate-page" aria-label="重复项页面">
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}

      <div className="duplicate-summary">
        <p className="duplicate-size-warning">这里只按数据库中已缓存的精确文件大小和时长识别，不读取视频内容、不计算指纹；大小和时长相同不能证明内容相同，永久删除前请播放确认。确认时只复查文件是否存在以及大小、修改时间是否变化。</p>
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
          <span>预计可释放</span>
        </div>
        <div className="duplicate-summary-actions">
          <div className="duplicate-sort duplicate-directory-filter">
            <span>优先保留目录</span>
            <DirectoryPicker
              directoryOptions={directoryOptions.map((option) => ({
                ...option,
                meta: `${option.groupCount} 个重复组 · 预计可释放 ${formatBytes(option.estimatedReclaimableBytes)}`
              }))}
              value={preferredDirectoryPath}
              placeholder="全部资料库（自动推荐）"
              ariaLabel="选择重复项优先保留目录"
              allowClear
              onChange={(path) => onPreferredDirectoryPathChange?.(path)}
            />
          </div>
          {preferredDirectoryPath && (
            <label className="duplicate-sort">
              <span>目录范围</span>
              <select aria-label="重复项目录范围" value={preferredDirectoryScope} onChange={(event) => onPreferredDirectoryScopeChange?.(event.target.value as "recursive" | "exact")}>
                <option value="recursive">包含子目录</option>
                <option value="exact">仅当前目录</option>
              </select>
            </label>
          )}
          <label className="duplicate-sort">
            <span>按大小排序</span>
            <select aria-label="重复项大小排序" value={sizeSortDirection} onChange={(event) => {
              const direction = event.target.value as SortDirection;
              setInternalSizeSortDirection(direction);
              onSizeSortDirection?.(direction);
            }}>
              <option value="desc">从大到小</option>
              <option value="asc">从小到大</option>
            </select>
          </label>
          <button type="button" onClick={resetSelectionToRecommended}>按推荐选择保留项</button>
          <button className="danger" type="button" onClick={() => void handlePreview()} disabled={actionPending || groups.length === 0}>
            清理当前页
          </button>
        </div>
      </div>

      <div className="duplicate-groups">
        {sortedGroups.map((group, index) => {
          const keepVideoId = selectedKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;
          const sortedItems = [...group.items].sort((left, right) => {
            const sizeDifference = left.video.sizeBytes - right.video.sizeBytes;
            return (sizeSortDirection === "asc" ? sizeDifference : -sizeDifference) || left.video.filename.localeCompare(right.video.filename);
          });
          const groupVideos = sortedItems.map((item) => item.video);
          const deleteCount = group.items.length - 1;
          const reclaimableBytes = group.items
            .filter((item) => item.video.id !== keepVideoId)
            .reduce((total, item) => total + item.video.sizeBytes, 0);

          return (
            <section className="duplicate-group-card" key={group.groupKey}>
              <header className="duplicate-group-header">
                <div>
                  <h3>{`重复组 ${String((page - 1) * pageSize + index + 1).padStart(2, "0")}`}</h3>
                  <p>{`${group.items.length} 个同大小同时长文件 · 拟删除 ${deleteCount} 个 · 预计可释放 ${formatBytes(reclaimableBytes)}`}</p>
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
                            {isKeeping ? "保留" : "待删除"}
                          </span>
                          {item.isRecommendedToKeep && <span className="duplicate-badge recommend">推荐保留</span>}
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
                          {item.video.isFavorite && (
                            <>
                              <i />
                              <span>已收藏</span>
                            </>
                          )}
                        </p>
                        {item.keepReason && <small className="duplicate-keep-reason">{item.keepReason}</small>}
                      </div>
                      <div className="duplicate-item-actions">
                        <button type="button" className={isKeeping ? "primary" : undefined} onClick={() => setSelectedKeepByGroup((current) => ({ ...current, [group.groupKey]: item.video.id }))}>
                          设为保留
                        </button>
                        <button type="button" aria-label={`播放 ${item.video.filename}`} onClick={() => onOpen(item.video, groupVideos)}>
                          <Play size={16} />
                        </button>
                        <button type="button" aria-label={`查看 ${item.video.filename} 详情`} onClick={() => onViewDetails(item.video)}>
                          <Info size={16} />
                        </button>
                        <button type="button" aria-label={`打开 ${item.video.filename} 所在文件夹`} onClick={() => void onRevealInFolder?.(item.video)}>
                          <FolderOpen size={16} />
                        </button>
                        {onDelete && (
                          <button className="danger" type="button" aria-label={`手动删除 ${item.video.filename}`} onClick={() => { setActionError(null); setDeleteTarget(item.video); }}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="pagination-bar duplicate-pagination" aria-label="重复项分页">
        <span>共 {totalGroups} 个大小＋时长匹配组</span>
        <button type="button" disabled={page <= 1 || loading} onClick={() => onPage?.(page - 1)}>上一页</button>
        <strong>{page} / {totalPages}</strong>
        <button type="button" disabled={page >= totalPages || loading} onClick={() => onPage?.(page + 1)}>下一页</button>
        <label>
          每页
          <select aria-label="重复项每页数量" value={pageSize} onChange={(event) => onPageSize?.(Number(event.target.value) as DuplicatePageSize)}>
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

      {confirmOpen && preview && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionPending) setConfirmOpen(false); }}>
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-confirm-title">
            <h3 id="duplicate-confirm-title">确认批量删除重复文件</h3>
            <p>文件存在性、大小和修改时间复查已通过；未读取或比较视频内容。本次只处理当前第 {page} 页：将保留 {preview.keepCount} 个文件，删除 {preview.deleteCount} 个文件，预计释放 {formatBytes(preview.reclaimableBytes)}。</p>
            {preferredDirectoryPath && <p>每个重复组会优先保留“{preferredDirectoryPath}”范围内的 1 个文件；同组其他目录的文件仍会参与清理。</p>}
            <p>文件将从磁盘永久删除且无法撤销，请确认保留项选择无误。</p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={actionPending}>取消</button>
              <button className="danger" type="button" onClick={() => void handleResolve()} disabled={actionPending}>
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}

      {staleItems && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStaleItems(null); }}>
          <section className="dialog duplicate-stale-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-stale-title">
            <h3 id="duplicate-stale-title">检测到文件状态变化</h3>
            <p>检测到部分文件状态已经变化，本次未执行删除。资料库已刷新，请重新检查重复项后再确认。</p>
            <p>异常文件可能位于同一重复组的其他目录中。</p>
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
              <button type="button" className="primary" onClick={() => { onRefresh?.(); setStaleItems(null); }}>刷新重复项</button>
            </div>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionPending) setDeleteTarget(null); }}>
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-delete-one-title">
            <h3 id="duplicate-delete-one-title">永久删除这个重复视频？</h3>
            <p className="delete-filename">{deleteTarget.filename}</p>
            <p>{deleteTarget.path}</p>
            <p>将从磁盘永久删除 {formatBytes(deleteTarget.sizeBytes)} 的文件，无法撤销。删除后重复组会自动重新计算。</p>
            {actionError && <small className="dialog-error">{actionError}</small>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={actionPending}>取消</button>
              <button className="danger" type="button" onClick={() => void handleDeleteOne()} disabled={actionPending}>永久删除</button>
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
    return "重复项检查失败，请刷新重复项后重试。";
  }
  return message;
}
