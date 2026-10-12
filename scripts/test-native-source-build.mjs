import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
for (const name of ["native_source_build_test.py", "native_source_license_test.py", "source_review_companion_test.py"]) {
  const test = fileURLToPath(new URL("../tests/scripts/" + name, import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", [test], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
