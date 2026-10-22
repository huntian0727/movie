// @vitest-environment node
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSmokeRoot } from "../../scripts/run-packaged-smoke.mjs";

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
