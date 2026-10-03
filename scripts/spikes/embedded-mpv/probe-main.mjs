import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { validateAction, validateBounds } from "./contract.mjs";
import { runDiagnosticMatrix, seekSettled } from "./diagnostic-matrix.mjs";
import { ControlQueue } from "./control-queue.mjs";
import { runControlValidation } from "./control-validation.mjs";
import { invalidateHostState, isSpikeKey, spikeKeyCode } from "./host-lifecycle.mjs";
import { runFailureValidation } from "./failure-validation.mjs";
import { LoadDeadline } from "./load-deadline.mjs";

const args = Object.fromEntries(process.argv.filter((v)=>v.startsWith("--spike-")).map((v)=>{
  const index=v.indexOf("="); return [v.slice(8,index),v.slice(index+1)];
}));
if (!args.root || !args.samples) throw new Error("--spike-root and --spike-samples are required");
const root=path.resolve(args.root), dir=path.dirname(fileURLToPath(import.meta.url));
const reportName=args.report || "report.json";
if(!/^[a-z0-9-]+\.json$/.test(reportName)) throw new Error("invalid-report-name");
app.setPath("userData",path.join(root,"electron-user-data"));
const samples=JSON.parse(await readFile(path.resolve(args.samples),"utf8"));
if(!Array.isArray(samples)||!samples.length||samples.length>10||samples.some((s)=>!path.isAbsolute(s.path)||typeof s.name!=="string")) throw new Error("invalid-samples");
if(args["sample-name"]){const index=samples.findIndex(s=>s.name===args["sample-name"]);if(index<0)throw new Error("sample-not-found");samples.splice(0,samples.length,samples[index]);}
let win, host, snapshot, sampleIndex=0, loadToken=0, ready=false, closing=false, bounds={op:"bounds",x:0,y:58,width:1280,height:720};
const report={ experiment:"libmpv-isolated-native-window", electron:process.versions.electron, samples:[], failures:[], expectedFaults:[], manualActions:[], controlEvents:[], rendererPhases:{},keyEvents:0,keyFallbackEvents:0,hostStops:[], hostPids:[], maxMainTimerDelayMs:0,rendererTicks:0,maxRendererTimerDelayMs:0 };
let stoppingHost=null, expectingFault=false;
report.inputTypes={};
let lastTick=performance.now();
const heartbeat=setInterval(()=>{ const now=performance.now(); report.maxMainTimerDelayMs=Math.max(report.maxMainTimerDelayMs,now-lastTick-100); lastTick=now; },100);
const wait= (ms)=>new Promise((r)=>setTimeout(r,ms));
async function until(predicate,timeout=15000){const start=performance.now();while(!predicate()){if(performance.now()-start>timeout)throw new Error("operation-timeout");await wait(50);}return performance.now()-start;}
function send(message){if(host?.stdin.writable && host.exitCode===null && host.signalCode===null)host.stdin.write(JSON.stringify(message)+"\n");}
const controls=args.controls==="1"?new ControlQueue({getState:()=>snapshot,send,
  publish:value=>{if(win&&!win.isDestroyed())win.webContents.send("mpv-spike:state",value);},
  record:value=>report.controlEvents.push({...value,atMs:Math.round(performance.now())})}):null;
