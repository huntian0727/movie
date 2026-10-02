"use strict";
let snapshot = {}, rotation = 0;
const api = window.mpvSpike;
const seek = document.querySelector("#seek");
const status = document.querySelector("#status");
const action = (op, value) => api.action(op, value).catch(() => { status.textContent = "操作失败，请查看实验报告"; });
document.querySelector("#pause").onclick = () => action("pause", snapshot.paused !== "yes");
document.querySelector("#back").onclick = () => action("seek", Math.max(0,(snapshot.time || 0)-5));
document.querySelector("#forward").onclick = () => action("seek", Math.min(snapshot.duration || 86400,(snapshot.time || 0)+5));
document.querySelector("#volume").onchange = (event) => action("volume", Number(event.target.value));
seek.onchange = (event) => action("seek", Number(event.target.value));
document.querySelector("#rotate").onclick = () => action("rotate", rotation = (rotation+90)%360);
document.querySelector("#fullscreen").onclick = () => action("fullscreen");
document.querySelector("#next").onclick = () => action("next");
document.querySelector("#exit").onclick = () => action("quit");
function sendBounds(){ const r=document.querySelector("#viewport").getBoundingClientRect(); const d=window.devicePixelRatio;
  void api.bounds({x:Math.round(r.x*d),y:Math.round(r.y*d),width:Math.max(1,Math.round(r.width*d)),height:Math.max(1,Math.round(r.height*d))}); }
new ResizeObserver(sendBounds).observe(document.querySelector("#viewport"));
api.onState((state) => {
  if(state.type === "snapshot") { snapshot=state; seek.max=String(state.duration || 12); if(document.activeElement !== seek) seek.value=String(state.time || 0);
    status.textContent=`样本 ${state.sample || "—"} · ${state.videoCodec || "等待解码"} / ${state.audioCodec || "—"} · ${(state.time || 0).toFixed(1)} / ${(state.duration || 0).toFixed(1)} 秒 · ${state.paused === "yes" ? "已暂停" : "播放中"} · 硬解 ${state.hwdec || "—"} · ${state.embedded ? "已嵌入" : "未嵌入"}`;
  } else if(state.type === "ready") { sendBounds(); }
  else if(state.type === "fatal" || state.type === "error") status.textContent="播放宿主错误："+state.reason;
});
window.addEventListener("keydown",(event)=>{ if(event.target instanceof HTMLInputElement) return;
  if(event.code === "Space"){event.preventDefault();action("pause",snapshot.paused!=="yes");}
  if(event.code === "KeyF") action("fullscreen");
  if(event.code === "Escape") action("windowed");
});
