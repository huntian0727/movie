import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Clock3, Cloud, Folder, HardDrive, LoaderCircle, RefreshCw, Search, Server, X } from "lucide-react";
import type { DirectoryBrowserResult, FolderScanStatus, LibraryPage, SourceFolder, VideoManagerApi, VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDateTime, formatDuration } from "./formatters";
import "./directoryBrowserPage.css";

interface DirectoryBrowserPageProps {
  compact?: boolean;
  onScanDirectory?: VideoManagerApi["scanDirectory"];
  scanStatus?: FolderScanStatus;
  folders: SourceFolder[];
  recentDirectories: Array<{ path: string; sourceFolderId: string }>;
  selectedSourceId?: string;
  currentPath?: string;
  scope: "recursive" | "exact";
  focusSequence: number;
  refreshSequence: number;
  loadDirectories: VideoManagerApi["listDirectoryBrowser"];
  loadVideos: VideoManagerApi["listVideoPage"];
  getCoverUrl?(video: VideoRecord): string | null;
  onNavigate(path: string, sourceFolderId: string): void;
  onScopeChange(scope: "recursive" | "exact"): void;
  onViewAll(): void;
  onOpenVideo(video: VideoRecord, queue: VideoRecord[]): void;
  onVideoDetails(video: VideoRecord): void;
}

const EMPTY_RESULT: DirectoryBrowserResult = { items: [], totalCount: 0, truncated: false };
const EMPTY_VIDEOS: LibraryPage = { videos: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0 };

