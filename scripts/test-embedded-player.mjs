// Bounded integration test of the built production service; neutral fixtures, isolated ledger, no real library.
import { app, BrowserWindow } from "electron";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EmbeddedPlayer } from "../dist-main/main/embeddedPlayer/embeddedPlayer.js";
const root=path.resolve(process.argv.find(a=>a.startsWith("--fixture-root="))?.slice(15)||"");
if(!root||root===process.cwd())throw Error("isolated-fixture-root-required");
app.setPath("userData",path.join(root,"production-service-test-user-data"));
const report={samples:[],failures:[],pass:false};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,timeout=15000)=>{const start=Date.now();while(!await fn()){if(Date.now()-start>timeout)throw Error("test-timeout");await wait(80);}};
app.whenReady().then(async()=>{
  const samples=[...JSON.parse(await readFile(path.join(root,"samples.json"),"utf8")),...JSON.parse(await readFile(path.join(root,"media-feature-samples.json"),"utf8"))];
  const ledger=new Map();
  const repo={getVideo:id=>{const s=samples.find(s=>s.name===id);if(!s)throw Error("invalid-video-id");return {id,path:s.path,isMissing:false};},getPlaybackPosition:id=>ledger.get(id)??0,recordPlayback:(id,position)=>ledger.set(id,position)};
  const w=new BrowserWindow({title:"拉面影视 · 正式服务短时测试",width:1120,height:720,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});w.setMenu(null);
  await w.loadURL("about:blank");
  const player=new EmbeddedPlayer(repo,()=>w,{host:path.resolve("native-bin/NativeHost.exe"),directory:root});
  const event={sender:w.webContents,senderFrame:w.webContents.mainFrame};
  let key;
  const call=command=>player.handle(event,{sessionKey:key,...command});
  const state=()=>call({op:"state"});
  let stage="start";
  try {
    for(const sample of samples){
      stage=sample.name+":load";
      key="test-"+sample.name;await call({op:"start",videoId:sample.name,positionMs:2000,autoplay:true});
      await call({op:"bounds",x:0,y:0,width:1000,height:500});
      await until(async()=>{const s=await state();if(s.phase==="failed")throw Error(s.error);return s.time>2.6&&s.phase==="playing";});
      const pauseLatencies=[];
      stage=sample.name+":pause";
      for(const value of [true,false,true,false,true,false]){
        const started=performance.now();const confirmed=await call({op:"pause",value});
        pauseLatencies.push(Math.round(performance.now()-started));
        if(confirmed.paused!==value)throw Error("pause-not-confirmed-in-command-reply");
        if(pauseLatencies.at(-1)>500)throw Error("pause-confirmation-exceeded-500ms");
      }
      await call({op:"pause",value:true});await until(async()=>(await state()).paused);
      stage=sample.name+":seek";
      for(const value of [3,4,5,6])await call({op:"seek",value});
      await until(async()=>{const s=await state();return Math.abs(s.time-6)<.35&&s.phase==="paused";});
      for(const value of [90,0,270,180,90,0]){
        stage=sample.name+":rotate-"+value;
        await call({op:"rotate",value});await until(async()=>{const s=await state();if(s.phase==="failed")throw Error(s.error);return s.rotation===value&&s.phase==="paused";});
      }
      // Coalescing must retain the latest requested orientation, including zero.
      for(const value of [90,180,270,0])await call({op:"rotate",value});
      stage=sample.name+":rapid-rotate";
      await until(async()=>{const s=await state();if(s.phase==="failed")throw Error(s.error);return s.rotation===0&&s.phase==="paused";});
      await call({op:"volume",value:15});await until(async()=>(await state()).volume===15);
      stage=sample.name+":mute";
      await call({op:"volume",value:0});await until(async()=>(await state()).volume===0);
      await call({op:"visible",value:false});await call({op:"visible",value:true});
      await call({op:"fullscreen",value:true});if(!(await state()).fullscreen)throw Error("fullscreen-failed");await call({op:"fullscreen",value:false});
      if(sample.name==="h264-aac-mp4"){
        stage=sample.name+":eof";
        const duration=(await state()).duration;
        await call({op:"seek",value:Math.max(0,duration-.6)});
        await call({op:"pause",value:false});
        await until(async()=>(await state()).phase==="ended",5000);
        await wait(350);if((await state()).phase!=="ended")throw Error("eof-state-lost");
      }
      stage=sample.name+":replacement";
      const old=key;key=old+"-replacement";await call({op:"start",videoId:sample.name,positionMs:3000,autoplay:false});
      await player.handle(event,{op:"stop",sessionKey:old});
      await until(async()=>{const s=await state();if(s.phase==="failed")throw Error(s.error);return s.phase==="paused"&&Math.abs(s.time-3)<.35;});
      if((await state()).volume!==0)throw Error("replacement-lost-muted-volume");
      if(sample.name==="dual-audio-subtitles"){
        const s=await state();if(s.tracks.filter(t=>t.type==="audio").length!==2)throw Error("tracks-missing");
        await call({op:"audio-track",value:2});await until(async()=>(await state()).tracks.some(t=>t.type==="audio"&&t.id===2&&t.selected));
        await call({op:"subtitle-track",value:0});await until(async()=>!(await state()).tracks.some(t=>t.type==="sub"&&t.selected));
      }
      await call({op:"stop"});if(ledger.get(sample.name)<2900)throw Error("progress-not-saved");
      stage=sample.name+":stop-then-resume";
      key=old+"-resumed";await call({op:"start",videoId:sample.name,autoplay:false});
      await until(async()=>{const s=await state();if(s.phase==="failed")throw Error(s.error);return s.phase==="paused"&&Math.abs(s.time-3)<.35;});
      await call({op:"stop"});if(ledger.get(sample.name)<2900)throw Error("stopped-progress-overwritten");
      report.samples.push({name:sample.name,pass:true,positionSaved:true,stopThenResume:true,staleStopIgnored:true,mutedVolumeRetained:true,pauseConfirmationMs:pauseLatencies});
    }
    report.pass=true;
  }catch(e){report.failures.push({stage,message:e.message,state:await state().catch(()=>null)});}
  finally {player.dispose();await call({op:"stop"}).catch(()=>{});w.destroy();await writeFile(path.join(root,"production-service-test.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.pass?0:1);}
}).catch(e=>{console.error(e.message);app.exit(1);});
