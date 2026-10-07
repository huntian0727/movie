import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

const storageKey = (id: string) => `video-manager:sidebar-group:${id}`;

/** Keep children mounted so collapsing a group never resets its directory tree. */
export function SidebarMenuGroup({ id, title, children, active = false, count, className = "", onOpen }: {
  id: string;
  title: string;
  children: ReactNode;
  active?: boolean;
  count?: number;
  className?: string;
  onOpen?(): void;
}) {
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(storageKey(id)) !== "collapsed"; }
    catch { return true; }
  });
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(storageKey(id), next ? "expanded" : "collapsed"); }
    catch { /* The menu remains usable when preference storage is unavailable. */ }
  };
  return <section className={`sidebar-menu-group ${className}${expanded ? "" : " is-collapsed"}`} aria-label={title}>
    {onOpen ? <div className={`sidebar-menu-heading${active ? " active" : ""}`}>
      <button type="button" className="sidebar-menu-fold" aria-label={`展开或收起${title}菜单`} aria-expanded={expanded} aria-controls={`sidebar-menu-${id}`} onClick={toggle}><ChevronRight size={15} className={expanded ? "expanded" : undefined} /></button>
      <button type="button" className="sidebar-menu-open" aria-label={`查看${title}`} aria-current={active ? "page" : undefined} onClick={onOpen}><span>{title}</span>{count !== undefined && <small>{count}</small>}</button>
    </div> : <button type="button" className={`sidebar-menu-toggle${active && !expanded ? " has-active-page" : ""}`} aria-label={`展开或收起${title}菜单`} aria-expanded={expanded} aria-controls={`sidebar-menu-${id}`} onClick={toggle} title={title}>
      <ChevronRight size={15} className={expanded ? "expanded" : undefined} />
      <span>{title}</span>
      {count !== undefined && <small>{count}</small>}
    </button>}
    <div id={`sidebar-menu-${id}`} className="sidebar-menu-content" hidden={!expanded}>{children}</div>
  </section>;
}