export function DirectoryBrowserPage({
  compact = false,
  onScanDirectory,
  scanStatus,
  folders,
  recentDirectories,
  selectedSourceId,
  currentPath,
  scope,
  focusSequence,
  refreshSequence,
  loadDirectories,
  loadVideos,
  getCoverUrl,
  onNavigate,
  onScopeChange,
  onViewAll,
  onOpenVideo,
  onVideoDetails
}: DirectoryBrowserPageProps) {
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [directories, setDirectories] = useState(EMPTY_RESULT);
  const [videos, setVideos] = useState(EMPTY_VIDEOS);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryListExpanded, setDirectoryListExpanded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [scanPending, setScanPending] = useState(false);
  const [scanResult, setScanResult] = useState<FolderScanStatus | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedSource = useMemo(
    () => folders.find((folder) => folder.id === selectedSourceId && (!currentPath || isPathWithin(currentPath, folder.path)))
      ?? folders.filter((folder) => currentPath && isPathWithin(currentPath, folder.path)).sort((a, b) => b.path.length - a.path.length)[0],
    [currentPath, folders, selectedSourceId]
  );
  const breadcrumb = useMemo(() => buildBreadcrumb(selectedSource, currentPath), [currentPath, selectedSource]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText.trim()), 160);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (focusSequence <= 0) return;
    searchRef.current?.focus();
  }, [focusSequence]);

  useEffect(() => {
    if (!search && (!currentPath || !directoryListExpanded)) {
      setDirectories(EMPTY_RESULT);
      setDirectoryLoading(false);
      return;
    }

    let disposed = false;
    setDirectoryLoading(true);
    setError("");
    void loadDirectories({
      sourceFolderId: search ? undefined : selectedSource?.id,
      parentPath: search ? undefined : currentPath,
      search,
      limit: 100
    }).then((result) => {
      if (!disposed) setDirectories(result);
    }).catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!disposed) setDirectoryLoading(false);
    });
    return () => { disposed = true; };
  }, [currentPath, directoryListExpanded, loadDirectories, refreshSequence, revision, search, selectedSource?.id]);

  useEffect(() => {
    if (!currentPath || compact) {
      setVideos(EMPTY_VIDEOS);
      return;
    }
    let disposed = false;
    setVideoLoading(true);
    void loadVideos({
      view: "folder",
      directoryPath: currentPath,
      folderScope: scope,
      search: "",
      sortField: "modifiedAt",
      sortDirection: "desc",
      page: 1,
      pageSize: 30
    }).then((result) => {
      if (!disposed) setVideos(result);
    }).catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!disposed) setVideoLoading(false);
    });
    return () => { disposed = true; };
  }, [compact, currentPath, loadVideos, refreshSequence, revision, scope]);

  const runDirectoryScan = async () => {
    if (!currentPath || !selectedSource || !onScanDirectory || scanPending) return;
    setScanPending(true);
    setScanResult(null);
    setError("");
    try {
      const result = await onScanDirectory({ sourceFolderId: selectedSource.id, directoryPath: currentPath, scope });
      setScanResult(result);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanPending(false);
    }
  };

  if (compact && currentPath) return <section className="directory-browser-context" aria-label="当前目录">
    <div className="directory-context-top">
      <nav aria-label="当前目录路径">
        {breadcrumb.map((entry, index) => <span key={entry.path}>
          {index > 0 && <ChevronRight size={13} />}
          <button type="button" title={entry.path} onClick={() => onNavigate(entry.path, selectedSource?.id ?? selectedSourceId ?? "")}>{entry.label}</button>
        </span>)}
      </nav>
      <div className="directory-context-actions">
        <div className="directory-scope" role="group" aria-label="视频与扫描范围">
          <button type="button" className={scope === "exact" ? "active" : undefined} onClick={() => onScopeChange("exact")}>仅当前目录</button>
          <button type="button" className={scope === "recursive" ? "active" : undefined} onClick={() => onScopeChange("recursive")}>包含子目录</button>
        </div>
        <button type="button" onClick={() => void runDirectoryScan()} disabled={!selectedSource || !onScanDirectory || scanPending}>
          <RefreshCw size={16} className={scanPending ? "spin" : undefined} />{scope === "exact" ? "扫描此目录" : "扫描此目录及子目录"}
        </button>
      </div>
    </div>
    <button type="button" className="directory-context-children-toggle" aria-expanded={directoryListExpanded} onClick={() => setDirectoryListExpanded((value) => !value)}>
      <ChevronRight size={15} className={directoryListExpanded ? "expanded" : undefined} />子目录{directoryListExpanded && !directoryLoading ? ` ${directories.totalCount}` : ""}
    </button>
    {directoryListExpanded && <div className="directory-context-children" aria-busy={directoryLoading}>
      {directoryLoading ? <span><LoaderCircle size={15} className="spin" />正在读取子目录</span> : directories.items.map((item) => <button type="button" key={`${item.sourceFolderId}:${item.path}`} title={item.path} onClick={() => onNavigate(item.path, item.sourceFolderId)}><Folder size={15} />{item.name}<small>{item.videoCount}</small></button>)}
      {!directoryLoading && directories.items.length === 0 && <span>当前没有已索引的子目录</span>}
      {directories.truncated && <small>仅显示前 100 个子目录，请使用“浏览目录”搜索其他目录。</small>}
    </div>}
    {scanPending && <p className="directory-context-status" role="status">正在后台扫描当前范围…{scanStatus?.currentPath ? ` ${scanStatus.currentPath}` : ""}</p>}
    {scanResult && <p className="directory-context-status" role="status">{scanResult.state === "completed" || scanResult.state === "completed-with-errors" ? `扫描结束：新增 ${scanResult.counters.addedVideos}，更新 ${scanResult.counters.updatedVideos}，异常 ${scanResult.counters.fileFailures + scanResult.counters.directoryFailures}` : `扫描状态：${scanResult.state}${scanResult.message ? ` · ${scanResult.message}` : ""}`}</p>}
    {error && <p className="directory-browser-error" role="alert">{error}</p>}
  </section>;

  const openSource = (folder: SourceFolder) => onNavigate(folder.path, folder.id);
  const heading = search ? "搜索结果" : currentPath ? "当前目录" : "资料库来源";

  return <section className="directory-browser-page">
    <header className="directory-browser-header">
      <div>
        <h1>目录浏览</h1>
        <p>从资料库来源、最近访问或搜索结果快速进入目录</p>
      </div>
      <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={directoryLoading || videoLoading}>
        <RefreshCw className={directoryLoading || videoLoading ? "spin" : undefined} size={16} />刷新
      </button>
    </header>

    <div className="directory-browser-body">
      <label className="directory-browser-search">
        <Search size={18} aria-hidden="true" />
        <input ref={searchRef} type="search" aria-label="搜索目录" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索目录名称或完整路径" />
        {searchText && <button type="button" aria-label="清除搜索" onClick={() => { setSearchText(""); searchRef.current?.focus(); }}><X size={15} /></button>}
      </label>

      {!search && currentPath && <div className="directory-browser-location">
        <nav aria-label="当前目录路径">
          {breadcrumb.map((entry, index) => <span key={entry.path}>
            {index > 0 && <ChevronRight size={13} />}
            <button type="button" title={entry.path} onClick={() => onNavigate(entry.path, selectedSource?.id ?? selectedSourceId ?? "")}>{entry.label}</button>
          </span>)}
        </nav>
        <div className="directory-scope" role="group" aria-label="视频范围">
          <button type="button" className={scope === "exact" ? "active" : undefined} onClick={() => onScopeChange("exact")}>仅当前目录</button>
          <button type="button" className={scope === "recursive" ? "active" : undefined} onClick={() => onScopeChange("recursive")}>包含子目录</button>
        </div>
      </div>}

      {error && <div className="directory-browser-error" role="alert">{error}</div>}

      {!search && !currentPath && <div className="directory-source-grid">
        {folders.map((folder) => <button type="button" key={folder.id} onClick={() => openSource(folder)}>
          <SourceIcon folder={folder} />
          <span><strong>{folderName(folder.path)}</strong><small>{sourceType(folder)} · {(folder.videoCount ?? 0).toLocaleString("zh-CN")} 个视频</small></span>
          {folder.scanError && <AlertTriangle size={16} className="warning" />}
          <ChevronRight size={17} />
        </button>)}
        {folders.length === 0 && <p className="directory-browser-empty">还没有添加资料库。</p>}
      </div>}

      {!search && !currentPath && recentDirectories.length > 0 && <section className="directory-recent-section">
        <div className="directory-section-title">
          <div><h2>最近目录</h2><small>最近访问的资料库位置</small></div>
        </div>
        <div className="directory-recent-grid">
          {recentDirectories.map((directory) => <button type="button" key={directory.path} title={directory.path} onClick={() => onNavigate(directory.path, directory.sourceFolderId)}>
            <Clock3 size={17} />
            <span><strong>{folderName(directory.path)}</strong><small>{directory.path}</small></span>
            <ChevronRight size={16} />
          </button>)}
        </div>
      </section>}

      {(search || currentPath) && <section className="directory-list-section">
        <button
          type="button"
          className="directory-section-title directory-section-toggle"
          aria-expanded={Boolean(search) || directoryListExpanded}
          onClick={() => { if (!search) setDirectoryListExpanded((value) => !value); }}
          disabled={Boolean(search)}
        >
          <div>
            <ChevronRight className={search || directoryListExpanded ? "expanded" : undefined} size={17} />
            <span><h2>{heading}</h2>{directories.truncated && <small>结果较多，继续输入可缩小范围</small>}</span>
          </div>
          <strong>{search || directoryListExpanded ? directories.totalCount.toLocaleString("zh-CN") : "展开查看"}</strong>
        </button>
        {(search || directoryListExpanded) && <div className="directory-list" aria-busy={directoryLoading}>
          <div className="directory-list-head"><span>目录</span><span>视频</span><span>最后更新</span><span /></div>
          {directoryLoading ? <div className="directory-list-loading"><LoaderCircle className="spin" size={18} />正在读取资料库</div> : directories.items.map((item) => <button type="button" key={`${item.sourceFolderId}:${item.path}`} onClick={() => { setSearchText(""); onNavigate(item.path, item.sourceFolderId); }}>
            <span className="directory-list-name"><Folder size={18} /><span><strong>{item.name}</strong>{search && <small>{item.path}</small>}</span></span>
            <span>{item.videoCount.toLocaleString("zh-CN")}</span>
            <span>{item.modifiedAt ? formatDateTime(item.modifiedAt) : "未知"}</span>
            <ChevronRight size={17} />
          </button>)}
          {!directoryLoading && directories.items.length === 0 && <p className="directory-browser-empty">{search ? "没有匹配的目录，请尝试其他关键词。" : "当前目录没有下一级目录。"}</p>}
        </div>}
      </section>}

      {!search && currentPath && <section className="directory-video-section">
        <div className="directory-section-title">
          <div><h2>当前范围的视频</h2><small>{videos.totalCount.toLocaleString("zh-CN")} 个视频</small></div>
          {videos.totalCount > 0 && <button type="button" onClick={onViewAll}>查看全部 <ChevronRight size={15} /></button>}
        </div>
        {videoLoading ? <div className="directory-video-loading"><LoaderCircle className="spin" size={18} />正在读取视频</div> : <div className="directory-video-preview">
          {videos.videos.slice(0, 8).map((video) => {
            const cover = getCoverUrl?.(video);
            return <article key={video.id}>
              <button type="button" className="directory-video-cover" onClick={() => onOpenVideo(video, videos.videos)} aria-label={`播放 ${video.filename}`}>
                {cover ? <img src={cover} alt="" /> : <span>{video.extension.replace(".", "").toUpperCase()}</span>}
                <em>{video.durationMs === null ? "时长未知" : formatDuration(video.durationMs)}</em>
              </button>
              <button type="button" className="directory-video-name" title={video.filename} onClick={() => onVideoDetails(video)}>{video.filename}</button>
              <small>{formatBytes(video.sizeBytes)} · {formatDateTime(video.modifiedAt)}</small>
            </article>;
          })}
          {videos.videos.length === 0 && <p className="directory-browser-empty">当前范围没有可显示的视频。</p>}
        </div>}
      </section>}
    </div>
  </section>;
}

