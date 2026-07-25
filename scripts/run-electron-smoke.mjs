import { spawn } from "node:child_process";
import path from "node:path";

const timeoutMs = 30_000;
const electronExecutable = process.platform === "win32"
  ? path.join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
  : path.join(process.cwd(), "node_modules", "electron", "dist", "electron");
const smokeEntry = path.join(process.cwd(), "scripts", "electron-smoke-main.cjs");
const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronExecutable, [smokeEntry], {
  cwd: process.cwd(),
  env: childEnvironment,
  shell: false,
  stdio: "inherit",
  windowsHide: true
});

const timeout = setTimeout(() => {
  child.kill();
  console.error(`Electron smoke timed out after ${timeoutMs} ms.`);
  process.exitCode = 1;
}, timeoutMs);

child.on("error", (error) => {
  clearTimeout(timeout);
  console.error("Unable to start the Electron smoke process.", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    console.error(`Electron smoke exited with signal ${signal}.`);
    process.exitCode = 1;
  } else if (code !== 0) {
    console.error(`Electron smoke exited with code ${code}. Run npm run rebuild:electron in this Electron-only checkout.`);
    process.exitCode = code ?? 1;
  }
});
