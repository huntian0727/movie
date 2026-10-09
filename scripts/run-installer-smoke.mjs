import { execFile, spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { runPackagedSmoke } from "./run-packaged-smoke.mjs";
import { assertTestFlavor, authenticode, hashFile, readJson, TEST_NSIS_GUID } from "./release-engineering.mjs";

const execute = promisify(execFile);
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Installer smoke requires Windows x64.");
const releaseDirectory = path.join(process.cwd(), "release", "unsigned-test-build");
const metadata = await readJson(path.join(releaseDirectory, "build-metadata.json"));
const flavor = await readJson(path.join(releaseDirectory, "build-flavor.json"));
assertTestFlavor(flavor);
if (JSON.stringify(metadata.flavor) !== JSON.stringify(flavor) || metadata.signed !== false || metadata.releaseClass !== "unsigned-test-build") {
  throw new Error("Installer smoke requires verified, current unsigned candidate metadata.");
}
const installerPath = path.join(releaseDirectory, flavor.artifactName);
const candidate = metadata.installers?.find((entry) => entry.name === flavor.artifactName);
if (!candidate || await hashFile(installerPath) !== candidate.sha256) throw new Error("Candidate installer SHA-256 does not match verified metadata.");
await authenticode(installerPath, flavor);
const before = await hostIsolationSnapshot();
if (before.testRegistrationPresent) throw new Error("A test installation already exists; refusing to alter it.");

const installParent = await mkdtemp(path.join(os.tmpdir(), "video-manager-isolated-installer-"));
const installDirectory = path.join(installParent, "installed-app");
const sandboxUserData = path.join(installParent, "sandbox-user-data");
const outerDatabase = path.join(installParent, "external-library.sqlite");
const userDatabase = path.join(sandboxUserData, "library.sqlite");
const outerVideo = path.join(installParent, "external-source.mp4");
const innerDatabase = path.join(installDirectory, "unknown-user-library.sqlite");
const innerVideo = path.join(installDirectory, "unknown-user-source.mp4");
const nestedVideo = path.join(installDirectory, "resources", "unknown-user-directory", "source.mp4");
const environment = { ...process.env, VIDEO_MANAGER_PACKAGED_SMOKE_USER_DATA: sandboxUserData };
delete environment.ELECTRON_RUN_AS_NODE;
let succeeded = false;

try {
  await mkdir(sandboxUserData, { recursive: true });
  await writeFile(path.join(installParent, ".disposable-installer-test-root"), flavor.appId, "utf8");
  makeDatabase(outerDatabase);
  makeDatabase(userDatabase);
  // Encode a valid tiny synthetic video with the exact packaged FFmpeg.
  await execute(path.join(releaseDirectory, "win-unpacked", "resources", "media-tools", "ffmpeg.exe"),
    ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=1", "-t", "1", "-c:v", "mpeg4", outerVideo],
    { windowsHide: true, timeout: 30_000 });
  // First install into a nonempty unrelated directory must fail without touching it.
  const unrelatedDirectory = path.join(installParent, "unrelated-user-folder");
  await mkdir(unrelatedDirectory);
  const unrelatedDatabase = path.join(unrelatedDirectory, "library.sqlite");
  const unrelatedVideo = path.join(unrelatedDirectory, "video.mp4");
  makeDatabase(unrelatedDatabase); await copyFile(outerVideo, unrelatedVideo);
  const unrelatedHashes = await Promise.all([hashFile(unrelatedDatabase), hashFile(unrelatedVideo)]);
  console.log("Installer smoke phase: reject unrelated nonempty target.");
  await spawnAndWait(installerPath, ["/S", "/currentuser", `/D=${unrelatedDirectory}`], 30_000, environment, true);
  await assertSentinels([unrelatedDatabase, unrelatedVideo], unrelatedHashes);
  if ((await hostIsolationSnapshot()).testRegistrationPresent) throw new Error("Rejected nonempty installation created a registry entry.");
  console.log("Installer smoke phase: install into new disposable target.");
  await spawnAndWait(installerPath, ["/S", "/currentuser", `/D=${installDirectory}`], 120_000, environment);
  const executablePath = path.join(installDirectory, `${flavor.executableName}.exe`);
  await access(executablePath);
  const installedFlavor = await readJson(path.join(installDirectory, "resources", "build-flavor.json"));
  assertTestFlavor(installedFlavor);
  if (JSON.stringify(installedFlavor) !== JSON.stringify(flavor)) throw new Error("Installed flavor differs from verified candidate.");
  if (await hashFile(executablePath) !== metadata.application?.sha256) throw new Error("Installed executable differs from the verified candidate.");
  const marker = await readFile(path.join(installDirectory, ".movie-install-safety.ini"), "utf8");
  if (!marker.includes(`appId=${flavor.appId}`) || !marker.includes("safeUninstaller=1")) throw new Error("Installed safety marker is invalid.");

  makeDatabase(innerDatabase);
  await copyFile(outerVideo, innerVideo);
  await mkdir(path.dirname(nestedVideo), { recursive: true });
  await copyFile(outerVideo, nestedVideo);
  const sentinels = [outerDatabase, userDatabase, outerVideo, innerDatabase, innerVideo, nestedVideo];
  const hashes = await Promise.all(sentinels.map(hashFile));
  console.log("Installer smoke phase: repair with synthetic user files present.");
  await spawnAndWait(installerPath, ["/S", "/currentuser", `/D=${installDirectory}`], 120_000, environment);
  await assertSentinels(sentinels, hashes);
  // Packaged smoke passes an explicit temporary userData before any DB is opened.
  await runPackagedSmoke(executablePath);
  await assertSentinels(sentinels, hashes);

  const uninstallers = (await readdir(installDirectory)).filter((name) => /^Uninstall.*\.exe$/i.test(name));
  if (uninstallers.length !== 1) throw new Error("Exactly one isolated test uninstaller is required.");
  const uninstaller = path.join(installDirectory, uninstallers[0]);
  // Destructive data flag must fail before any removal, even when explicitly supplied.
  await spawnAndWait(uninstaller, ["/S", "--delete-app-data", `_?=${installDirectory}`], 30_000, environment, true);
  await access(executablePath);
  await assertSentinels(sentinels, hashes);
  await spawnAndWait(uninstaller, ["/S", `_?=${installDirectory}`], 120_000, environment);
  await waitForRemoval(executablePath, 30_000);
  await assertSentinels(sentinels, hashes);
  const after = await hostIsolationSnapshot();
  if (after.productionStateHash !== before.productionStateHash || after.testRegistrationPresent) {
    throw new Error("Installer smoke changed production registration/shortcuts or left test registration.");
  }
  succeeded = true;
  console.log("Installer smoke PASS: isolated unsigned identity; install, repair, explicit data-delete rejection and uninstall; real SQLite/video sentinels preserved inside/outside installation; production registration/shortcuts unchanged.");
} finally {
  if (succeeded) {
    // Only our mkdtemp root with our marker is recursively removed.
    const marker = await readFile(path.join(installParent, ".disposable-installer-test-root"), "utf8");
    if (marker !== flavor.appId || !path.resolve(installParent).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe smoke cleanup root.");
    await rm(installParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } else console.error(`Installer smoke failed; disposable diagnostics retained at: ${installParent}`);
}

function makeDatabase(filePath) {
  const database = new DatabaseSync(filePath);
  database.exec("CREATE TABLE sentinel (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sentinel VALUES (1, 'synthetic-only'); PRAGMA user_version=1;");
  if (database.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Fixture SQLite quick_check failed.");
  database.close();
}

async function assertSentinels(files, hashes) {
  for (let index = 0; index < files.length; index++) {
    if (await hashFile(files[index]) !== hashes[index]) throw new Error("Install/repair/uninstall changed a synthetic user-file sentinel.");
    if (files[index].endsWith(".sqlite")) {
      const database = new DatabaseSync(files[index], { readOnly: true });
      try { if (database.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Preserved SQLite is corrupt."); }
      finally { database.close(); }
    }
  }
}
async function hostIsolationSnapshot() {
  const script = `$ErrorActionPreference='Stop'; Import-Module (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1') -ErrorAction Stop; $formal='a2885079-8351-5efc-a946-f9cf44af627d'; $test='${TEST_NSIS_GUID}'; $result=[ordered]@{};
$testPresent=$false;
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view);
    try {
      foreach($suffix in @("Software\\$formal","Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$formal")) {
        $key=$base.OpenSubKey($suffix,$false); $label="$hive/$view/$suffix";
        if($null -eq $key){$result[$label]='absent'}else{try{$values=[ordered]@{};foreach($name in @($key.GetValueNames() | Sort-Object)){$values[$name]=[ordered]@{kind=[string]$key.GetValueKind($name);value=$key.GetValue($name)}};$result[$label]=$values}finally{$key.Dispose()}}
      }
      foreach($suffix in @("Software\\$test","Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$test")) {
        $key=$base.OpenSubKey($suffix,$false); if($null -ne $key){$testPresent=$true;$key.Dispose()}
      }
    } finally {$base.Dispose()}
  }
}
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'))) { $file=Join-Path $folder '拉面影视.lnk'; if(Test-Path -LiteralPath $file){$fileHash=[Security.Cryptography.SHA256]::Create(); $result[$file]=[BitConverter]::ToString($fileHash.ComputeHash([IO.File]::ReadAllBytes($file)))}else{$result[$file]='absent'} }
$bytes=[Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Depth 12 -Compress)); $hash=[Security.Cryptography.SHA256]::Create(); @{productionStateHash=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','');testRegistrationPresent=$testPresent} | ConvertTo-Json -Compress`;
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30_000 });
  return JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
}
function spawnAndWait(command, args, timeout, env, expectFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "inherit", windowsHide: true, env });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Isolated installer test timed out.")); }, timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal || code === null || (!expectFailure && code !== 0) || (expectFailure && code === 0)) reject(new Error(`Isolated installer exit status mismatch: expected ${expectFailure ? "failure" : "success"}, received code=${code}, signal=${signal ?? "none"}.`));
      else resolve();
    });
  });
}
async function waitForRemoval(targetPath, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { await access(targetPath); await new Promise((resolve) => setTimeout(resolve, 250)); }
    catch { return; }
  }
  throw new Error("Uninstaller did not remove the known application executable.");
}
