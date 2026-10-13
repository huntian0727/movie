// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertStablePortableDraft } from "../../scripts/stage-stable-portable-draft.mjs";
function fixture() {
  const flavor = { releaseClass:"unsigned-public-release", version:"1.2.3", commit:"a".repeat(40) };
  const approval = {approved:true, manualQaApproved:true, scope:"stable-portable-only", version:flavor.version, productDraftReleaseId:1, nativeSourceApprovalSha256:"b".repeat(64), correspondingNativeSourcesSha256:"c".repeat(64)};
  const pair = {version:flavor.version, application:{name:"application.zip",bytes:1,archiveSha256:"d".repeat(64),commit:flavor.commit},native:{name:"native.zip",bytes:2,archiveSha256:approval.correspondingNativeSourcesSha256,approvalSha256:approval.nativeSourceApprovalSha256}};
  const release = {id:1,draft:true,prerelease:false,tag_name:"v"+flavor.version,assets:[pair.application,pair.native].map(p=>({name:p.name,size:p.bytes,digest:"sha256:"+p.archiveSha256,state:"uploaded"}))};
  return {flavor,approval,pair,release};
}
describe("stable portable private staging",()=>{
  it("accepts exact approved draft and both matching sources",()=>{const f=fixture();expect(()=>assertStablePortableDraft(f.release,f.flavor,f.pair,f.approval)).not.toThrow();});
  it.each(["published","beta","unapproved","scope","tag","id","commit","source","native","qa"])("rejects %s drift",kind=>{
    const f=fixture();
    if(kind==="published")f.release.draft=false;
    if(kind==="beta")f.release.prerelease=true;
    if(kind==="unapproved")f.approval.approved=false;
    if(kind==="scope")f.approval.scope="installer";
    if(kind==="tag")f.release.tag_name="v9.0.0";
    if(kind==="id")f.release.id++;
    if(kind==="commit")f.pair.application.commit="e".repeat(40);
    if(kind==="source")f.release.assets.pop();
    if(kind==="native")f.pair.native.approvalSha256="e".repeat(64);
    if(kind==="qa")f.approval.manualQaApproved=false;
    expect(()=>assertStablePortableDraft(f.release,f.flavor,f.pair,f.approval)).toThrow();
  });
});
