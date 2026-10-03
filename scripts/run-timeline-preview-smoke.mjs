import { spawn } from "node:child_process";
import path from "node:path";
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(path.resolve("node_modules/electron/dist/electron.exe"), [path.resolve("scripts/timeline-preview-smoke-main.cjs")], {
  env: environment, stdio: "inherit", windowsHide: true, shell: false
});
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 30000);
child.on("error", error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on("exit", code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
