import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Folder, GripVertical, LoaderCircle } from "lucide-react";
import type { DirectoryBrowserResult, SourceFolder, VideoManagerApi } from "../../shared/videoTypes";
import { DIRECTORY_TREE_ORDER_KEY, ROOT_ORDER_SCOPE, moveDirectorySibling, orderDirectorySiblings, readDirectoryTreeOrders, type DirectoryTreeOrders } from "./directoryTreeOrder";

interface Props {
  folders: SourceFolder[];
  load?: VideoManagerApi["listDirectoryBrowser"];
  currentPath: string | null;
  selectedSourceId?: string;
  refreshSequence: number;
  onNavigate(path: string, sourceFolderId: string): void;
  renderSource(folder: SourceFolder): ReactNode;
  onSearch?(): void;
  onOrderChange?(orders: DirectoryTreeOrders): void;
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
export function DirectoryFilterTree({ folders, load, currentPath, selectedSourceId, refreshSequence, onNavigate, renderSource, onSearch, onOrderChange }: Props) {
  const tree = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Map<string, { source: string; path: string }>>(() => new Map());
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const requests = useRef(new Map<string, number>());
  const nextRequest = useRef(0);
  const alive = useRef(true);
  const purposes = useRef(new Map<string, string>());
  const nextPurpose = useRef(0);
  const [orders, setOrders] = useState(readDirectoryTreeOrders);
  const [orderMessage, setOrderMessage] = useState("");
  const drag = useRef<{ scope: string; id: string; ids: string[]; pointerId: number; fromX: number; fromY: number; active: boolean } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ scope: string; id: string; after: boolean } | null>(null);

