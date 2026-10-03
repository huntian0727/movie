import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
if (process.platform !== "win32") throw new Error("Windows native player build required");
const output = path.resolve("native-bin"); mkdirSync(output, { recursive: true });
const compiler = path.join(process.env.WINDIR || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
const result = spawnSync(compiler, ["/nologo", "/target:exe", "/platform:x64", `/out:${path.join(output,"NativeHost.exe")}`, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", path.resolve("native/embedded-mpv/NativeHost.cs")], { windowsHide: true, stdio: "inherit" });
if (result.error || result.status !== 0) throw new Error("Native player compile failed");
