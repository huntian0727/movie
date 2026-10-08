// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudDriveCredentialStore } from "../../src/main/clouddrive/credentialStore";
import { createSettingsStoreWithPersistence, getDefaultSettings, type PersistedSettings } from "../../src/main/settings/settingsStore";
import { sanitizeForLog } from "../../src/main/logging/redaction";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "movie-cd-storage-")); roots.push(root);
  // Exercise actual ciphertext files with a test key; real DPAPI is verified by Electron smoke.
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret" as const,
    encryptString(value: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString(bytes: Buffer) {
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    }
  };
  return { root, encryption, credentials: createCloudDriveCredentialStore(root, encryption) };
}

describe("CloudDrive secure persistence and migration", () => {
  it("persists only ciphertext, survives reopening, and preserves a blank replacement", () => {
    const { root, encryption, credentials } = setup();
    const persistence = { store: getDefaultSettings() as PersistedSettings };
    const settings = createSettingsStoreWithPersistence(persistence, credentials, {});
    const result = settings.set({ cloudDrive: { ...settings.get().cloudDrive, apiToken: "storage-test-value" } });
    expect(result.cloudDrive.configured).toBe(true);
    expect(JSON.stringify([result, settings.get(), persistence.store])).not.toContain("storage-test-value");
    expect(JSON.stringify(persistence.store)).not.toContain("apiToken");
    const bytes = readFileSync(path.join(root, "clouddrive-credentials.bin"));
    expect(bytes.includes(Buffer.from("storage-test-value"))).toBe(false);
    const reopened = createSettingsStoreWithPersistence(persistence, createCloudDriveCredentialStore(root, encryption), {});
    expect(reopened.getCloudDriveToken()).toBe("storage-test-value");
    reopened.set({ cloudDrive: { ...reopened.get().cloudDrive, apiToken: "  " } });
    reopened.set({ seekStepSeconds: 25 });
    expect(reopened.getCloudDriveToken()).toBe("storage-test-value");
    expect(readdirSync(root)).toEqual(["clouddrive-credentials.bin"]);
  });

  it("migrates minimal legacy settings and preserves normal user configuration", () => {
    const { credentials } = setup();
    const persistence = { store: { seekStepSeconds: 25, startupSync: false, cloudDrive: {
      apiToken: "legacy-secret", endpoint: "http://127.0.0.2:19798", timeoutMs: 40000,
      mountMapJson: '[{"mountPoint":"Z:","sourceDir":"/115"}]'
    } } as PersistedSettings };
    const settings = createSettingsStoreWithPersistence(persistence, credentials, {});
    expect(settings.getCloudDriveToken()).toBe("legacy-secret");
    expect(persistence.store.cloudDrive).not.toHaveProperty("apiToken");
    expect(settings.get()).toMatchObject({ seekStepSeconds: 25, startupSync: false, cloudDrive: {
      configured: true, endpoint: "http://127.0.0.2:19798", timeoutMs: 40000, mountMapJson: persistence.store.cloudDrive!.mountMapJson
    } });
    expect(JSON.stringify(settings.get())).not.toContain("legacy-secret");
    expect(createSettingsStoreWithPersistence(persistence, credentials, {}).getCloudDriveToken()).toBe("legacy-secret");
  });

  it("preserves plaintext and all settings if encryption is unavailable, then retries", () => {
    const { root, encryption } = setup();
    const persistence = { store: { cloudDrive: { apiToken: "migration-failure-value" }, startupSync: false } };
    const original = structuredClone(persistence.store);
    const unavailable = createCloudDriveCredentialStore(root, { ...encryption, isEncryptionAvailable: () => false });
    const failed = createSettingsStoreWithPersistence(persistence, unavailable, {});
    expect(failed.get().cloudDrive).toMatchObject({ configured: false, credentialError: expect.stringContaining("连接已停用") });
    expect(failed.getCloudDriveToken()).toBe("");
    expect(persistence.store).toEqual(original);
    expect(readdirSync(root)).toEqual([]);
    const settings = createSettingsStoreWithPersistence(persistence, createCloudDriveCredentialStore(root, encryption), {});
    expect(settings.getCloudDriveToken()).toBe("migration-failure-value");
    expect(persistence.store.cloudDrive).not.toHaveProperty("apiToken");
  });

  it("does not downgrade Linux basic_text into supposedly secure storage", () => {
    const { root, encryption } = setup();
    const weak = createCloudDriveCredentialStore(root, { ...encryption, getSelectedStorageBackend: () => "basic_text" }, "linux");
    expect(() => weak.writeToken("basic-backend-test-value")).toThrow("系统安全存储不可用");
    expect(readdirSync(root)).toEqual([]);
  });

  it("allows local settings and verified replacement after corrupt ciphertext, without erasing a blank save", () => {
    const { root, credentials } = setup();
    const file = path.join(root, "clouddrive-credentials.bin");
    writeFileSync(file, "synthetic-corrupted-ciphertext");
    const persistence = { store: getDefaultSettings() as PersistedSettings };
    const settings = createSettingsStoreWithPersistence(persistence, credentials, { LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN: "fallback-value" });
    expect(settings.getCloudDriveToken()).toBe("");
    expect(settings.get().cloudDrive).toMatchObject({ configured: false, credentialError: expect.stringContaining("连接已停用") });
    settings.set({ seekStepSeconds: 25, cloudDrive: { ...settings.get().cloudDrive, apiToken: " " } });
    expect(settings.get().seekStepSeconds).toBe(25);
    expect(readFileSync(file, "utf8")).toBe("synthetic-corrupted-ciphertext");
    expect(JSON.stringify(settings.get())).not.toMatch(/fallback-value|synthetic-corrupted/);
    const result = settings.set({ cloudDrive: { ...settings.get().cloudDrive, apiToken: "recovery-value" } });
    expect(result.cloudDrive).toMatchObject({ configured: true }); expect(result.cloudDrive.credentialError).toBeUndefined();
    expect(settings.getCloudDriveToken()).toBe("recovery-value");
    expect(readFileSync(file).includes(Buffer.from("recovery-value"))).toBe(false);
  });

  it("preserves failed migration plaintext and previous ciphertext until successful replacement", () => {
    const { root, encryption, credentials } = setup();
    credentials.writeToken("previous-safe-value");
    const file = path.join(root, "clouddrive-credentials.bin"), originalCiphertext = readFileSync(file);
    let broken = true;
    const unstable = createCloudDriveCredentialStore(root, { ...encryption,
      encryptString: value => { if (broken) throw new Error("synthetic-sensitive-native-value"); return encryption.encryptString(value); }
    });
    const persistence = { store: { startupSync: false, cloudDrive: { apiToken: "retained-legacy-value" } } as PersistedSettings };
    const settings = createSettingsStoreWithPersistence(persistence, unstable, {});
    settings.set({ seekStepSeconds: 30 });
    expect(persistence.store.cloudDrive!.apiToken).toBe("retained-legacy-value");
    expect(readFileSync(file)).toEqual(originalCiphertext);
    expect(settings.getCloudDriveToken()).toBe("");
    expect(() => settings.set({ cloudDrive: { ...settings.get().cloudDrive, apiToken: "new-recovery-value" } })).toThrow("无法安全保存");
    expect(readFileSync(file)).toEqual(originalCiphertext);
    expect(persistence.store.cloudDrive!.apiToken).toBe("retained-legacy-value");
    broken = false;
    const result = settings.set({ cloudDrive: { ...settings.get().cloudDrive, apiToken: "new-recovery-value" } });
    expect(result.cloudDrive.credentialError).toBeUndefined();
    expect(settings.getCloudDriveToken()).toBe("new-recovery-value");
    expect(persistence.store.cloudDrive).not.toHaveProperty("apiToken");
    expect(JSON.stringify([result, settings.get(), persistence.store])).not.toMatch(/retained-legacy|new-recovery|synthetic-sensitive/);
  });

  it("leaves legacy config recoverable when clearing plaintext fails, including an old backup restore", () => {
    const { credentials } = setup();
    credentials.writeToken("newer-value");
    const old: PersistedSettings = { cloudDrive: { apiToken: "older-value" } };
    const persistence = { get store() { return old; }, set store(_value: PersistedSettings) { throw new Error("older-value"); } };
    const failed = createSettingsStoreWithPersistence(persistence, credentials, {});
    expect(failed.get().cloudDrive).toMatchObject({ configured: false, credentialError: expect.stringContaining("原凭据已保留") });
    expect(failed.getCloudDriveToken()).toBe("");
    expect(old.cloudDrive!.apiToken).toBe("older-value");
    expect(credentials.readToken()).toBe("older-value");
  });

  it("does not overwrite ciphertext on encryption/write failure and sanitizes native errors", () => {
    const { root, encryption, credentials } = setup();
    credentials.writeToken("previous-value");
    const broken = createCloudDriveCredentialStore(root, { ...encryption, encryptString: () => { throw new Error("replacement-value"); } });
    expect(() => broken.writeToken("replacement-value")).toThrow("无法安全保存");
    expect(credentials.readToken()).toBe("previous-value");
    expect(readdirSync(root)).toEqual(["clouddrive-credentials.bin"]);
    writeFileSync(path.join(root, "clouddrive-credentials.bin"), "corrupt-value");
    expect(() => credentials.readToken()).toThrow("无法解密");
  });

  it("rejects insecure transport before updating credentials or public settings", () => {
    const { credentials } = setup();
    const write = vi.spyOn(credentials, "writeToken");
    const persistence = { store: getDefaultSettings() as PersistedSettings };
    const settings = createSettingsStoreWithPersistence(persistence, credentials, {});
    expect(() => settings.set({ cloudDrive: { ...settings.get().cloudDrive, endpoint: "http://10.0.0.2", apiToken: "unsent-value" } })).toThrow("HTTPS");
    expect(write).not.toHaveBeenCalled();
    expect(settings.get().cloudDrive.configured).toBe(false);
  });

  it("redacts raw, URL-encoded and retired credentials in errors, logs and diagnostics", () => {
    const { credentials } = setup();
    credentials.writeToken("logging-value+/=");
    credentials.writeToken("replacement-logging-value");
    const output = JSON.stringify(sanitizeForLog({ message: "logging-value+/= logging-value%2B%2F%3D replacement-logging-value",
      failure: new Error("logging-value+/="), nested: { diagnostic: "replacement-logging-value" } }));
    expect(output).not.toContain("logging-value");
    expect(output).toContain("<redacted>");
  });
});
