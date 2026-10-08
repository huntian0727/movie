import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquirePackage, assertX64ManagedExecutable, checkedDirectory, checkedFile, materializePinnedFiles, readPinnedZip, sha256 } from "./native-player-toolchain.mjs";

export const repositoryRoot = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
export const toolchain = JSON.parse(readFileSync(new URL("./native-player-toolchain.lock.json", import.meta.url), "utf8"));

export function compilerArguments(source, output, references, staging) {
  for (const value of [path.dirname(source), staging, repositoryRoot]) {
    if (/[,=\r\n]/.test(value)) throw new Error("Compiler path cannot be mapped safely");
  }
  return ["/nologo", "/deterministic+", "/noconfig", "/nostdlib+", "/langversion:5", "/platform:x64",
    "/optimize+", "/target:exe", "/debug-", "/codepage:65001", "/utf8output", "/preferreduilang:en-US",
    `/pathmap:${path.dirname(source)}=/_/src,${staging}=/_/out,${repositoryRoot}=/_/repo`,
    `/out:${output}`, ...references.map(reference => `/reference:${reference}`), source];
}

export async function buildNativePlayer(options = {}) {
  if (process.platform !== "win32") throw new Error("Windows native player build required (.NET Framework 4.8+; Visual Studio is not required)");
  const cache = checkedDirectory(repositoryRoot, path.join(repositoryRoot, ".tmp", "native-player-toolchain"));
  const source = realpathSync(checkedFile(repositoryRoot, options.source ?? path.join(repositoryRoot, "native/embedded-mpv/NativeHost.cs")));
  if (path.basename(source) !== "NativeHost.cs") throw new Error("NativeHost source filename must remain stable");
  const outputDirectory = checkedDirectory(repositoryRoot, options.outputDirectory ?? path.join(repositoryRoot, "native-bin"));
  const output = checkedFile(repositoryRoot, path.join(outputDirectory, "NativeHost.exe"));
  const compilerBytes = await acquirePackage(repositoryRoot, cache, toolchain.compiler);
  const referenceBytes = await acquirePackage(repositoryRoot, cache, toolchain.references);
  const compilerEntries = readPinnedZip(compilerBytes, name => name.startsWith("tasks/net472/"));
  const referenceEntries = readPinnedZip(referenceBytes, name => toolchain.references.assemblies.some(reference => reference.path === name));
  const compilerRoot = path.join(cache, `compiler-${toolchain.compiler.version}`);
  const referenceRoot = path.join(cache, `references-${toolchain.references.version}`);
  for (const pin of toolchain.references.assemblies) {
    if (!referenceEntries.has(pin.path) || sha256(referenceEntries.get(pin.path)) !== pin.sha256) throw new Error("Pinned reference assembly mismatch");
  }
  if (!compilerEntries.has(toolchain.compiler.executable) || sha256(compilerEntries.get(toolchain.compiler.executable)) !== toolchain.compiler.executableSha256) throw new Error("Pinned compiler executable mismatch");
  materializePinnedFiles(repositoryRoot, compilerRoot, compilerEntries);
  materializePinnedFiles(repositoryRoot, referenceRoot, referenceEntries);
  const compiler = path.join(compilerRoot, toolchain.compiler.executable);
  const references = toolchain.references.assemblies.map(pin => path.join(referenceRoot, pin.path));
  const staging = mkdtempSync(path.join(cache, "compile-"));
  try {
    const built = path.join(staging, "NativeHost.exe");
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) if (["LIB", "LIBPATH", "CSC", "PLATFORM"].includes(key.toUpperCase())) delete environment[key];
    const result = spawnSync(compiler, compilerArguments(source, built, references, staging), {
      cwd: staging, env: environment, windowsHide: true, shell: false, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024
    });
    if (result.error || result.status !== 0) throw new Error(`Pinned NativeHost compile failed: ${result.error?.message ?? [result.stdout, result.stderr].filter(Boolean).join("\n")}`);
    const bytes = readFileSync(built);
    assertX64ManagedExecutable(bytes);
    checkedFile(repositoryRoot, output);
    renameSync(built, output);
    return { output, bytes: bytes.length, sha256: sha256(bytes), sourceSha256: sha256(readFileSync(source)),
      compiler: { version: toolchain.compiler.version, sha256: toolchain.compiler.executableSha256, packageSha256: toolchain.compiler.sha256 },
      references: toolchain.references.assemblies, referencePackageVersion: toolchain.references.version };
  } finally {
    checkedDirectory(repositoryRoot, staging);
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("NativeHost build accepts no unreviewed command-line overrides");
  const result = await buildNativePlayer();
  console.log(`NativeHost x64 deterministic build OK: SHA-256 ${result.sha256}`);
}
