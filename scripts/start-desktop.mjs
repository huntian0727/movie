import { spawn } from "node:child_process";
import path from "node:path";

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const startupTimeoutMs = 30_000;
const isWindows = process.platform === "win32";

let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

async function main() {
  await buildMainProcess();
  const hasDevServer = await isReachable(devServerUrl);

  if (!hasDevServer) {
    viteProcess = spawnVite();
    await waitForDevServer(devServerUrl, startupTimeoutMs);
  }

  electronProcess = spawnElectron(process.argv.slice(2));

  electronProcess.on("exit", (code, signal) => {
    cleanup();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

async function buildMainProcess() {
  await runCommand(process.execPath, [path.join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.node.json"]);
}

function spawnVite() {
  return spawn(process.execPath, [path.join("node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
    shell: false,
    stdio: "inherit",
    windowsHide: false
  });
}

function spawnElectron(args) {
  const executable = isWindows
    ? path.join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
    : path.join(process.cwd(), "node_modules", "electron", "dist", "electron");

  return spawn(executable, [".", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
    shell: false,
    stdio: "inherit",
    windowsHide: false
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: "inherit",
      windowsHide: false
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited with signal ${signal}: ${command} ${args.join(" ")}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Command exited with code ${code}: ${command} ${args.join(" ")}`));
        return;
      }

      resolve();
    });

    child.on("error", reject);
  });
}

async function waitForDevServer(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (viteProcess?.exitCode !== null) {
      throw new Error("Vite dev server exited before it became reachable.");
    }

    if (await isReachable(url)) return;
    await delay(300);
  }

  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electronProcess && electronProcess.exitCode === null) electronProcess.kill();
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill();
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

main().catch((error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});
