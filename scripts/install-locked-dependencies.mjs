import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function planDependencyLifecycles(root, lock) {
  const directories = new Set();
  for (const location of Object.keys(lock.packages)) {
    if (!location) continue;
    const directory = path.resolve(root, location);
    if (!directory.startsWith(path.resolve(root, "node_modules") + path.sep)) throw new Error("Unexpected lockfile package path");
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT" && lock.packages[location].optional) continue; throw error; }
    if (manifest.version !== lock.packages[location].version) throw new Error("Installed package version does not match lockfile");
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(manifest.name ?? "")) throw new Error("Unsafe dependency name");
    const authored = ["preinstall", "install", "postinstall"].some(event => Boolean(manifest.scripts?.[event]));
    let implicitGyp = false;
    if (manifest.gypfile !== false) {
      try { await access(path.join(directory, "binding.gyp")); implicitGyp = true; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (authored || implicitGyp) directories.add(directory);
  }
  return [...directories].sort();
}

function npm(args) {
  const cli = process.env.npm_execpath;
  if (!cli || !path.isAbsolute(cli)) throw new Error("Invoke via npm run install:locked with the fixed npm version");
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Dependency lifecycle command failed: ${args[0]}`, { cause: result.error });
}

async function install() {
  const root = process.cwd();
  // npm 10 loses gypfile:false on lockfile-driven installs (npm/cli#9837).
  // Extract with integrity verification, then replay every authored lifecycle.
  // The upstream N-API opt-out is honored; no dependency source is patched.
  npm(["run", "verify:environment"]);
  npm(["ci", "--ignore-scripts", "--include=dev"]);
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const dependencies = await planDependencyLifecycles(root, lock);
  if (dependencies.length) npm(["rebuild", ...dependencies, "--foreground-scripts", "--ignore-scripts=false"]);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const event of ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"]) {
    if (manifest.scripts?.[event]) npm(["run", event, "--ignore-scripts"]);
  }
  npm(["run", "verify:native:node"]);
  npm(["run", "prepare:electron"]);
  console.log(`Locked dependency installation complete; ${dependencies.length} exact lifecycle package directories replayed.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  install().catch(error => { console.error(error); process.exitCode = 1; });
}
