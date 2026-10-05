import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep measured space, but mount expensive row contents only near the viewport. */
export function VirtualVideoRows({ children, columns, estimatedHeight, initiallyVisible }: {
  children: ReactNode; columns: number; estimatedHeight: number; initiallyVisible: boolean;
}) {
  const root = useRef<HTMLTableSectionElement>(null);
  const intersects = useRef(initiallyVisible);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined" || initiallyVisible);
  const height = useRef(estimatedHeight);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      intersects.current = entry?.isIntersecting ?? false;
      if (!intersects.current) {
        const measured = element.getBoundingClientRect().height;
        if (measured > 0) height.current = measured;
      }
      setVisible(intersects.current || element.contains(document.activeElement));
    }, { rootMargin: "600px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || typeof ResizeObserver === "undefined" || !root.current) return;
    const element = root.current;
    const observer = new ResizeObserver(() => {
      const measured = element.getBoundingClientRect().height;
      if (measured > 0) height.current = measured;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return <tbody ref={root} onBlurCapture={(event) => {
    if (!intersects.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) setVisible(false);
  }}>
    {visible ? children : <tr aria-hidden="true"><td colSpan={columns} style={{ height: height.current, padding: 0, border: 0 }} /></tr>}
  </tbody>;
}
