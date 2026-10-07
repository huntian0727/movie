// @vitest-environment node
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import { Script } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type AppSettings } from "../../src/shared/videoTypes";
import { createSettingsStoreWithPersistence, getDefaultSettings, type PersistedSettings } from "../../src/main/settings/settingsStore";
import { registerTrustedWebContents } from "../../src/main/security";
import { configureCloudDriveRuntime } from "../../src/main/clouddrive/mountedScanner";

const electronMock = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => electronMock.handlers.set(channel, handler) },
  dialog: {}, shell: {}, app: {}, BrowserWindow: class {} }));
import { registerIpcHandlers } from "../../src/main/ipc";

const unregister: Array<() => void> = [];
afterEach(() => {
  unregister.splice(0).forEach((remove) => remove());
  configureCloudDriveRuntime(getDefaultSettings().cloudDrive, "", {});
  electronMock.handlers.clear();
});
function event(role: "main" | "player") {
  const sender = { id: role === "main" ? 901 : 902, isDestroyed: () => false,
    mainFrame: { url: "file:///app/index.html" }, on: vi.fn() };
  unregister.push(registerTrustedWebContents(sender, role, "file:///app/index.html"));
  return { sender, senderFrame: sender.mainFrame };
}
function setup() {
  let token = "";
  const persistence = { store: getDefaultSettings() as PersistedSettings };
  const settings = createSettingsStoreWithPersistence(persistence, {
    readToken: () => token, writeToken: (value) => { token = value.trim(); }
  }, {});
  const logger = { createOperationId: () => "test-operation", info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const publish = vi.fn();
  registerIpcHandlers({} as never, {
    settings, logger, cacheRoot: "test-cache", cacheManager: { getStatus: () => ({ totalBytes: 0 }) },
    domainEvents: { publish }, metadataQueue: {}, duplicateCleanupJobs: {}, duplicateCleanup: {}, scanManager: {}
  } as never);
  const invoke = (channel: string, caller: unknown, payload?: unknown) => electronMock.handlers.get(channel)!(caller, payload);
  return { settings, persistence, logger, publish, invoke };
}

describe("CloudDrive IPC and preload security", () => {
  it("settings:get and settings:set never disclose a saved token to either trusted window role", async () => {
    const s = setup(); const main = event("main"); const player = event("player");
    const saved = await s.invoke(IPC_CHANNELS.settingsSet, main, {
      ...getDefaultSettings(), cloudDrive: { ...getDefaultSettings().cloudDrive, apiToken: "ipc-security-value" }
    });
    expect(saved.cloudDrive.configured).toBe(true);
    expect(s.settings.getCloudDriveToken()).toBe("ipc-security-value");
    for (const caller of [main, player]) {
      const result = await s.invoke(IPC_CHANNELS.settingsGet, caller);
      expect(result.settings.cloudDrive).toEqual({ endpoint: "http://127.0.0.1:19798", timeoutMs: 20000, mountMapJson: "", configured: true });
      expect(JSON.stringify(result)).not.toContain("ipc-security-value");
      expect(JSON.stringify(result)).not.toContain("apiToken");
    }
    expect(JSON.stringify(saved)).not.toContain("ipc-security-value");
    expect(s.publish).toHaveBeenCalledWith({ type: "settings:changed", videoIds: [] });
    expect(JSON.stringify([s.logger.info.mock.calls, s.logger.error.mock.calls, s.persistence.store])).not.toContain("ipc-security-value");
    await s.invoke(IPC_CHANNELS.settingsSet, main, { ...saved, cloudDrive: { ...saved.cloudDrive, apiToken: " " }, seekStepSeconds: 25 });
    expect(s.settings.getCloudDriveToken()).toBe("ipc-security-value");
    expect(s.settings.get().seekStepSeconds).toBe(25);
    expect(() => s.invoke(IPC_CHANNELS.settingsSet, player, saved)).toThrow("ERR_UNTRUSTED_IPC_SENDER");
  });

  it("rejects unsafe settings and native failures without forwarding credential-bearing diagnostics", async () => {
    const s = setup(); const main = event("main");
    await expect(s.invoke(IPC_CHANNELS.settingsSet, main, { ...getDefaultSettings(),
      cloudDrive: { ...getDefaultSettings().cloudDrive, endpoint: "http://192.168.1.10:19798", apiToken: "invalid-ipc-value" }
    })).rejects.toThrow("HTTPS");
    expect(s.settings.getCloudDriveToken()).toBe("");
    vi.spyOn(s.settings, "set").mockImplementation(() => { throw new Error("raw-native-value"); });
    await expect(s.invoke(IPC_CHANNELS.settingsSet, main, { ...getDefaultSettings(),
      cloudDrive: { ...getDefaultSettings().cloudDrive, apiToken: "raw-native-value" }
    })).rejects.toThrow("设置保存失败");
    expect(JSON.stringify([s.logger.info.mock.calls, s.logger.error.mock.calls, s.logger.warn.mock.calls])).not.toMatch(/invalid-ipc-value|raw-native-value/);
    expect(s.logger.error).not.toHaveBeenCalled();
  });

  it("keeps a defensive public projection even if an internal store adds sensitive fields", async () => {
    const s = setup(); const main = event("main"); const player = event("player");
    vi.spyOn(s.settings, "get").mockReturnValue({ ...getDefaultSettings(),
      cloudDrive: { ...getDefaultSettings().cloudDrive, apiToken: "future-internal-value" },
      internalCredential: "future-internal-value"
    } as AppSettings);
    for (const caller of [main, player]) expect(JSON.stringify(await s.invoke(IPC_CHANNELS.settingsGet, caller))).not.toContain("future-internal-value");
  });

  it("Main runtime can authenticate with the stored credential after settings:set", async () => {
    const s = setup(); const main = event("main");
    const server = http2.createServer(); let authorization = "";
    server.on("stream", (stream, headers) => {
      authorization = String(headers.authorization);
      stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "0" });
      stream.end(Buffer.alloc(5)); // A unary empty GetMountPoints protobuf message.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    try {
      await s.invoke(IPC_CHANNELS.settingsSet, main, { ...getDefaultSettings(), cloudDrive: {
        ...getDefaultSettings().cloudDrive, endpoint: `http://127.0.0.1:${address.port}`, apiToken: "runtime-security-value"
      } });
      const result = await s.invoke(IPC_CHANNELS.cloudDriveTest, main);
      expect(authorization).toBe("Bearer runtime-security-value");
      expect(result.apiMountPointCount).toBe(0);
      expect(JSON.stringify(result)).not.toContain("runtime-security-value");
    } finally {
      configureCloudDriveRuntime(getDefaultSettings().cloudDrive, "", {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(["main", "player"])("%s preload reads only public settings and has no credential getter", async (role) => {
    let exposed: any;
    const settings = { ...getDefaultSettings(), cloudDrive: { ...getDefaultSettings().cloudDrive, configured: true, apiToken: "bridge-security-value" } };
    const ipcRenderer = { invoke: vi.fn(async () => ({ settings, cacheLocation: "test-cache", cacheStatus: {} })), on: vi.fn(), removeListener: vi.fn() };
    const source = readFileSync(new URL("../../src/main/preload.cts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Script(compiled).runInNewContext({ exports: {}, URL, Set,
      require: (name: string) => { if (name !== "electron") throw new Error("Unexpected preload dependency"); return {
        ipcRenderer, contextBridge: { exposeInMainWorld: (_name: string, api: any) => { exposed = api; } }
      }; },
      process: { argv: [`--video-manager-window-role=${role}`, "--video-manager-entry-url=file%3A%2F%2F%2Fapp%2Findex.html"] },
      window: { location: { href: "file:///app/index.html" } }
    });
    const result = await exposed.getSettings();
    expect(result.settings.cloudDrive.configured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("bridge-security-value");
    expect(Object.keys(exposed).filter((key) => /token|secret|credential|invoke/i.test(key))).toEqual([]);
    if (role === "player") expect(exposed.setSettings).toBeUndefined();
    else {
      ipcRenderer.invoke.mockResolvedValue(settings as never);
      expect(JSON.stringify(await exposed.setSettings(getDefaultSettings()))).not.toContain("bridge-security-value");
    }
  });
});
