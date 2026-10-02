import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { validateAction, validateBounds } from "./contract.mjs";

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
let win, host, snapshot, sampleIndex=0, loadToken=0, ready=false, closing=false, bounds={op:"bounds",x:0,y:58,width:1280,height:720};
const report={ experiment:"libmpv-isolated-native-window", electron:process.versions.electron, samples:[], failures:[], manualActions:[], hostPids:[], maxMainTimerDelayMs:0 };
let lastTick=performance.now();
const heartbeat=setInterval(()=>{ const now=performance.now(); report.maxMainTimerDelayMs=Math.max(report.maxMainTimerDelayMs,now-lastTick-100); lastTick=now; },100);
const wait= (ms)=>new Promise((r)=>setTimeout(r,ms));
async function until(predicate,timeout=15000){const start=performance.now();while(!predicate()){if(performance.now()-start>timeout)throw new Error("operation-timeout");await wait(50);}return performance.now()-start;}
function send(message){if(host?.stdin.writable)host.stdin.write(JSON.stringify(message)+"\n");}
function load(index){sampleIndex=index; snapshot=null; send({op:"load",token:++loadToken,path:samples[index].path});}
async function startHost(){
  ready=false;
  const handle=win.getNativeWindowHandle().readBigUInt64LE().toString();
  host=spawn(path.join(root,"NativeHost.exe"),[handle,root],{stdio:["pipe","pipe","pipe"],windowsHide:true,detached:false});
  report.hostPids.push(host.pid);
  const lines=createInterface({input:host.stdout});
  lines.on("line",(line)=>{
    try {
      const value=JSON.parse(line.replace(/^\uFEFF/,""));
      if(value.type==="ready"){ready=true; report.mpv=value.version; send(bounds);}
      if(value.type==="snapshot"){snapshot=value; value.sample=samples[sampleIndex].name;}
      if(value.type==="fatal"||value.type==="error") report.failures.push(value);
      if(value.type==="ended"&&value.error<0) report.failures.push(value);
      if(!win.isDestroyed())win.webContents.send("mpv-spike:state",value);
    }catch{/* Do not print third-party runtime output or private paths. */}
  });
  host.stderr.on("data",()=>{});
  host.on("error",(error)=>{report.failures.push({type:"host-start-error",code:error.code});});
  host.on("exit",(code,signal)=>{if(!closing&&!win.isDestroyed())win.webContents.send("mpv-spike:state",{type:"error",reason:"宿主已退出"});report.lastHostExit={code,signal};});
  await until(()=>ready||report.failures.some((f)=>f.type==="fatal"),15000);
  if(!ready)throw new Error("native-host-not-ready");
}
async function stopHost(){
  if(!host||host.exitCode!==null||host.signalCode!==null)return;
  const current=host; send({op:"quit"});
  await until(()=>current.exitCode!==null||current.signalCode!==null,4000).catch(()=>{current.kill();});
  await until(()=>current.exitCode!==null||current.signalCode!==null,4000);
  report.hostStopped=true;
}
async function save(){await writeFile(path.join(root,reportName),JSON.stringify(report,null,2));}
function trust(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith("file:"))throw new Error("untrusted-probe-sender");}
ipcMain.handle("mpv-spike:bounds",(event,payload)=>{trust(event);bounds=validateBounds(payload);send(bounds);});
ipcMain.handle("mpv-spike:action",async(event,payload)=>{
  trust(event);const command=validateAction(payload);report.manualActions.push({op:command.op,value:command.value});
  if(command.op==="fullscreen")win.setFullScreen(!win.isFullScreen());
  else if(command.op==="windowed")win.setFullScreen(false);
  else if(command.op==="next")load((sampleIndex+1)%samples.length);
  else if(command.op==="quit")win.close();
  else send(command);
  return true;
});
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
      stage="seek";const target=Math.min(5,Math.max(1,snapshot.duration/2));const seekStart=performance.now();send({op:"seek",value:target});
      await until(()=>Math.abs(snapshot?.time-target)<0.3,45000);result.seekMs=Math.round(performance.now()-seekStart);result.seek=true;
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
win=new BrowserWindow({title:"拉面影视 · 内嵌播放验证",width:1280,height:908,minWidth:900,minHeight:600,backgroundColor:"#111111",webPreferences:{preload:path.join(dir,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
win.setMenu(null);
win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
win.webContents.on("will-navigate",(event)=>event.preventDefault());
await win.loadFile(path.join(dir,"probe.html"));
win.on("close",(event)=>{if(!closing){event.preventDefault();closing=true;void stopHost().then(save).then(()=>{win.destroy();app.quit();});}});
win.on("closed",()=>clearInterval(heartbeat));
try {await startHost();if(args.auto==="1")await automatedChecks();else load(0);}
catch(error){report.failures.push({type:"experiment-error",reason:error.message});closing=true;await stopHost().catch(()=>{});await save();console.log(JSON.stringify(report));app.exit(1);}
}).catch(async (error) => { report.failures.push({type:"initialization-error",reason:error.message}); await save(); console.log(JSON.stringify(report)); app.exit(1); });
