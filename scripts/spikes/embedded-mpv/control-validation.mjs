import {playbackAdvanced} from "./diagnostic-matrix.mjs";

// Uses real native media, but only experimental controls and anonymous fixture names.
export async function runControlValidation({samples,startHost,stopHost,load,getState,getToken,controls,send,until,wait,record,persist,getEvents,getResponsiveness}) {
  for(let index=0;index<samples.length;index++){
    const result={name:samples[index].name};record(result);let stage="load";
    try{
      await startHost();load(index);const token=getToken();
      await until(()=>playbackAdvanced(getState(),{token,from:0})&&getState().width>0,45000);
      send({op:"pause",value:true});await until(()=>getState()?.paused==="yes");await wait(250);
      stage="rapid-seek";let begin=performance.now();let eventStart=getEvents().length;
      for(const value of [2,4,6,8,10])controls.request({op:"seek",value});
      result.immediatePending=controls.pending.size;result.immediateActive=controls.active?.value;
      await until(()=>!controls.active&&!controls.pending.size,65000);
      let events=getEvents().slice(eventStart);result.seekSent=events.filter(e=>e.event==="sent").map(e=>e.value);
      result.rapidMs=Math.round(performance.now()-begin);result.rapidFinal=getState().time;
      if(events.some(e=>["timeout","native-error"].includes(e.event))||JSON.stringify(result.seekSent)!=="[2,10]"||Math.abs(getState().time-10)>=0.35)throw new Error("rapid-seek-not-coalesced");
      stage="mixed-controls";eventStart=getEvents().length;begin=performance.now();
      controls.request({op:"seek",value:3});for(const value of [90,180,270])controls.request({op:"rotate",value});controls.request({op:"seek",value:9});
      result.mixedPending=controls.pending.size;await until(()=>!controls.active&&!controls.pending.size,90000);
      events=getEvents().slice(eventStart);result.mixedSent=events.filter(e=>e.event==="sent").map(e=>({op:e.op,value:e.value}));
      result.mixedMs=Math.round(performance.now()-begin);
      if(events.some(e=>["timeout","native-error"].includes(e.event))||getState().rotation!==270||Math.abs(getState().time-9)>=0.35)throw new Error("mixed-control-state-invalid");
      controls.request({op:"rotate",value:0});await until(()=>!controls.active,35000);
      if(controls.phase!=="ready"||getState().rotation!==0)throw new Error("rotation-not-restored");
      stage="resume";send({op:"pause",value:false});await until(()=>playbackAdvanced(getState(),{token,from:9}),15000);
      result.resume=true;result.cacheWait=getState().pausedForCache;
      stage="cancel-on-load";eventStart=getEvents().length;
      controls.request({op:"seek",value:2});controls.request({op:"seek",value:7});load(index);
      if(controls.active||controls.pending.size)throw new Error("old-controls-not-cleared");
      const replacement=getToken();await until(()=>playbackAdvanced(getState(),{token:replacement,from:0}),45000);
      if(getEvents().slice(eventStart).some(e=>e.event==="sent"&&e.value===7))throw new Error("old-pending-seek-leaked");
      result.cancelOnLoad=true;
      stage="close-while-seeking";controls.request({op:"seek",value:5});controls.request({op:"seek",value:7});begin=performance.now();
      await stopHost();result.closeMs=Math.round(performance.now()-begin);result.closedPending=controls.pending.size;
      if(controls.active||controls.pending.size)throw new Error("controls-not-cleared-on-close");
      result.pass=true;
    }catch(error){result.pass=false;result.failedStage=stage;result.error=error.message;const s=getState();result.lastState=s?{time:s.time,seeking:s.seeking,pausedForCache:s.pausedForCache}:null;}
    finally{await stopHost();result.responsiveness=getResponsiveness();await persist();console.log(JSON.stringify({controls:result}));}
  }
}