  const saveOrders = (next: DirectoryTreeOrders) => {
    setOrders(next);
    onOrderChange?.(next);
    try {
      localStorage.setItem(DIRECTORY_TREE_ORDER_KEY, JSON.stringify({ version: 1, scopes: [...next] }));
      setOrderMessage(next.size ? "目录顺序已保存" : "已恢复默认顺序");
    } catch { setOrderMessage("顺序已调整，但无法保存；重启后可能丢失本次调整"); }
  };
  const reorder = (scope: string, ids: string[], dragged: string, target: string, after: boolean) => {
    const moved = moveDirectorySibling(ids, dragged, target, after);
    if (!moved) return;
    const next = new Map(orders);
    // Preserve saved siblings outside the first 100 indexed results.
    next.set(scope, [...moved, ...(orders.get(scope) ?? []).filter((id) => !ids.includes(id))]);
    saveOrders(next);
  };
  const endDrag = () => { drag.current = null; setDraggedId(null); setDropTarget(null); };
  const targetAt = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-order-scope]");
    const scope = row?.dataset.orderScope;
    const id = row?.dataset.orderId;
    if (!row || !drag.current || scope !== drag.current.scope || !id || id === drag.current.id || !drag.current.ids.includes(id)) return null;
    const bounds = row.getBoundingClientRect();
    return { scope, id, after: y >= bounds.top + bounds.height / 2 };
  };
  const dragClass = (scope: string, id: string) => `${draggedId === id ? " is-dragging" : ""}${dropTarget?.scope === scope && dropTarget.id === id ? ` drop-${dropTarget.after ? "after" : "before"}` : ""}`;
  const renderHandle = (scope: string, id: string, name: string, ids: string[]) => <button
    type="button" className="directory-tree-drag" draggable={false} aria-label={`拖拽排序 ${name}`}
    title="拖动调整同级顺序；Alt + ↑ / ↓ 也可排序"
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onPointerDown={(event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { scope, id, ids, pointerId: event.pointerId, fromX: event.clientX, fromY: event.clientY, active: false };
    }}
    onPointerMove={(event) => {
      const pending = drag.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (!pending.active && Math.hypot(event.clientX - pending.fromX, event.clientY - pending.fromY) < 4) return;
      pending.active = true;
      setDraggedId(pending.id);
      const nav = event.currentTarget.closest("nav");
      if (nav) {
        const bounds = nav.getBoundingClientRect();
        if (event.clientY < bounds.top + 24) nav.scrollTop -= 12;
        else if (event.clientY > bounds.bottom - 24) nav.scrollTop += 12;
      }
      const target = targetAt(event.clientX, event.clientY);
      setDropTarget((previous) => previous?.scope === target?.scope && previous?.id === target?.id && previous?.after === target?.after ? previous : target);
    }}
    onPointerUp={(event) => {
      const pending = drag.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      const target = pending.active ? targetAt(event.clientX, event.clientY) : null;
      if (target) reorder(scope, pending.ids, id, target.id, target.after);
      endDrag();
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={endDrag}
    onLostPointerCapture={endDrag}
    onKeyDown={(event) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); endDrag(); return; }
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const down = event.key === "ArrowDown";
      const target = ids[ids.indexOf(id) + (down ? 1 : -1)];
      if (target) reorder(scope, ids, id, target, down);
    }}
  ><GripVertical size={13} /></button>;

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

  useEffect(() => {
    if (currentPath) tree.current?.querySelector<HTMLElement>('[aria-current="location"]')?.scrollIntoView?.({ block: "nearest" });
  }, [currentPath, branches]);

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
      {orderDirectorySiblings(items, orders.get(key), (item) => keyFor(source, item.path)).map((item, _index, siblings) => {
        const childKey = keyFor(source, item.path);
        const ids = siblings.map((sibling) => keyFor(source, sibling.path));
        const child = branches[childKey];
        const isExpanded = expanded.has(childKey);
        const leaf = child?.result?.totalCount === 0 && !child.loading && !child.error;
        const selected = currentPath && normalize(currentPath) === normalize(item.path) && (!selectedSourceId || selectedSourceId === source);
        return <div key={childKey}>
          <div className={`directory-tree-row${selected ? " active" : ""}${dragClass(key, childKey)}`} style={{ paddingLeft: `${Math.min(depth, 12) * 14}px` }} data-order-scope={key} data-order-id={childKey}>
            <button type="button" className="directory-tree-toggle" disabled={leaf} aria-label={`展开或收起 ${item.name}`} aria-expanded={isExpanded} onClick={() => toggle(source, item.path)}><ChevronRight size={14} className={isExpanded ? "expanded" : undefined} /></button>
            <button type="button" className="directory-tree-name" title={item.path} aria-current={selected ? "location" : undefined} onClick={() => onNavigate(item.path, source)}><Folder size={16} /><span>{item.name}</span></button>
            {renderHandle(key, childKey, item.name, ids)}
          </div>
          {renderChildren(source, item.path, depth + 1)}
        </div>;
      })}
      {branch?.result?.truncated && onSearch && <button type="button" className="directory-tree-more" onClick={onSearch}>仅显示前 100 个，搜索其他目录</button>}
    </div>;
  };

  const orderedFolders = orderDirectorySiblings(folders, orders.get(ROOT_ORDER_SCOPE), (folder) => folder.id);
  const sourceIds = orderedFolders.map((folder) => folder.id);
  return <div className="directory-tree-browser">
    <nav ref={tree} className="source-root-list" aria-label="资料库来源">
    {orderedFolders.map((folder) => <div key={folder.id}>
      <div className={`directory-tree-root${dragClass(ROOT_ORDER_SCOPE, folder.id)}`} data-order-scope={ROOT_ORDER_SCOPE} data-order-id={folder.id}>
        {load && <button type="button" className="directory-tree-toggle" aria-label={`展开或收起 ${folder.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)}`} aria-expanded={expanded.has(keyFor(folder.id, folder.path))} onClick={() => toggle(folder.id, folder.path)}><ChevronRight size={15} className={expanded.has(keyFor(folder.id, folder.path)) ? "expanded" : undefined} /></button>}
        {renderSource(folder)}
        {renderHandle(ROOT_ORDER_SCOPE, folder.id, folder.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? folder.path, sourceIds)}
      </div>
      {renderChildren(folder.id, folder.path, 1)}
    </div>)}
    {folders.length === 0 && <p className="source-root-empty">还没有添加资料库</p>}
    {orders.size > 0 && <button type="button" className="directory-tree-reset" onClick={() => saveOrders(new Map())}>恢复默认排序</button>}
    {orderMessage && <p className="directory-tree-order-status" role="status" aria-live="polite">{orderMessage}</p>}
    </nav>
  </div>;
}
