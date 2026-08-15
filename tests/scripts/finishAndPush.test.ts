// @vitest-environment node

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("finish-and-push main backup delivery", () => {
  it("archives the previous remote main before fast-forwarding main", () => {
    const root = mkdtempSync(path.join(tmpdir(), "finish-push-"));
    tempRoots.push(root);
    const remote = path.join(root, "origin.git");
    const worktree = path.join(root, "worktree");
    mkdirSync(worktree);
    git(root, "init", "--bare", remote);
    git(worktree, "init", "-b", "main");
    git(worktree, "config", "user.name", "Workflow Test");
    git(worktree, "config", "user.email", "workflow@example.invalid");
    writeFileSync(path.join(worktree, "README.md"), "initial\n");
    git(worktree, "add", "README.md");
    git(worktree, "commit", "-m", "chore: initial state");
    git(worktree, "remote", "add", "origin", remote);
    git(worktree, "push", "-u", "origin", "main");
    const oldMain = git(worktree, "rev-parse", "HEAD");

    git(worktree, "switch", "-c", "ai/workflow-test");
    mkdirSync(path.join(worktree, "scripts"));
    copyFileSync(path.resolve("scripts/finish-and-push.ps1"), path.join(worktree, "scripts/finish-and-push.ps1"));
    mkdirSync(path.join(worktree, "docs", "ai", "deliveries"), { recursive: true });
    writeFileSync(path.join(worktree, "docs", "ai", "deliveries", "2026-08-16-workflow-test.md"), [
      "# Workflow test delivery",
      "## Context",
      "Verify the delivery script in an isolated repository without using project credentials or media.",
      "## Changes",
      "Adds a harmless feature file and this test delivery record.",
      "## Verification",
      "The integration test verifies feature push, main fast-forward, backup tag, and upstream preservation.",
      "## Risks and follow-up",
      "Temporary repositories are removed after the test; no production remote is contacted."
    ].join("\n\n"));
    writeFileSync(path.join(worktree, "feature.txt"), "delivered\n");

    const output = execFileSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/finish-and-push.ps1",
      "-Message", "chore: verify archived main delivery", "-SkipChecks"
    ], { cwd: worktree, encoding: "utf8", timeout: 30_000 });

    const newHead = git(worktree, "rev-parse", "HEAD");
    expect(git(root, "--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(newHead);
    expect(git(root, "--git-dir", remote, "rev-parse", "refs/heads/ai/workflow-test")).toBe(newHead);
    expect(git(worktree, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")).toBe("origin/ai/workflow-test");
    const tags = git(root, "--git-dir", remote, "tag", "--list", "backup-main-*").split(/\r?\n/).filter(Boolean);
    expect(tags).toHaveLength(1);
    expect(git(root, "--git-dir", remote, "rev-parse", `${tags[0]}^{}`)).toBe(oldMain);
    expect(output).toContain(`Main=origin/main Backup=${tags[0]}`);
    expect(git(worktree, "status", "--porcelain")).toBe("");
  }, 40_000);

  it("contains no force-push command", () => {
    const script = readFileSync(path.resolve("scripts/finish-and-push.ps1"), "utf8");
    expect(script).not.toMatch(/git\s+push\s+(?:-f|--force)/i);
    expect(script).not.toContain('"push", "--force"');
    expect(script).not.toContain('"push", "-f"');
  });

  it("blocks a delivery that has changes but no delivery record", () => {
    const root = mkdtempSync(path.join(tmpdir(), "finish-push-record-"));
    tempRoots.push(root);
    const remote = path.join(root, "origin.git");
    const worktree = path.join(root, "worktree");
    mkdirSync(worktree);
    git(root, "init", "--bare", remote);
    git(worktree, "init", "-b", "main");
    git(worktree, "config", "user.name", "Workflow Test");
    git(worktree, "config", "user.email", "workflow@example.invalid");
    writeFileSync(path.join(worktree, "README.md"), "initial\n");
    git(worktree, "add", "README.md");
    git(worktree, "commit", "-m", "chore: initial state");
    git(worktree, "remote", "add", "origin", remote);
    git(worktree, "push", "-u", "origin", "main");
    git(worktree, "switch", "-c", "ai/missing-delivery-record");
    mkdirSync(path.join(worktree, "scripts"));
    copyFileSync(path.resolve("scripts/finish-and-push.ps1"), path.join(worktree, "scripts/finish-and-push.ps1"));
    writeFileSync(path.join(worktree, "feature.txt"), "not deliverable yet\n");

    expect(() => execFileSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/finish-and-push.ps1",
      "-Message", "chore: reject missing delivery record", "-ValidateOnly"
    ], { cwd: worktree, encoding: "utf8", timeout: 30_000, stdio: "pipe" })).toThrow(/Every delivery must a\s*dd or update/);

    expect(git(worktree, "status", "--porcelain")).toContain("feature.txt");
    expect(git(worktree, "rev-list", "--count", "HEAD")).toBe("1");
  }, 40_000);
});
