import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPackagedSmoke } from "./run-packaged-smoke.mjs";

const releaseDirectory = path.join(process.cwd(), "release");
const installerName = (await readdir(releaseDirectory)).find((name) => /Setup\.exe$/i.test(name));
if (!installerName) throw new Error(`No NSIS installer found in ${releaseDirectory}`);

const installParent = await mkdtemp(path.join(os.tmpdir(), "video-manager-installer-smoke-"));
const installDirectory = path.join(installParent, "installed-app");
const sandboxAppData = path.join(installParent, "appdata");
const sandboxLocalAppData = path.join(installParent, "local-appdata");
const expectedUserData = path.join(sandboxAppData, "local-video-manager");
const databaseSentinel = path.join(expectedUserData, "library.sqlite");
const sourceVideoSentinel = path.join(installParent, "source-video-must-survive.mp4");
const sandboxEnvironment = {
  ...process.env,
  APPDATA: sandboxAppData,
  LOCALAPPDATA: sandboxLocalAppData
};
let succeeded = false;

try {
  const installerPath = path.join(releaseDirectory, installerName);
  await Promise.all([
    mkdir(expectedUserData, { recursive: true }),
    mkdir(sandboxLocalAppData, { recursive: true })
  ]);
  await spawnAndWait(installerPath, ["/S", `/D=${installDirectory}`], 120_000, sandboxEnvironment);
  const executablePath = path.join(installDirectory, "Local Video Manager.exe");
  await stat(executablePath);

  await writeFile(databaseSentinel, "database-sentinel", "utf8");
  await writeFile(sourceVideoSentinel, "source-video-sentinel", "utf8");

  // Reinstalling the same signed/unsigned artifact exercises the NSIS upgrade/repair
  // path without requiring a historical installer fixture in the repository.
  await spawnAndWait(installerPath, ["/S", `/D=${installDirectory}`], 120_000, sandboxEnvironment);
  await stat(executablePath);
  await assertSentinelsPreserved();
  await runPackagedSmoke(executablePath);

  const uninstaller = (await readdir(installDirectory)).find((name) => /^Uninstall.*\.exe$/i.test(name));
  if (!uninstaller) throw new Error("NSIS installer smoke did not find an uninstaller");
  await spawnAndWait(path.join(installDirectory, uninstaller), ["/S"], 120_000, sandboxEnvironment);
  await waitForRemoval(executablePath, 30_000);
  await assertSentinelsPreserved();
  succeeded = true;
  console.log(`Installer smoke OK: ${installerName}`);
} finally {
  if (succeeded) await rm(installParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  else console.error(`Installer smoke diagnostics preserved at: ${installParent}`);
}

function spawnAndWait(command, args, timeout, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: "inherit",
      windowsHide: true,
      env: environment
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after ${timeout} ms: ${command}`));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`${command} exited with signal ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolve();
    });
  });
}

async function assertSentinelsPreserved() {
  const [database, sourceVideo] = await Promise.all([
    readFile(databaseSentinel, "utf8"),
    readFile(sourceVideoSentinel, "utf8")
  ]);
  if (database !== "database-sentinel") {
    throw new Error("Install/upgrade/uninstall changed the user database sentinel");
  }
  if (sourceVideo !== "source-video-sentinel") {
    throw new Error("Install/upgrade/uninstall changed the source video sentinel");
  }
}

async function waitForRemoval(targetPath, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await access(targetPath);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch {
      return;
    }
  }
  throw new Error(`Uninstaller did not remove the application directory within ${timeout} ms: ${targetPath}`);
}
