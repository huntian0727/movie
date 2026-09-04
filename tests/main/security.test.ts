import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/videoTypes";
import {
  PRODUCTION_CSP,
  UNTRUSTED_IPC_ERROR_CODE,
  assertTrustedIpcSender,
  buildDevelopmentCsp,
  configureWindowSecurity,
  getAllowedIpcRoles,
  installContentSecurityPolicy,
  isTrustedRendererUrl,
  registerTrustedWebContents,
  wrapTrustedIpcHandler
} from "../../src/main/security";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Electron security policy", () => {
  it("uses a strict production CSP that blocks inline, eval, data, and remote scripts", () => {
    expect(PRODUCTION_CSP).toContain("default-src 'self'");
    expect(PRODUCTION_CSP).toContain("script-src 'self'");
    expect(PRODUCTION_CSP).toContain("object-src 'none'");
    expect(PRODUCTION_CSP).toContain("local-video:");
    expect(PRODUCTION_CSP).not.toContain("'unsafe-eval'");
    expect(PRODUCTION_CSP.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(PRODUCTION_CSP.match(/script-src[^;]*/)?.[0]).not.toContain("data:");
    expect(PRODUCTION_CSP).not.toContain("https:");
  });

  it("keeps the development CSP separate and limits HMR connections to the configured origin", () => {
    const policy = buildDevelopmentCsp("http://127.0.0.1:5173");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("http://127.0.0.1:5173");
    expect(policy).toContain("ws://127.0.0.1:5173");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("https:");
  });

  it("attaches CSP only to the trusted renderer document response", () => {
    let listener:
      | ((details: { url: string; responseHeaders?: Record<string, string[]> }, callback: (result: any) => void) => void)
      | undefined;
    installContentSecurityPolicy(
      {
        webRequest: {
          onHeadersReceived: vi.fn((next) => {
            listener = next;
          })
        }
      } as never,
      {
        isPackaged: true,
        devServerUrl: "http://127.0.0.1:5173",
        entryUrl: "file:///app/index.html"
      }
    );

    const trustedCallback = vi.fn();
    listener?.({ url: "file:///app/index.html", responseHeaders: { Existing: ["value"] } }, trustedCallback);
    expect(trustedCallback).toHaveBeenCalledWith({
      responseHeaders: {
        Existing: ["value"],
        "Content-Security-Policy": [PRODUCTION_CSP]
      }
    });

    const externalCallback = vi.fn();
    listener?.({ url: "https://example.com/", responseHeaders: { Existing: ["value"] } }, externalCallback);
    expect(externalCallback).toHaveBeenCalledWith({ responseHeaders: { Existing: ["value"] } });
  });

  it("allows only the configured renderer entry while tolerating query and hash state", () => {
    const packaged = "file:///C:/Program%20Files/VideoManager/resources/app.asar/dist-renderer/index.html";
    expect(isTrustedRendererUrl(`${packaged}?player=1#state`, packaged)).toBe(true);
    expect(isTrustedRendererUrl("file:///C:/Windows/System32/index.html", packaged)).toBe(false);
    expect(isTrustedRendererUrl("https://example.com/", packaged)).toBe(false);

    const development = "http://127.0.0.1:5173/";
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/?player=1", development)).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/other", development)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173/", development)).toBe(false);
  });

  it("denies new windows and prevents untrusted navigation", () => {
    let navigateListener: ((event: { preventDefault(): void }, url: string) => void) | undefined;
    let openHandler: ((details: { url: string }) => { action: string }) | undefined;
    const preventDefault = vi.fn();
    const contents = {
      id: 101,
      isDestroyed: () => false,
      mainFrame: { url: "file:///app/index.html" },
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        if (event === "will-navigate") navigateListener = listener;
      }),
      setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
        openHandler = handler;
      })
    };
    configureWindowSecurity({ webContents: contents } as never, {
      role: "main",
      entryUrl: "file:///app/index.html"
    });

    navigateListener?.({ preventDefault }, "file:///app/index.html?player=1");
    expect(preventDefault).not.toHaveBeenCalled();
    navigateListener?.({ preventDefault }, "https://example.com/private?path=C:/secret");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openHandler?.({ url: "https://example.com/" })).toEqual({ action: "deny" });
  });

  it("rejects forged frames and enforces main/player IPC role differences", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const main = createContents(201, "file:///app/index.html");
    const player = createContents(202, "file:///app/index.html?player=1");
    const unregisterMain = registerTrustedWebContents(main, "main", "file:///app/index.html");
    const unregisterPlayer = registerTrustedWebContents(player, "player", "file:///app/index.html");
    try {
      expect(assertTrustedIpcSender(createEvent(main), ["main"])).toBe("main");
      expect(assertTrustedIpcSender(createEvent(player), ["main", "player"])).toBe("player");
      expect(getAllowedIpcRoles(IPC_CHANNELS.videoDelete)).toEqual(["main", "player"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.windowSyncSnapshot)).toEqual(["main", "player"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.playerSessionSet)).toEqual(["main", "player"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.playerSessionSelect)).toEqual(["main", "player"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.videoBatchDelete)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.duplicateFastDelete)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.videoBatchMove)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.assetCenterSummary)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.assetCenterSources)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.diagnosticsPreview)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.diagnosticsExport)).toEqual(["main"]);
      expect(getAllowedIpcRoles(IPC_CHANNELS.settingsSet)).toEqual(["main"]);

      expect(() => assertTrustedIpcSender(createEvent(player), ["main"])).toThrow(UNTRUSTED_IPC_ERROR_CODE);
      expect(() =>
        assertTrustedIpcSender(
          { sender: player, senderFrame: { url: "file:///app/index.html" } } as never,
          ["main", "player"]
        )
      ).toThrow(UNTRUSTED_IPC_ERROR_CODE);

      player.mainFrame.url = "https://example.com/?path=C:/secret";
      expect(() => assertTrustedIpcSender(createEvent(player), ["main", "player"])).toThrow(
        UNTRUSTED_IPC_ERROR_CODE
      );
      const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
      expect(logged).not.toContain("C:/secret");
      expect(logged).not.toContain("/?path=");
    } finally {
      unregisterMain();
      unregisterPlayer();
    }
  });

  it("blocks a player WebContents from invoking a main-only destructive handler", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const main = createContents(301, "file:///app/index.html");
    const player = createContents(302, "file:///app/index.html?player=1");
    const unregisterMain = registerTrustedWebContents(main, "main", "file:///app/index.html");
    const unregisterPlayer = registerTrustedWebContents(player, "player", "file:///app/index.html");
    const destructiveOperation = vi.fn(() => "deleted");
    const handler = wrapTrustedIpcHandler(
      IPC_CHANNELS.videoBatchDelete,
      (_event, _videoIds: unknown) => destructiveOperation()
    );
    try {
      expect(() => handler(createEvent(player), ["forged-id"])).toThrow(UNTRUSTED_IPC_ERROR_CODE);
      expect(destructiveOperation).not.toHaveBeenCalled();
      expect(handler(createEvent(main), ["trusted-id"])).toBe("deleted");
      expect(destructiveOperation).toHaveBeenCalledOnce();
    } finally {
      unregisterMain();
      unregisterPlayer();
    }
  });
});

function createContents(id: number, url: string) {
  return {
    id,
    isDestroyed: () => false,
    mainFrame: { url },
    on: vi.fn()
  };
}

function createEvent(sender: ReturnType<typeof createContents>) {
  return { sender, senderFrame: sender.mainFrame } as never;
}
