// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolvePinnedMediaTool } from "../../src/main/media/mediaBinaries";

describe("pinned media-tool resolver", () => {
  const resources = path.join("C:", "installed", "resources");
  const workspace = path.join("C:", "source");
  const devTool = path.resolve(workspace, "native-bin", "media-tools", "ffmpeg.exe");
  const packTool = path.join(resources, "media-tools", "ffmpeg.exe");
  const asar = path.join(resources, "app.asar");
  it("uses the bundled pinned executable in packaged runtime", () => {
    expect(resolvePinnedMediaTool("ffmpeg.exe", {
      resourcesPath: resources, workspace, pathExists: (name) => name === packTool || name === asar
    })).toBe(packTool);
  });
  it("rejects missing packaged media tools without falling back to PATH or dev source", () => {
    expect(() => resolvePinnedMediaTool("ffmpeg.exe", {
      resourcesPath: resources, workspace, pathExists: (name) => name === asar || name === devTool
    })).toThrow(/missing from installed app/);
  });
  it("uses the pinned workspace candidate only for development", () => {
    expect(resolvePinnedMediaTool("ffmpeg.exe", {
      workspace, pathExists: (name) => name === devTool
    })).toBe(devTool);
  });
  it("fails closed if no pinned executable is present", () => {
    expect(() => resolvePinnedMediaTool("ffmpeg.exe", {
      workspace, pathExists: () => false
    })).toThrow(/not staged/);
  });
  it("rejects unknown media executable names", () => {
    expect(() => resolvePinnedMediaTool("unexpected.exe" as "ffmpeg.exe", {
      pathExists: () => true
    })).toThrow(/Unsupported/);
  });
});
