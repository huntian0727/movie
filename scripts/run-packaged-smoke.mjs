import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readJson, releaseOutputDirectory } from "./release-engineering.mjs";

const timeoutMs = 60_000;

export async function createSmokeRoot(tempDirectory = os.tmpdir()) {
  const createdDirectory = await mkdtemp(path.join(tempDirectory, "video-manager-packaged-smoke-"));
  try {
    // TEMP on Windows CI can be an 8.3 alias (for example C:\Users\RUNNER~1).
    // DataDirectoryManager intentionally rejects paths whose realpath differs, so
    // pass a canonical path to the packaged app rather than triggering a hidden modal.
    return await realpath(createdDirectory);
  } catch (error) {
    await rm(createdDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function runPackagedSmoke(executablePath) {
  executablePath ??= await defaultExecutablePath();
  const smokeRoot = await createSmokeRoot();
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

  await spawnAndWait(executablePath, ["--disable-gpu"], childEnvironment, timeoutMs, phase);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (!result.ok) throw new Error(`Packaged smoke ${phase} phase failed:\n${result.error ?? "unknown error"}`);
  return result;
}

function spawnAndWait(command, args, environment, timeout, phase) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    pipeSmokeOutput(child.stdout, process.stdout, phase, "stdout");
    pipeSmokeOutput(child.stderr, process.stderr, phase, "stderr");
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Packaged smoke ${phase} phase timed out after ${timeout} ms: ${command}`));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`${command} exited with signal ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolve();
    });
  });
}

export function formatSmokeOutputLine(phase, channel, line) {
  return /Can't find filter element|ERR_UNTRUSTED_IPC_SENDER|iCCP|deprecated/i.test(line)
    ? "[packaged-smoke:" + phase + ":" + channel + "] " + line
    : line;
}

function pipeSmokeOutput(stream, destination, phase, channel) {
  let pending = "";
  stream.setEncoding("utf8");
  const writeLine = (line) => destination.write(formatSmokeOutputLine(phase, channel, line) + "\n");
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) writeLine(line);
  });
  stream.on("end", () => {
    if (pending) writeLine(pending);
  });
}

async function defaultExecutablePath() {
  const directory = path.join(process.cwd(), releaseOutputDirectory());
  const flavor = await readJson(path.join(directory, "build-flavor.json"));
  return path.join(directory, "win-unpacked", `${flavor.executableName}.exe`);
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
