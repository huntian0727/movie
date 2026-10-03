import {createServer} from "node:http";
import path from "node:path";
import {performance} from "node:perf_hooks";

// Real libmpv failures, against neutral fixtures and a private loopback server.
// Does not modify network configuration or touch user video files.
export async function runFailureValidation(h) {
  const sockets=new Set();let requests=0;
  const server=createServer(()=>{requests++; /* deliberately send no response */});
  server.on("connection",s=>{sockets.add(s);s.on("close",()=>sockets.delete(s));});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const stalled=`http://127.0.0.1:${server.address().port}/stall.mp4`;
  async function playback(){h.load(0);await h.until(()=>h.getState()?.loaded&&h.getState().time>0.3);}
  async function recover(){await h.perform({op:"next"});await h.until(()=>h.getState()?.loaded&&h.getState().time>0.3);}
  async function check(name,run){const r={name};const start=performance.now();try{await run(r);r.pass=true;}catch(e){r.pass=false;r.error=e.message;}finally{r.elapsedMs=Math.round(performance.now()-start);await h.stopHost();h.record(r);await h.persist();}}
  try {
    await check("missing-file-and-recovery",async r=>{
      await h.startHost();const n=h.faults().length;h.expectFault(true);
      h.load(0,path.join(h.root,"missing-fixture-does-not-exist.mp4"));
      await h.until(()=>h.faults().length>n);h.expectFault(false);
      if(h.getState()?.loaded||h.controls.phase!=="failed")throw new Error("stale-ready-after-missing");
      const ticks=h.ticks();await h.wait(350);r.uiAlive=h.alive()&&h.ticks()>ticks;
      if(!r.uiAlive)throw new Error("renderer-stalled");
      await recover();r.recovered=true;
    });
    await check("host-crash-pending-controls-and-recovery",async r=>{
      await h.startHost();await playback();h.send({op:"pause",value:true});await h.until(()=>h.getState()?.paused==="yes");
      h.controls.request({op:"seek",value:2});h.controls.request({op:"seek",value:7});
      h.killHost();await h.until(()=>h.controls.phase==="failed"&&!h.getState()?.loaded);
      r.queueCleared=!h.controls.active&&!h.controls.pending.size;
      try{h.perform({op:"seek",value:5});}catch(e){r.staleActionRejected=e.message==="media-not-ready";}
      const ticks=h.ticks();await h.wait(350);r.uiAlive=h.alive()&&h.ticks()>ticks;
      if(!r.queueCleared||!r.staleActionRejected||!r.uiAlive)throw new Error("crash-isolation-failed");
      await recover();r.recovered=true;
    });
    await check("loopback-read-timeout-and-recovery",async r=>{
      await h.startHost();const n=h.faults().length,before=requests;h.expectFault(true);h.load(0,stalled);
      await h.until(()=>requests>before);const ticks=h.ticks();const start=performance.now();
      await h.until(()=>h.faults().length>n,45000);r.timeoutMs=Math.round(performance.now()-start);h.expectFault(false);
      r.timeoutSource=h.faults()[n].type;
      r.uiAlive=h.alive()&&h.ticks()>ticks;r.failureState=h.controls.phase==="failed"&&!h.getState()?.loaded;
      if(!r.uiAlive||!r.failureState)throw new Error("timeout-state-failed");
      await recover();r.recovered=true;
    });
    await check("close-during-loopback-read",async r=>{
      await h.startHost();const before=requests;h.load(0,stalled);await h.until(()=>requests>before);
      const ticks=h.ticks();await h.wait(350);r.uiAlive=h.alive()&&h.ticks()>ticks;
      const n=h.stops().length;await h.stopHost();r.stop=h.stops()[n];
      if(!r.uiAlive||!r.stop||r.stop.elapsedMs>8000||h.controls.active||h.controls.pending.size)throw new Error("bounded-stop-failed");
    });
  } finally {
    h.expectFault(false);await h.stopHost();for(const s of sockets)s.destroy();
    await new Promise(resolve=>server.close(resolve));
  }
}
