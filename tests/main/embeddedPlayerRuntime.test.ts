import { describe, expect, it } from "vitest";
import path from "node:path";
import { embeddedPlayerRuntime } from "../../src/main/embeddedPlayer/runtime.js";

describe("embedded playback on first unpack/install", () => {
  it("uses the bundled runtime without any per-user DLL or PATH configuration", () => {
    const resources = path.resolve("isolated extracted 包/resources");
    const runtime = embeddedPlayerRuntime(true, resources, path.resolve("unused checkout"));
    expect(runtime).toEqual({ host: path.join(resources,"native-player","NativeHost.exe"), directory: path.join(resources,"native-player") });
  });
  it("development uses the same pinned staging input", () => {
    const root = path.resolve("isolated checkout");
    expect(embeddedPlayerRuntime(false, "unused", root).directory).toBe(path.join(root,"native-bin","player-runtime"));
  });
});
