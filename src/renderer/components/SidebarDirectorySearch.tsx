import { Folder, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DirectoryBrowserResult, SourceFolder, VideoManagerApi } from "../../shared/videoTypes";

interface Props {
  folders: SourceFolder[];
  load: VideoManagerApi["listDirectoryBrowser"];
  currentPath: string | null;
  selectedSourceId?: string;
  refreshSequence: number;
  focusSequence: number;
  onActiveChange(active: boolean): void;
  onNavigate(path: string, sourceFolderId: string): void;
}
const EMPTY: DirectoryBrowserResult = { items: [], totalCount: 0, truncated: false };
const normalize = (value: string) => value.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
const directoryName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export function SidebarDirectorySearch({ folders, load, currentPath, selectedSourceId, refreshSequence, focusSequence, onActiveChange, onNavigate }: Props) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const keyword = text.trim();
  const currentSource = folders.find((folder) => folder.id === selectedSourceId)
    ?? folders.filter((folder) => currentPath && (normalize(currentPath) === normalize(folder.path) || normalize(currentPath).startsWith(`${normalize(folder.path)}\\`))).sort((a, b) => b.path.length - a.path.length)[0];
  const sourceId = scope === "current" ? currentSource?.id : undefined;
  const clear = () => { setText(""); input.current?.focus(); };

  useEffect(() => onActiveChange(Boolean(keyword)), [keyword, onActiveChange]);
  useEffect(() => { if (focusSequence > 0) input.current?.focus(); }, [focusSequence]);
  useEffect(() => {
    setResult(EMPTY);
    setFailed(false);
    if (!keyword || (scope === "current" && !sourceId)) { setLoading(false); return; }
    let disposed = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void load({ search: keyword, sourceFolderId: sourceId, limit: 100 }, "sidebar-directory-search").then((page) => {
        if (!disposed) setResult(page);
      }).catch(() => {
        if (!disposed) setFailed(true);
      }).finally(() => { if (!disposed) setLoading(false); });
    }, 200);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [keyword, load, sourceId, scope, refreshSequence, retry]);

  return <>
    <div className="sidebar-directory-search-controls">
      <label className="sidebar-directory-search-input">
        <Search size={14} aria-hidden="true" />
        <input ref={input} type="search" maxLength={500} aria-label="搜索资料库目录" placeholder="搜索目录名称或路径" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); }
          if (event.key === "ArrowDown" && keyword) { event.preventDefault(); results.current?.querySelector<HTMLButtonElement>("button[data-result]")?.focus(); }
        }} />
        {text && <button type="button" aria-label="清除目录搜索" onClick={clear}><X size={13} /></button>}
      </label>
      <select aria-label="目录搜索范围" value={scope} onChange={(event) => setScope(event.target.value)}>
        <option value="all">全部资料库</option>
        <option value="current" disabled={!currentSource}>{currentSource ? `当前资料库：${directoryName(currentSource.path)}` : "当前资料库（先选目录）"}</option>
      </select>
    </div>
    {keyword && <div className="sidebar-directory-search-results" ref={results} role="region" aria-label="目录搜索结果" aria-busy={loading} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); return; }
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      const buttons = [...(results.current?.querySelectorAll<HTMLButtonElement>("button[data-result]") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      if (index === 0 && event.key === "ArrowUp") input.current?.focus();
      else buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    }}>
      {loading ? <p className="directory-tree-message" role="status"><LoaderCircle size={13} className="spin" />正在搜索目录</p>
        : failed ? <div className="directory-tree-message" role="alert">目录搜索失败<button type="button" onClick={() => setRetry((value) => value + 1)}>重试搜索</button></div>
        : scope === "current" && !currentSource ? <p className="directory-tree-message">请先选择一个资料库目录</p>
        : <>
          <p className="sidebar-directory-search-summary" role="status">{result.items.length ? `已显示 ${result.items.length} 个目录` : "没有匹配的已入库目录"}</p>
          {result.items.map((item) => {
            const source = folders.find((folder) => folder.id === item.sourceFolderId);
            const parent = item.path.replace(/[\\/]+$/, "").slice(0, item.path.replace(/[\\/]+$/, "").lastIndexOf("\\"));
            const context = `${source ? directoryName(source.path) : "资料库"} · ${parent || item.path}`;
            const selected = currentPath && normalize(currentPath) === normalize(item.path) && (!selectedSourceId || selectedSourceId === item.sourceFolderId);
            return <button type="button" data-result key={`${item.sourceFolderId}:${normalize(item.path)}`} className={`sidebar-directory-search-result${selected ? " active" : ""}`} title={item.path} aria-label={`进入目录 ${item.name}`} aria-current={selected ? "location" : undefined} onClick={() => onNavigate(item.path, item.sourceFolderId)}>
              <Folder size={16} aria-hidden="true" /><span><strong>{highlight(item.name, keyword)}</strong><small>{highlight(context, keyword)}</small></span>
            </button>;
          })}
          {result.truncated && <p className="directory-tree-message">结果较多，仅显示前 100 个；请细化关键词。</p>}
        </>}
      <p className="sidebar-directory-search-note">搜索已入库目录及来源；输入时不切换右侧内容。</p>
    </div>}
  </>;
}

function highlight(value: string, keyword: string): ReactNode {
  const lower = value.toLocaleLowerCase();
  const query = keyword.toLocaleLowerCase();
  const pieces: ReactNode[] = [];
  let start = 0;
  let index = lower.indexOf(query);
  while (index >= 0) {
    pieces.push(value.slice(start, index), <mark key={index}>{value.slice(index, index + query.length)}</mark>);
    start = index + query.length;
    index = lower.indexOf(query, start);
  }
  pieces.push(value.slice(start));
  return pieces;
}
