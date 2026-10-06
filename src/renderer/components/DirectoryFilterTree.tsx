import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Folder, LoaderCircle } from "lucide-react";
import type { DirectoryBrowserResult, SourceFolder, VideoManagerApi } from "../../shared/videoTypes";

interface Props {
  folders: SourceFolder[];
  load?: VideoManagerApi["listDirectoryBrowser"];
  currentPath: string | null;
  selectedSourceId?: string;
  refreshSequence: number;
  onNavigate(path: string, sourceFolderId: string): void;
  onSearch(): void;
  renderSource(folder: SourceFolder): ReactNode;
}

interface Branch {
  revision: number;
  result?: DirectoryBrowserResult;
  error?: string;
  loading: boolean;
}

const normalize = (path: string) => path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
const keyFor = (source: string, path: string) => JSON.stringify([source, normalize(path)]);

/** Only expanded branches are read. Source menus retain their existing actions. */
export function DirectoryFilterTree({ folders, load, currentPath, selectedSourceId, refreshSequence, onNavigate, onSearch, renderSource }: Props) {
  const [expanded, setExpanded] = useState<Map<string, { source: string; path: string }>>(() => new Map());
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const requests = useRef(new Map<string, number>());
  const nextRequest = useRef(0);
  const alive = useRef(true);
  const purposes = useRef(new Map<string, string>());
  const nextPurpose = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requests.current.clear(); };
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    const source = folders.find((folder) => folder.id === selectedSourceId)
      ?? folders.filter((folder) => normalize(currentPath) === normalize(folder.path) || normalize(currentPath).startsWith(`${normalize(folder.path)}\\`)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!source) return;
    const root = source.path.replace(/[\\/]+$/, "");
    if (normalize(currentPath) !== normalize(root) && !normalize(currentPath).startsWith(`${normalize(root)}\\`)) return;
    const parts = currentPath.slice(root.length).replace(/^[\\/]+/, "").split(/[\\/]+/).filter(Boolean);
    setExpanded((previous) => {
      const next = new Map(previous);
      let path = root;
      next.set(keyFor(source.id, path), { source: source.id, path });
      for (const part of parts) {
        path = `${path}\\${part}`;
        next.set(keyFor(source.id, path), { source: source.id, path });
      }
      return next;
    });
  }, [currentPath, selectedSourceId, folders]);

  useEffect(() => {
    if (!load) return;
    for (const [key, node] of expanded) {
      if (!folders.some((folder) => folder.id === node.source)) continue;
      if (branches[key]?.revision === refreshSequence) continue;
      const id = ++nextRequest.current;
      requests.current.set(key, id);
      let purpose = purposes.current.get(key);
      if (!purpose) {
        purpose = `directory-tree-${++nextPurpose.current}`;
        purposes.current.set(key, purpose);
      }
      setBranches((previous) => ({ ...previous, [key]: { revision: refreshSequence, loading: true, result: previous[key]?.result } }));
      void load({ sourceFolderId: node.source, parentPath: node.path, search: "", limit: 100 }, purpose).then((result) => {
        if (alive.current && requests.current.get(key) === id) setBranches((previous) => ({ ...previous, [key]: { revision: refreshSequence, loading: false, result } }));
      }).catch((cause) => {
        if (alive.current && requests.current.get(key) === id) setBranches((previous) => ({ ...previous, [key]: { revision: refreshSequence, loading: false, error: cause instanceof Error ? cause.message : String(cause) } }));
      });
    }
  }, [branches, expanded, folders, load, refreshSequence]);

  const toggle = (source: string, path: string) => {
    const key = keyFor(source, path);
    setExpanded((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else next.set(key, { source, path });
      return next;
    });
  };
  const retry = (key: string) => setBranches((previous) => {
    const next = { ...previous };
    delete next[key];
    return next;
  });
  const renderChildren = (source: string, path: string, depth: number): ReactNode => {
    const key = keyFor(source, path);
    if (!expanded.has(key)) return null;
    const branch = branches[key];
    const items = [...(branch?.result?.items ?? [])].filter((item) => normalize(item.path).startsWith(`${normalize(path)}\\`));
    // A search result can sit beyond the first 100 siblings. Still reveal its ancestry.
    if (branch?.result && currentPath && (!selectedSourceId || selectedSourceId === source) && normalize(currentPath).startsWith(`${normalize(path)}\\`)) {
      const name = currentPath.slice(path.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "").split(/[\\/]/)[0];
      const childPath = `${path.replace(/[\\/]+$/, "")}\\${name}`;
      if (name && !items.some((item) => normalize(item.path) === normalize(childPath))) items.unshift({ sourceFolderId: source, path: childPath, name, videoCount: 0, sizeBytes: 0, modifiedAt: null });
    }
    return <div className="directory-tree-children">
      {(!branch || branch.loading) && <p className="directory-tree-message" role="status"><LoaderCircle size={13} className="spin" />正在读取目录</p>}
      {branch?.error && <div className="directory-tree-message" role="alert"><span title={branch.error}>目录读取失败</span><button type="button" onClick={() => retry(key)}>重试</button></div>}
      {items.map((item) => {
        const childKey = keyFor(source, item.path);
        const child = branches[childKey];
        const isExpanded = expanded.has(childKey);
        const leaf = child?.result?.totalCount === 0 && !child.loading && !child.error;
        const selected = currentPath && normalize(currentPath) === normalize(item.path) && (!selectedSourceId || selectedSourceId === source);
        return <div key={childKey}>
          <div className={`directory-tree-row${selected ? " active" : ""}`} style={{ paddingLeft: `${Math.min(depth, 12) * 14}px` }}>
            <button type="button" className="directory-tree-toggle" disabled={leaf} aria-label={`展开或收起 ${item.name}`} aria-expanded={isExpanded} onClick={() => toggle(source, item.path)}><ChevronRight size={14} className={isExpanded ? "expanded" : undefined} /></button>
            <button type="button" className="directory-tree-name" title={item.path} aria-current={selected ? "location" : undefined} onClick={() => onNavigate(item.path, source)}><Folder size={16} /><span>{item.name}</span></button>
          </div>
          {renderChildren(source, item.path, depth + 1)}
        </div>;
      })}
      {branch?.result?.truncated && <button type="button" className="directory-tree-more" onClick={onSearch}>仅显示前 100 个，搜索其他目录</button>}
    </div>;
  };

  return <nav className="source-root-list" aria-label="资料库来源">
    {folders.map((folder) => <div key={folder.id}>
      <div className="directory-tree-root">
        {load && <button type="button" className="directory-tree-toggle" aria-label={`展开或收起 ${folder.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)}`} aria-expanded={expanded.has(keyFor(folder.id, folder.path))} onClick={() => toggle(folder.id, folder.path)}><ChevronRight size={15} className={expanded.has(keyFor(folder.id, folder.path)) ? "expanded" : undefined} /></button>}
        {renderSource(folder)}
      </div>
      {renderChildren(folder.id, folder.path, 1)}
    </div>)}
    {folders.length === 0 && <p className="source-root-empty">还没有添加资料库</p>}
  </nav>;
}
