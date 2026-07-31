import { describe, expect, it } from "vitest";
import { getDefaultSettings, normalizeSettings } from "../../src/main/settings/settingsStore";
import { DEFAULT_SHORTCUTS } from "../../src/shared/shortcuts";

describe("settingsStore", () => {
  it("returns conservative first-version defaults", () => {
    expect(getDefaultSettings()).toEqual({
      defaultRecursiveScan: true,
      startupSync: true,
      autoPlayOnOpen: true,
      seekStepSeconds: 10,
      coverFrameTimeSeconds: 5,
      playbackPreference: "auto",
      shortcuts: DEFAULT_SHORTCUTS
    });
  });

  it("normalizes invalid values back to defaults", () => {
    expect(normalizeSettings({ seekStepSeconds: 0 }).seekStepSeconds).toBe(10);
    expect(normalizeSettings({ seekStepSeconds: 9.5 }).seekStepSeconds).toBe(10);
    expect(normalizeSettings({ coverFrameTimeSeconds: 15 }).coverFrameTimeSeconds).toBe(15);
    expect(normalizeSettings({ coverFrameTimeSeconds: 7 as 5 }).coverFrameTimeSeconds).toBe(5);
    expect(normalizeSettings({ playbackPreference: "invalid" as "auto" }).playbackPreference).toBe("auto");
    expect(normalizeSettings({ autoPlayOnOpen: "invalid" as unknown as boolean }).autoPlayOnOpen).toBe(true);
    expect(normalizeSettings({ shortcuts: { playerDelete: "Ctrl+KeyX" } as typeof DEFAULT_SHORTCUTS }).shortcuts.playerDelete).toBe("Ctrl+KeyX");
    expect(normalizeSettings({ shortcuts: { playerDelete: "Escape" } as typeof DEFAULT_SHORTCUTS }).shortcuts.playerDelete).toBe(DEFAULT_SHORTCUTS.playerDelete);
  });

  it("falls back to defaults when persisted shortcuts conflict within one window", () => {
    const shortcuts = {
      ...DEFAULT_SHORTCUTS,
      playerSeekForward: DEFAULT_SHORTCUTS.playerSeekBackward
    };
    expect(normalizeSettings({ shortcuts }).shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });
});
