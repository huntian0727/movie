// @vitest-environment node
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSmokeRoot, formatSmokeOutputLine } from "../../scripts/run-packaged-smoke.mjs";

describe("packaged smoke diagnostic output", () => {
  it("labels known diagnostics with phase and output channel", () => {
    expect(formatSmokeOutputLine("verify", "stderr", "Can't find filter element"))
      .toBe("[packaged-smoke:verify:stderr] Can't find filter element");
    expect(formatSmokeOutputLine("create", "stderr", "ERR_UNTRUSTED_IPC_SENDER"))
      .toBe("[packaged-smoke:create:stderr] ERR_UNTRUSTED_IPC_SENDER");
    expect(formatSmokeOutputLine("create", "stdout", "normal progress message"))
      .toBe("normal progress message");
  });
});

describe("packaged smoke temporary directory", () => {
  it("canonicalizes a directory created through an aliased temp parent", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "movie-packaged-smoke-target-"));
    const alias = path.join(os.tmpdir(), `movie-packaged-smoke-alias-${randomUUID()}`);
    let smokeRoot;
    try {
      await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
      smokeRoot = await createSmokeRoot(alias);
      expect(smokeRoot).toBe(await realpath(smokeRoot));
      expect(path.dirname(smokeRoot)).toBe(await realpath(target));
      expect(smokeRoot.toLowerCase()).not.toContain(alias.toLowerCase());
    } finally {
      if (smokeRoot) await rm(smokeRoot, { recursive: true, force: true });
      await rm(alias, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });
});
