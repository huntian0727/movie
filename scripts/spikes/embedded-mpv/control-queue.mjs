// Experiment only. One active media operation, at most one pending seek/rotation each.
export class ControlQueue {
  constructor({getState,send,publish,record=()=>{},timeoutMs=30000}) {
    this.getState=getState;this.send=send;this.publish=publish;this.record=record;this.timeoutMs=timeoutMs;
    this.pending=new Map();this.active=null;this.timer=null;this.closed=false;
  }
  status(phase,extra={}) { this.phase=phase;this.publish({type:"control-status",phase,pending:this.pending.size,...extra}); }
  request(command) {
    if(this.closed)throw new Error("controls-closed");
    if(!["seek","rotate"].includes(command.op)||!Number.isFinite(command.value))throw new Error("invalid-media-control");
    const s=this.getState();if(!s?.loaded)throw new Error("media-not-ready");
    const coalesced=this.pending.has(command.op);
    this.pending.set(command.op,{...command,token:s.token});
    this.record({event:coalesced?"coalesced":"queued",op:command.op,value:command.value});
    this.pump();
    if(this.active)this.status("reading",{op:this.active.op,target:this.active.value});
  }
  pump() {
    if(this.active||this.closed||!this.pending.size)return;
    const [key,next]=this.pending.entries().next().value;this.pending.delete(key);
    const s=this.getState();
    if(!s?.loaded||s.token!==next.token){this.reset("cancelled");return;}
    if(next.op==="rotate"&&s.rotation===next.value){this.record({event:"unchanged",op:next.op,value:next.value});this.pump();return;}
    this.active={...next,restartCount:s.restartCount,ack:false};
    this.record({event:"sent",op:next.op,value:next.value});
    this.timer=setTimeout(()=>this.fail("timeout"),this.timeoutMs);
    this.status("reading",{op:next.op,target:next.value});
    this.send({op:next.op,value:next.value});
  }
  acknowledge(message) {
    if(!this.active||message.op!==this.active.op)return;
    if(message.result<0){this.fail("native-error");return;}
    this.active.ack=true;
  }
  observe(s) {
    const a=this.active;if(!a)return;
    if(s.token!==a.token){this.reset("cancelled");return;}
    if(!s.loaded||!a.ack||s.seeking!=="no"||!(s.restartCount>a.restartCount))return;
    const matches=a.op==="seek"?Number.isFinite(s.time)&&Math.abs(s.time-a.value)<0.35:s.rotation===a.value;
    if(!matches)return;
    clearTimeout(this.timer);this.timer=null;this.active=null;
    this.record({event:"completed",op:a.op,value:a.value});this.pump();
    if(!this.active)this.status("ready");
  }
  fail(reason) {
    const a=this.active;this.reset();this.record({event:reason,op:a?.op,value:a?.value});
    this.status("failed",{reason});
  }
  reset(reason) {
    clearTimeout(this.timer);this.timer=null;this.active=null;this.pending.clear();
    if(reason){this.record({event:reason});this.status(reason);}
  }
  close(){this.reset("cancelled");this.closed=true;}
}

export function controlLabel(state,controls) {
  if(controls?.phase==="failed")return "操作未完成，请重试";
  if(controls?.phase==="reading")return `正在读取目标位置${controls.pending?` · 待执行 ${controls.pending} 项`:""}`;
  if(state?.seeking==="yes")return "正在跳转，等待视频就绪";
  if(state?.pausedForCache==="yes")return "正在缓冲";
  return state?.paused==="yes"?"已暂停":"播放中";
}
