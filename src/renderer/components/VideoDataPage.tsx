import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SourceFolder, VideoManagerApi, VideoRecord } from "../../shared/videoTypes";
import { videoDataQuerySchema, videoDataStatus, type VideoDataPage as Page, type VideoDataQuery, type VideoDataSelection } from "../../shared/videoDataTable";
import { formatBytes, formatDateTime, formatDuration } from "./formatters";
import "./videoDataPage.css";

interface Props {
  load: VideoManagerApi["listVideoData"];
  exportCsv: VideoManagerApi["exportVideoData"];
  folders: SourceFolder[];
  initialDirectory?: string;
  onDetails(video: VideoRecord): void;
  onDiagnostic(video: VideoRecord): void;
}
const storageKey = "video-manager:video-data-preferences";
function preferences(): { pageSize: 50 | 100 | 200; extra: boolean } {
  try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); return { pageSize: [50, 100, 200].includes(saved.pageSize) ? saved.pageSize : 100, extra: saved.extra === true }; }
  catch { return { pageSize: 100, extra: false }; }
}
const emptySelection = (): VideoDataSelection => ({ all: false, ids: [], excludedIds: [] });
const sourceLabel = { local: "本地 / 挂载盘", nas: "NAS / SMB", clouddrive: "CloudDrive" };
export function VideoDataPage({ load, exportCsv, folders, initialDirectory = "", onDetails, onDiagnostic }: Props) {
  const [query, setQuery] = useState<VideoDataQuery>(() => videoDataQuerySchema.parse({ pageSize: preferences().pageSize, directory: initialDirectory }));
  const [search, setSearch] = useState("");
  const [extra, setExtra] = useState(() => preferences().extra);
  const [result, setResult] = useState<Page | null>(null);
  const [selection, setSelection] = useState(emptySelection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [jump, setJump] = useState("1");
  const request = useRef(0);
  const patch = (value: Partial<VideoDataQuery>, resetSelection = true) => {
    setQuery(old => ({ ...old, ...value, page: value.page ?? 1 }));
    if (resetSelection) setSelection(emptySelection());
    setNotice("");
  };
  useEffect(() => {
    if (search === query.search) return;
    const timer = setTimeout(() => {
      setQuery(old => old.search === search ? old : { ...old, search, page: 1 });
      setSelection(emptySelection());
    }, 350);
    return () => clearTimeout(timer);
  }, [search, query.search]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify({ pageSize: query.pageSize, extra })); } catch { /* Preferences are optional. */ } }, [query.pageSize, extra]);
  useEffect(() => {
    const id = ++request.current;
    setLoading(true); setError("");
    void load(query).then(page => {
      if (id !== request.current) return;
      setResult(page); setJump(String(page.page));
    }).catch(reason => { if (id === request.current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current++; };
  }, [load, query, revision]);
  const isSelected = (id: string) => selection.all ? !selection.excludedIds.includes(id) : selection.ids.includes(id);
  const selectedCount = selection.all ? Math.max(0, (result?.totalCount ?? 0) - selection.excludedIds.length) : selection.ids.length;
  const toggle = (ids: string[], checked: boolean) => setSelection(old => {
    const values = new Set(old.all ? old.excludedIds : old.ids);
    ids.forEach(id => { if (checked !== old.all) values.add(id); else values.delete(id); });
    return old.all ? { ...old, excludedIds: [...values] } : { ...old, ids: [...values] };
  });
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const numeric = (name: string, factor: number) => data.get(name) ? Number(data.get(name)) * factor : undefined;
    const from = String(data.get("addedFrom") ?? ""), to = String(data.get("addedTo") ?? "");
    const end = to ? new Date(`${to}T00:00:00`) : undefined;
    if (end) end.setDate(end.getDate() + 1);
    const filters = { directory: String(data.get("directory") ?? ""), minSize: numeric("minSize", 1024 ** 3), maxSize: numeric("maxSize", 1024 ** 3), minDuration: numeric("minDuration", 60000), maxDuration: numeric("maxDuration", 60000), addedFrom: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, addedTo: end?.toISOString() };
    if ((filters.minSize ?? 0) > (filters.maxSize ?? Infinity) || (filters.minDuration ?? 0) > (filters.maxDuration ?? Infinity) || (filters.addedFrom && filters.addedTo && filters.addedFrom >= filters.addedTo)) { setError("范围起点不能大于终点"); return; }
    patch(filters);
  };
  const exportSelected = async () => {
    setExporting(true); setNotice("");
    try { const exported = await exportCsv(query, selection); if (!exported.cancelled) setNotice(`已导出 ${exported.count.toLocaleString()} 条记录：${exported.path}`); }
    catch (reason) { setNotice(`导出失败：${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setExporting(false); }
  };
  const sort = (field: VideoDataQuery["sort"]) => patch({ sort: field, direction: query.sort === field && query.direction === "desc" ? "asc" : "desc" }, false);
  const heading = (label: string, field: VideoDataQuery["sort"]) => <th aria-sort={query.sort === field ? query.direction === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => sort(field)}>{label}{query.sort === field ? query.direction === "asc" ? " ↑" : " ↓" : ""}</button></th>;
  return <section className="video-data-page" aria-label="视频数据表">
    <header className="video-data-header"><div><h1>视频数据表</h1><p>{result ? `${result.totalCount.toLocaleString()} 条记录 · ${formatBytes(result.totalBytes)}` : "正在读取资料库"} · 仅查询已入库信息</p></div><button onClick={() => { setRevision(v => v + 1); setSelection(emptySelection()); }} disabled={loading}>刷新</button></header>
    <div className="video-data-filters">
      <label className="video-data-search">搜索文件名或完整路径<input type="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") patch({ search }); }} placeholder="输入关键词" /></label>
      <label>资料库<select value={query.sourceFolderId} onChange={event => patch({ sourceFolderId: event.target.value })}><option value="">全部资料库</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
      <label>来源<select value={query.sourceType} onChange={event => patch({ sourceType: event.target.value as VideoDataQuery["sourceType"] })}><option value="all">全部来源</option>{Object.entries(sourceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>状态<select value={query.status} onChange={event => patch({ status: event.target.value as VideoDataQuery["status"] })}>{Object.entries({ all: "全部状态", normal: "正常", missing: "文件缺失", failed: "元数据异常", pending: "元数据待处理", pendingDelete: "待删除" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <details className="video-data-advanced"><summary>目录、大小、时长和添加时间筛选</summary><form onSubmit={applyFilters}>
      <label>目录（包含子目录）<input name="directory" defaultValue={initialDirectory} placeholder="例如 F:\\视频" /></label>
      <label>最小大小 GB<input name="minSize" type="number" min="0" step="any" /></label><label>最大大小 GB<input name="maxSize" type="number" min="0" step="any" /></label>
      <label>最短时长 分钟<input name="minDuration" type="number" min="0" step="any" /></label><label>最长时长 分钟<input name="maxDuration" type="number" min="0" step="any" /></label>
      <label>添加日期起<input name="addedFrom" type="date" /></label><label>添加日期止<input name="addedTo" type="date" /></label><button type="submit">应用筛选</button>
      <button type="reset" onClick={() => { setSearch(""); setQuery(videoDataQuerySchema.parse({ pageSize: query.pageSize })); setSelection(emptySelection()); }}>清除所有筛选</button>
    </form></details>
    <div className="video-data-actions"><span>已选 {selectedCount.toLocaleString()} 条{selection.all ? "（全部筛选结果）" : ""}</span>
      <button disabled={loading || !!error || !result?.totalCount} onClick={() => setSelection({ all: true, ids: [], excludedIds: [] })}>选择全部筛选结果</button>
      <button onClick={() => setSelection(emptySelection())} disabled={!selectedCount}>取消选择</button>
      <button onClick={() => void exportSelected()} disabled={loading || !!error || !selectedCount || exporting}>{exporting ? "正在后台导出…" : "导出选中 CSV"}</button>
      <label><input type="checkbox" checked={extra} onChange={event => setExtra(event.target.checked)} />显示编码、分辨率和修改时间</label>
    </div>
    {notice && <p role="status" className="video-data-notice">{notice}</p>}
    {error && <div role="alert" className="error-banner">{error}<button onClick={() => setRevision(v => v + 1)}>重试</button></div>}
    <div aria-busy={loading} className="video-data-table-wrap">
      {loading && <p role="status">正在查询…</p>}
      <table><thead><tr><th><input aria-label="全选本页" type="checkbox" disabled={loading || !!error || !result?.items.length} checked={!!result?.items.length && result.items.every(video => isSelected(video.id))} onChange={event => toggle(result?.items.map(video => video.id) ?? [], event.target.checked)} /></th>{heading("文件名", "filename")}<th>所在目录</th>{heading("大小", "sizeBytes")}{heading("时长", "durationMs")}{heading("添加时间", "importedAt")}<th>来源</th><th>状态</th>{extra && <><th>分辨率</th><th>编码</th>{heading("修改时间", "modifiedAt")}</>}<th>操作</th></tr></thead>
      <tbody>{!loading && !error && result?.items.map(video => <tr key={video.id} className={isSelected(video.id) ? "selected" : undefined}>
        <td><input aria-label={`选择 ${video.filename}`} type="checkbox" checked={isSelected(video.id)} onChange={event => toggle([video.id], event.target.checked)} /></td>
        <td className="video-data-name"><button title={video.filename} onClick={() => onDetails(video)}>{video.filename}</button></td>
        <td className="video-data-path" title={video.directory}>{video.directory}</td><td>{formatBytes(video.sizeBytes)}</td><td>{video.durationMs === null ? "未知" : formatDuration(video.durationMs)}</td><td>{video.importedAt ? formatDateTime(video.importedAt) : "未知"}</td><td title={video.sourcePath}>{sourceLabel[video.sourceType]}</td><td>{videoDataStatus(video)}</td>
        {extra && <><td>{video.width && video.height ? `${video.width} × ${video.height}` : "未知"}</td><td>{video.videoCodec ?? "未知"}</td><td>{formatDateTime(video.modifiedAt)}</td></>}
        <td><button onClick={() => onDiagnostic(video)}>诊断</button><button onClick={() => { void navigator.clipboard.writeText(video.path).then(() => setNotice("已复制完整路径"), () => setNotice("复制失败，请在详情中复制路径")); }}>复制路径</button></td>
      </tr>)}</tbody></table>
      {!loading && !error && !result?.items.length && <p className="video-data-empty">没有符合条件的视频记录，请调整筛选条件。</p>}
    </div>
    <footer className="video-data-pagination"><label>每页<select value={query.pageSize} onChange={event => patch({ pageSize: Number(event.target.value) as 50 | 100 | 200 }, false)}>{[50, 100, 200].map(size => <option key={size}>{size}</option>)}</select></label>
      <button disabled={loading || !result || result.page <= 1} onClick={() => patch({ page: (result?.page ?? 1) - 1 }, false)}>上一页</button><span>{result?.page ?? 1} / {result?.totalPages ?? 1} 页</span><button disabled={loading || !result || result.page >= result.totalPages} onClick={() => patch({ page: (result?.page ?? 1) + 1 }, false)}>下一页</button>
      <form onSubmit={event => { event.preventDefault(); const page = Number(jump); if (Number.isInteger(page) && page > 0) patch({ page: Math.min(page, result?.totalPages ?? 1) }, false); }}><input aria-label="跳转页码" type="number" min="1" max={result?.totalPages ?? 1} value={jump} onChange={event => setJump(event.target.value)} /><button disabled={loading}>跳转</button></form>
    </footer><p className="video-data-footnote">添加时间指加入映匣的时间。状态来自最近保存的记录；导出按执行时的数据生成。映射盘的实际来源无法确定时显示“本地 / 挂载盘”。</p>
  </section>;
}
