import { useEffect, useRef, useState } from "react";
import type { VideoManagerApi } from "../../shared/videoTypes";

/** One window-level fullscreen contract for every decoder; no media is opened. */
export function usePlayerWindowFullscreen(
  api: Pick<VideoManagerApi, "embeddedPlayback"> | undefined,
  onChange: (fullscreen: boolean) => void
) {
  const fullscreen = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const notify = useRef(onChange); notify.current = onChange;
  const mounted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    if (!api) return () => { mounted.current = false; };
    let disposed = false, reading = false;
    const refresh = async () => {
      if (disposed || reading || pending.current) return;
      reading = true;
      const before = revision.current;
      try {
        const state = await api.embeddedPlayback({ op: "window-state", sessionKey: "player-window" });
        if (!disposed && !pending.current && before === revision.current) { fullscreen.current = state.fullscreen; notify.current(state.fullscreen); }
      } catch { /* Keep known state; explicit operation failures are shown below. */ }
      finally { reading = false; }
    };
    void refresh();
    window.addEventListener("resize", refresh);
    // OS transitions are asynchronous; bounded polling also covers external changes.
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { disposed = true; mounted.current = false; window.clearInterval(timer); window.removeEventListener("resize", refresh); };
  }, [api]);
  return { managed: Boolean(api), error, toggle: async () => {
    if (!api || pending.current) return;
    pending.current = true;
    ++revision.current;
    try {
      const state = await api.embeddedPlayback({ op: "fullscreen", sessionKey: "player-window", value: !fullscreen.current });
      if (mounted.current) { fullscreen.current = state.fullscreen; notify.current(state.fullscreen); setError(null); }
    } catch { if (mounted.current) setError("全屏操作未完成，请重试"); }
    finally { pending.current = false; }
  } };
}
