import { useEffect, useMemo, useRef } from "react";
import { ChevronRight, Cloud, Folder, HardDrive, Search, Server, X } from "lucide-react";
import type { FolderScanStatus, SourceFolder } from "../../shared/videoTypes";
import { orderDirectorySiblings, ROOT_ORDER_SCOPE, type DirectoryTreeOrders } from "./directoryTreeOrder";
import "./libraryDirectoryOverview.css";

interface Props {
  folders: SourceFolder[];
  scanStatuses: FolderScanStatus[];
  orders: DirectoryTreeOrders;
  search: string;
  focusSequence: number;
  onSearch(value: string): void;
  onNavigate(path: string, sourceFolderId: string): void;
  onAddFolder?(): void | Promise<void>;
}

const normalize = (value: string) => value.replace(/\//g, "\\").toLocaleLowerCase();
const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;

/** Only filters registered roots. No directory enumeration or video query is needed. */
export function LibraryDirectoryOverview({ folders, scanStatuses, orders, search, focusSequence, onSearch, onNavigate, onAddFolder }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const query = normalize(search.trim());
  const visible = useMemo(() => orderDirectorySiblings(folders, orders.get(ROOT_ORDER_SCOPE), (folder) => folder.id)
    .filter((folder) => normalize(folder.path).includes(query)), [folders, orders, query]);
  const statuses = new Map(scanStatuses.map((status) => [status.folderId, status.state]));
  useEffect(() => { if (focusSequence > 0) input.current?.focus(); }, [focusSequence]);
  const clear = () => { onSearch(""); input.current?.focus(); };
  return <section className="library-directory-overview" aria-label="一级目录总览">
    <header className="library-directory-header"><div><h1>资料库目录</h1><p>已添加 {folders.length} 个一级目录</p></div></header>
    <div className="library-directory-body">
      <label className="library-directory-search"><Search size={18} aria-hidden="true" />
        <input ref={input} type="search" maxLength={500} aria-label="搜索一级目录" placeholder="搜索一级目录名称或路径" value={search} onChange={(event) => onSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); clear(); } }} />
        {search && <button type="button" aria-label="清除一级目录搜索" onClick={clear}><X size={17} /></button>}
      </label>
      <div className="library-directory-summary" role="status">{query ? `找到 ${visible.length} 个一级目录` : "全部一级目录"}<span>与左侧目录顺序一致</span></div>
      <div className="library-directory-grid" aria-label="一级目录列表">
        {visible.map((folder) => {
          const state = statuses.get(folder.id);
          const status = !folder.enabled ? "已停用" : state === "queued" ? "等待扫描" : state === "scanning" ? "正在扫描" : state === "paused" ? "扫描已暂停" : state === "offline" ? "最近扫描：离线" : state === "error" || state === "completed-with-errors" || folder.scanError ? "存在扫描异常" : folder.lastScannedAt ? "已扫描" : "尚未扫描";
          const provider = folder.providerType === "clouddrive" ? "CloudDrive" : /^(\\\\|\/\/)/.test(folder.path) ? "NAS / 网络目录" : "本地 / 挂载目录";
          const ProviderIcon = folder.providerType === "clouddrive" ? Cloud : /^(\\\\|\/\/)/.test(folder.path) ? Server : HardDrive;
          return <button type="button" className="library-directory-card" key={folder.id} aria-label={`打开一级目录 ${folderName(folder.path)}`} title={folder.path} onClick={() => onNavigate(folder.path, folder.id)}>
            <Folder className="library-directory-icon" size={46} strokeWidth={1.4} />
            <strong>{highlight(folderName(folder.path), query)}</strong>
            <small className="library-directory-path">{highlight(folder.path, query)}</small>
            <span className="library-directory-meta"><span><ProviderIcon size={13} />{provider}</span><em className={folder.scanError || state === "offline" || state === "error" || state === "completed-with-errors" ? "warning" : undefined}>{status}</em></span>
            <ChevronRight className="library-directory-enter" size={17} />
          </button>;
        })}
      </div>
      {folders.length === 0 ? <div className="library-directory-empty"><Folder size={36} /><h2>还没有添加资料库目录</h2>{onAddFolder && <button type="button" onClick={() => void onAddFolder()}>添加本地或挂载目录</button>}</div>
        : visible.length === 0 && <div className="library-directory-empty"><h2>没有匹配的一级目录</h2><p>试试其他目录名称或路径</p><button type="button" onClick={clear}>显示全部一级目录</button></div>}
    </div>
  </section>;
}

function highlight(value: string, query: string) {
  if (!query) return value;
  const start = normalize(value).indexOf(query);
  if (start < 0) return value;
  return <>{value.slice(0, start)}<mark>{value.slice(start, start + query.length)}</mark>{value.slice(start + query.length)}</>;
}
