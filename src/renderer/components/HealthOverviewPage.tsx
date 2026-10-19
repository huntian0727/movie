import { AlertTriangle, CheckCircle2, ChevronRight, Cloud, Database, FileQuestion, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetCenterSummary, LibraryNavigationSnapshot, SourceFolder } from "../../shared/videoTypes";
import { formatDateTime } from "./formatters";

interface HealthOverviewPageProps {
  folders: SourceFolder[];
  navigation?: LibraryNavigationSnapshot;
  refreshSequence: number;
  loadSummary?(): Promise<AssetCenterSummary>;
  onOpenScanFailures(sourceFolderId?: string): void;
  onOpenMissingVideos(): void;
  onOpenMetadataIssues(status: "all" | "failed"): void;
  onOpenAssetCenter(): void;
}

function describeSourceError(error: string | null): string {
  const message = error?.trim() ?? "";
  const unresolved = /^(\d+)\s+unresolved scan issue\(s\)(?::.*)?$/i.exec(message);
  if (unresolved) {
    return `该来源有 ${Number(unresolved[1]).toLocaleString("zh-CN")} 条未解决的扫描记录，建议先按来源排查，不必逐条处理`;
  }
  return message || "该来源存在需要检查的问题";
}

export function HealthOverviewPage({
  folders,
  navigation,
  refreshSequence,
  loadSummary,
  onOpenScanFailures,
  onOpenMissingVideos,
  onOpenMetadataIssues,
  onOpenAssetCenter
}: HealthOverviewPageProps) {
  const [summary, setSummary] = useState<AssetCenterSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(loadSummary));
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const loadSummaryRef = useRef(loadSummary);
  const requestRef = useRef(0);

  useEffect(() => {
    loadSummaryRef.current = loadSummary;
  }, [loadSummary]);

  useEffect(() => {
    if (!loadSummaryRef.current) {
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    void loadSummaryRef.current()
      .then((next) => {
        if (request === requestRef.current) setSummary(next);
      })
      .catch((cause) => {
        if (request === requestRef.current) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
    return () => { requestRef.current += 1; };
  }, [refreshSequence, refreshVersion, Boolean(loadSummary)]);

  const sourceAlerts = useMemo(
    () => folders.filter((folder) => folder.enabled && Boolean(folder.scanError)),
    [folders]
  );
  const scanFailureCount = summary?.scanFailureCount ?? navigation?.scanFailureCount ?? null;
  const missingCount = summary?.missingVideoCount ?? null;
  const metadataFailedCount = summary?.metadataFailedCount ?? null;
  const pendingMetadataCount = summary?.metadataPendingCount ?? navigation?.pendingMetadataVideos ?? null;
  // Recent access-check counts and recorded source errors can overlap, but the
  // summary does not expose source IDs. Their maximum is a safe lower bound,
  // not an exact distinct-source total.
  const sourceIssueCount = Math.max(
    sourceAlerts.length,
    (summary?.offlineSourceCount ?? 0) + (summary?.checkFailedSourceCount ?? 0)
  );
  const healthIssueCount = navigation?.healthIssueCount
    ?? ((scanFailureCount ?? 0) + (missingCount ?? 0) + (metadataFailedCount ?? 0) + sourceAlerts.length);

  return (
    <section className="health-overview-page" aria-label="异常中心总览">
      <header className="health-overview-header">
        <div>
          <span className="health-overview-eyebrow">问题处理工作台</span>
          <h1>异常中心</h1>
          <p>先处理来源问题，再处理单个文件。正常等待分析的任务会单独显示，不会混进异常数量。</p>
        </div>
        <button type="button" className="health-overview-refresh" disabled={loading || !loadSummary} onClick={() => setRefreshVersion((current) => current + 1)}>
          <RefreshCw size={16} className={loading ? "spin" : undefined} />
          {loading ? "读取中" : "刷新统计"}
        </button>
      </header>

      {error && (
        <div className="health-overview-error" role="alert">
          <AlertTriangle size={17} />
          <span>统计读取失败：{error}。不会因此启动扫描。</span>
          <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>重新读取</button>
        </div>
      )}
      <div className="health-overview-kpis" aria-label="异常中心摘要" aria-busy={loading}>
        <article className="health-overview-kpi health-overview-kpi-primary">
          <span>需要核查的记录</span>
          <strong>{healthIssueCount.toLocaleString("zh-CN")}</strong>
          <small>同一来源的多条记录不代表多个独立故障原因；请先按来源检查</small>
        </article>
        <article className="health-overview-kpi">
          <span>可能需要检查的来源</span>
          <strong>至少 {sourceIssueCount.toLocaleString("zh-CN")}</strong>
          <small>{summary ? `记录错误 ${sourceAlerts.length.toLocaleString("zh-CN")} · 最近离线 ${summary.offlineSourceCount.toLocaleString("zh-CN")} · 检查失败 ${summary.checkFailedSourceCount.toLocaleString("zh-CN")}（来源可能重叠）` : "已记录来源错误；具体原因请看下方来源明细"}</small>
        </article>
        <article className="health-overview-kpi">
          <span>扫描失败记录</span>
          <strong>{scanFailureCount === null ? "—" : scanFailureCount.toLocaleString("zh-CN")}</strong>
          <small>访问、权限、解析等问题，需要按原因处理</small>
        </article>
      </div>

      <section className="health-overview-section" aria-labelledby="health-overview-issues-title">
        <header>
          <div><h2 id="health-overview-issues-title">需要你处理</h2><p>按影响范围与建议处理顺序排列。</p></div>
          <span>{loading ? "正在更新" : healthIssueCount === 0 && sourceIssueCount === 0 ? "当前没有已统计的问题" : "优先处理来源级问题"}</span>
        </header>
        <div className="health-overview-issue-grid">
          <article className="health-overview-issue health-overview-issue-source">
            <div className="health-overview-issue-icon"><Cloud size={20} /></div>
            <div className="health-overview-issue-copy">
              <h3>资料库来源需要检查</h3>
              <strong>至少 {sourceIssueCount.toLocaleString("zh-CN")} 个来源</strong>
              <p>先排查来源的连接、路径、权限或扫描错误，再统一复查受影响的文件；扫描异常不等于来源已离线。</p>
            </div>
            <button type="button" onClick={onOpenAssetCenter}>检查来源状态 <ChevronRight size={16} /></button>
          </article>
          <article className="health-overview-issue">
            <div className="health-overview-issue-icon"><AlertTriangle size={20} /></div>
            <div className="health-overview-issue-copy">
              <h3>扫描失败</h3>
              <strong>{scanFailureCount === null ? "—" : scanFailureCount.toLocaleString("zh-CN")} 条记录</strong>
              <p>先区分网络、权限、文件缺失和内容解析问题；扫描失败本身不代表视频损坏。</p>
            </div>
            <button type="button" onClick={() => onOpenScanFailures()}>查看并处理 <ChevronRight size={16} /></button>
          </article>
          <article className="health-overview-issue">
            <div className="health-overview-issue-icon"><FileQuestion size={20} /></div>
            <div className="health-overview-issue-copy">
              <h3>文件可能已经不存在</h3>
              <strong>{missingCount === null ? "—" : missingCount.toLocaleString("zh-CN")} 条记录</strong>
              <p>先复查文件是否仍可访问。确认缺失后，只移除本地资料库记录，不删除磁盘文件。</p>
            </div>
            <button type="button" onClick={onOpenMissingVideos}>复查缺失记录 <ChevronRight size={16} /></button>
          </article>
          <article className="health-overview-issue">
            <div className="health-overview-issue-icon"><Database size={20} /></div>
            <div className="health-overview-issue-copy">
              <h3>元数据分析失败</h3>
              <strong>{metadataFailedCount === null ? "—" : metadataFailedCount.toLocaleString("zh-CN")} 条视频</strong>
              <p>可以重新分析并查看失败原因。解析失败不等于损坏，不会直接触发删除。</p>
            </div>
            <button type="button" onClick={() => onOpenMetadataIssues("failed")}>查看分析失败 <ChevronRight size={16} /></button>
          </article>
        </div>
      </section>

      {sourceAlerts.length > 0 && (
        <section className="health-overview-section health-overview-source-section" aria-labelledby="health-overview-source-title">
          <header>
            <div><h2 id="health-overview-source-title">来源级问题（优先处理）</h2><p>一个来源的问题可能导致大量文件同时报错，建议先处理来源，不要逐条清理文件。</p></div>
            <span>{sourceAlerts.length.toLocaleString("zh-CN")} 个来源</span>
          </header>
          <div className="health-overview-source-list">
            {sourceAlerts.map((source) => (
              <article key={source.id}>
                <FolderOpen size={18} />
                <div>
                  <strong title={source.path}>{source.path}</strong>
                  <small title={source.scanError ?? undefined}>{describeSourceError(source.scanError)}</small>
                </div>
                <button type="button" onClick={() => onOpenScanFailures(source.id)}>查看此来源 <ChevronRight size={15} /></button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="health-overview-section health-overview-background-section" aria-labelledby="health-overview-background-title">
        <header>
          <div>
            <h2 id="health-overview-background-title">后台任务（不一定是异常）</h2>
            <p>待分析或暂缓分析属于处理状态，不应与真正失败的问题混为一谈。</p>
          </div>
          <span>不会自动修改视频文件</span>
        </header>
        <article className="health-overview-background-card">
          <div className="health-overview-issue-icon"><LoaderCircle size={20} /></div>
          <div className="health-overview-issue-copy">
            <h3>待分析 / 暂缓分析</h3>
            <strong>{pendingMetadataCount === null ? "—" : pendingMetadataCount.toLocaleString("zh-CN")} 条任务</strong>
            <p>只有分析失败需要优先排查；等待中的任务可以按需查看，不必逐条处理。</p>
          </div>
          <button type="button" onClick={() => onOpenMetadataIssues("all")}>查看全部任务 <ChevronRight size={16} /></button>
        </article>
      </section>
      <footer className="health-overview-footer">
        <CheckCircle2 size={15} />
        <span>{summary
          ? "统计时间：" + formatDateTime(summary.generatedAt) + "。刷新统计只读取本地统计，不会启动扫描。"
          : "统计数字在数据读取成功后显示；打开明细后可按需复查可访问性。"}</span>
      </footer>
    </section>
  );
}
