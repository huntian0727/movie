import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CircleGauge, ExternalLink, FileSearch, FolderOpen, LoaderCircle, Play, RefreshCw, Search, Wrench } from "lucide-react";
import { explainPlaybackRoute } from "../../shared/playbackDiagnosis";
import { choosePlaybackRoute } from "../../shared/playbackRouting";
import type { LibraryPage, PlaybackDiagnosticSearchQuery, PlaybackPreference, SourceFolder, VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDateTime, formatDuration } from "./formatters";

const SEARCH_PAGE_SIZE = 30;
const RECENT_LIMIT = 10;
const EMPTY_RECENT_VIDEO_IDS: string[] = [];

interface PlaybackDiagnosticPageProps {
  selectedVideoId: string | null;
  initialVideo?: VideoRecord | null;
  recentVideoIds?: string[];
  folders?: SourceFolder[];
  playbackPreference: PlaybackPreference;
  searchVideos(query: PlaybackDiagnosticSearchQuery): Promise<LibraryPage>;
  loadVideosByIds(videoIds: string[]): Promise<VideoRecord[]>;
  onSelectVideo(video: VideoRecord): void;
  onClearSelection(): void;
  onOpen?(video: VideoRecord, queue: VideoRecord[]): void | Promise<void>;
  onPlayExternal?(video: VideoRecord): void | Promise<void>;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onRetryMetadata?(video: VideoRecord): void | Promise<void>;
  onOpenScanFailures(): void;
}

