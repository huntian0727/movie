// Match actual selected tracks, not a successful command ack alone.
export function selectedTrack(state,type,id){return state?.media?.tracks?.some(t=>t.type===type&&t.id===id&&t.selected==="yes")===true;}
export function streamRecovered(state,start){return state?.loaded===true&&state.paused==="no"&&state.pausedForCache==="no"&&state.seeking==="no"&&Number.isFinite(state.time)&&state.time>start+0.6;}
export function fragmentPrefixLength(buffer,fragments=2){
  let offset=0,seen=0;
  while(offset+8<=buffer.length){const size=buffer.readUInt32BE(offset),type=buffer.toString("ascii",offset+4,offset+8);
    if(size<8||offset+size>buffer.length)throw Error("invalid-fixture-box");
    offset+=size;if(type==="mdat"&&++seen===fragments)return offset;
  }
  throw Error("fixture-fragments-not-found");
}
