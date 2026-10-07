import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const timeoutMs = 30_000;
const electronExecutable = process.platform === "win32"
  ? path.join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
  : path.join(process.cwd(), "node_modules", "electron", "dist", "electron");
const smokeEntry = path.join(process.cwd(), "scripts", "electron-smoke-main.cjs");
const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;
const nativeOnly = process.argv.includes("--native-only");
const smokeRoot = mkdtempSync(path.join(tmpdir(), "movie-clouddrive-safe-storage-"));
const completionFile = path.join(smokeRoot, "smoke-completed");

const child = spawn(electronExecutable, [smokeEntry, `--smoke-root=${smokeRoot}`, ...(nativeOnly ? ["--native-only"] : [])], {
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
  rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    console.error(`Electron smoke exited with signal ${signal}.`);
    process.exitCode = 1;
  } else if (code !== 0) {
    console.error(`Electron smoke exited with code ${code}. Run npm run rebuild:electron in this Electron-only checkout.`);
    process.exitCode = code ?? 1;
  } else if (!nativeOnly && !existsSync(completionFile)) {
    console.error("Electron security smoke exited before all assertions completed.");
    process.exitCode = 1;
  }
  // Chromium cache handles remain open until the child process exits.
  rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
