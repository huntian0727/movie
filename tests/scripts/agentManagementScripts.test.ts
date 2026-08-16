// @vitest-environment node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const describeWindows = process.platform === "win32" ? describe : describe.skip;

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function invokePowerShell(scriptPath: string, args: string[], cwd: string, env = process.env): string {
  return execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args
  ], { cwd, env, encoding: "utf8", timeout: 30_000, stdio: "pipe" });
}

describeWindows("agent management PowerShell safety", () => {
  it("runs only the Node release gate and rejects mixed Electron smoke before invoking npm", () => {
    const root = createTempRoot("agent-qa-gate-");
    const fakeBin = path.join(root, "bin");
    const npmLog = path.join(root, "npm.log");
    mkdirSync(fakeBin);
    writeFileSync(path.join(fakeBin, "npm.cmd"), [
      "@echo off",
      ">>\"%AGENT_GATE_NPM_LOG%\" echo %*",
      "exit /b 0"
    ].join("\r\n"));
    const env = {
      ...process.env,
      AGENT_GATE_NPM_LOG: npmLog,
      PATH: `${fakeBin};${process.env.PATH ?? ""}`
    };
    const scriptPath = path.resolve("scripts/agent/run-qa-gate.ps1");

    expect(invokePowerShell(scriptPath, [], root, env)).toContain(
      "QA_GATE_PASS NodeReleaseGate=PASS ElectronSmoke=NOT_RUN_SEPARATE_ABI_REQUIRED"
    );
    expect(readFileSync(npmLog, "utf8").trim()).toBe("run test:release-gate");

    rmSync(npmLog);
    expect(() => invokePowerShell(scriptPath, ["-IncludeElectronSmoke"], root, env)).toThrow(
      /unsafe in the Node ABI checkout[\s\S]*separate Electron ABI checkout/i
    );
    expect(existsSync(npmLog)).toBe(false);
  });

  it("writes Web Advisor handoffs only to direct markdown children of the repository handoff directory", () => {
    const root = createTempRoot("agent-web-handoff-");
    const remote = path.join(root, "origin.git");
    const worktree = path.join(root, "worktree");
    mkdirSync(worktree);
    git(root, "init", "--bare", remote);
    git(worktree, "init", "-b", "main");
    git(worktree, "config", "user.name", "Agent Script Test");
    git(worktree, "config", "user.email", "agent-script@example.invalid");
    writeFileSync(path.join(worktree, "README.md"), "initial\n");
    git(worktree, "add", "README.md");
    git(worktree, "commit", "-m", "chore: initialize handoff fixture");
    git(worktree, "remote", "add", "origin", remote);
    git(worktree, "push", "-u", "origin", "main");
    git(worktree, "switch", "-c", "ai/handoff-test");
    writeFileSync(path.join(worktree, "change.txt"), "review me\n");
    git(worktree, "add", "change.txt");
    git(worktree, "commit", "-m", "docs: add handoff fixture change");
    git(worktree, "push", "-u", "origin", "ai/handoff-test");

    const scriptPath = path.resolve("scripts/agent/generate-web-handoff.ps1");
    const allowedOutput = path.join(worktree, "docs", "ai", "web-handoff", "TASK-PM-TEST.md");
    const commonArgs = [
      "-Task", "TASK-PM-TEST",
      "-ReasonForReview", "Verify path safety",
      "-Questions", "Is this handoff constrained?",
      "-Branch", "ai/handoff-test"
    ];

    expect(invokePowerShell(scriptPath, [...commonArgs, "-OutputPath", allowedOutput], worktree)).toContain(
      `Generated ${allowedOutput}`
    );
    expect(readFileSync(allowedOutput, "utf8")).toContain("# Web Advisor Handoff");

    const traversalOutput = path.join("docs", "ai", "web-handoff", "..", "escape.md");
    expect(() => invokePowerShell(scriptPath, [...commonArgs, "-OutputPath", traversalOutput], worktree)).toThrow(
      /must be a direct child/
    );
    expect(existsSync(path.join(worktree, "docs", "ai", "escape.md"))).toBe(false);

    const outsideOutput = path.join(root, "outside.md");
    expect(() => invokePowerShell(scriptPath, [...commonArgs, "-OutputPath", outsideOutput], worktree)).toThrow(
      /must be a direct child/
    );
    expect(existsSync(outsideOutput)).toBe(false);

    const wrongExtension = path.join(worktree, "docs", "ai", "web-handoff", "LATEST.txt");
    expect(() => invokePowerShell(scriptPath, [...commonArgs, "-OutputPath", wrongExtension], worktree)).toThrow(
      /must be a \.md file/
    );
    expect(existsSync(wrongExtension)).toBe(false);
  });
});

describe("movie skill activation prompts", () => {
  it.each([
    "movie-project-manager",
    "movie-developer",
    "movie-qa",
    "movie-ui-designer"
  ])("explicitly invokes $%s from its default prompt", (skillName) => {
    const manifest = readFileSync(path.resolve("skills", skillName, "agents", "openai.yaml"), "utf8");
    expect(manifest).toContain(`$${skillName}`);
  });
});
