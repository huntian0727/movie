import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddedRequestSchema } from "../../src/shared/embeddedPlayback";
import { EmbeddedControlQueue, type NativeSnapshot } from "../../src/main/embeddedPlayer/controlQueue";
import { choosePlaybackRoute } from "../../src/shared/playbackRouting";
import { normalizeSettings } from "../../src/main/settings/settingsStore";
describe("embedded trial contracts", () => {
  afterEach(() => vi.useRealTimers());
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
});
