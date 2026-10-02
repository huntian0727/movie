// @vitest-environment node
import {describe,it,expect,vi} from "vitest";
import {selectCases,seekSettled,playbackAdvanced,runDiagnosticMatrix} from "../../scripts/spikes/embedded-mpv/diagnostic-matrix.mjs";
describe("embedded MPV diagnostic matrix",()=>{
  it("bounds repeated cases and restricts native decoding profiles",()=>{
    expect(selectCases().length).toBe(8);
    expect(selectCases("seek-auto,seek-software",3).map(c=>c.hwdec)).toEqual(["auto-safe","no","auto-safe","no","auto-safe","no"]);
    for(const [names,repeat] of [["arbitrary",1],["seek-auto,seek-auto",1],["seek-auto",0],["seek-auto",4],["seek-auto",NaN]])expect(()=>selectCases(names,repeat)).toThrow();
  });
  it("does not count a time-pos update as completed seek",()=>{
    const state={token:2,loaded:true,seeking:"no",time:5,restartCount:3};const request={token:2,restartCount:2,target:5};
    expect(seekSettled(state,request)).toBe(true);
    for(const patch of [{seeking:"yes"},{restartCount:2},{token:1},{loaded:false},{time:null},{time:8}])expect(seekSettled({...state,...patch},request)).toBe(false);
  });
  it("requires unpaused actual time progression without a pending seek",()=>{
    const state={token:2,loaded:true,seeking:"no",paused:"no",time:6};const request={token:2,from:5};
    expect(playbackAdvanced(state,request)).toBe(true);
    for(const patch of [{paused:"yes"},{seeking:"yes"},{time:5},{time:null},{token:1}])expect(playbackAdvanced({...state,...patch},request)).toBe(false);
  });
  it("records a pending-seek failure and still releases the owned helper",async()=>{
    const records=[];const stopHost=vi.fn();const persist=vi.fn();let state;
    const log=vi.spyOn(console,"log").mockImplementation(()=>{});
    try{
      await runDiagnosticMatrix({names:"seek-auto",repeat:1,sample:{name:"neutral"},getState:()=>state,getToken:()=>2,startHost:async()=>{},stopHost,
        load:()=>{state={token:2,loaded:true,seeking:"no",paused:"no",time:1,width:640,restartCount:1};},
        send:m=>{if(m.op==="pause")state.paused=m.value?"yes":"no";if(m.op==="seek"){state.time=5;state.seeking="yes";}},
        until:async p=>{if(!p())throw new Error("operation-timeout");},wait:async()=>{},setFullscreen:()=>{},isFullscreen:()=>false,record:r=>records.push(r),persist});
      expect(records[0]).toMatchObject({pass:false,failedStage:"seek",lastState:{time:5,seeking:"yes"},hostStopped:true});
      expect(stopHost).toHaveBeenCalledTimes(1);expect(persist).toHaveBeenCalledTimes(1);
    }finally{log.mockRestore();}
  });
});
