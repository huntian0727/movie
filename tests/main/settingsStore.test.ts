import { describe, expect, it } from "vitest";
import { getDefaultSettings, normalizeSettings } from "../../src/main/settings/settingsStore";

describe("settingsStore", () => {
  it("returns conservative first-version defaults", () => {
    expect(getDefaultSettings()).toEqual({
      defaultRecursiveScan: true,
      startupSync: true,
      autoPlayOnOpen: true,
      seekStepSeconds: 10,
      coverFrameTimeSeconds: 5,
      playbackPreference: "auto"
    });
  });

  it("normalizes invalid values back to defaults", () => {
    expect(normalizeSettings({ seekStepSeconds: 0 }).seekStepSeconds).toBe(10);
    expect(normalizeSettings({ seekStepSeconds: 9.5 }).seekStepSeconds).toBe(10);
    expect(normalizeSettings({ coverFrameTimeSeconds: 15 }).coverFrameTimeSeconds).toBe(15);
    expect(normalizeSettings({ coverFrameTimeSeconds: 7 as 5 }).coverFrameTimeSeconds).toBe(5);
    expect(normalizeSettings({ playbackPreference: "invalid" as "auto" }).playbackPreference).toBe("auto");
    expect(normalizeSettings({ autoPlayOnOpen: "invalid" as unknown as boolean }).autoPlayOnOpen).toBe(true);
  });
});
