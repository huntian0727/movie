import { useEffect, useRef, useState } from "react";
import type { SubtitleAction, SubtitleState } from "../../shared/subtitles";
import type { PlayerSubtitleApi } from "./SubtitleDialog";

export function SubtitleQuickControls({ api, state, onState, onSwitch }: {
  api: PlayerSubtitleApi; state: SubtitleState; onState(value: SubtitleState): void; onSwitch(): void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const action = async (request: Omit<SubtitleAction, "videoId">) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { onState(await api.subtitleAction({ ...request, videoId: state.videoId })); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "字幕调整失败，请重试"); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const selected = state.items.find(item => item.id === state.selectedId);
  return <div className="subtitle-quick-controls" aria-label="字幕快捷操作">
    <span title={selected?.filename}>{selected?.language || "外挂字幕"} · 偏移 {state.offsetSeconds > 0 ? "+" : ""}{state.offsetSeconds.toFixed(1)} 秒</span>
    <button disabled={busy} onClick={onSwitch}>换字幕</button>
    <button disabled={busy || state.offsetSeconds <= -600} onClick={() => void action({ op: "offset", offsetSeconds: Math.max(-600, state.offsetSeconds - 0.5) })}>提前 0.5 秒</button>
    <button disabled={busy || state.offsetSeconds >= 600} onClick={() => void action({ op: "offset", offsetSeconds: Math.min(600, state.offsetSeconds + 0.5) })}>延后 0.5 秒</button>
    <button disabled={busy} onClick={() => void action({ op: "select", id: null })}>关闭字幕</button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
