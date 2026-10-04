import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddedInputSchema, embeddedRequestSchema } from "../../src/shared/embeddedPlayback";
import { EmbeddedControlQueue, type NativeSnapshot } from "../../src/main/embeddedPlayer/controlQueue";
import { choosePlaybackRoute } from "../../src/shared/playbackRouting";
import { normalizeSettings } from "../../src/main/settings/settingsStore";
describe("embedded trial contracts", () => {
  afterEach(() => vi.useRealTimers());
  it("accepts bounded optional fullscreen masks and only bounded pointer coordinates", () => {
    const bounds = { op: "bounds", sessionKey: "k", x: 0, y: 0, width: 1280, height: 720 };
    expect(embeddedRequestSchema.safeParse(bounds).success).toBe(true);
    expect(embeddedRequestSchema.safeParse({ ...bounds, clipTop: 70, clipBottom: 142 }).success).toBe(true);
    for (const clipTop of [-1, 1.5, 16385, NaN]) expect(embeddedRequestSchema.safeParse({ ...bounds, clipTop }).success).toBe(false);
    expect(embeddedInputSchema.safeParse({ kind: "pointer-move" }).success).toBe(true);
    expect(embeddedInputSchema.safeParse({ kind: "pointer-move", x: 1, y: 2 }).success).toBe(true);
    for (const x of [-1, 1.5, 16385, NaN]) expect(embeddedInputSchema.safeParse({ kind: "pointer-move", x, y: 2 }).success).toBe(false);
    expect(embeddedInputSchema.safeParse({ kind: "pointer-move", path: "file" }).success).toBe(false);
  });
  it("accepts the opt-in but preserves the automatic default", () => {
    expect(normalizeSettings({}).playbackPreference).toBe("auto");
    expect(normalizeSettings({playbackPreference:"embedded-first"}).playbackPreference).toBe("embedded-first");
    expect(choosePlaybackRoute({} as any, "embedded-first")).toBe("embedded");
  });
  it("rejects renderer files, native handles, arbitrary ops and missing session keys", () => {
    for (const request of [
      {op:"start", videoId:"v", sessionKey:"k", autoplay:true, path:"C:/private.mp4"},
      {op:"command", sessionKey:"k", command:"loadfile"},
      {op:"bounds", sessionKey:"k", x:0,y:0,width:10,height:10,handle:1},
      {op:"stop"}, {op:"volume",sessionKey:"k",value:NaN}
    ]) expect(embeddedRequestSchema.safeParse(request).success).toBe(false);
  });
  it("coalesces seeks and waits for actual restart plus an ack", () => {
    vi.useFakeTimers(); const send=vi.fn(), phase=vi.fn();
    let state:NativeSnapshot={loaded:true,token:1,time:0,rotation:0,seeking:"no",restartCount:1};
    const q=new EmbeddedControlQueue(()=>state,send,phase);
    for(const t of [2,4,6,8,10])q.request("seek",t);
    expect(send.mock.calls).toEqual([[{op:"seek",value:2}]]);
    state={...state,time:2,restartCount:2};q.observe(state);expect(send).toHaveBeenCalledTimes(1);
    q.acknowledge("seek",0);q.observe({...state,seeking:"yes"});expect(send).toHaveBeenCalledTimes(1);
    q.observe(state);expect(send.mock.calls[1]).toEqual([{op:"seek",value:10}]);q.reset();
  });
  it("cancels old tokens and fails a stuck control within the deadline", () => {
    vi.useFakeTimers();const send=vi.fn(),phase=vi.fn();
    const state={loaded:true,token:1,time:0,rotation:0,seeking:"no",restartCount:1};
    const q=new EmbeddedControlQueue(()=>state,send,phase);
    q.request("seek",3);q.request("seek",9);q.observe({...state,token:2});
    vi.advanceTimersByTime(31000);expect(phase).not.toHaveBeenCalledWith(true,false);
    q.request("rotate",90);vi.advanceTimersByTime(30000);expect(phase).toHaveBeenCalledWith(true,false);q.reset();
  });
  it("allows rotation back while paused without a playback restart event", () => {
    vi.useFakeTimers(); const send=vi.fn(), phase=vi.fn();
    let state:NativeSnapshot={loaded:true,token:1,time:3,rotation:0,seeking:"no",restartCount:1};
    const q=new EmbeddedControlQueue(()=>state,send,phase);
    try {
      q.request("rotate",90);q.request("rotate",0);
      state={...state,rotation:90};q.observe(state);
      expect(send).toHaveBeenCalledTimes(1); // Snapshot alone is not an acknowledgement.
      q.acknowledge("rotate",0);q.observe(state);
      expect(send.mock.calls[1]).toEqual([{op:"rotate",value:0}]);
      q.acknowledge("rotate",0);state={...state,rotation:0};q.observe(state);
      expect(q.busy).toBe(false);
      vi.advanceTimersByTime(30000);expect(phase).not.toHaveBeenCalledWith(true,false);
    } finally { q.reset(); }
  });
  it("coalesces rotation but still requires its ack, angle and a settled seek", () => {
    vi.useFakeTimers(); const send=vi.fn(), phase=vi.fn();
    let state:NativeSnapshot={loaded:true,token:1,time:3,rotation:0,seeking:"no",restartCount:1};
    const q=new EmbeddedControlQueue(()=>state,send,phase);
    try {
      for(const value of [90,180,270,0])q.request("rotate",value);
      q.acknowledge("rotate",0);q.observe(state);
      expect(send).toHaveBeenCalledTimes(1); // Old angle cannot complete the request.
      state={...state,rotation:90,seeking:"yes"};q.observe(state);
      expect(send).toHaveBeenCalledTimes(1);
      state={...state,seeking:"no"};q.observe(state);
      expect(send.mock.calls).toEqual([[{op:"rotate",value:90}],[{op:"rotate",value:0}]]);
      q.acknowledge("rotate",0);state={...state,rotation:0};q.observe(state);
      expect(q.busy).toBe(false);
      q.request("seek",5);q.acknowledge("seek",0);state={...state,time:5};q.observe(state);
      expect(q.busy).toBe(true); // Seek retains the stronger restart requirement.
      state={...state,restartCount:2};q.observe(state);expect(q.busy).toBe(false);
    } finally { q.reset(); }
  });
  it("does not dispatch queued rotation after an error or session replacement", () => {
    vi.useFakeTimers(); const send=vi.fn(), phase=vi.fn();
    const state:NativeSnapshot={loaded:true,token:1,time:3,rotation:0,seeking:"no",restartCount:1};
    const q=new EmbeddedControlQueue(()=>state,send,phase);
    try {
      q.request("rotate",90);q.request("rotate",0);q.acknowledge("rotate",-1);
      expect(q.busy).toBe(false);expect(send).toHaveBeenCalledTimes(1);
      expect(phase).toHaveBeenLastCalledWith(true,false);
      q.request("rotate",270);q.request("rotate",0);q.acknowledge("rotate",0);
      q.observe({...state,token:2,rotation:270});
      expect(q.busy).toBe(false);expect(send).toHaveBeenCalledTimes(2);
    } finally { q.reset(); }
  });
});
