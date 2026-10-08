// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { configureCloudDriveRuntime, getCloudDriveConnectionBinding, testConfiguredCloudDriveConnection } from "../../src/main/clouddrive/mountedScanner";
import { getDefaultSettings } from "../../src/main/settings/settingsStore";

afterEach(() => configureCloudDriveRuntime(getDefaultSettings().cloudDrive, "", {}));
describe("CloudDrive recovery runtime and private account binding", () => {
  it("disables env fallback and all configured RPCs when the credential status is unavailable", async () => {
    const settings = { ...getDefaultSettings().cloudDrive, credentialError: "fixed-recovery-status" };
    configureCloudDriveRuntime(settings, "", { LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN: "unwanted-fallback" });
    expect(getCloudDriveConnectionBinding()).toBeNull();
    await expect(testConfiguredCloudDriveConnection()).rejects.toThrow("尚未配置");
  });
  it("uses canonical endpoint and credentials for a main-only account digest", () => {
    const settings = getDefaultSettings().cloudDrive;
    configureCloudDriveRuntime({ ...settings, endpoint: "https://example.com:443" }, "first-value", {});
    const initial = getCloudDriveConnectionBinding(); expect(initial).toMatch(/^[a-f0-9]{64}$/);
    expect(initial).not.toContain("first-value");
    configureCloudDriveRuntime({ ...settings, endpoint: "https://example.com/" }, "first-value", {});
    expect(getCloudDriveConnectionBinding()).toBe(initial);
    configureCloudDriveRuntime({ ...settings, endpoint: "https://example.com/" }, "second-value", {});
    expect(getCloudDriveConnectionBinding()).not.toBe(initial);
    configureCloudDriveRuntime({ ...settings, endpoint: "https://other.example/" }, "first-value", {});
    expect(getCloudDriveConnectionBinding()).not.toBe(initial);
  });
});