export function PlaybackDiagnosticPage({
  selectedVideoId,
  initialVideo = null,
  recentVideoIds = EMPTY_RECENT_VIDEO_IDS,
  folders = [],
  playbackPreference,
  searchVideos,
  loadVideosByIds,
  onSelectVideo,
  onClearSelection,
  onOpen,
  onPlayExternal,
  onRevealInFolder,
  onRetryMetadata,
  onOpenScanFailures
}: PlaybackDiagnosticPageProps) {
  const [video, setVideo] = useState<VideoRecord | null>(initialVideo?.id === selectedVideoId ? initialVideo : null);
  const [removed, setRemoved] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchPage, setSearchPage] = useState<LibraryPage>(() => emptyPage());
  const [searchPageNumber, setSearchPageNumber] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetryVersion, setSearchRetryVersion] = useState(0);
  const [recentVideos, setRecentVideos] = useState<VideoRecord[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentRetryVersion, setRecentRetryVersion] = useState(0);
  const [actionPending, setActionPending] = useState<"play" | "external" | "reveal" | "metadata" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const searchRequest = useRef(0);
  const recentRequest = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setSearchPageNumber(1);
    }, 225);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!selectedVideoId) {
      detailRequest.current += 1;
      setVideo(null);
      setRemoved(false);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError(null);
    setRemoved(false);
    if (initialVideo?.id === selectedVideoId) setVideo(initialVideo);

    void loadVideosByIds([selectedVideoId]).then((videos) => {
      if (detailRequest.current !== requestId) return;
      const refreshed = videos.find((item) => item.id === selectedVideoId) ?? null;
      setVideo(refreshed);
      setRemoved(!refreshed);
    }).catch((cause) => {
      if (detailRequest.current === requestId) setDetailError(toMessage(cause));
    }).finally(() => {
      if (detailRequest.current === requestId) setDetailLoading(false);
    });
  }, [initialVideo, loadVideosByIds, refreshVersion, selectedVideoId]);

  useEffect(() => {
    if (selectedVideoId || recentVideoIds.length === 0) {
      recentRequest.current += 1;
      setRecentVideos([]);
      setRecentLoading(false);
      setRecentError(null);
      return;
    }
    const ids = recentVideoIds.slice(0, RECENT_LIMIT);
    const requestId = ++recentRequest.current;
    setRecentLoading(true);
    setRecentError(null);
    void loadVideosByIds(ids).then((videos) => {
      if (recentRequest.current !== requestId) return;
      const byId = new Map(videos.map((item) => [item.id, item]));
      setRecentVideos(ids.map((id) => byId.get(id)).filter((item): item is VideoRecord => Boolean(item)));
    }).catch((cause) => {
      if (recentRequest.current === requestId) setRecentError(toMessage(cause));
    }).finally(() => {
      if (recentRequest.current === requestId) setRecentLoading(false);
    });
  }, [loadVideosByIds, recentRetryVersion, recentVideoIds, selectedVideoId]);

  useEffect(() => {
    if (selectedVideoId || !debouncedQuery) {
      searchRequest.current += 1;
      setSearchPage(emptyPage());
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    const requestId = ++searchRequest.current;
    setSearchLoading(true);
    setSearchError(null);
    void searchVideos({
      search: debouncedQuery,
      page: searchPageNumber,
      pageSize: SEARCH_PAGE_SIZE
    }).then((result) => {
      if (searchRequest.current !== requestId) return;
      setSearchPage(result);
      if (result.page !== searchPageNumber) setSearchPageNumber(result.page);
    }).catch((cause) => {
      if (searchRequest.current === requestId) setSearchError(toMessage(cause));
    }).finally(() => {
      if (searchRequest.current === requestId) setSearchLoading(false);
    });
  }, [debouncedQuery, searchPageNumber, searchRetryVersion, searchVideos, selectedVideoId]);

  const source = useMemo(() => video ? folders.find((folder) => folder.id === video.sourceFolderId) ?? null : null, [folders, video]);
  const route = video ? choosePlaybackRoute(video, playbackPreference) : null;
  const diagnosis = video && route ? explainPlaybackRoute(video, playbackPreference, route) : null;

  const chooseVideo = (nextVideo: VideoRecord) => {
    setVideo(nextVideo);
    setRemoved(false);
    setDetailError(null);
    setQuery("");
    setDebouncedQuery("");
    onSelectVideo(nextVideo);
  };

  const runAction = async (kind: NonNullable<typeof actionPending>, action: (() => void | Promise<void>) | undefined) => {
    if (!action) return;
    setActionPending(kind);
    setActionError(null);
    try {
      await action();
      if (kind === "metadata") setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setActionError(toMessage(cause));
    } finally {
      setActionPending(null);
    }
  };

  if (!selectedVideoId) {
    const visibleItems = debouncedQuery ? searchPage.videos : recentVideos;
    const resultError = debouncedQuery ? searchError : recentError;
    const resultLoading = debouncedQuery ? searchLoading : recentLoading;
    const retryResults = () => debouncedQuery
      ? setSearchRetryVersion((current) => current + 1)
      : setRecentRetryVersion((current) => current + 1);
    const resultSummary = debouncedQuery
      ? `找到 ${searchPage.totalCount.toLocaleString("zh-CN")} 条，第 ${searchPage.page.toLocaleString("zh-CN")} / ${searchPage.totalPages.toLocaleString("zh-CN")} 页`
      : `最多显示 ${RECENT_LIMIT.toLocaleString("zh-CN")} 条`;
    return (
      <div className="playback-diagnostic-page">
        <header className="playback-diagnostic-toolbar">
          <div>
            <h1>播放诊断</h1>
            <p>使用资料库中已有的媒体信息分析当前播放策略</p>
          </div>
        </header>
        <div className="playback-diagnostic-body playback-diagnostic-picker">
          <section className="diagnostic-search-panel" aria-labelledby="diagnostic-search-title">
            <div>
              <h2 id="diagnostic-search-title">选择一个视频</h2>
              <p>搜索不会加载预览图，也不会读取视频文件。</p>
            </div>
            <label className="diagnostic-search-input">
              <Search size={17} aria-hidden="true" />
              <span className="visually-hidden">搜索视频</span>
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入文件名或路径" />
              {(searchLoading || recentLoading) && <LoaderCircle className="spin" size={16} aria-label="正在读取" />}
            </label>
          </section>

          <section className="diagnostic-video-results" aria-busy={resultLoading}>
            <header>
              <h2>{debouncedQuery ? "搜索结果" : "最近播放"}</h2>
              <span role="status" aria-live="polite" aria-atomic="true">{resultSummary}</span>
            </header>
            {resultError ? (
              <div className="diagnostic-inline-error" role="alert"><AlertTriangle size={16} /><span>{debouncedQuery ? "搜索失败" : "最近播放读取失败"}：{resultError}</span><button type="button" onClick={retryResults}>重新读取</button></div>
            ) : !debouncedQuery && recentVideoIds.length === 0 ? (
              <DiagnosticEmpty title="还没有最近播放记录" description="输入文件名或路径开始查找。" />
            ) : !resultLoading && !debouncedQuery && recentVideoIds.length > 0 && recentVideos.length === 0 ? (
              <DiagnosticEmpty title="最近播放记录已失效" description="这些记录已从资料库移除，请搜索其他视频。" />
            ) : !resultLoading && debouncedQuery && searchPage.totalCount === 0 ? (
              <DiagnosticEmpty title="没有找到匹配视频" description="请尝试更短的文件名或路径关键词。" />
            ) : visibleItems.length === 0 && resultLoading ? (
              <div className="diagnostic-loading"><LoaderCircle className="spin" size={18} />正在读取资料库记录...</div>
            ) : (
              <>
                <div className="diagnostic-video-list">
                  {visibleItems.map((item) => <VideoChoice key={item.id} video={item} onChoose={() => chooseVideo(item)} />)}
                </div>
                {debouncedQuery && searchPage.totalPages > 1 && <nav className="diagnostic-search-pagination" aria-label="诊断搜索分页">
                  <button type="button" disabled={searchLoading || searchPage.page <= 1} onClick={() => setSearchPageNumber((current) => Math.max(1, current - 1))}>上一页</button>
                  <span>{searchPage.page} / {searchPage.totalPages}</span>
                  <button type="button" disabled={searchLoading || searchPage.page >= searchPage.totalPages} onClick={() => setSearchPageNumber((current) => Math.min(searchPage.totalPages, current + 1))}>下一页</button>
                </nav>}
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  if (!video && detailLoading) {
    return <div className="playback-diagnostic-page"><DiagnosticHeader onBack={onClearSelection} /><div className="diagnostic-page-state"><LoaderCircle className="spin" size={22} /><strong>正在读取资料库记录</strong><span>不会访问视频文件。</span></div></div>;
  }

  if (!video) {
    return (
      <div className="playback-diagnostic-page">
        <DiagnosticHeader onBack={onClearSelection} />
        <div className="diagnostic-page-state">
          <FileSearch size={30} />
          <strong>{removed ? "记录已移除" : "无法读取视频记录"}</strong>
          <span>{detailError ?? "这个视频已不在当前资料库中，请选择其他视频。"}</span>
          <div>
            {removed
              ? <button type="button" onClick={onOpenScanFailures}>查看扫描异常</button>
              : <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>重新读取缓存</button>}
          </div>
        </div>
      </div>
    );
  }

  const controlsDisabled = video.isMissing || actionPending !== null;
  return (
    <div className="playback-diagnostic-page">
      <DiagnosticHeader
        onBack={onClearSelection}
        onRefresh={() => setRefreshVersion((current) => current + 1)}
        refreshing={detailLoading}
      />
      <div className="playback-diagnostic-body">
        {detailError && <div className="diagnostic-inline-error" role="alert"><AlertTriangle size={16} /><span>刷新失败，继续显示上次记录。{detailError}</span></div>}
        {video.isMissing && <div className="diagnostic-missing" role="status"><AlertTriangle size={17} /><span>资料库记录显示文件当前缺失。播放和元数据重试已停用。</span><button type="button" onClick={onOpenScanFailures}>查看扫描异常</button></div>}

        <section className="diagnostic-file-heading">
          <div className="diagnostic-file-icon"><CircleGauge size={24} /></div>
          <div><h2>{video.filename}</h2><p title={video.path}>{video.path}</p></div>
          <div className="diagnostic-actions" aria-busy={actionPending !== null}>
            <button type="button" className="primary" disabled={controlsDisabled || !onOpen} onClick={() => void runAction("play", () => onOpen?.(video, [video]))}><Play size={15} />{actionPending === "play" ? "正在启动..." : "按当前策略播放"}</button>
            <button type="button" disabled={controlsDisabled || !onPlayExternal} onClick={() => void runAction("external", () => onPlayExternal?.(video))}><ExternalLink size={15} />{actionPending === "external" ? "正在启动 MPV..." : "使用 MPV"}</button>
            <button type="button" disabled={actionPending !== null || !onRevealInFolder} onClick={() => void runAction("reveal", () => onRevealInFolder?.(video))}><FolderOpen size={15} />{actionPending === "reveal" ? "正在定位..." : "定位文件"}</button>
          </div>
        </section>

        {diagnosis && <section className="diagnostic-analysis" aria-labelledby="diagnostic-analysis-title">
          <header><div><span>当前播放策略</span><h2 id="diagnostic-analysis-title">{diagnosis.routeLabel}</h2></div><RiskBadge risk={diagnosis.risk} /></header>
          <dl><div><dt>判断依据</dt><dd>{diagnosis.reason}</dd></div><div><dt>建议</dt><dd>{diagnosis.suggestion}</dd></div><div><dt>分析置信度</dt><dd>{formatConfidence(diagnosis.confidence)}</dd></div></dl>
          <p><AlertTriangle size={14} />{diagnosis.disclaimer}</p>
        </section>}

        <div className="diagnostic-information-grid">
          <DiagnosticSection title="文件信息">
            <DiagnosticItem label="完整路径" value={video.path} wrap />
            <DiagnosticItem label="文件大小" value={formatBytes(video.sizeBytes)} />
            <DiagnosticItem label="修改时间" value={formatDateTime(video.modifiedAt)} />
            <DiagnosticItem label="时长" value={formatDuration(video.durationMs)} />
            <DiagnosticItem label="来源" value={formatSource(source)} />
          </DiagnosticSection>
          <DiagnosticSection title="视频信息">
            <DiagnosticItem label="格式" value={video.format?.trim() || video.extension.slice(1).toUpperCase() || "未记录"} />
            <DiagnosticItem label="视频编码" value={formatField(video.videoCodec, video)} />
            <DiagnosticItem label="分辨率" value={video.width && video.height ? `${video.width} x ${video.height}` : formatField(null, video)} />
            <DiagnosticItem label="Profile" value={formatField(video.videoProfile, video)} />
            <DiagnosticItem label="Pixel Format" value={formatField(video.pixelFormat, video)} />
          </DiagnosticSection>
          <DiagnosticSection title="音频信息">
            <DiagnosticItem label="音频编码" value={formatField(video.audioCodec, video)} />
          </DiagnosticSection>
        </div>

        <section className="diagnostic-maintenance">
          <div><h2>资料维护</h2><p>仅在你明确操作后补充媒体信息。诊断页自身不会读取文件内容。</p></div>
          <button type="button" disabled={controlsDisabled || !onRetryMetadata} onClick={() => void runAction("metadata", () => onRetryMetadata?.(video))}><Wrench size={15} />{actionPending === "metadata" ? "正在补充..." : "补充元数据"}</button>
        </section>
        {actionError && <div className="diagnostic-inline-error" role="alert"><AlertTriangle size={16} />{actionError}</div>}
      </div>
    </div>
  );
}

function DiagnosticHeader({ onBack, onRefresh, refreshing = false }: { onBack(): void; onRefresh?(): void; refreshing?: boolean }) {
  return <header className="playback-diagnostic-toolbar"><div><h1>播放诊断</h1><p>当前策略与兼容风险仅供排查参考</p></div><div><button type="button" onClick={onBack}><ArrowLeft size={16} />更换视频</button>{onRefresh && <button type="button" aria-label={refreshing ? "正在重新读取缓存" : "重新读取缓存"} title="只重新读取资料库缓存记录，不访问视频文件" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? "spin" : undefined} size={16} />{refreshing ? "读取中" : "重新读取缓存"}</button>}</div></header>;
}

function VideoChoice({ video, onChoose }: { video: VideoRecord; onChoose(): void }) {
  return <button type="button" className="diagnostic-video-choice" onClick={onChoose}><span><strong>{video.filename}</strong><small title={video.path}>{video.path}</small></span><em>{formatBytes(video.sizeBytes)} · {formatDuration(video.durationMs)}</em><span className="diagnostic-choice-action">诊断</span></button>;
}

function DiagnosticEmpty({ title, description }: { title: string; description: string }) {
  return <div className="diagnostic-empty"><FileSearch size={27} /><strong>{title}</strong><span>{description}</span></div>;
}

function DiagnosticSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="diagnostic-info-section"><h2>{title}</h2><dl>{children}</dl></section>;
}

function DiagnosticItem({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return <div><dt>{label}</dt><dd className={wrap ? "wrap" : undefined} title={value}>{value}</dd></div>;
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" | "unknown" }) {
  const label = risk === "low" ? "低风险" : risk === "medium" ? "需要留意" : risk === "high" ? "兼容风险" : "风险未知";
  return <span className={`diagnostic-risk ${risk}`}>{label}</span>;
}

function formatConfidence(confidence: "high" | "medium" | "low"): string {
  return confidence === "high" ? "较高" : confidence === "medium" ? "中等" : "较低";
}

function formatField(value: string | null, video: VideoRecord): string {
  if (value?.trim()) return value;
  if (video.metadataStatus === "failed" || video.codecProbeStatus === "failed") return "读取失败";
  if (video.metadataStatus === "pending" || video.codecProbeStatus === "unprobed") return "尚未采集";
  return "未记录";
}

function formatSource(source: SourceFolder | null): string {
  if (!source) return "来源记录不可用";
  if (source.providerType === "clouddrive") return `${source.providerName || "CloudDrive"} · ${source.path}`;
  if (/^\\\\/.test(source.path)) return `NAS · ${source.path}`;
  return `本地目录 · ${source.path}`;
}

function emptyPage(): LibraryPage {
  return { videos: [], page: 1, pageSize: SEARCH_PAGE_SIZE, totalPages: 1, totalCount: 0 };
}

function toMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "读取失败，请稍后重试";
  return message.split(/\r?\n/, 1)[0].slice(0, 500);
}
