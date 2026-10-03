import {describe,it,expect} from "vitest";
import {selectedTrack,streamRecovered,fragmentPrefixLength} from "../../scripts/spikes/embedded-mpv/media-oracles.mjs";
describe("isolated media feature oracles",()=>{
  it("requires actual selected track and matching media type",()=>{
    const s={media:{tracks:[{type:"audio",id:2,selected:"yes"},{type:"sub",id:1,selected:"no"}]}};
    expect(selectedTrack(s,"audio",2)).toBe(true);expect(selectedTrack(s,"sub",2)).toBe(false);
    expect(selectedTrack(s,"sub",1)).toBe(false);expect(selectedTrack(null,"audio",2)).toBe(false);
  });
  it("does not confuse a loaded or unpaused buffer with recovered playback",()=>{
    const s={loaded:true,paused:"no",pausedForCache:"no",seeking:"no",time:3};
    expect(streamRecovered(s,2)).toBe(true);
    for(const patch of [{time:2.1},{pausedForCache:"yes"},{seeking:"yes"},{loaded:false},{paused:"yes"}])expect(streamRecovered({...s,...patch},2)).toBe(false);
  });
  it("stalls only after complete fixture fragments",()=>{
    function box(type){const b=Buffer.alloc(12);b.writeUInt32BE(12);b.write(type,4);return b;}
    const b=Buffer.concat([box("ftyp"),box("moov"),box("moof"),box("mdat"),box("moof"),box("mdat"),box("moof")]);
    expect(fragmentPrefixLength(b)).toBe(72);
    expect(()=>fragmentPrefixLength(b,3)).toThrow("fixture-fragments-not-found");
    expect(()=>fragmentPrefixLength(Buffer.alloc(8))).toThrow("invalid-fixture-box");
  });
});
