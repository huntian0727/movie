import { describe, expect, it, vi } from "vitest";
import { resolvePackagedExecutablePath } from "../../src/main/media/packagedExecutable";

describe("resolvePackagedExecutablePath", () => {
  it("maps an asar virtual executable to its unpacked physical path", () => {
    const pathExists = vi.fn(() => true);

    const result = resolvePackagedExecutablePath(
      "C:\\Program Files\\Video Manager\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe",
      pathExists
    );

    expect(result).toBe(
      "C:\\Program Files\\Video Manager\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe"
    );
    expect(pathExists).toHaveBeenCalledWith(result);
  });

  it("supports slash-separated packaged paths", () => {
    expect(resolvePackagedExecutablePath(
      "C:/Video/resources/app.asar/node_modules/ffprobe-static/ffprobe.exe",
      () => true
    )).toBe("C:/Video/resources/app.asar.unpacked/node_modules/ffprobe-static/ffprobe.exe");
  });

  it("keeps development and PATH executables unchanged", () => {
    const pathExists = vi.fn(() => true);

    expect(resolvePackagedExecutablePath("C:\\repo\\node_modules\\ffmpeg-static\\ffmpeg.exe", pathExists))
      .toBe("C:\\repo\\node_modules\\ffmpeg-static\\ffmpeg.exe");
    expect(resolvePackagedExecutablePath("ffmpeg", pathExists)).toBe("ffmpeg");
    expect(pathExists).not.toHaveBeenCalled();
  });

  it("keeps the original path when the unpacked executable is absent", () => {
    const original = "C:\\Video\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe";
    expect(resolvePackagedExecutablePath(original, () => false)).toBe(original);
  });
});
