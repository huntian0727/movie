import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const REPO="huntian0727/movie";
const inputs=[
 {tag:"v0.1.16-beta.1",name:"Native-Runtime-38134981406-Pinned-Inputs.zip",bytes:39814033,sha256:"3b4b4d22a3cf303b05898dedd470a6f05b0bfaa532c4ca9ab481167cd8f21b99",destination:"native-runtime.zip"},
 {tag:"v0.1.15-beta.3",name:"Movie-Native-Runtime-38134981406-Corresponding-Sources.zip",bytes:257326109,sha256:"d7f286b7af10be3f07ca7e13ca7514c24ec15b0d742a673e3f1935e421c3fd75",destination:"source-companion.zip"}
];
const digest=data=>createHash("sha256").update(data).digest("hex");
async function verify(p,sha,bytes){
 const info=await lstat(p);
 if(!info.isFile()||info.isSymbolicLink()||info.size!==bytes||digest(await readFile(p))!==sha)throw new Error("Approved pinned input mismatch: "+path.basename(p));
}
const gh=(...args)=>execFileSync("gh",args,{encoding:"utf8",windowsHide:true,maxBuffer:4*1024*1024});
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REF!=="refs/tags/v0.1.16"||
 process.env.MOVIE_RELEASE_CLASS!=="unsigned-public-release"||!process.env.GH_TOKEN)throw new Error("Only exact approved GitHub stable tag may fetch approved public inputs");
 const root=process.cwd(),pin=JSON.parse(await readFile(path.join(root,"scripts/native-source-inputs.lock.json"),"utf8"));
 const expectPins=[["native-runtime.zip",39814033,inputs[0].sha256],["source-evidence.zip",255050585,"3e242199da78c68939ebcbc8bb70bae4c2e57102b7aadc5ceb6b54317880e70a"]];
 if(pin.assets?.length!==2||expectPins.some(([dest,bytes,sha])=>!pin.assets.some(x=>x.destination===dest&&x.bytes===bytes&&x.sha256===sha)))throw new Error("Source locks changed");
 const dir=path.join(root,".tmp/native-source-inputs");
 await mkdir(dir,{recursive:true});
 const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Unsafe staging directory");
 for(const asset of inputs){
  const rel=JSON.parse(gh("api","repos/"+REPO+"/releases/tags/"+asset.tag));
  if(rel.draft!==false||rel.prerelease!==true)throw new Error("Published source scope changed");
  const matches=rel.assets.filter(x=>x.name===asset.name&&x.state==="uploaded");
  if(matches.length!==1||matches[0].size!==asset.bytes||matches[0].digest!=="sha256:"+asset.sha256)throw new Error("Published asset digest changed");
  const dest=path.join(dir,asset.destination);
  try{await verify(dest,asset.sha256,asset.bytes);}
  catch(error){
   if(error.code!=="ENOENT")throw error;
   const source=path.join(dir,asset.name);
   gh("release","download",asset.tag,"--repo",REPO,"--pattern",asset.name,"--dir",dir);
   await verify(source,asset.sha256,asset.bytes);
   await rename(source,dest);
  }
 }
 const source=path.join(dir,"source-evidence.zip"),pinned=pin.assets.find(x=>x.destination==="source-evidence.zip");
 try{await verify(source,pinned.sha256,pinned.bytes);}
 catch(error){
  if(error.code!=="ENOENT")throw error;
  const code=["import shutil,sys,zipfile","source,out=sys.argv[1:]","with zipfile.ZipFile(source) as archive:","  assert archive.namelist().count('retained-native-sources.zip')==1","  with archive.open('retained-native-sources.zip') as inp,open(out,'xb') as dst:","    shutil.copyfileobj(inp,dst,1024*1024)"].join("\n");
  execFileSync("python",["-c",code,path.join(dir,"source-companion.zip"),source],{stdio:"inherit",windowsHide:true});
  await verify(source,pinned.sha256,pinned.bytes);
 }
 await verify(path.join(dir,"native-runtime.zip"),inputs[0].sha256,inputs[0].bytes);
 if(!process.env.GITHUB_ENV)throw new Error("Runner env file missing");
 await appendFile(process.env.GITHUB_ENV,"MOVIE_SOURCE_NATIVE_ZIP="+path.join(dir,"native-runtime.zip")+"\nMOVIE_SOURCE_PLAYER_ZIP="+path.join(dir,"native-runtime.zip")+"\n");
 console.log("EXACT_PINNED_PUBLIC_RELEASE_INPUTS=PASS");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
