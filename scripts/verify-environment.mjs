import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REQUIRED_NODE_VERSION = "22.23.1";
export const REQUIRED_NPM_VERSION = "10.9.8";

export function parseNpmVersion(userAgent = "") {
  return /(?:^|\s)npm\/([^\s]+)/.exec(userAgent)?.[1];
}

export function inspectEnvironment({
  nodeVersion = process.versions.node,
  npmVersion = parseNpmVersion(process.env.npm_config_user_agent) ?? readNpmVersion()
} = {}) {
  const problems = [];
  if (nodeVersion !== REQUIRED_NODE_VERSION) {
    problems.push(`Node ${REQUIRED_NODE_VERSION} is required; found ${nodeVersion || "unknown"}.`);
  }
  if (npmVersion !== REQUIRED_NPM_VERSION) {
    problems.push(`npm ${REQUIRED_NPM_VERSION} is required; found ${npmVersion || "unknown"}.`);
  }
  return { ok: problems.length === 0, nodeVersion, npmVersion, problems };
}

export function formatEnvironmentError(result) {
  return [
    "Unsupported development environment:",
    ...result.problems.map((problem) => `- ${problem}`),
    "",
    "Windows recovery:",
    `1. Install/use Node ${REQUIRED_NODE_VERSION} (see .nvmrc or .node-version).`,
    `2. Run: npm install --global npm@${REQUIRED_NPM_VERSION}`,
    "3. Open a new terminal and run: npm ci",
    "",
    "Do not delete library.sqlite to repair a native-module ABI error."
  ].join("\n");
}

function readNpmVersion() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, shell: false });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`));
}

if (isMainModule()) {
  const result = inspectEnvironment();
  if (!result.ok) {
    console.error(formatEnvironmentError(result));
    process.exitCode = 1;
  } else {
    console.log(`Environment OK: Node ${result.nodeVersion}, npm ${result.npmVersion}.`);
  }
}