const loadDeadline=new LoadDeadline((token)=>{
  if(token!==loadToken||snapshot?.loaded||closing)return;
  ready=false;
  void stopHost().then(()=>{
    if(token!==loadToken||closing)return;
    failHost("load-timeout");
    (expectingFault?report.expectedFaults:report.failures).push({type:"load-timeout",token,timeoutMs:loadDeadline.timeoutMs});
  }).catch(()=>{report.failures.push({type:"load-timeout-cleanup-failed"});});
},Number(args["load-timeout-ms"]||30000));
function load(index, experimentPath){controls?.reset("cancelled");controls?.status("reading");sampleIndex=index; snapshot=null; send({op:"load",token:++loadToken,path:experimentPath || samples[index].path});loadDeadline.arm(loadToken);}
function failHost(reason){snapshot=invalidateHostState(snapshot,controls,reason);if(!win.isDestroyed())win.webContents.send("mpv-spike:state",snapshot);}
async function startHost(hwdec="auto-safe"){
  ready=false;
  snapshot=null;
  const handle=win.getNativeWindowHandle().readBigUInt64LE().toString();
  host=spawn(path.join(root,"NativeHost.exe"),[handle,root,hwdec],{stdio:["pipe","pipe","pipe"],windowsHide:true,detached:false});
  const current=host;
  host.stdin.on("error",()=>{});
  report.hostPids.push(host.pid);
  const lines=createInterface({input:host.stdout});
  lines.on("line",(line)=>{
    try {
      const value=JSON.parse(line.replace(/^\uFEFF/,""));
      if(host!==current)return;
      if(value.type==="ready"){ready=true; report.mpv=value.version; send(bounds);}
      if(value.type==="snapshot"){snapshot=value; value.sample=samples[sampleIndex].name;}
      if(value.type==="snapshot")controls?.observe(value);
      if(value.type==="loaded"){loadDeadline.complete(value.token);controls?.status("ready");}
      if(value.type==="ack")controls?.acknowledge(value);
      if(args.controls==="1"&&(value.type==="ready"||value.type==="loaded")&&win.isFocused())win.webContents.focus();
      if(value.type==="fatal"||value.type==="error") report.failures.push(value);
      if(value.type==="ack"&&value.result<0)report.failures.push({type:"negative-ack",op:value.op,result:value.result});
      if(value.type==="ended"&&value.error<0){loadDeadline.complete(value.token);(expectingFault?report.expectedFaults:report.failures).push(value);failHost("media-read-failed");}
      if(!win.isDestroyed())win.webContents.send("mpv-spike:state",value);
    }catch{/* Do not print third-party runtime output or private paths. */}
  });
  host.stderr.on("data",()=>{});
  host.on("error",(error)=>{report.failures.push({type:"host-start-error",code:error.code});});
  host.on("exit",(code,signal)=>{if(host!==current)return;loadDeadline.clear();ready=false;if(stoppingHost!==current&&!closing&&!win.isDestroyed())failHost("host-exited");report.lastHostExit={code,signal};});
  await until(()=>ready||report.failures.some((f)=>f.type==="fatal"),15000);
  if(!ready)throw new Error("native-host-not-ready");
}
async function stopHost(){
  loadDeadline.clear();
  controls?.reset("cancelled");
  if(!host||host.exitCode!==null||host.signalCode!==null)return;
  const current=host; stoppingHost=current;const started=performance.now();let forced=false;send({op:"quit"});
  await until(()=>current.exitCode!==null||current.signalCode!==null,4000).catch(()=>{forced=true;current.kill();});
  await until(()=>current.exitCode!==null||current.signalCode!==null,4000);
  report.hostStopped=true;
  report.hostStops.push({forced,elapsedMs:Math.round(performance.now()-started)});stoppingHost=null;snapshot=null;ready=false;
}
async function save(){await writeFile(path.join(root,reportName),JSON.stringify(report,null,2));}
function trust(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith("file:"))throw new Error("untrusted-probe-sender");}
ipcMain.handle("mpv-spike:bounds",(event,payload)=>{trust(event);bounds=validateBounds(payload);send(bounds);});
ipcMain.handle("mpv-spike:heartbeat",(event,gapMs,phase)=>{trust(event);if(!Number.isFinite(gapMs)||gapMs<0||gapMs>3600000||!["failed","reading","seeking","buffering","paused","playing"].includes(phase))throw new Error("invalid-heartbeat");report.rendererTicks++;report.rendererPhases[phase]=(report.rendererPhases[phase]||0)+1;report.maxRendererTimerDelayMs=Math.max(report.maxRendererTimerDelayMs,gapMs);return true;});
ipcMain.handle("mpv-spike:action",async(event,payload)=>{
  trust(event);const command=validateAction(payload);report.manualActions.push({op:command.op,value:command.value});
  await perform(command);
  return true;
});
function perform(command){
  if(command.op==="fullscreen")win.setFullScreen(!win.isFullScreen());
  else if(command.op==="windowed")win.setFullScreen(false);
  else if(command.op==="next")return (async()=>{
    if(!ready){await stopHost();await startHost();}
    load((sampleIndex+1)%samples.length);
  })();
  else if(command.op==="quit")win.close();
  else if(!snapshot?.loaded || !ready)throw new Error("media-not-ready");
  else if(controls&&["seek","rotate"].includes(command.op))controls.request(command);
  else send(command);
}
async function automatedChecks(){
  for(let i=0;i<samples.length;i++){
    const result={name:samples[i].name};let stage="load";report.samples.push(result);
    try {
      const started=performance.now(); load(i);const token=loadToken;
      await until(()=>snapshot?.token===token&&snapshot.loaded&&snapshot.time>0.2&&snapshot.width>0,60000);
      result.startMs=Math.round(performance.now()-started);result.embedded=snapshot.embedded;
      result.viewportMatches=snapshot.viewportWidth===bounds.width&&snapshot.viewportHeight===bounds.height&&snapshot.renderWidth===bounds.width&&snapshot.renderHeight===bounds.height;
      result.videoCodec=snapshot.videoCodec;result.audioCodec=snapshot.audioCodec;result.hwdec=snapshot.hwdec;result.size=[snapshot.width,snapshot.height];result.duration=snapshot.duration;
      stage="pause";send({op:"pause",value:true});await until(()=>snapshot?.paused==="yes");
      const pausedTime=snapshot.time;await wait(650);result.pauseStable=Math.abs(snapshot.time-pausedTime)<0.1;
      stage="seek";const target=Math.min(5,Math.max(1,snapshot.duration/2));const seekStart=performance.now();const restartCount=snapshot.restartCount;send({op:"seek",value:target});
      await until(()=>seekSettled(snapshot,{token,restartCount,target}),45000);result.seekMs=Math.round(performance.now()-seekStart);result.seek=true;
      stage="volume";send({op:"volume",value:35});await until(()=>Math.abs(snapshot?.volume-35)<0.1);result.volume=true;
      stage="rotate";
      send({op:"rotate",value:90});await until(()=>snapshot?.rotation===90);send({op:"rotate",value:0});await until(()=>snapshot?.rotation===0);result.rotate=true;
      stage="fullscreen";win.setFullScreen(true);await wait(500);result.fullscreen=win.isFullScreen()&&snapshot.embedded;
      win.setFullScreen(false);await wait(500);result.windowed=!win.isFullScreen()&&snapshot.embedded;
      stage="resume";send({op:"pause",value:false});await until(()=>snapshot?.paused==="no"&&snapshot.time>target+0.4);
      await wait(600);result.avsync=snapshot.avsync;result.dropped=snapshot.dropped;result.resume=true;result.pass=result.embedded&&result.viewportMatches&&result.rotate&&result.pauseStable&&result.seek&&result.volume&&result.fullscreen&&result.windowed;
    }catch(error){result.pass=false;result.error=error.message;result.failedStage=stage;result.lastState=snapshot?{time:snapshot.time,paused:snapshot.paused,pausedForCache:snapshot.pausedForCache,cacheDuration:snapshot.cacheDuration,seeking:snapshot.seeking}:null;send({op:"pause",value:true});}
    await save();console.log(JSON.stringify({sample:result}));
  }
  await stopHost();
  // An independently stopped/crashed playback helper must not take Electron down.
  await startHost();load(0);await until(()=>snapshot?.token===loadToken&&snapshot.loaded,15000);
  host.kill();await until(()=>host.signalCode!==null||host.exitCode!==null);report.helperFailureIsolated=!win.isDestroyed();
  await startHost();load(0);await until(()=>snapshot?.token===loadToken&&snapshot.loaded,15000);report.helperRestart=true;
  await stopHost();closing=true;
  report.pass=report.samples.every((s)=>s.pass)&&report.failures.length===0&&report.helperFailureIsolated&&report.helperRestart&&report.hostStopped;
  await save();
  console.log(JSON.stringify(report));win.destroy();app.exit(report.pass?0:1);
}
app.whenReady().then(async () => {
await mkdir(path.join(root,"electron-user-data"),{recursive:true});
// Automation heartbeats must not mistake Chromium's background timer throttle for a hang.
const automated=args["failure-auto"]==="1"||args["control-auto"]==="1"||args.matrix==="1"||args.auto==="1";
report.backgroundThrottling=!automated;
win=new BrowserWindow({title:"拉面影视 · 内嵌播放验证",width:1280,height:908,minWidth:900,minHeight:600,backgroundColor:"#111111",webPreferences:{preload:path.join(dir,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!automated}});
win.setMenu(null);
win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
win.webContents.on("will-navigate",(event)=>event.preventDefault());
if(controls){
  win.on("focus",()=>win.webContents.focus());
  win.webContents.on("before-input-event",(event,input)=>{
    if(["keyDown","keyUp","char"].includes(input.type))report.inputTypes[input.type]=(report.inputTypes[input.type]||0)+1;
    if(input.type!=="keyDown"||input.isAutoRepeat||input.control||input.alt||input.meta)return;
    const code=spikeKeyCode(input.code,input.key);if(!code)return;
    report.keyEvents++;
    if(!isSpikeKey(input.code))report.keyFallbackEvents++;
    report.manualActions.push({source:"electron-key",code});
    event.preventDefault();win.webContents.send("mpv-spike:key",code);
  });
}
await win.loadFile(path.join(dir,"probe.html"));
win.on("close",(event)=>{if(!closing){event.preventDefault();closing=true;void stopHost().then(save).then(()=>{win.destroy();app.quit();});}});
win.on("closed",()=>clearInterval(heartbeat));
try {
  if(args["failure-auto"]==="1"){
    if(!controls)throw new Error("failure-auto-requires-controls");
    await runFailureValidation({root,startHost,stopHost,load,getState:()=>snapshot,controls,until,wait,send,
      killHost:()=>host.kill(),perform,alive:()=>!win.isDestroyed(),ticks:()=>report.rendererTicks,
      expectFault:v=>{expectingFault=v;},faults:()=>report.expectedFaults,stops:()=>report.hostStops,
      record:r=>report.samples.push(r),persist:save});
    closing=true;report.pass=report.samples.every(s=>s.pass)&&report.failures.length===0;await save();console.log(JSON.stringify(report));win.destroy();app.exit(report.pass?0:1);
  }else if(args["control-auto"]==="1"){
    if(!controls)throw new Error("control-auto-requires-controls");
    await runControlValidation({samples,startHost,stopHost,load,getState:()=>snapshot,getToken:()=>loadToken,controls,send,until,wait,
      record:r=>report.samples.push(r),persist:save,getEvents:()=>report.controlEvents,
      getResponsiveness:()=>({mainMaxDelayMs:report.maxMainTimerDelayMs,rendererMaxDelayMs:report.maxRendererTimerDelayMs,rendererTicks:report.rendererTicks})});
    closing=true;report.pass=report.samples.every(s=>s.pass)&&report.failures.length===0;await save();console.log(JSON.stringify(report));win.destroy();app.exit(report.pass?0:1);
  }else if(args.matrix==="1"){
    await runDiagnosticMatrix({names:args.cases,repeat:Number(args.repeat||1),sample:samples[0],getState:()=>snapshot,getToken:()=>loadToken,startHost,stopHost,load:()=>load(0),send,until,wait,
      setFullscreen:v=>win.setFullScreen(v),isFullscreen:()=>win.isFullScreen(),record:r=>report.samples.push(r),persist:save,
      getResponsiveness:()=>({mainMaxDelayMs:report.maxMainTimerDelayMs,rendererMaxDelayMs:report.maxRendererTimerDelayMs,rendererTicks:report.rendererTicks})});
    closing=true;report.pass=report.samples.every(s=>s.pass)&&report.failures.length===0;await save();console.log(JSON.stringify(report));win.destroy();app.exit(report.pass?0:1);
  }else{await startHost();if(args.auto==="1")await automatedChecks();else{load(0);if(args["start-paused"]==="1")send({op:"pause",value:true});}}
}
catch(error){report.failures.push({type:"experiment-error",reason:error.message});closing=true;await stopHost().catch(()=>{});await save();console.log(JSON.stringify(report));app.exit(1);}
}).catch(async (error) => { report.failures.push({type:"initialization-error",reason:error.message}); await save(); console.log(JSON.stringify(report)); app.exit(1); });
