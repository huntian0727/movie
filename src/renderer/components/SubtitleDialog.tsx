import { useEffect, useRef, useState } from "react";
import { Download, Search, X } from "lucide-react";
import type { SubtitleAction, SubtitleApi, SubtitleSearchResult, SubtitleState } from "../../shared/subtitles";
import type { VideoRecord } from "../../shared/videoTypes";

export type PlayerSubtitleApi = Pick<SubtitleApi, "openSubtitleWebsite" | "getSubtitleConfig" | "searchSubtitles" | "getSubtitleState" | "subtitleAction">;
const label = (p: string) => p === "assrt" ? "ASSRT 射手网" : "OpenSubtitles";
export function SubtitleDialog({ video, api, state, onState, onClose, external, stateError, onRetryState }: {
  video: VideoRecord; api: PlayerSubtitleApi; state: SubtitleState | null;
  onState(value: SubtitleState): void; onClose(): void; external: boolean;
  stateError?: string; onRetryState?(): void;
}) {
  const [query, setQuery] = useState(video.filename.replace(/\.[a-z0-9]+$/i, "").replace(/[._]/g, " ").replace(/\b(?:720p|1080p|2160p|blu[ -]?ray|web[ -]?(?:dl|rip)|remux|x26[45]|hevc)\b.*$/i, "").trim());
  const [language, setLanguage] = useState<"chinese" | "bilingual" | "english">("chinese");
  const [provider, setProvider] = useState<"all" | "assrt" | "opensubtitles">("all");
  const [result, setResult] = useState<SubtitleSearchResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [offset, setOffset] = useState(String(state?.offsetSeconds ?? 0));
  const alive = useRef(true), panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const inFlight = useRef(false);
  useEffect(() => { setOffset(String(state?.offsetSeconds ?? 0)); }, [state?.offsetSeconds]);
  useEffect(() => {
    alive.current = true;
    const focused = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLInputElement>("input"); first?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const controls = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
      if (!controls?.length) return;
      const firstControl = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); firstControl.focus(); }
    };
    document.addEventListener("keydown", keys, true);
    return () => { alive.current = false; document.removeEventListener("keydown", keys, true); focused?.focus(); };
  }, []);
  const perform = async (name: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(name); setError(null); setHint(null);
    try { await work(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "字幕操作失败，请重试"); }
    finally { inFlight.current = false; if (alive.current) setBusy(null); }
  };
  const action = (request: Omit<SubtitleAction, "videoId">) => perform(request.op, async () => {
    const value = await api.subtitleAction({ ...request, videoId: video.id });
    onState(value);
    if (!alive.current) return;
    setHint(request.op === "download" ? "字幕已保存并选用。若不同步，可调整时间偏移。" : request.op === "export" ? "导出窗口已关闭。" : "字幕设置已保存。");
  });
  return <div className="subtitle-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="subtitle-dialog" role="dialog" aria-modal="true" aria-labelledby="subtitle-title">
      <header><div><h2 id="subtitle-title">查找字幕</h2><p title={video.filename}>{video.filename}</p></div><button className="player-icon-button" aria-label="关闭字幕面板" onClick={onClose}><X size={20} /></button></header>
      <div className="subtitle-body">
        <form className="subtitle-search" onSubmit={event => { event.preventDefault(); void perform("search", async () => {
          const value = await api.searchSubtitles({ videoId: video.id, query, language, provider });
          if (alive.current) { setResult(value); setQuery(value.query); }
        }); }}>
          <label>影片名称或发行版本<input value={query} maxLength={240} onChange={e => { setQuery(e.target.value); setResult(null); }} placeholder="例如：电影英文名 2024 / S01E02" disabled={!!busy} /></label>
          <div className="subtitle-search-options"><label>语言<select value={language} onChange={e => { setLanguage(e.target.value as typeof language); setResult(null); }} disabled={!!busy}><option value="chinese">中文字幕</option><option value="bilingual">中英双语</option><option value="english">英语</option></select></label>
          <label>来源<select value={provider} onChange={e => { setProvider(e.target.value as typeof provider); setResult(null); }} disabled={!!busy}><option value="all">全部已配置来源</option><option value="assrt">ASSRT 射手网</option><option value="opensubtitles">OpenSubtitles</option></select></label>
          <button type="submit" className="primary-button" disabled={!!busy}><Search size={16} />{busy === "search" ? "搜索中…" : "搜索字幕"}</button></div>
        </form>
        <p className="subtitle-note">在主窗口的设置中配置字幕来源。匹配分是片名、年份和版本线索的排序参考；请核对发行版本后下载。</p>
        <p className="subtitle-note">字幕服务由 <a href="https://assrt.net/" onClick={e => { e.preventDefault(); void api.openSubtitleWebsite("assrt").catch(() => setError("无法打开字幕网站，请在浏览器访问 assrt.net")); }}>ASSRT 射手网</a> 和 <a href="https://www.opensubtitles.com/" onClick={e => { e.preventDefault(); void api.openSubtitleWebsite("opensubtitles").catch(() => setError("无法打开字幕网站，请在浏览器访问 opensubtitles.com")); }}>OpenSubtitles</a> 提供。</p>
        {external && <p className="subtitle-note">外部播放器请导出字幕后手动载入；已保存的选择会用于内置播放器。</p>}
        {error && <p role="alert" className="subtitle-error">{error}</p>}
        {(hint || state?.message) && <p role="status" className="subtitle-note">{state?.message || hint}</p>}
        {result && <section aria-label="字幕搜索结果">
          {result.providers.map(p => <p key={p.provider} className={p.status === "failed" ? "subtitle-error" : "subtitle-note"}>{label(p.provider)} · {p.status === "ok" ? "搜索完成" : p.message}</p>)}
          {!result.candidates.length && result.providers.some(p => p.status === "ok") && <p className="subtitle-empty">没有找到可直接下载的字幕。可尝试英文片名、年份或具体季集。</p>}
          <div className="subtitle-results">{result.candidates.map(c => <article key={c.id} className="subtitle-result">
            <div><strong>{c.title}</strong><p>{c.language} · {label(c.provider)} · {c.format.toUpperCase()} · 匹配分 {c.score}</p><p className="subtitle-release">{c.release}</p><small>{c.filename}</small><small>{c.matches.length ? c.matches.join(" · ") : "尚无版本匹配线索"}{c.downloads !== null ? ` · 下载 ${c.downloads}` : ""}</small></div>
            <button disabled={!!busy} onClick={() => void action({ op: "download", id: c.id })}><Download size={16} />下载并使用</button>
          </article>)}</div>
        </section>}
        <section className="subtitle-saved" aria-label="已保存字幕"><h3>已保存字幕</h3>
          {!state ? stateError ? <div><p role="alert" className="subtitle-error">{stateError}</p><button onClick={onRetryState}>重新读取字幕记录</button></div> : <p className="subtitle-note">正在读取字幕记录…</p> : <>
          <label>当前字幕<select value={state.selectedId ?? ""} disabled={!!busy} onChange={e => void action({ op: "select", id: e.target.value || null })}><option value="">关闭外挂字幕</option>{state.items.map(s => <option key={s.id} value={s.id}>{s.language} · {s.filename} · {label(s.provider)}</option>)}</select></label>
          <div className="subtitle-offset"><label>时间偏移（秒）<input type="number" min={-600} max={600} step={0.5} value={offset} onChange={e => setOffset(e.target.value)} disabled={!!busy || !state.selectedId} /></label>
          <button disabled={!!busy || !state.selectedId || !offset.trim() || !Number.isFinite(Number(offset)) || Math.abs(Number(offset)) > 600} onClick={() => void action({ op: "offset", offsetSeconds: Number(offset) })}>应用偏移</button>
          <button disabled={!!busy || !state.selectedId} onClick={() => void action({ op: "export", id: state.selectedId })}>导出原始字幕</button></div>
          <p className="subtitle-note">正数让字幕晚出现，负数让字幕早出现。字幕独立保存，清理封面缓存不会删除。</p>
          </>}
        </section>
        {busy && <p role="status" className="subtitle-note">{busy === "search" ? "正在查询字幕来源…" : busy === "download" ? "正在下载并校验字幕…" : "正在处理…"} 可以关闭面板，操作完成后字幕会保存到当前影片。</p>}
      </div>
    </div>
  </div>;
}
