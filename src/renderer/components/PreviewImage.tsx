import { useEffect, useRef, useState, type CSSProperties } from "react";

const placeholder = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" fill="#202824"/><path d="M69 32h22v26H69zM76 38l9 7-9 7z" fill="none" stroke="#89988e" stroke-width="2"/></svg>');

/** Requests belong to this visible image, not to a permanent background download list. */
export function PreviewImage({ src, cachedOnly = false, priority = 1, eager = false, delayMs = 100, style, onError, onStateChange }: {
  src: string; cachedOnly?: boolean; priority?: 0 | 1 | 2; eager?: boolean; delayMs?: number;
  style?: CSSProperties; onError?(): void; onStateChange?(state: "loading" | "ready" | "failed"): void;
}) {
  const element = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(eager);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  const loaded = useRef<{ source: string; url: string } | null>(null);
  const failedSource = useRef<string | null>(null);
  const errorCallback = useRef(onError);
  errorCallback.current = onError;
  const stateCallback = useRef(onStateChange);
  stateCallback.current = onStateChange;
  const api = window.videoManager;
  const managed = Boolean(api?.loadPreviewImage && src.startsWith("local-video://"));

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (eager || !managed || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "0px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [eager, managed]);

  useEffect(() => () => {
    if (loaded.current) URL.revokeObjectURL(loaded.current.url);
    loaded.current = null;
  }, [src]);

  useEffect(() => {
    if (!api || !managed || !visible || !pageVisible || loaded.current?.source === src || failedSource.current === src) return;
    let disposed = false;
    let requested = false;
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      requested = true;
      stateCallback.current?.("loading");
      void api.loadPreviewImage({ requestId, url: src, cachedOnly, priority }).then((bytes) => {
        if (disposed) return;
        if (!bytes) { failedSource.current = src; stateCallback.current?.("failed"); errorCallback.current?.(); return; }
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
        if (loaded.current) URL.revokeObjectURL(loaded.current.url);
        loaded.current = { source: src, url };
        setImage(loaded.current);
        stateCallback.current?.("ready");
      }).catch(() => {
        if (!disposed) { failedSource.current = src; stateCallback.current?.("failed"); errorCallback.current?.(); }
      });
    }, delayMs);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (requested) void api.cancelPreviewImage(requestId).catch(() => undefined);
    };
  }, [api, cachedOnly, delayMs, managed, pageVisible, priority, src, visible]);

  return <img ref={element} src={managed ? image?.source === src ? image.url : placeholder : src}
    alt="" style={style} loading={eager ? "eager" : "lazy"} data-preview-state={image?.source === src ? "ready" : "pending"}
    onError={() => errorCallback.current?.()} />;
}
