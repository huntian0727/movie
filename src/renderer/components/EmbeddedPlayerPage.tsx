import { useEffect, useRef, useState } from "react";
import type { VideoManagerApi, VideoRecord } from "../../shared/videoTypes";
import type { EmbeddedRequest, EmbeddedState } from "../../shared/embeddedPlayback";
import { formatDuration } from "./formatters";

interface Props {
  api: VideoManagerApi;
  video: VideoRecord;
  autoplay: boolean;
  startPositionMs?: number;
  startRequestId?: string;
  queue: VideoRecord[];
  onSelect(videoId: string): Promise<void>;
  onFallback(positionMs: number): void;
}
const labels = { idle: "准备播放", loading: "正在读取视频", playing: "播放中", paused: "已暂停", reading: "正在读取目标位置", buffering: "正在缓冲，可退出或切换播放器", failed: "播放失败", ended: "播放已结束" };
export function EmbeddedPlayerPage({ api, video, autoplay, startPositionMs, startRequestId, queue, onSelect, onFallback }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef("");
  const [state, setState] = useState<EmbeddedState | null>(null);
  const current = useRef(state); current.current = state;
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const send = async (request: Omit<EmbeddedRequest, "sessionKey">) => {
    try { await api.embeddedPlayback({ ...request, sessionKey: session.current } as EmbeddedRequest); setError(null); }
    catch { setError("操作未完成，请重试或改用原播放器"); }
  };
  useEffect(() => {
    let disposed = false, polling = false;
    const key = crypto.randomUUID(); session.current = key; setState(null); setError(null);
    const call = (request: EmbeddedRequest) => api.embeddedPlayback(request);
    const measure = () => {
      if (!stage.current || disposed) return;
      const r = stage.current.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      void call({ op: "bounds", sessionKey: key, x: Math.max(0, Math.round(r.x * d)), y: Math.max(0, Math.round(r.y * d)), width: Math.max(1, Math.floor(r.width * d)), height: Math.max(1, Math.floor(r.height * d)) }).catch(() => undefined);
    };
    void call({ op: "start", sessionKey: key, videoId: video.id, autoplay, ...(startPositionMs === undefined ? {} : { positionMs: startPositionMs }) }).then(s => {
      if (!disposed) { setState(s); measure(); }
    }).catch(() => { if (!disposed) setError("无法启动内嵌播放，请改用原播放器"); });
    const tick = async () => {
      if (disposed || polling) return;
      polling = true;
      try { const s = await call({ op: "state", sessionKey: key }); if (!disposed) setState(s); }
      catch { if (!disposed) setError("播放服务不可用，可退出或改用原播放器"); }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => void tick(), 250);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (stage.current) observer?.observe(stage.current);
    window.addEventListener("resize", measure);
    const unsubscribe = api.subscribeEmbeddedKeys(code => {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement) return;
      if (code === "Space") void call({ op: "pause", sessionKey: key, value: !current.current?.paused }).catch(() => undefined);
      else void call({ op: "fullscreen", sessionKey: key, value: code === "Escape" ? false : !current.current?.fullscreen }).catch(() => undefined);
    });
    return () => {
      disposed = true; window.clearInterval(timer); observer?.disconnect(); window.removeEventListener("resize", measure); unsubscribe();
      void call({ op: "stop", sessionKey: key }).catch(() => undefined);
    };
  }, [video.id, startRequestId, retry]);
  const index = queue.findIndex(v => v.id === video.id);
  const ready = state && !["loading", "idle", "failed", "ended"].includes(state.phase);
  const fallback = async () => {
    const positionMs = Math.max(0, Math.trunc((current.current?.time ?? 0) * 1000));
    await api.embeddedPlayback({ op: "stop", sessionKey: session.current }).catch(() => undefined);
    onFallback(positionMs);
  };
  const select = async (id: string) => {
    try { await onSelect(id); } catch { setError("切换视频失败，请重试"); }
  };
  const external = async () => {
    const positionMs = Math.max(0, Math.trunc((state?.time ?? 0) * 1000));
    await api.embeddedPlayback({ op: "stop", sessionKey: session.current }).catch(() => undefined);
    try { await api.playExternalVideo(video.id, positionMs); } catch { setError("外部播放器启动失败，可退回原播放方式"); }
  };
  return <section className="embedded-player-page">
    <header className="embedded-player-header">
      <strong title={video.filename}>{video.filename}</strong><span>内嵌 MPV · 试用</span>
      <button onClick={() => void fallback()}>退回原播放方式</button>
      <button onClick={() => void external()}>使用外部 MPV</button><button onClick={() => window.close()}>关闭</button>
    </header>
    <div ref={stage} className="embedded-player-stage" aria-label="内嵌视频画面" />
    <footer className="embedded-player-controls">
      <div role="status">{error ?? state?.error ?? labels[state?.phase ?? "idle"]}</div>
      <input aria-label="播放进度" type="range" min={0} max={Math.max(state?.duration ?? 0, 1)} step={0.1} value={Math.min(state?.time ?? 0, state?.duration || 1)} disabled={!ready} onChange={e => void send({ op: "seek", value: Number(e.target.value) } as EmbeddedRequest)} />
      <div className="embedded-player-buttons">
        <button disabled={!ready} onClick={() => void send({ op: "pause", value: !state?.paused } as EmbeddedRequest)}>{state?.paused ? "播放" : "暂停"}</button>
        <button disabled={!ready} onClick={() => void send({ op: "seek", value: Math.max(0, (state?.time ?? 0) - 10) } as EmbeddedRequest)}>后退 10 秒</button>
        <button disabled={!ready} onClick={() => void send({ op: "seek", value: Math.min(state?.duration ?? 0, (state?.time ?? 0) + 10) } as EmbeddedRequest)}>前进 10 秒</button>
        <span>{formatDuration((state?.time ?? 0) * 1000)} / {formatDuration((state?.duration ?? 0) * 1000)}</span>
        <label>音量 <input aria-label="音量" type="range" min={0} max={100} value={state?.volume ?? 20} disabled={!ready} onChange={e => void send({ op: "volume", value: Number(e.target.value) } as EmbeddedRequest)} /></label>
        <button disabled={!ready} onClick={() => void send({ op: "rotate", value: ((state?.rotation ?? 0) + 90) % 360 } as EmbeddedRequest)}>旋转 90°</button>
        <button onClick={() => void send({ op: "fullscreen", value: !state?.fullscreen } as EmbeddedRequest)}>{state?.fullscreen ? "退出全屏" : "全屏"}</button>
        <button onClick={() => setRetry(n => n + 1)}>重新加载</button>
      </div>
      <div className="embedded-player-buttons">
        <button disabled={index <= 0} onClick={() => void select(queue[index - 1].id)}>上一部</button>
        <select aria-label="播放队列" value={video.id} onChange={e => void select(e.target.value)}>{queue.map(v => <option key={v.id} value={v.id}>{v.filename}</option>)}</select>
        <button disabled={index < 0 || index >= queue.length - 1} onClick={() => void select(queue[index + 1].id)}>下一部</button>
        <label>音轨 <select aria-label="音轨" disabled={!ready} value={state?.tracks.find(t => t.type === "audio" && t.selected)?.id ?? 0} onChange={e => void send({ op: "audio-track", value: Number(e.target.value) } as EmbeddedRequest)}><option value={0}>关闭</option>{state?.tracks.filter(t => t.type === "audio").map(t => <option key={t.id} value={t.id}>{t.id} · {t.codec}</option>)}</select></label>
        <label>字幕 <select aria-label="字幕" disabled={!ready} value={state?.tracks.find(t => t.type === "sub" && t.selected)?.id ?? 0} onChange={e => void send({ op: "subtitle-track", value: Number(e.target.value) } as EmbeddedRequest)}><option value={0}>关闭</option>{state?.tracks.filter(t => t.type === "sub").map(t => <option key={t.id} value={t.id}>{t.id} · {t.codec}</option>)}</select></label>
        <button disabled={!ready} onClick={() => void send({ op: "subtitle-file" })}>加载 SRT 字幕</button>
      </div>
      <small>仅个人试用；默认仍为原播放策略。读取慢不等于解码失败，长时稳定性尚未验收。</small>
    </footer>
  </section>;
}
