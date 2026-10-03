import {describe,it,expect,vi} from "vitest";
import {invalidateHostState,isSpikeKey,spikeKeyCode} from "../../scripts/spikes/embedded-mpv/host-lifecycle.mjs";
import {ControlQueue,controlLabel} from "../../scripts/spikes/embedded-mpv/control-queue.mjs";
import {LoadDeadline} from "../../scripts/spikes/embedded-mpv/load-deadline.mjs";

describe("isolated host failure lifecycle",()=>{
  it("invalidates loaded state and clears active and pending operations",()=>{
    vi.useFakeTimers();
    try{
      let state={token:1,loaded:true,restartCount:0,seeking:"yes",pausedForCache:"yes"};
      const publish=vi.fn(),send=vi.fn();
      const controls=new ControlQueue({getState:()=>state,send,publish});
      controls.request({op:"seek",value:2});controls.request({op:"seek",value:7});
      state=invalidateHostState(state,controls,"host-exited");
      expect(state).toMatchObject({loaded:false,seeking:"no",pausedForCache:"no",paused:"yes"});
      expect(controls.active).toBeNull();expect(controls.pending.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);expect(controls.phase).toBe("failed");
      expect(()=>controls.request({op:"seek",value:4})).toThrow("media-not-ready");
      expect(controlLabel(state,{phase:"failed"})).toBe("操作未完成，请重试");
    }finally{vi.useRealTimers();}
  });
  it("handles failure before the first snapshot",()=>{
    expect(invalidateHostState(null,null,"read-failed").loaded).toBe(false);
  });
  it("accepts only the three experiment shortcut codes",()=>{
    for(const key of ["Space","KeyF","Escape"])expect(isSpikeKey(key)).toBe(true);
    for(const key of ["KeyA","Control+Space","run",undefined,null])expect(isSpikeKey(key)).toBe(false);
  });
  it("normalizes logical keys when synthesized input lacks a physical code",()=>{
    expect(spikeKeyCode("","f")).toBe("KeyF");expect(spikeKeyCode(""," ")).toBe("Space");
    expect(spikeKeyCode(undefined,"Escape")).toBe("Escape");
    expect(spikeKeyCode("KeyA","a")).toBeNull();
  });
});
describe("isolated load deadline",()=>{
  it("fires once, cancels completed loads, and replaces old load tokens",()=>{
    vi.useFakeTimers();try{
      const expired=vi.fn(),deadline=new LoadDeadline(expired,1000);
      deadline.arm(1);deadline.arm(2);deadline.complete(1);
      vi.advanceTimersByTime(1000);expect(expired).toHaveBeenCalledTimes(1);expect(expired).toHaveBeenCalledWith(2);
      deadline.arm(3);deadline.complete(3);vi.advanceTimersByTime(1000);
      expect(expired).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it("rejects unbounded or malformed deadlines",()=>{
    for(const ms of [0,999,60001,NaN,Infinity,1500.5])expect(()=>new LoadDeadline(()=>{},ms)).toThrow("invalid-load-deadline");
  });
});
