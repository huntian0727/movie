import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EmbeddedPlayerPage } from "../../src/renderer/components/EmbeddedPlayerPage";
import type { VideoManagerApi, VideoRecord } from "../../src/shared/videoTypes";
const video={id:"v1",filename:"中性测试.mp4"} as VideoRecord;
function setup(){
  const state={sessionKey:"",phase:"paused",time:2,duration:12,paused:true,volume:20,rotation:0,fullscreen:false,tracks:[]};
  const api={embeddedPlayback:vi.fn(async r=>({...state,sessionKey:r.sessionKey})),subscribeEmbeddedKeys:vi.fn(()=>vi.fn()),playExternalVideo:vi.fn(async()=>true)} as unknown as VideoManagerApi;
  const onFallback=vi.fn(),onSelect=vi.fn(async()=>undefined);
  return {api,onFallback,onSelect,state};
}
describe("embedded player trial page",()=>{
  it("starts by video ID and sends no paths, then cleans its session on unmount",async()=>{
    const p=setup();const view=render(<EmbeddedPlayerPage {...p} video={video} autoplay={false} queue={[video]} />);
    await waitFor(()=>expect(screen.getByText("已暂停")).toBeInTheDocument());
    expect(p.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({op:"start",videoId:"v1",autoplay:false}));
    const start=(p.api.embeddedPlayback as any).mock.calls[0][0];expect(start).not.toHaveProperty("path");
    view.unmount();expect(p.api.embeddedPlayback).toHaveBeenCalledWith({op:"stop",sessionKey:start.sessionKey});
  });
  it("stops embedded playback before returning to the old route",async()=>{
    const p=setup();const view=render(<EmbeddedPlayerPage {...p} video={video} autoplay queue={[video]} />);
    await waitFor(()=>expect(screen.getByText("已暂停")).toBeInTheDocument());
    await act(async()=>fireEvent.click(screen.getByText("退回原播放方式")));
    expect(p.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({op:"stop"}));expect(p.onFallback).toHaveBeenCalledWith(2000);view.unmount();
  });
  it("starts a new session when selecting a replacement video and sends the old stop key",async()=>{
    const p=setup();const queue=[video,{id:"v2",filename:"第二部.mp4"} as VideoRecord];
    const view=render(<EmbeddedPlayerPage {...p} video={video} autoplay queue={queue} />);
    await waitFor(()=>expect(screen.getByText("已暂停")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一部"));expect(p.onSelect).toHaveBeenCalledWith("v2");
    const first=(p.api.embeddedPlayback as any).mock.calls[0][0].sessionKey;
    view.rerender(<EmbeddedPlayerPage {...p} video={queue[1]} autoplay queue={queue} />);
    await waitFor(()=>expect(p.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({op:"start",videoId:"v2"})));
    expect(p.api.embeddedPlayback).toHaveBeenCalledWith({op:"stop",sessionKey:first});view.unmount();
  });
});
