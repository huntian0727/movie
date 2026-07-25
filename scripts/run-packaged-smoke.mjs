import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const timeoutMs = 60_000;

export async function runPackagedSmoke(executablePath = defaultExecutablePath()) {
  const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "video-manager-packaged-smoke-"));
  let succeeded = false;
  try {
    const createResult = await runPhase(executablePath, smokeRoot, "create");
    const verifyResult = await runPhase(executablePath, smokeRoot, "verify");
    if (!createResult.ok || !verifyResult.ok) throw new Error("Packaged smoke result did not report success");
    succeeded = true;
    console.log(`Packaged smoke OK: ${executablePath}`);
    console.log(JSON.stringify({ create: createResult.checks, verify: verifyResult.checks }, null, 2));
  } finally {
    if (succeeded) {
      await rm(smokeRoot, { recursive: true, force: true });
    } else {
      console.error(`Packaged smoke diagnostics preserved at: ${smokeRoot}`);
    }
  }
}

async function runPhase(executablePath, smokeRoot, phase) {
  const resultPath = path.join(smokeRoot, `${phase}-result.json`);
  const childEnvironment = {
    ...process.env,
    VIDEO_MANAGER_PACKAGED_SMOKE_PHASE: phase,
    VIDEO_MANAGER_PACKAGED_SMOKE_USER_DATA: smokeRoot,
    VIDEO_MANAGER_PACKAGED_SMOKE_RESULT: resultPath
  };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;

  await spawnAndWait(executablePath, ["--disable-gpu"], childEnvironment, timeoutMs);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (!result.ok) throw new Error(`Packaged smoke ${phase} phase failed:\n${result.error ?? "unknown error"}`);
  return result;
}

function spawnAndWait(command, args, environment, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: "inherit",
      windowsHide: true
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

function defaultExecutablePath() {
  return path.join(process.cwd(), "release", "win-unpacked", "Local Video Manager.exe");
}

function parseExecutableArgument() {
  const index = process.argv.indexOf("--executable");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runPackagedSmoke(parseExecutableArgument()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
