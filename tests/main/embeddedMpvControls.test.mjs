// @vitest-environment node
import {describe,it,expect,vi} from "vitest";
import {ControlQueue,controlLabel} from "../../scripts/spikes/embedded-mpv/control-queue.mjs";

function setup(){
  let state={loaded:true,token:1,time:0,seeking:"no",restartCount:1,rotation:0};
  const send=vi.fn(),publish=vi.fn(),record=vi.fn();const queue=new ControlQueue({getState:()=>state,send,publish,record,timeoutMs:100});
  return {queue,send,publish,record,update:s=>{state={...state,...s};queue.observe(state);}};
}
describe("isolated MPV control scheduling",()=>{
  it("coalesces rapid seeks into one active and the latest pending destination",()=>{
    const t=setup();try{
      for(const value of [2,4,6,8])t.queue.request({op:"seek",value});
      expect(t.send.mock.calls).toEqual([[{op:"seek",value:2}]]);expect(t.queue.pending.size).toBe(1);
      t.queue.acknowledge({op:"seek",result:0});t.update({time:2,seeking:"yes",restartCount:2});expect(t.send).toHaveBeenCalledTimes(1);
      t.update({seeking:"no"});expect(t.send.mock.calls[1]).toEqual([{op:"seek",value:8}]);
      t.queue.acknowledge({op:"seek",result:0});t.update({time:8,restartCount:3});expect(t.queue.active).toBeNull();expect(t.publish).toHaveBeenLastCalledWith({type:"control-status",phase:"ready",pending:0});
    }finally{t.queue.close();}
  });
  it("does not finish on stale position/restart before the matching native ack",()=>{
    const t=setup();try{
      t.queue.request({op:"seek",value:5});t.update({time:5,restartCount:2});expect(t.queue.active).not.toBeNull();
      t.queue.acknowledge({op:"rotate",result:0});t.update({});expect(t.queue.active).not.toBeNull();
      t.queue.acknowledge({op:"seek",result:0});t.update({});expect(t.queue.active).toBeNull();
    }finally{t.queue.close();}
  });
  it("bounds pending kinds and preserves seek followed by latest rotation",()=>{
    const t=setup();try{
      t.queue.request({op:"seek",value:2});for(const value of [90,180,270])t.queue.request({op:"rotate",value});t.queue.request({op:"seek",value:8});
      expect(t.queue.pending.size).toBe(2);t.queue.acknowledge({op:"seek",result:0});t.update({time:2,restartCount:2});
      expect(t.send.mock.calls[1][0]).toEqual({op:"rotate",value:270});
      t.queue.acknowledge({op:"rotate",result:0});t.update({rotation:270,restartCount:3});expect(t.send.mock.calls[2][0]).toEqual({op:"seek",value:8});
    }finally{t.queue.close();}
  });
  it("cancels old-token work without dispatching pending operations into a new video",()=>{
    const t=setup();try{t.queue.request({op:"seek",value:2});t.queue.request({op:"seek",value:8});t.update({token:2});expect(t.queue.active).toBeNull();expect(t.queue.pending.size).toBe(0);expect(t.send).toHaveBeenCalledTimes(1);}finally{t.queue.close();}
  });
  it("reports bounded timeout and clears all scheduled work",()=>{
    vi.useFakeTimers();const t=setup();try{t.queue.request({op:"seek",value:2});t.queue.request({op:"seek",value:8});vi.advanceTimersByTime(101);expect(t.send).toHaveBeenCalledTimes(1);expect(t.publish).toHaveBeenLastCalledWith({type:"control-status",phase:"failed",pending:0,reason:"timeout"});expect(t.queue.pending.size).toBe(0);}finally{t.queue.close();vi.useRealTimers();}
  });
  it("fails on negative ack without silently sending queued work",()=>{
    const t=setup();try{t.queue.request({op:"rotate",value:90});t.queue.request({op:"seek",value:8});t.queue.acknowledge({op:"rotate",result:-1});expect(t.send).toHaveBeenCalledTimes(1);expect(t.queue.active).toBeNull();}finally{t.queue.close();}
  });
  it("distinguishes reading, cache wait, pause and failure from normal playback",()=>{
    expect(controlLabel({paused:"no",seeking:"yes"})).toContain("等待");expect(controlLabel({pausedForCache:"yes"})).toBe("正在缓冲");
    expect(controlLabel({paused:"yes"})).toBe("已暂停");expect(controlLabel({paused:"no"})).toBe("播放中");
    expect(controlLabel({}, {phase:"reading",pending:1})).toContain("待执行 1");expect(controlLabel({}, {phase:"failed"})).toContain("重试");
  });
});
