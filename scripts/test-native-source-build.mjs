import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const test = fileURLToPath(new URL("../tests/scripts/native_source_build_test.py", import.meta.url));
const result = spawnSync(process.platform === "win32" ? "python" : "python3", [test], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
