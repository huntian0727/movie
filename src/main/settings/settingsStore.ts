import type { AppSettings } from "../../shared/videoTypes.js";
import { DEFAULT_SHORTCUTS, normalizeShortcutSettings } from "../../shared/shortcuts.js";

export interface SettingsStore {
  get(): AppSettings;
  set(input: Partial<AppSettings>): AppSettings;
}

export function getDefaultSettings(): AppSettings {
  return {
    defaultRecursiveScan: true,
    startupSync: true,
    autoPlayOnOpen: true,
    seekStepSeconds: 10,
    coverFrameTimeSeconds: 5,
    playbackPreference: "auto",
    shortcuts: { ...DEFAULT_SHORTCUTS }
  };
}

export function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const defaults = getDefaultSettings();
  return {
    defaultRecursiveScan: typeof input.defaultRecursiveScan === "boolean" ? input.defaultRecursiveScan : defaults.defaultRecursiveScan,
    startupSync: typeof input.startupSync === "boolean" ? input.startupSync : defaults.startupSync,
    autoPlayOnOpen: typeof input.autoPlayOnOpen === "boolean" ? input.autoPlayOnOpen : defaults.autoPlayOnOpen,
    seekStepSeconds: Number.isInteger(input.seekStepSeconds) && (input.seekStepSeconds ?? 0) >= 1 && (input.seekStepSeconds ?? 0) <= 120 ? input.seekStepSeconds! : defaults.seekStepSeconds,
    coverFrameTimeSeconds: input.coverFrameTimeSeconds === 0 || input.coverFrameTimeSeconds === 3 || input.coverFrameTimeSeconds === 5 || input.coverFrameTimeSeconds === 10 || input.coverFrameTimeSeconds === 15 ? input.coverFrameTimeSeconds : defaults.coverFrameTimeSeconds,
    playbackPreference: input.playbackPreference === "native-first" || input.playbackPreference === "mpv-first" || input.playbackPreference === "auto" ? input.playbackPreference : defaults.playbackPreference,
    shortcuts: normalizeShortcutSettings(input.shortcuts)
  };
}

export async function createSettingsStore(): Promise<SettingsStore> {
  const { default: ElectronStore } = await import("electron-store");
  const store = new ElectronStore<Partial<AppSettings>>({ name: "settings", defaults: getDefaultSettings() });
  return {
    get: () => normalizeSettings(store.store),
    set: (input) => {
      const normalized = normalizeSettings(input);
      store.store = normalized;
      return normalized;
    }
  };
}
