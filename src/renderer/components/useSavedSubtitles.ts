import { useEffect, useRef, useState } from "react";
import type { SubtitleState } from "../../shared/subtitles";
import type { PlayerSubtitleApi } from "./SubtitleDialog";

export function useSavedSubtitles(api: PlayerSubtitleApi | undefined, videoId: string, identity = videoId) {
  const [saved, setSaved] = useState<SubtitleState | null>(null);
  const [failure, setFailure] = useState<{ videoId: string; message: string } | null>(null);
  const [asset, setAsset] = useState<{ videoId: string; url: string } | null>(null);
  const current = useRef(videoId); current.current = videoId;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const alive = useRef(true), sequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const refresh = async () => {
    const request = ++sequence.current;
    if (!api) return;
    try {
      const value = await api.getSubtitleState(videoId);
      if (alive.current && request === sequence.current && current.current === videoId && currentIdentity.current === identity) { setSaved(value); setFailure(null); }
    } catch {
      if (alive.current && request === sequence.current && current.current === videoId) setFailure({ videoId, message: "已保存字幕无法读取，请检查字幕目录或重新下载" });
    }
  };
  useEffect(() => {
    setSaved(null); setFailure(null); void refresh();
    return () => { sequence.current++; };
  }, [api, videoId, identity]);
  const state = saved?.videoId === videoId ? saved : null;
  useEffect(() => {
    setAsset(null);
    if (!state?.nativeVtt) return;
    const url = URL.createObjectURL(new Blob([state.nativeVtt], { type: "text/vtt;charset=utf-8" }));
    setAsset({ videoId, url });
    return () => URL.revokeObjectURL(url);
  }, [state?.nativeVtt, videoId]);
  return { state, url: asset?.videoId === videoId ? asset.url : null,
    error: failure?.videoId === videoId ? failure.message : state?.message,
    refresh,
    update(value: SubtitleState) { if (alive.current && value.videoId === current.current && currentIdentity.current === identity) { sequence.current++; setSaved(value); setFailure(null); } }
  };
}
