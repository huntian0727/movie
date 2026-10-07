import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Folder, ImageIcon, LoaderCircle, RefreshCw, X } from "lucide-react";
import { IMAGE_PAGE_SIZE, type DirectoryImageItem, type DirectoryImagePage, type ImageViewingApi } from "../../shared/imageViewing";
import "./directoryImageGallery.css";

interface Props {
  api: ImageViewingApi;
  sourceFolderId: string;
  directoryPath: string;
  refreshSequence: number;
  onDirectoriesLoaded?(directories: DirectoryImagePage["directories"] | null, truncated?: boolean): void;
  onNavigate(path: string, sourceFolderId: string): void;
}

export function DirectoryImageGallery({ api, sourceFolderId, directoryPath, refreshSequence, onNavigate, onDirectoriesLoaded }: Props) {
  const [result, setResult] = useState<DirectoryImagePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const sessionRef = useRef<string>();
  const viewerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const viewerWanted = useRef(false);
  const requestSequence = useRef(0);

  // One shallow directory listing per visit. Pagination reuses its name list.
  useEffect(() => {
    let disposed = false;
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setResult(null); setPage(0); setSelected(null);
    viewerWanted.current = false;
    sessionRef.current = undefined;
    onDirectoriesLoaded?.(null);
    let ownedSession: string | undefined;
    void api.listDirectoryImages({ sourceFolderId, directoryPath }).then((data) => {
      ownedSession = data.sessionId;
      if (disposed) { void api.closeImageDirectory(data.sessionId).catch(() => undefined); return; }
      if (sequence !== requestSequence.current) return;
      sessionRef.current = data.sessionId;
      setResult(data);
      onDirectoriesLoaded?.(data.directories, data.directoriesTruncated);
    }).catch((cause) => { if (!disposed) setError(message(cause)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => {
      disposed = true;
      requestSequence.current++;
      if (ownedSession) void api.closeImageDirectory(ownedSession).catch(() => undefined);
    };
  }, [api, directoryPath, sourceFolderId, refreshSequence, revision, onDirectoriesLoaded]);

  const movePage = async (nextPage: number, selection: number | null = null) => {
    if (!sessionRef.current || loading) return;
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const data = await api.listDirectoryImages({ sourceFolderId, directoryPath, sessionId: sessionRef.current, offset: nextPage * IMAGE_PAGE_SIZE });
      if (sequence !== requestSequence.current) return;
      setResult(data); setPage(nextPage); setSelected(selection !== null && viewerWanted.current ? selection : null);
    } catch (cause) { if (sequence === requestSequence.current) setError(message(cause)); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  };
  const moveImage = (delta: number) => {
    if (!result || selected === null || loading) return;
    const absolute = result.offset + selected + delta;
    if (absolute < 0 || absolute >= result.totalCount) return;
    const nextPage = Math.floor(absolute / IMAGE_PAGE_SIZE);
    if (nextPage !== page) void movePage(nextPage, absolute % IMAGE_PAGE_SIZE);
    else setSelected(absolute % IMAGE_PAGE_SIZE);
  };
  const closeViewer = () => { viewerWanted.current = false; setSelected(null); focusRef.current?.focus(); };
  const openViewer = (index: number, trigger: HTMLElement) => { viewerWanted.current = true; focusRef.current = trigger; setSelected(index); };
  const viewerOpen = selected !== null;
  useEffect(() => {
    if (viewerOpen) viewerRef.current?.focus();
  }, [viewerOpen]);

  const current = selected === null ? undefined : result?.files[selected];
  return <section className="directory-images" aria-label="当前目录图片">
    <header><div><h2>图片 <span>{result?.totalCount ?? ""}</span></h2><small>仅当前目录</small></div>
      <button type="button" title="重新读取图片目录" aria-label="刷新图片" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /></button>
    </header>
    {error && <div role="alert" className="image-gallery-error">{error}<button type="button" onClick={() => setRevision(value => value + 1)}>重新读取</button></div>}
    {loading && <p role="status"><LoaderCircle size={15} className="spin" />正在读取图片目录…</p>}
    {!onDirectoriesLoaded && result && result.directories.length > 0 && <details open className="image-subdirectories"><summary>浏览子文件夹 · {result.directories.length}</summary><div>
      {result.directories.map(directory => <button type="button" key={directory.path} onClick={() => onNavigate(directory.path, sourceFolderId)}><Folder size={16} />{directory.name}<ChevronRight size={14} /></button>)}
    </div></details>}
    {result && !loading && <>
      {result.totalCount > 0 ? <div className="directory-image-grid" aria-label="图片缩略图">
        {result.files.map((file, index) => <button type="button" className="directory-image-card" key={file.originalUrl} title={file.name} aria-label={`查看图片 ${file.name}`} onClick={event => openViewer(index, event.currentTarget)}>
          <VisibleImage url={file.thumbnailUrl} alt="" enabled={!viewerOpen} />
          <span>{file.name}</span>
        </button>)}
      </div> : <p className="image-gallery-empty">当前目录没有 JPG、PNG、WebP 等可查看的图片。</p>}
      {result.totalCount > IMAGE_PAGE_SIZE && <nav className="image-gallery-pages" aria-label="图片分页">
        <button type="button" disabled={page === 0 || loading} onClick={() => void movePage(page - 1)}>上一页</button>
        <span>{page + 1} / {Math.ceil(result.totalCount / IMAGE_PAGE_SIZE)}</span>
        <button type="button" disabled={result.offset + result.files.length >= result.totalCount || loading} onClick={() => void movePage(page + 1)}>下一页</button>
      </nav>}
      {result.truncated && <p>此目录较大，已限制本次列出的数量。可进入子文件夹查看。</p>}
    </>}
    {viewerOpen && current && createPortal(<div className="image-viewer-backdrop" onClick={event => { if (event.target === event.currentTarget) closeViewer(); }}>
      <div className="image-viewer" ref={viewerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`图片查看 ${current.name}`} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); closeViewer(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); moveImage(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); moveImage(1); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const index = controls.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
        }
      }}>
        <header><div><strong>{current.name}</strong><span>{result!.offset + selected! + 1} / {result!.totalCount}</span></div><button type="button" aria-label="关闭图片查看" onClick={closeViewer}><X size={22} /></button></header>
        <div className="image-viewer-stage">
          <button type="button" aria-label="上一张图片" disabled={loading || result!.offset + selected! === 0} onClick={() => moveImage(-1)}><ChevronLeft size={30} /></button>
          <VisibleImage key={current.originalUrl} url={current.originalUrl} alt={current.name} enabled eager />
          <button type="button" aria-label="下一张图片" disabled={loading || result!.offset + selected! + 1 >= result!.totalCount} onClick={() => moveImage(1)}><ChevronRight size={30} /></button>
        </div>
        <footer>← → 切换图片 · Esc 关闭{loading ? " · 正在读取…" : ""}</footer>
        {error && <footer role="alert">{error} · 请关闭后刷新目录</footer>}
      </div>
    </div>, document.body)}
  </section>;
}

/** Abort source reads and release decoded/blob data when an item leaves the viewport. */
export function VisibleImage({ url, alt, enabled, eager = false }: { url: string; alt: string; enabled: boolean; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [blob, setBlob] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (eager) return;
    if (!ref.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: "0px", threshold: 0.01 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [eager]);
  useEffect(() => {
    setBlob(undefined); setError(false);
    if (!enabled || !visible) return;
    const controller = new AbortController();
    let disposed = false;
    let objectUrl: string | undefined;
    // Short delay also prevents reads during a fast scroll across many rows.
    const timer = window.setTimeout(() => {
      void fetch(url, { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error("图片读取失败");
        return response.blob();
      }).then(body => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(body); setBlob(objectUrl);
      }).catch(() => { if (!disposed) setError(true); });
    }, eager ? 0 : 120);
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, visible, enabled, eager]);
  return <div ref={ref} className={`viewable-image${eager ? " viewable-image--original" : ""}`}>
    {blob && !error ? <img src={blob} alt={alt} onError={() => setError(true)} /> : error ? <span role="status"><ImageIcon size={24} />图片无法显示</span> : enabled && visible ? <span role="status"><LoaderCircle size={22} className="spin" />加载中</span> : <ImageIcon size={24} />}
  </div>;
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
