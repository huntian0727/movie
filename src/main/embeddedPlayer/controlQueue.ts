// One native media operation at a time, retaining only the latest request per kind.
export interface NativeSnapshot { loaded: boolean; token: number; time: number | null; rotation: number | null; seeking: string | null; restartCount: number }
export class EmbeddedControlQueue {
  private active: { op: "seek" | "rotate"; value: number; token: number; restartCount: number; ack: boolean } | null = null;
  private pending = new Map<"seek" | "rotate", number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  get busy(): boolean { return this.active !== null || this.pending.size > 0; }
  constructor(private state: () => NativeSnapshot | null, private send: (command: object) => void, private phase: (failed: boolean, busy: boolean) => void) {}
  request(op: "seek" | "rotate", value: number): void {
    if (!this.state()?.loaded) throw new Error("视频尚未就绪");
    this.pending.set(op, value); this.pump();
  }
  private pump(): void {
    if (this.active || !this.pending.size) return;
    const [op, value] = this.pending.entries().next().value!; this.pending.delete(op);
    const s = this.state(); if (!s?.loaded) return this.reset();
    if (op === "rotate" && s.rotation === value) return this.pump();
    this.active = { op, value, token: s.token, restartCount: s.restartCount, ack: false };
    this.timer = setTimeout(() => { this.reset(); this.phase(true, false); }, 30_000);
    this.phase(false, true); this.send({ op, value });
  }
  acknowledge(op: string, result: number): void {
    if (this.active?.op !== op) return;
    if (result < 0) { this.reset(); this.phase(true, false); } else this.active.ack = true;
  }
  observe(s: NativeSnapshot): void {
    const a = this.active; if (!a) return;
    if (s.token !== a.token) return this.reset();
    if (!s.loaded || !a.ack || s.seeking !== "no") return;
    // A seek must finish decoding at the requested position. Rotation can be
    // applied by the video output alone (including while paused), with no
    // PLAYBACK_RESTART event. Waiting for that event wedges subsequent controls.
    if (a.op === "seek" && s.restartCount <= a.restartCount) return;
    if (a.op === "seek" ? s.time === null || Math.abs(s.time - a.value) >= 0.35 : s.rotation !== a.value) return;
    clearTimeout(this.timer); this.active = null; this.pump(); this.phase(false, !!this.active);
  }
  reset(): void { clearTimeout(this.timer); this.active = null; this.pending.clear(); }
}
