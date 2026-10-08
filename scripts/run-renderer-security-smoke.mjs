import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "movie-renderer-security-")));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executable = path.join(process.cwd(), "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const child = spawn(executable, [path.resolve("scripts/renderer-security-smoke-main.cjs"), `--smoke-root=${root}`], { env, stdio: "inherit", windowsHide: true });
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; console.error("Renderer protocol security smoke timed out"); }, 30_000);
child.on("error", () => {
  clearTimeout(timer); process.exitCode = 1;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
child.on("exit", code => {
  clearTimeout(timer);
  if (code !== 0 || !existsSync(path.join(root, "security-completed.json"))) process.exitCode = 1;
  // Chromium's files remain locked until child exit; this directory was created by this runner only.
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
