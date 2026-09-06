import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Cloud,
  Database,
  FolderRoot,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Server,
  TriangleAlert
} from "lucide-react";
import type {
  AssetCenterSourceAvailability,
  AssetCenterSourcePage,
  AssetCenterSourcePageSize,
  AssetCenterSourceQuery,
  AssetCenterSourceRow,
  AssetCenterSourceSort,
  AssetCenterSourceType,
  AssetCenterSummary,
  FolderScanStatus,
  LibraryView,
  SortDirection
} from "../../shared/videoTypes";
import { formatBytes, formatDateTime } from "./formatters";

const EMPTY_SOURCE_PAGE: AssetCenterSourcePage = { items: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0 };

interface AssetCenterPageProps {
  scanStatuses: FolderScanStatus[];
  refreshSequence: number;
  loadSummary(): Promise<AssetCenterSummary>;
  loadSources(query: AssetCenterSourceQuery): Promise<AssetCenterSourcePage>;
  onNavigate(view: Extract<LibraryView, "all" | "duplicates" | "scanFailures">): void;
  onOpenMissing(sourceFolderId?: string): void;
  onOpenMetadata(sourceFolderId?: string): void;
  onSelectSource(path: string): void;
}

export function AssetCenterPage({
  scanStatuses,
  refreshSequence,
  loadSummary,
  loadSources,
  onNavigate,
  onOpenMissing,
  onOpenMetadata,
  onSelectSource
}: AssetCenterPageProps) {
  const [summary, setSummary] = useState<AssetCenterSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [sourcePage, setSourcePage] = useState<AssetCenterSourcePage>(EMPTY_SOURCE_PAGE);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<"all" | AssetCenterSourceType>("all");
  const [availability, setAvailability] = useState<"all" | AssetCenterSourceAvailability>("all");
  const [sort, setSort] = useState<AssetCenterSourceSort>("path");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [pageSize, setPageSize] = useState<AssetCenterSourcePageSize>(30);
  const [page, setPage] = useState(1);
  const sourceSectionRef = useRef<HTMLElement>(null);
  const summaryRequest = useRef(0);
  const sourceRequest = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => setPage(1), [availability, direction, pageSize, search, sort, sourceType]);

  useEffect(() => {
    const request = ++summaryRequest.current;
    setSummaryLoading(true);
    setSummaryError(null);
    void loadSummary()
      .then((result) => {
        if (request === summaryRequest.current) setSummary(result);
      })
      .catch((cause) => {
        if (request === summaryRequest.current) setSummaryError(toMessage(cause));
      })
      .finally(() => {
        if (request === summaryRequest.current) setSummaryLoading(false);
      });
  }, [loadSummary, refreshSequence, refreshVersion]);

  useEffect(() => {
    const request = ++sourceRequest.current;
    const query: AssetCenterSourceQuery = { page, pageSize, search, type: sourceType, availability, sort, direction };
    setSourcesLoading(true);
    setSourcesError(null);
    void loadSources(query)
      .then((result) => {
        if (request !== sourceRequest.current) return;
        setSourcePage(result);
        if (result.page !== page) setPage(result.page);
      })
      .catch((cause) => {
        if (request === sourceRequest.current) setSourcesError(toMessage(cause));
      })
      .finally(() => {
        if (request === sourceRequest.current) setSourcesLoading(false);
      });
  }, [availability, direction, loadSources, page, pageSize, refreshSequence, refreshVersion, search, sort, sourceType]);

  const activeScans = useMemo(
    () => scanStatuses.filter((status) => status.state === "queued" || status.state === "scanning" || status.state === "paused"),
    [scanStatuses]
  );
  const refreshing = summaryLoading || sourcesLoading;
  const refresh = () => setRefreshVersion((current) => current + 1);
  const showSources = (next?: Partial<Pick<AssetCenterSourceQuery, "sort" | "direction" | "availability">>) => {
    if (next?.sort) setSort(next.sort);
    if (next?.direction) setDirection(next.direction);
    if (next?.availability) setAvailability(next.availability);
    sourceSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  return (
    <div className="asset-center-page">
      <header className="asset-center-toolbar">
        <div>
          <h1>资产中心</h1>
          <p>
            {summary
              ? `共 ${summary.totalVideoCount.toLocaleString("zh-CN")} 个有效视频 · 数据生成于 ${formatAssetTime(summary.generatedAt)}`
              : summaryLoading ? "正在读取资料库统计…" : "资料库统计暂不可用"}
          </p>
        </div>
        <button type="button" aria-label={refreshing ? "正在重新读取缓存" : "重新读取缓存"} title="只重新读取本地数据库缓存，不会启动扫描" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={18} className={refreshing ? "spin" : undefined} />
          <span>{refreshing ? "读取中" : "重新读取缓存"}</span>
        </button>
      </header>

      <div className="asset-center-body">
        {summaryError && (
          <div className="asset-center-notice error" role="alert">
            <AlertTriangle size={17} />
            <span>资产统计读取失败：{summaryError}</span>
            <button type="button" onClick={refresh}>重试</button>
          </div>
        )}

        <section className="asset-metric-strip" aria-label="资产核心统计" aria-busy={summaryLoading}>
          <MetricButton
            label="视频总数量"
            value={summary ? summary.totalVideoCount.toLocaleString("zh-CN") : summaryLoading ? "读取中" : "暂无"}
            note={summary ? `${summary.missingVideoCount.toLocaleString("zh-CN")} 条缺失记录另行保留` : "等待统计"}
            loading={summaryLoading && !summary}
            onClick={() => onNavigate("all")}
          />
          <MetricButton
            label="总容量"
            value={summary ? formatAssetBytes(summary.totalSizeBytes) : summaryLoading ? "读取中" : "暂无"}
            note="按数据库中的有效视频大小统计"
            loading={summaryLoading && !summary}
            onClick={() => showSources({ availability: "all", sort: "sizeBytes", direction: "desc" })}
          />
          <MetricButton
            label="资料库根来源"
            value={summary ? summary.sourceCount.toLocaleString("zh-CN") : summaryLoading ? "读取中" : "暂无"}
            note={summary ? `${summary.enabledSourceCount.toLocaleString("zh-CN")} 个已启用` : "等待统计"}
            loading={summaryLoading && !summary}
            onClick={() => showSources({ availability: "all" })}
          />
          <MetricButton
            label="最近可访问"
            value={summary ? `${summary.reachableSourceCount.toLocaleString("zh-CN")}/${summary.enabledSourceCount.toLocaleString("zh-CN")}` : summaryLoading ? "读取中" : "暂无"}
            note={summary ? `${summary.offlineSourceCount.toLocaleString("zh-CN")} 离线，${summary.checkFailedSourceCount.toLocaleString("zh-CN")} 检查失败，${summary.unknownSourceCount.toLocaleString("zh-CN")} 未知（非实时）` : "基于最近一次检查"}
            loading={summaryLoading && !summary}
            onClick={() => showSources({ availability: "all", sort: "lastScannedAt", direction: "desc" })}
          />
        </section>

        <div className="asset-status-grid">
          <section className="asset-panel" aria-labelledby="asset-scan-status-title">
            <header><h2 id="asset-scan-status-title">扫描状态</h2><span>{activeScans.length > 0 ? `${activeScans.length.toLocaleString("zh-CN")} 个活动任务` : "当前空闲"}</span></header>
            {activeScans.length > 0 ? (
              <div className="asset-active-scans" aria-live="polite">
                {activeScans.slice(0, 4).map((status) => (
                  <article key={status.folderId}>
                    <LoaderCircle size={16} className={status.state === "paused" ? undefined : "spin"} />
                    <div><strong>{formatScanState(status)}</strong><small title={status.currentPath ?? undefined}>{status.currentPath ?? "等待目录信息"}</small></div>
                    <em>{status.processedFiles.toLocaleString("zh-CN")}/{status.totalFiles ? status.totalFiles.toLocaleString("zh-CN") : "?"}</em>
                  </article>
                ))}
                {activeScans.length > 4 && <p className="asset-active-scans-more">另有 {(activeScans.length - 4).toLocaleString("zh-CN")} 个活动任务</p>}
              </div>
            ) : (
              <p className="asset-panel-empty">当前没有扫描任务。</p>
            )}
            <div className="asset-latest-scan">
              <span>最近完成</span><strong>{summary?.latestCompletedScan ? formatDateTime(summary.latestCompletedScan.completedAt) : "暂无记录"}</strong>
              {summary?.latestCompletedScan && (
                <div>
                  <span>新增 <b>{summary.latestCompletedScan.addedVideos.toLocaleString("zh-CN")}</b></span>
                  <span>更新 <b>{summary.latestCompletedScan.updatedVideos.toLocaleString("zh-CN")}</b></span>
                  <span>缺失 <b>{summary.latestCompletedScan.missingVideos.toLocaleString("zh-CN")}</b></span>
                  <span>失败 <b>{summary.latestCompletedScan.failureCount.toLocaleString("zh-CN")}</b></span>
                </div>
              )}
            </div>
            <button className="asset-panel-link" type="button" onClick={() => onNavigate("scanFailures")}>
              扫描异常 <strong>{summary?.scanFailureCount.toLocaleString("zh-CN") ?? "暂无"}</strong><ChevronRight size={16} />
            </button>
          </section>

          <section className="asset-panel" aria-labelledby="asset-health-title">
            <header><h2 id="asset-health-title">需要关注</h2><span>只读提醒</span></header>
            <HealthRow label="播放风险" value={summary?.playbackRiskCount ?? null} note="按当前自动播放规则估算" />
            <HealthRow label="元数据异常" value={summary?.metadataIssueCount ?? null} note="等待分析或分析失败的有效视频" onClick={() => onOpenMetadata()} />
            <HealthRow label="重复候选" value={summary?.duplicateCandidateGroupCount ?? null} note="按文件大小和整数秒时长匹配" onClick={() => onNavigate("duplicates")} />
            <HealthRow label="文件缺失" value={summary?.missingVideoCount ?? null} note="数据库记录保留，等待复查" onClick={() => onOpenMissing()} />
          </section>
        </div>

        <section ref={sourceSectionRef} className="asset-source-section" aria-labelledby="asset-source-title">
          <header>
            <div><h2 id="asset-source-title">资料库</h2><p>可访问性基于最近检查；问题数量与可访问性分别统计。</p></div>
            <span>{sourcePage.totalCount.toLocaleString("zh-CN")} 个来源</span>
          </header>
          <div className="asset-source-filters">
            <label>搜索<input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="名称或路径" /></label>
            <label>类型<select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)}><option value="all">全部</option><option value="localOrMounted">本地 / 挂载盘</option><option value="nas">NAS</option><option value="clouddrive">CloudDrive</option></select></label>
            <label>可访问性<select value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)}><option value="all">全部</option><option value="reachable">最近可访问</option><option value="offline">最近离线</option><option value="checkFailed">检查失败</option><option value="unknown">未知</option><option value="disabled">已停用</option></select></label>
            <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as AssetCenterSourceSort)}><option value="path">路径</option><option value="videoCount">视频数量</option><option value="sizeBytes">容量</option><option value="lastScannedAt">最近扫描</option><option value="issueCount">问题数量</option></select></label>
            <button type="button" className="asset-direction-button" aria-label={direction === "asc" ? "当前升序，切换为降序" : "当前降序，切换为升序"} onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}>{direction === "asc" ? "升序" : "降序"}</button>
          </div>

          {sourcesError && <div className="asset-source-error" role="alert"><span>资料库列表读取失败：{sourcesError}</span><button type="button" onClick={refresh}>重试</button></div>}
          {sourcesError && sourcePage.items.length === 0 ? null : sourcesLoading && sourcePage.items.length === 0 ? (
            <SourceTableSkeleton />
          ) : sourcePage.items.length === 0 ? (
            <div className="asset-source-empty"><FolderRoot size={30} /><strong>{summary?.sourceCount === 0 ? "尚未添加资料库" : "没有符合筛选条件的资料库"}</strong><span>{summary?.sourceCount === 0 ? "请使用左侧文件夹区域添加本地目录或 CloudDrive 来源。" : "请调整搜索、类型或可访问性筛选。"}</span></div>
          ) : (
            <div className="asset-source-table-wrap" aria-busy={sourcesLoading}>
              <table className="asset-source-table">
                <thead><tr><th>资料库</th><th>类型</th><th>视频</th><th>容量</th><th>可访问性</th><th>最近扫描</th><th>问题</th></tr></thead>
                <tbody>{sourcePage.items.map((source) => <SourceRow key={source.id} source={source} onOpen={() => onSelectSource(source.path)} onOpenMissing={() => onOpenMissing(source.id)} onOpenMetadata={() => onOpenMetadata(source.id)} />)}</tbody>
              </table>
              {sourcesLoading && <span className="asset-table-refreshing" role="status">正在更新列表…</span>}
            </div>
          )}
          <div className="asset-source-pagination" aria-label="资料库分页">
            <span>共 {sourcePage.totalCount.toLocaleString("zh-CN")} 个来源</span>
            <button type="button" disabled={sourcePage.page <= 1 || sourcesLoading} onClick={() => setPage((current) => current - 1)}>上一页</button>
            <strong>{sourcePage.page.toLocaleString("zh-CN")} / {sourcePage.totalPages.toLocaleString("zh-CN")}</strong>
            <button type="button" disabled={sourcePage.page >= sourcePage.totalPages || sourcesLoading} onClick={() => setPage((current) => current + 1)}>下一页</button>
            <label>每页<select aria-label="每页资料库数量" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as AssetCenterSourcePageSize)}><option value="30">30</option><option value="50">50</option><option value="100">100</option></select></label>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricButton({ label, value, note, loading = false, onClick }: { label: string; value: string; note: string; loading?: boolean; onClick(): void }) {
  return <button type="button" className={`asset-metric${loading ? " is-loading" : ""}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{note}</small></button>;
}

function SourceTableSkeleton() {
  return (
    <div className="asset-source-skeleton" role="status" aria-label="正在读取资料库">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} aria-hidden="true"><span /><span /><span /><span /></div>
      ))}
    </div>
  );
}

function HealthRow({ label, value, note, onClick }: { label: string; value: number | null; note: string; onClick?(): void }) {
  const content = <><div><strong>{label}</strong><small>{note}</small></div><b>{value === null ? "暂无统计" : value.toLocaleString("zh-CN")}</b>{onClick && <ChevronRight size={16} />}</>;
  return onClick
    ? <button type="button" className="asset-health-row" onClick={onClick}>{content}</button>
    : <div className="asset-health-row">{content}</div>;
}

function SourceRow({ source, onOpen, onOpenMissing, onOpenMetadata }: { source: AssetCenterSourceRow; onOpen(): void; onOpenMissing(): void; onOpenMetadata(): void }) {
  const SourceIcon = source.sourceType === "clouddrive" ? Cloud : source.sourceType === "nas" ? Server : HardDrive;
  const status = availabilityLabel(source.availability);
  const StatusIcon = source.availability === "reachable" ? CheckCircle2 : source.availability === "unknown" ? CircleHelp : source.availability === "disabled" ? Database : source.availability === "offline" ? TriangleAlert : AlertTriangle;
  return (
    <tr>
      <td><button type="button" className="asset-source-link" onClick={onOpen} title={source.path}><strong>{source.providerName || folderName(source.path)}</strong><small>{source.path}</small></button></td>
      <td><span className="asset-source-type"><SourceIcon size={15} />{sourceTypeLabel(source.sourceType)}</span></td>
      <td className="numeric">{source.videoCount.toLocaleString("zh-CN")}</td>
      <td className="numeric">{formatBytes(source.sizeBytes)}</td>
      <td><span className={`asset-availability ${source.availability}`} title={`最近检查：${source.lastCheckAt ? formatDateTime(source.lastCheckAt) : "暂无"}`}><StatusIcon size={14} />{status}</span></td>
      <td>{source.lastScannedAt ? formatDateTime(source.lastScannedAt) : "从未扫描"}</td>
      <td className={source.issueCount > 0 ? "numeric warning" : "numeric"} title={`扫描异常 ${source.scanFailureCount.toLocaleString("zh-CN")}，文件缺失 ${source.missingVideoCount.toLocaleString("zh-CN")}，元数据异常 ${source.metadataIssueCount.toLocaleString("zh-CN")}`}>
        <div className="asset-issue-summary">
          <strong>{source.issueCount.toLocaleString("zh-CN")}</strong>
          {(source.missingVideoCount > 0 || source.metadataIssueCount > 0) && <span>
            {source.missingVideoCount > 0 && <button type="button" className="asset-issue-link" onClick={onOpenMissing} aria-label={`查看 ${source.path} 的 ${source.missingVideoCount} 条缺失记录`}>缺失 {source.missingVideoCount.toLocaleString("zh-CN")}</button>}
            {source.metadataIssueCount > 0 && <button type="button" className="asset-issue-link" onClick={onOpenMetadata} aria-label={`查看 ${source.path} 的 ${source.metadataIssueCount} 条元数据异常`}>元数据 {source.metadataIssueCount.toLocaleString("zh-CN")}</button>}
          </span>}
        </div>
      </td>
    </tr>
  );
}

function availabilityLabel(value: AssetCenterSourceAvailability): string {
  if (value === "reachable") return "最近可访问";
  if (value === "offline") return "最近离线";
  if (value === "checkFailed") return "检查失败";
  if (value === "disabled") return "已停用";
  return "未知";
}

function sourceTypeLabel(value: AssetCenterSourceType): string {
  if (value === "clouddrive") return "CloudDrive";
  if (value === "nas") return "NAS";
  return "本地 / 挂载盘";
}

function formatScanState(status: FolderScanStatus): string {
  if (status.state === "queued") return "等待扫描";
  if (status.state === "paused") return "扫描已暂停";
  if (status.mode === "retry-failures") return "正在复查异常";
  if (status.phase === "discovering") return "正在发现文件";
  if (status.phase === "comparing-snapshots") return "正在比较变化";
  if (status.phase === "processing") return "正在处理媒体信息";
  return "正在扫描";
}

function formatAssetBytes(bytes: number): string {
  return bytes >= 1024 ** 4 ? `${(bytes / 1024 ** 4).toFixed(2)} TB` : formatBytes(bytes);
}

function formatAssetTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function folderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? folderPath;
}

function toMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "读取失败，请稍后重试";
  return message.split(/\r?\n/, 1)[0].slice(0, 500);
}
