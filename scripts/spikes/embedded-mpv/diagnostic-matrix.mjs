// Experiment only: bounded one-variable cases and strict playback state checks.
export const DIAGNOSTIC_CASES = [
  {name:"baseline-auto",hwdec:"auto-safe",steps:[]},
  {name:"seek-auto",hwdec:"auto-safe",steps:["seek"]},
  {name:"rotate-auto",hwdec:"auto-safe",steps:["rotate"]},
  {name:"fullscreen-auto",hwdec:"auto-safe",steps:["fullscreen"]},
  {name:"combo-overlap-auto",hwdec:"auto-safe",steps:["seek-overlap","rotate","fullscreen"]},
  {name:"combo-serial-auto",hwdec:"auto-safe",steps:["seek","rotate","fullscreen"]},
  {name:"seek-software",hwdec:"no",steps:["seek"]},
  {name:"combo-serial-software",hwdec:"no",steps:["seek","rotate","fullscreen"]}
];
export function selectCases(names,repeat=1){
  if(!Number.isInteger(repeat)||repeat<1||repeat>3)throw new Error("invalid-repeat");
  const keys=names?names.split(","):DIAGNOSTIC_CASES.map(c=>c.name);
  if(!keys.length||new Set(keys).size!==keys.length||keys.some(k=>!DIAGNOSTIC_CASES.some(c=>c.name===k)))throw new Error("invalid-cases");
  return Array.from({length:repeat},(_,i)=>keys.map(k=>({...DIAGNOSTIC_CASES.find(c=>c.name===k),iteration:i+1}))).flat();
}
export function seekSettled(state,{token,restartCount,target}){
  return !!state&&state.token===token&&state.loaded&&state.seeking==="no"&&state.restartCount>restartCount&&Number.isFinite(state.time)&&Math.abs(state.time-target)<0.35;
}
export function playbackAdvanced(state,{token,from}){
  return !!state&&state.token===token&&state.loaded&&state.paused==="no"&&state.seeking==="no"&&Number.isFinite(state.time)&&state.time>from+0.6;
}
export async function runDiagnosticMatrix({names,repeat,sample,getState,getToken,startHost,stopHost,load,send,until,wait,setFullscreen,isFullscreen,record,persist,getResponsiveness}){
  for(const entry of selectCases(names,repeat)){
    const result={name:sample.name,case:entry.name,iteration:entry.iteration,requestedHwdec:entry.hwdec,steps:[]};record(result);
    let stage="start-host";
    const stamp=()=>{const s=getState();return s?{time:s.time,paused:s.paused,seeking:s.seeking,seekCount:s.seekCount,restartCount:s.restartCount,rotation:s.rotation,cacheDuration:s.cacheDuration,pausedForCache:s.pausedForCache,hwdec:s.hwdec,currentAo:s.currentAo,embedded:s.embedded}:null;};
    try{
      const start=performance.now();await startHost(entry.hwdec);load();const token=getToken();stage="load";
      await until(()=>playbackAdvanced(getState(),{token,from:0})&&getState().width>0,45000);
      result.startMs=Math.round(performance.now()-start);result.hwdec=getState().hwdec;result.size=[getState().width,getState().height];
      result.initial=stamp();stage="pause";send({op:"pause",value:true});await until(()=>getState()?.paused==="yes");await wait(400);
      for(const step of entry.steps){
        stage=step;const event={op:step,before:stamp()};result.steps.push(event);const begin=performance.now();
        if(step==="seek"||step==="seek-overlap"){
          const restartCount=getState().restartCount;const target=5;send({op:"seek",value:target});
          if(step==="seek")await until(()=>seekSettled(getState(),{token,restartCount,target}),30000);
          else await until(()=>Math.abs(getState()?.time-target)<0.35,10000);
        }else if(step==="rotate"){
          for(const rotation of [90,0]){
            const restarts=getState().restartCount;send({op:"rotate",value:rotation});await until(()=>getState()?.rotation===rotation);
            if(entry.name.includes("serial"))await until(()=>getState()?.seeking==="no"&&getState()?.restartCount>restarts,30000);
            else await wait(300);
          }
        }else if(step==="fullscreen"){
          setFullscreen(true);await wait(500);if(!isFullscreen())throw new Error("fullscreen-not-set");
          setFullscreen(false);await wait(500);if(isFullscreen())throw new Error("fullscreen-not-restored");
        }
        event.ms=Math.round(performance.now()-begin);event.after=stamp();
      }
      stage="resume";const from=getState().time;send({op:"pause",value:false});const resumed=performance.now();
      await until(()=>playbackAdvanced(getState(),{token,from}),15000);await wait(700);
      result.resumeMs=Math.round(performance.now()-resumed);result.final=stamp();result.pass=getState().embedded&&getState().time>from+0.6;
    }catch(error){result.pass=false;result.failedStage=stage;result.error=error.message;result.lastState=stamp();}
    finally{setFullscreen(false);await stopHost();result.hostStopped=true;result.responsiveness=getResponsiveness?.();await persist();console.log(JSON.stringify({diagnostic:result}));}
  }
}
