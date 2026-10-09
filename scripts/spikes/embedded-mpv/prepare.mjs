// Build artifacts and generated media always go outside the repository.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(process.argv[2]||"");
if(process.platform!=="win32"||!process.argv[2]||root===path.parse(root).root)throw new Error("Windows and explicit isolated output directory required");
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
await mkdir(root,{recursive:true});
async function run(exe,args){await new Promise((resolve,reject)=>{const child=spawn(exe,args,{stdio:"inherit",windowsHide:true});child.on("error",reject);child.on("exit",(code)=>code===0?resolve():reject(new Error(`subprocess failed: ${code}`)));});}
await run("C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",["/nologo","/target:exe","/platform:x64",`/out:${path.join(root,"NativeHost.exe")}`,"/r:System.Windows.Forms.dll","/r:System.Drawing.dll","/r:System.Web.Extensions.dll",path.join(repo,"scripts/spikes/embedded-mpv/NativeHost.cs")]);
const configs=[
  {name:"h264-aac-mp4",ext:"mp4",video:["-c:v","libx264","-preset","ultrafast"],audio:["-c:a","aac"]},
  {name:"hevc-aac-mp4",ext:"mp4",video:["-c:v","libx265","-preset","ultrafast","-x265-params","pools=2:frame-threads=2","-tag:v","hvc1"],audio:["-c:a","aac"]},
  {name:"hevc-dts-mkv",ext:"mkv",video:["-c:v","libx265","-preset","ultrafast","-x265-params","pools=2:frame-threads=2"],audio:["-c:a","dca","-strict","-2"]},
  {name:"vp9-opus-mkv",ext:"mkv",video:["-c:v","libvpx-vp9","-deadline","realtime","-cpu-used","8"],audio:["-c:a","libopus"]}
];
const samples=[];
for(const config of configs){const output=path.join(root,`验证 空格-${config.name}.${config.ext}`);
  await run(path.join(repo,"native-bin/media-tools/ffmpeg.exe"),["-hide_banner","-loglevel","error","-nostdin","-y","-f","lavfi","-i","testsrc2=size=640x360:rate=24","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","12",...config.video,...config.audio,"-pix_fmt","yuv420p","-threads","2",output]);
  samples.push({name:config.name,path:output});}
await writeFile(path.join(root,"samples.json"),JSON.stringify(samples,null,2));
const runtime=await readFile(path.join(root,"libmpv-2.dll"));
console.log(JSON.stringify({output:root,syntheticSamples:samples.length,libmpvSha256:createHash("sha256").update(runtime).digest("hex"),libmpvBytes:runtime.length}));
