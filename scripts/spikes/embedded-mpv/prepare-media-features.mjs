// Generates neutral, short media only. No library paths, DB, or cloud traffic.
import {spawn} from "node:child_process";
import {mkdir,writeFile,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(process.argv[2]||"");
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
if(!process.argv[2]||root===path.parse(root).root||root===repo||root.startsWith(repo+path.sep))throw Error("isolated-output-required");
await mkdir(root,{recursive:true});
async function run(args){await new Promise((resolve,reject)=>{
  const c=spawn(path.join(repo,"native-bin/media-tools/ffmpeg.exe"),["-hide_banner","-loglevel","error","-nostdin","-y",...args],{windowsHide:true,stdio:"inherit"});
  c.on("error",reject);c.on("exit",code=>code===0?resolve():reject(Error("fixture-generation-failed")));
});}
const inner=path.join(root,"embedded-fixture.srt"),external=path.join(root,"external-fixture.srt");
await writeFile(inner,"1\n00:00:00,000 --> 00:00:11,000\nINNER subtitle - 内嵌字幕测试\n\n");
await writeFile(external,"1\n00:00:00,000 --> 00:00:11,000\nEXTERNAL subtitle - 外挂字幕测试\n\n");
const multi=path.join(root,"双音轨 空格字幕验证.mkv");
await run(["-f","lavfi","-i","testsrc2=size=640x360:rate=24","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-f","lavfi","-i","sine=frequency=880:sample_rate=48000","-i",inner,
  "-map","0:v","-map","1:a","-map","2:a","-map","3:s","-t","12","-c:v","libx264","-preset","ultrafast","-g","24","-c:a","aac","-c:s","srt","-metadata:s:a:0","language=eng","-metadata:s:a:1","language=zho","-disposition:a:0","default","-disposition:a:1","0","-disposition:s:0","default","-threads","2",multi]);
const stream=path.join(root,"fragmented-stream.mp4");
await run(["-f","lavfi","-i","testsrc2=size=640x360:rate=24","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","20","-c:v","libx264","-preset","ultrafast","-g","24","-c:a","aac","-movflags","frag_keyframe+empty_moov+default_base_moof","-threads","2",stream]);
await writeFile(path.join(root,"media-feature-samples.json"),JSON.stringify([{name:"dual-audio-subtitles",path:multi}],null,2));
console.log(JSON.stringify({neutralSamples:2,durations:[12,20],multiBytes:(await stat(multi)).size,streamBytes:(await stat(stream)).size}));