function SourceIcon({ folder }: { folder: SourceFolder }) {
  if (folder.providerType === "clouddrive") return <Cloud size={20} />;
  if (/^(\\\\|\/\/)/.test(folder.path)) return <Server size={20} />;
  return <HardDrive size={20} />;
}

function sourceType(folder: SourceFolder): string {
  if (folder.providerType === "clouddrive") return "CloudDrive";
  if (/^(\\\\|\/\/)/.test(folder.path)) return "NAS";
  return "本地";
}

function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function isPathWithin(candidatePath: string, parentPath: string): boolean {
  const candidate = normalizePath(candidatePath);
  const parent = normalizePath(parentPath);
  return candidate === parent || candidate.startsWith(`${parent}\\`);
}

function buildBreadcrumb(source: SourceFolder | undefined, currentPath: string | undefined): Array<{ label: string; path: string }> {
  if (!currentPath) return [];
  if (!source || !isPathWithin(currentPath, source.path)) return [{ label: folderName(currentPath), path: currentPath }];
  const root = source.path.replace(/[\\/]+$/, "");
  const relative = currentPath.slice(root.length).replace(/^[\\/]+/, "");
  const parts = relative ? relative.split(/[\\/]+/).filter(Boolean) : [];
  const separator = root.includes("/") && !root.includes("\\") ? "/" : "\\";
  const entries = [{ label: folderName(root), path: root }];
  let path = root;
  for (const part of parts) {
    path = `${path}${separator}${part}`;
    entries.push({ label: part, path });
  }
  return entries;
}
