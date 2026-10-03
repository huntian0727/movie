import type { EmbeddedState } from "../../shared/embeddedPlayback";

type TrackCommand = { op: "audio-track" | "subtitle-track"; value: number } | { op: "subtitle-file" };

/** Displays decoded tracks only; never probes, reads or enumerates library files. */
export function EmbeddedMediaControls({ state, error, send }: {
  state: EmbeddedState | null;
  error?: string | null;
  send(command: TrackCommand): Promise<void>;
}) {
  const ready = Boolean(state && !error && ["playing", "paused", "reading", "buffering"].includes(state.phase));
  const audio = state?.tracks.filter(t => t.type === "audio") ?? [];
  const subtitles = state?.tracks.filter(t => t.type === "sub") ?? [];
  return <div className="player-media-controls" aria-label="音轨与字幕控制">
    <label>音轨 <select aria-label="音轨" disabled={!ready || audio.length === 0} value={audio.find(t => t.selected)?.id ?? 0}
      onChange={e => void send({ op: "audio-track", value: Number(e.target.value) })}>
      <option value={0}>{audio.length ? "关闭音轨" : ready ? "无音轨" : "读取中"}</option>
      {audio.map(t => <option key={t.id} value={t.id}>音轨 {t.id} · {t.codec}</option>)}
    </select></label>
    <label>字幕 <select aria-label="字幕" disabled={!ready || subtitles.length === 0} value={subtitles.find(t => t.selected)?.id ?? 0}
      onChange={e => void send({ op: "subtitle-track", value: Number(e.target.value) })}>
      <option value={0}>关闭字幕</option>
      {subtitles.map(t => <option key={t.id} value={t.id}>字幕 {t.id} · {t.codec}</option>)}
    </select></label>
    <button disabled={!ready} onClick={() => void send({ op: "subtitle-file" })}>加载 SRT 字幕</button>
  </div>;
}
