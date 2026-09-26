// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "movie-project-backup-"));
  roots.push(root);
  const userDataPath = path.join(root, "user-data");
  const backupRoot = path.join(root, "backups");
  const databasePath = path.join(userDataPath, "library.sqlite");
  mkdirSync(userDataPath, { recursive: true });
  executeSql(databasePath, "PRAGMA user_version = 12; CREATE TABLE source_folders (id TEXT); CREATE TABLE videos (id TEXT); CREATE TABLE scan_failures (id TEXT, status TEXT); INSERT INTO source_folders VALUES ('s1'); INSERT INTO videos VALUES ('v1');");
  writeFileSync(path.join(userDataPath, "settings.json"), JSON.stringify({ cloudDrive: { apiToken: "secret" } }));
  return { userDataPath, backupRoot, databasePath };
}

function runBackup(...arguments_) {
  const result = invokeBackup(arguments_);
  if (result.status !== 0) throw new Error(result.stderr || `backup command exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function invokeBackup(arguments_) {
  return spawnSync(process.execPath, [
    "--no-warnings=ExperimentalWarning",
    path.resolve("scripts/project-backup.mjs"),
    ...arguments_
  ], { encoding: "utf8", timeout: 30_000 });
}

function executeSql(databasePath, sql) {
  execFileSync(process.execPath, [
    "--no-warnings=ExperimentalWarning", "-e",
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec(process.argv[2]);db.close();",
    databasePath, sql
  ], { encoding: "utf8", timeout: 30_000 });
}

function queryScalar(databasePath, sql) {
  return JSON.parse(execFileSync(process.execPath, [
    "--no-warnings=ExperimentalWarning", "-e",
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});const row=db.prepare(process.argv[2]).get();db.close();process.stdout.write(JSON.stringify(Object.values(row)[0]));",
    databasePath, sql
  ], { encoding: "utf8", timeout: 30_000 }));
}

function git(cwd, ...arguments_) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

describe("project backup and rollback", () => {
  it("creates an integrity-checked snapshot without copying cache or media", () => {
    const { userDataPath, backupRoot } = fixture();
    const sourceBundlePath = path.join(userDataPath, "source.bundle");
    writeFileSync(sourceBundlePath, "bundle");

    const result = runBackup(
      "--action=create", `--backup-root=${backupRoot}`, `--user-data=${userDataPath}`,
      "--label=before-test", "--kind=development", "--git-branch=main", "--git-commit=abc123",
      "--git-tag=checkpoint-test", `--source-bundle=${sourceBundlePath}`
    );

    expect(result.manifest).toMatchObject({
      database: { schemaVersion: 12, videoCount: 1, sourceCount: 1, quickCheck: "ok" },
      git: { branch: "main", commit: "abc123", tag: "checkpoint-test" }
    });
    expect(result.manifest.files.settings.sha256).toHaveLength(64);
    expect(result.manifest.files.sourceBundle.sha256).toHaveLength(64);
    expect(result.manifest.excluded).toContain("media-cache");
    expect(runBackup("--action=list", `--backup-root=${backupRoot}`)).toHaveLength(1);
    expect(runBackup("--action=verify", `--backup-root=${backupRoot}`, `--snapshot=${result.manifest.id}`)).toMatchObject({ databaseInfo: { quickCheck: "ok" } });
  });

  it("restores data and settings only after creating a pre-restore snapshot", () => {
    const { userDataPath, backupRoot, databasePath } = fixture();
    const original = runBackup("--action=create", `--backup-root=${backupRoot}`, `--user-data=${userDataPath}`, "--label=known-good");
    executeSql(databasePath, "INSERT INTO videos VALUES ('v2')");
    writeFileSync(path.join(userDataPath, "settings.json"), JSON.stringify({ changed: true }));

    const restored = runBackup(
      "--action=restore", `--backup-root=${backupRoot}`, `--user-data=${userDataPath}`,
      `--snapshot=${original.manifest.id}`, "--confirm-application-closed"
    );

    expect(queryScalar(databasePath, "SELECT COUNT(*) AS count FROM videos")).toBe(1);
    expect(JSON.parse(readFileSync(path.join(userDataPath, "settings.json"), "utf8"))).toEqual({ cloudDrive: { apiToken: "secret" } });
    expect(restored.preRestoreSnapshotId).toContain("before-restore");
    expect(runBackup("--action=list", `--backup-root=${backupRoot}`)).toHaveLength(2);
  });

  it("refuses restore without explicit confirmation that the application is closed", () => {
    const { userDataPath, backupRoot } = fixture();
    const snapshot = runBackup("--action=create", `--backup-root=${backupRoot}`, `--user-data=${userDataPath}`, "--label=safe");
    const result = invokeBackup([
      "--action=restore", `--backup-root=${backupRoot}`, `--user-data=${userDataPath}`, `--snapshot=${snapshot.manifest.id}`
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Restore refused:.*closing every video manager/is);
  });

  it("detects a changed backup file before restore", () => {
    const { userDataPath, backupRoot } = fixture();
    const snapshot = runBackup("--action=create", `--backup-root=${backupRoot}`, `--user-data=${userDataPath}`, "--label=safe");
    writeFileSync(path.join(snapshot.snapshotDirectory, "settings.json"), "tampered");
    const result = invokeBackup(["--action=verify", `--backup-root=${backupRoot}`, `--snapshot=${snapshot.manifest.id}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/size mismatch|checksum mismatch/i);
  });

  it("creates a Git checkpoint and data snapshot through the PowerShell workflow", () => {
    const { userDataPath, backupRoot } = fixture();
    const repository = mkdtempSync(path.join(os.tmpdir(), "movie-project-backup-repo-"));
    roots.push(repository);
    mkdirSync(path.join(repository, "scripts"), { recursive: true });
    copyFileSync(path.resolve("scripts/project-backup.mjs"), path.join(repository, "scripts", "project-backup.mjs"));
    copyFileSync(path.resolve("scripts/project-backup.ps1"), path.join(repository, "scripts", "project-backup.ps1"));
    writeFileSync(path.join(repository, "package.json"), JSON.stringify({ version: "0.1.15" }));
    git(repository, "init", "-b", "main");
    git(repository, "config", "user.name", "Backup Test");
    git(repository, "config", "user.email", "backup@example.invalid");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "initial");

    const output = execFileSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/project-backup.ps1",
      "-Action", "Create", "-Label", "wrapper-test", "-BackupRoot", backupRoot,
      "-UserDataPath", userDataPath, "-LocalOnly"
    ], { cwd: repository, encoding: "utf8", timeout: 30_000 });

    expect(output).toContain("Development checkpoint created");
    expect(git(repository, "tag", "--list", "checkpoint-*")).toMatch(/wrapper-test/);
    expect(runBackup("--action=list", `--backup-root=${backupRoot}`)).toHaveLength(1);
  });
});
