import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const mode = process.argv[2];
if (mode !== "--dir" && mode !== "--win-nsis") {
  throw new Error("Usage: node scripts/run-electron-builder.mjs <--dir|--win-nsis>");
}

const electronBuilderCli = path.join(process.cwd(), "node_modules", "electron-builder", "cli.js");
const args = mode === "--dir" ? ["--dir"] : ["--win", "nsis"];
const hasSigningCertificate = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);

if (!hasSigningCertificate) {
  args.push("--config.win.signAndEditExecutable=false");
  console.log("Building an unsigned test artifact; Windows signing and executable resource editing are disabled.");
}

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [electronBuilderCli, ...args], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (signal) reject(new Error(`electron-builder exited with signal ${signal}`));
    else if (code !== 0) reject(new Error(`electron-builder exited with code ${code}`));
    else resolve();
  });
});
