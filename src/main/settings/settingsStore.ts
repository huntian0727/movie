import type { AppSettings, AppSettingsUpdate, CloudDrivePublicSettings } from "../../shared/videoTypes.js";
import { DEFAULT_SHORTCUTS, normalizeShortcutSettings } from "../../shared/shortcuts.js";
import { parseCloudDriveEndpoint } from "../../shared/cloudDriveEndpoint.js";
import { createCloudDriveCredentialStore, type CloudDriveCredentialStore } from "../clouddrive/credentialStore.js";
import { registerSensitiveValue } from "../logging/redaction.js";

export interface SettingsStore {
  get(): AppSettings;
  set(input: Partial<AppSettingsUpdate>): AppSettings;
  /** Main-process runtime only; never exposed by IPC/preload. */
  getCloudDriveToken(): string;
}

export function getDefaultSettings(): AppSettings {
  return {
    defaultRecursiveScan: true,
    startupSync: true,
    autoPlayOnOpen: true,
    seekStepSeconds: 10,
    coverFrameTimeSeconds: 5,
    playbackPreference: "auto",
    cloudDrive: {
      endpoint: "http://127.0.0.1:19798",
      configured: false,
      timeoutMs: 20_000,
      mountMapJson: ""
    },
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
    playbackPreference: input.playbackPreference === "embedded-first" || input.playbackPreference === "native-first" || input.playbackPreference === "mpv-first" || input.playbackPreference === "auto" ? input.playbackPreference : defaults.playbackPreference,
    cloudDrive: {
      endpoint: typeof input.cloudDrive?.endpoint === "string" && input.cloudDrive.endpoint.trim() ? input.cloudDrive.endpoint.trim() : defaults.cloudDrive.endpoint,
      configured: false,
      timeoutMs: Number.isInteger(input.cloudDrive?.timeoutMs) && (input.cloudDrive?.timeoutMs ?? 0) >= 1_000 && (input.cloudDrive?.timeoutMs ?? 0) <= 120_000
        ? input.cloudDrive!.timeoutMs
        : defaults.cloudDrive.timeoutMs,
      mountMapJson: typeof input.cloudDrive?.mountMapJson === "string" ? input.cloudDrive.mountMapJson.trim() : defaults.cloudDrive.mountMapJson
    },
    shortcuts: normalizeShortcutSettings(input.shortcuts)
  };
}

/** Explicit allowlist, also guarding future internal store changes at the IPC boundary. */
export function toPublicSettings(input: AppSettings): AppSettings {
  const settings = normalizeSettings(input);
  settings.cloudDrive.configured = Boolean(input.cloudDrive?.configured);
  return settings;
}

export type PersistedSettings = Omit<Partial<AppSettings>, "cloudDrive"> & {
  cloudDrive?: Partial<CloudDrivePublicSettings> & { apiToken?: unknown };
};

/** The same migration/read/write boundary is used by Electron and persistence tests. */
export function createSettingsStoreWithPersistence(
  store: { store: PersistedSettings },
  credentials: CloudDriveCredentialStore,
  fallbackEnvironment: NodeJS.ProcessEnv = process.env
): SettingsStore {
  const legacyToken = typeof store.store.cloudDrive?.apiToken === "string" ? store.store.cloudDrive.apiToken.trim() : "";
  if (legacyToken) {
    registerSensitiveValue(legacyToken);
    // Legacy settings remain authoritative until migration commits (also for old backups).
    credentials.writeToken(legacyToken);
    if (credentials.readToken() !== legacyToken) throw new Error("CloudDrive Token 安全迁移失败，原配置已保留");
  }
  if (store.store.cloudDrive && "apiToken" in store.store.cloudDrive) {
    const { apiToken: _legacy, ...cloudDrive } = store.store.cloudDrive;
    // Never clear the old file before ciphertext has been durably saved and verified.
    try { store.store = { ...store.store, cloudDrive }; }
    catch { throw new Error("CloudDrive Token 安全迁移失败，原配置已保留"); }
  }
  const get = (): AppSettings => {
    const settings = normalizeSettings(store.store as Partial<AppSettings>);
    settings.cloudDrive.configured = Boolean(credentials.readToken() || fallbackEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN?.trim());
    return settings;
  };
  return {
    get,
    getCloudDriveToken: () => credentials.readToken(),
    set(input) {
      const normalized = normalizeSettings({ ...get(), ...input });
      parseCloudDriveEndpoint(normalized.cloudDrive.endpoint);
      if (input.cloudDrive?.apiToken?.trim()) credentials.writeToken(input.cloudDrive.apiToken);
      const { configured: _configured, ...cloudDrive } = normalized.cloudDrive;
      try { store.store = { ...normalized, cloudDrive }; }
      catch { throw new Error("设置无法保存，请检查数据目录权限"); }
      return get();
    }
  };
}

export async function createSettingsStore(): Promise<SettingsStore> {
  const { default: ElectronStore } = await import("electron-store");
  const { app, safeStorage } = await import("electron");
  const store = new ElectronStore<PersistedSettings>({ name: "settings", defaults: getDefaultSettings() });
  return createSettingsStoreWithPersistence(store, createCloudDriveCredentialStore(app.getPath("userData"), safeStorage));
}
