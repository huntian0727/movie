import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { VideoManagerApi } from "../../shared/videoTypes";
import type { EmbeddedInput, EmbeddedRequest, EmbeddedState } from "../../shared/embeddedPlayback";

type Command = EmbeddedRequest extends infer R ? R extends EmbeddedRequest ? Omit<R, "sessionKey"> : never : never;
type Bridge = Pick<VideoManagerApi, "embeddedPlayback" | "subscribeEmbeddedInput">;

/** Engine adapter only: all player UI, playlist and business actions remain in PlayerPage. */
export function useEmbeddedEngine(options: {
  api?: Bridge; enabled: boolean; videoId: string; autoplay: boolean;
  positionMs?: number; requestId?: string; stage: RefObject<HTMLDivElement | null>;
  visible: boolean; layoutKey: string; onInput(input: EmbeddedInput): void;
}) {
  const { api, enabled, videoId, autoplay, positionMs, requestId, stage, visible, layoutKey } = options;
  const [state, setState] = useState<EmbeddedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const session = useRef("");
  const observed = useRef<EmbeddedState | null>(null);
  const pauseVersion = useRef(0);
  const pendingPause = useRef<{ key: string; version: number; value: boolean } | null>(null);
  const reloadPosition = useRef<number | undefined>(undefined);
  const input = useRef(options.onInput); input.current = options.onInput;
  const visibility = useRef(visible); visibility.current = visible;
  const measure = useRef<() => void>(() => undefined);
  useEffect(() => {
    observed.current = null; pendingPause.current = null; setState(null); setError(null);
    if (!enabled || !api) return;
    let disposed = false, polling = false;
    const key = crypto.randomUUID(); session.current = key;
    const call = (request: Command) => api.embeddedPlayback({ ...request, sessionKey: key } as EmbeddedRequest);
    measure.current = () => {
      if (disposed || !stage.current) return;
      const r = stage.current.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      void call({ op: "bounds", x: Math.max(0, Math.round(r.x * d)), y: Math.max(0, Math.round(r.y * d)), width: Math.max(1, Math.floor(r.width * d)), height: Math.max(1, Math.floor(r.height * d)) }).catch(() => undefined);
      void call({ op: "visible", value: visibility.current }).catch(() => undefined);
    };
    const startingPosition = reloadPosition.current ?? positionMs; reloadPosition.current = undefined;
    void call({ op: "start", videoId, autoplay, ...(startingPosition === undefined ? {} : { positionMs: startingPosition }) }).then(s => {
      if (!disposed) { observed.current = s; setState(s); measure.current(); }
    }).catch(() => { if (!disposed) setError("内嵌解码启动失败，可重试或手动使用外部播放器"); });
    const poll = async () => {
      if (disposed || polling) return;
      polling = true;
      const version = pauseVersion.current;
      try { const s = await call({ op: "state" }); if (!disposed && !pendingPause.current && version === pauseVersion.current) { observed.current = s; setState(s); } }
      catch { if (!disposed) setError("播放服务不可用，请重试"); }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => void poll(), 250);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure.current());
    if (stage.current) observer?.observe(stage.current);
    const resize = () => measure.current(); window.addEventListener("resize", resize);
    const unsubscribe = api.subscribeEmbeddedInput(e => { if (!disposed) input.current(e); });
    return () => {
      disposed = true; window.clearInterval(timer); observer?.disconnect(); window.removeEventListener("resize", resize); unsubscribe();
      if (session.current === key) { session.current = ""; pendingPause.current = null; }
      measure.current = () => undefined;
      void call({ op: "stop" }).catch(() => undefined);
    };
  }, [api, enabled, videoId, requestId, retry]);
  useLayoutEffect(() => { measure.current(); }, [visible, layoutKey]);
  const send = async (request: Command) => {
    if (!api || !enabled || !session.current) return;
    const key = session.current;
    const version = request.op === "pause" ? ++pauseVersion.current : pauseVersion.current;
    if (request.op === "pause") pendingPause.current = { key, version, value: request.value };
    try {
      const s = await api.embeddedPlayback({ ...request, sessionKey: key } as EmbeddedRequest);
      if (key === session.current && version === pauseVersion.current) {
        if (request.op === "pause") { pendingPause.current = null; observed.current = s; setState(s); }
        setError(null);
      }
    } catch { if (key === session.current && version === pauseVersion.current) { if (request.op === "pause") pendingPause.current = null; setError("播放操作未完成，请重试"); } }
  };
  const stop = async () => {
    if (api && enabled && session.current) await api.embeddedPlayback({ op: "stop", sessionKey: session.current });
  };
  return { state, error, send, stop, getPaused: () => pendingPause.current?.value ?? observed.current?.paused ?? true, reload: (position = state?.time) => {
    reloadPosition.current = position === undefined ? undefined : Math.max(0, Math.trunc(position * 1000));
    setRetry(n => n + 1);
  } };
}
