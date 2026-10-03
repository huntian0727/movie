// Prototype only. Never leave actionable media state behind after a host failure.
export function invalidateHostState(state, controls, reason) {
  controls?.fail(reason);
  return {...state, type:"snapshot", loaded:false, seeking:"no", pausedForCache:"no", paused:"yes"};
}
export function isSpikeKey(code) {return ["Space","KeyF","Escape"].includes(code);}
export function spikeKeyCode(code,key) {
  if(isSpikeKey(code))return code;
  if(key===" "||key==="Space")return "Space";
  if(key==="f"||key==="F")return "KeyF";
  if(key==="Escape")return "Escape";
  return null;
}
