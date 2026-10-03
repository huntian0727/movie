import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {selectedTrack,streamRecovered,fragmentPrefixLength} from "./media-oracles.mjs";

export async function runMediaFeatureValidation(h){
  async function loaded(){h.load(0);await h.until(()=>h.state()?.loaded&&h.state().time>0.3);}
  async function atSubtitle(){h.send({op:"pause",value:true});await h.until(()=>h.state()?.paused==="yes");h.controls.request({op:"seek",value:2});await h.until(()=>h.controls.phase==="ready"&&Math.abs(h.state()?.time-2)<0.35);}
  async function check(name,run){const r={name},start=performance.now();try{await run(r);r.pass=true;}catch(e){r.pass=false;r.error=e.message;}finally{await h.stopHost();r.elapsedMs=Math.round(performance.now()-start);h.record(r);await h.persist();}}
  await check("audio-track-switch-and-disable",async r=>{
    await h.startHost();await loaded();const a=h.state().media.tracks.filter(t=>t.type==="audio");
    if(a.length!==2)throw Error("two-audio-tracks-required");r.trackIds=a.map(t=>t.id);
    h.send({op:"audio-track",value:0});await h.until(()=>h.state()?.media.aid==="no"&&!h.state().media.tracks.some(t=>t.type==="audio"&&t.selected==="yes"));r.disabled=true;
    for(const track of [...a].reverse()){
      h.send({op:"audio-track",value:track.id});await h.until(()=>selectedTrack(h.state(),"audio",track.id)&&h.state().currentAo==="wasapi"&&h.state().media.audioSamplerate===48000);
      const before=h.state().time;await h.until(()=>h.state()?.time>before+0.6);r.switched=(r.switched||0)+1;
    }
    r.audioOutput=h.state().currentAo;r.actualListening="NOT RUN";
  });
  await check("embedded-external-subtitle-selection",async r=>{
    await h.startHost();await loaded();await atSubtitle();
    const inner=h.state().media.tracks.find(t=>t.type==="sub"&&t.external!=="yes");if(!inner)throw Error("embedded-subtitle-required");
    h.send({op:"subtitle-track",value:inner.id});h.send({op:"subtitle-visible",value:true});
    await h.until(()=>selectedTrack(h.state(),"sub",inner.id)&&h.state().media.innerFixture);r.embedded=true;
    h.send({op:"subtitle-add",path:path.join(h.root,"external-fixture.srt")});
    await h.until(()=>h.state()?.media.externalFixture&&h.state().media.tracks.some(t=>t.type==="sub"&&t.external==="yes"&&t.selected==="yes"));r.external=true;
    h.send({op:"subtitle-visible",value:false});await h.until(()=>h.state()?.media.subtitleVisible==="no");r.hidden=true;
    h.send({op:"subtitle-track",value:0});await h.until(()=>h.state()?.media.sid==="no"&&!h.state().media.tracks.some(t=>t.type==="sub"&&t.selected==="yes"));r.disabled=true;
    h.send({op:"subtitle-track",value:inner.id});h.send({op:"subtitle-visible",value:true});
    await h.until(()=>h.state()?.media.innerFixture&&h.state().media.subtitleVisible==="yes");r.restored=true;
  });
  const buffer=await readFile(path.join(h.root,"fragmented-stream.mp4")),prefix=fragmentPrefixLength(buffer);
  const sockets=new Set(),responses=new Set();let requestCount=0;
  const server=createServer((req,res)=>{
    if(req.url!=="/fixture.mp4"){res.writeHead(404);res.end();return;}
    requestCount++;res.writeHead(200,{"Content-Type":"video/mp4","Content-Length":buffer.length});res.write(buffer.subarray(0,prefix));responses.add(res);
    res.on("close",()=>responses.delete(res));
  });
  server.on("connection",s=>{sockets.add(s);s.on("close",()=>sockets.delete(s));});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const url=`http://127.0.0.1:${server.address().port}/fixture.mp4`;
  async function stalled(){await h.startHost();const n=requestCount;h.load(0,url);await h.until(()=>requestCount>n);await h.until(()=>h.state()?.loaded&&h.state().time>0.3);await h.until(()=>h.state()?.pausedForCache==="yes",12000);}
  try{
    await check("midstream-stall-and-recover",async r=>{
      await stalled();r.prefixBytes=prefix;r.stalledTime=h.state().time;const ticks=h.ticks();await h.wait(350);r.uiAlive=h.ticks()>ticks;
      if(!r.uiAlive)throw Error("renderer-stalled");
      const start=performance.now();for(const res of responses)res.end(buffer.subarray(prefix));
      await h.until(()=>streamRecovered(h.state(),r.stalledTime),10000);r.recoveryMs=Math.round(performance.now()-start);r.recovered=true;
    });
    await check("midstream-stall-close",async r=>{
      await stalled();const n=h.stops().length;await h.stopHost();r.stop=h.stops()[n];
      if(!r.stop||r.stop.elapsedMs>8000||h.controls.active||h.controls.pending.size)throw Error("stop-not-clean");
    });
  }finally{await h.stopHost();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}
}

// Trusted CLI fixture setup, not a renderer API. Pauses neutral video for visual inspection.
export async function prepareSubtitleVisual(h,mode){
  if(!["embedded","external","hidden"].includes(mode))throw Error("invalid-visual-mode");
  await h.startHost();h.load(0);await h.until(()=>h.state()?.loaded&&h.state().time>0.3);
  h.send({op:"pause",value:true});await h.until(()=>h.state()?.paused==="yes");h.controls.request({op:"seek",value:2});await h.until(()=>h.controls.phase==="ready");
  if(mode==="external")h.send({op:"subtitle-add",path:path.join(h.root,"external-fixture.srt")});
  else h.send({op:"subtitle-track",value:1});
  h.send({op:"subtitle-visible",value:mode!=="hidden"});
  await h.until(()=>h.state()?.media.subtitleVisible===(mode==="hidden"?"no":"yes")&&(mode==="external"?h.state().media.externalFixture:h.state().media.innerFixture));
}
