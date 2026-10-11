import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { authenticode, hashFile, packagedFileManifest, readJson, releaseOutputDirectory, validateRelativeFile, verifyFormalApproval, zipArtifactName } from "./release-engineering.mjs";
import { verifyPlayerRuntime } from "./native-player-runtime.mjs";
import { runPackagedSmoke } from "./run-packaged-smoke.mjs";

if (process.platform !== "win32") throw new Error("ZIP QA requires Windows.");
const root = process.cwd(), output = path.join(root, releaseOutputDirectory());
const flavor = await readJson(path.join(output,"win-unpacked/resources/build-flavor.json"));
validateRelativeFile(flavor.executableName + ".exe");
validateRelativeFile(zipArtifactName(flavor));
if (flavor.outputDirectory !== releaseOutputDirectory()) throw new Error("ZIP flavor/output mismatch.");
const approvalSha256 = await verifyFormalApproval(root, flavor);
if (flavor.complianceApprovalSha256 !== approvalSha256) throw new Error("ZIP release approval differs from its packaged record.");
const signatures = {
  application: await authenticode(path.join(output,"win-unpacked",flavor.executableName+".exe"),flavor),
  nativeHost: await authenticode(path.join(output,"win-unpacked/resources/native-player/NativeHost.exe"),flavor)
};
const archive = path.join(output,zipArtifactName(flavor));
const extracted = await mkdtemp(path.join(output,"portable-qa-"));
// Reject paths outside the extraction root and Windows case collisions before extracting.
const script = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($env:MOVIE_PORTABLE_ZIP)
try {
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in $z.Entries) {
    $name=$entry.FullName.Replace('\','/').TrimEnd('/')
    if (!$name -or $name.StartsWith('/') -or $name -match '[\x00-\x1f:*?<>|]' -or
        $name.Split('/') -contains '..' -or $name.Split('/') -contains '.' -or !$seen.Add($name)) { throw 'Unsafe ZIP entry' }
  }
} finally { $z.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($env:MOVIE_PORTABLE_ZIP,$env:MOVIE_PORTABLE_ROOT)
`;
await promisify(execFile)("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{
  env:{...process.env,MOVIE_PORTABLE_ZIP:archive,MOVIE_PORTABLE_ROOT:extracted},windowsHide:true,timeout:120_000
});
const original = path.join(output,"win-unpacked");
const expected = await packagedFileManifest(original), actual = await packagedFileManifest(extracted);
if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("ZIP file manifest differs from unpacked candidate.");
for(const name of expected.files) {
  if(await hashFile(path.join(original,name))!==await hashFile(path.join(extracted,name))) throw new Error("ZIP file bytes differ: "+name);
}
await verifyPlayerRuntime(path.join(extracted,"resources/native-player"),await readJson(path.join(root,"scripts/native-player-runtime.lock.json")));
await runPackagedSmoke(path.join(extracted,flavor.executableName+".exe"));
const result={archive,sha256:await hashFile(archive),filesVerified:expected.files.length,extracted,commit:flavor.commit,appAsarSha256:await hashFile(path.join(extracted,"resources/app.asar")),releaseClass:flavor.releaseClass,approvalSha256,signatures,publicReleaseApproved:false};
await writeFile(path.join(output,"portable-qa.json"),JSON.stringify(result,null,2)+"\n");
await writeFile(path.join(output,"PORTABLE-SHA256SUMS.txt"),`${result.sha256}  ${path.basename(archive)}\n`);
console.log(JSON.stringify(result,null,2));
