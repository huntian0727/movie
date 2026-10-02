// @vitest-environment node
import { describe, it, expect } from "vitest";
import { validateAction, validateBounds } from "../../scripts/spikes/embedded-mpv/contract.mjs";
describe("isolated embedded MPV spike contract",()=>{
  it("only allows constrained playback controls, never a file path or MPV command",()=>{
    expect(validateAction({op:"pause",value:true})).toEqual({op:"pause",value:true});
    expect(validateAction({op:"seek",value:5.5})).toEqual({op:"seek",value:5.5});
    expect(validateAction({op:"volume",value:20})).toEqual({op:"volume",value:20});
    expect(validateAction({op:"rotate",value:90})).toEqual({op:"rotate",value:90});
    for(const payload of [{op:"load",path:"x"},{op:"command",value:"run"},{op:"seek",value:NaN},{op:"volume",value:101},{op:"rotate",value:91},{op:"pause",value:"yes"},{op:"constructor",value:0},null]) expect(()=>validateAction(payload)).toThrow();
  });
  it("rejects invalid or unbounded native viewport geometry",()=>{
    expect(validateBounds({x:0,y:58,width:1280,height:720})).toEqual({op:"bounds",x:0,y:58,width:1280,height:720});
    for(const value of [null,{x:0,y:0,width:0,height:1},{x:0,y:0,width:NaN,height:1},{x:0,y:-1,width:1,height:1},{x:0,y:0,width:32769,height:1}]) expect(()=>validateBounds(value)).toThrow();
  });
});
