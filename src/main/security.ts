import type { BrowserWindow, IpcMainInvokeEvent, Session } from "electron";
import { IPC_CHANNELS } from "../shared/videoTypes.js";
import type { StructuredLogger } from "./logging/logger.js";

export type WindowRole = "main" | "player" | "smoke";

interface TrustedWebContents {
  role: WindowRole;
  entryUrl: string;
}

interface RegisterableWebContents {
  id: number;
  isDestroyed(): boolean;
  mainFrame: { url: string };
  on(event: "destroyed", listener: () => void): unknown;
}

const trustedWebContents = new Map<number, TrustedWebContents>();
let securityLogger: StructuredLogger | undefined;
export const UNTRUSTED_IPC_ERROR_CODE = "ERR_UNTRUSTED_IPC_SENDER";

export function configureSecurityLogger(logger: StructuredLogger | undefined): void {
  securityLogger = logger;
}

const playerAllowedChannels = new Set<string>([
  IPC_CHANNELS.previewImageLoad,
  IPC_CHANNELS.previewImageCancel,
  IPC_CHANNELS.libraryPage,
  IPC_CHANNELS.libraryNavigation,
  IPC_CHANNELS.libraryMissingList,
  IPC_CHANNELS.videoListByIds,
  IPC_CHANNELS.folderList,
  IPC_CHANNELS.folderScanStatusList,
  IPC_CHANNELS.videoFavorite,
  IPC_CHANNELS.videoPendingDelete,
  IPC_CHANNELS.videoDelete,
  IPC_CHANNELS.videoPlayExternal,
  IPC_CHANNELS.playHistoryList,
  IPC_CHANNELS.playHistoryRecord,
  IPC_CHANNELS.windowSyncSnapshot,
  IPC_CHANNELS.playerSessionSet,
  IPC_CHANNELS.playerSessionSelect,
  IPC_CHANNELS.settingsGet
]);

export function getAllowedIpcRoles(channel: string): readonly WindowRole[] {
  return playerAllowedChannels.has(channel) ? ["main", "player"] : ["main"];
}

export function wrapTrustedIpcHandler<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
): (event: IpcMainInvokeEvent, ...args: TArgs) => TResult {
  return (event, ...args) => {
    assertTrustedIpcSender(event, getAllowedIpcRoles(channel));
    return listener(event, ...args);
  };
}

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: local-video:",
  "media-src 'self' blob: local-video:",
  "connect-src 'self' local-video:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

export function buildDevelopmentCsp(devServerUrl: string): string {
  const origin = new URL(devServerUrl).origin;
  const socketOrigin = origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: local-video:",
    "media-src 'self' blob: local-video:",
    `connect-src 'self' ${origin} ${socketOrigin} local-video:`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function installContentSecurityPolicy(
  targetSession: Session,
  options: { isPackaged: boolean; devServerUrl: string; entryUrl: string }
): void {
  const policy = options.isPackaged ? PRODUCTION_CSP : buildDevelopmentCsp(options.devServerUrl);
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isTrustedRendererUrl(details.url, options.entryUrl)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy]
      }
    });
  });
}

export function configureWindowSecurity(
  window: BrowserWindow,
  options: { role: WindowRole; entryUrl: string }
): void {
  registerTrustedWebContents(window.webContents, options.role, options.entryUrl);

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isTrustedRendererUrl(targetUrl, options.entryUrl)) return;
    event.preventDefault();
    logSecurityRejection("navigation", options.role, targetUrl);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    logSecurityRejection("window-open", options.role, url);
    return { action: "deny" };
  });
}

export function registerTrustedWebContents(
  webContents: RegisterableWebContents,
  role: WindowRole,
  entryUrl: string
): () => void {
  const registration = { role, entryUrl };
  trustedWebContents.set(webContents.id, registration);
  const unregister = () => {
    if (trustedWebContents.get(webContents.id) === registration) trustedWebContents.delete(webContents.id);
  };
  webContents.on("destroyed", unregister);
  return unregister;
}

export function assertTrustedIpcSender(
  event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
  allowedRoles: readonly WindowRole[]
): WindowRole {
  const registration = trustedWebContents.get(event.sender.id);
  const senderFrame = event.senderFrame;
  const frameDestroyed =
    senderFrame && "isDestroyed" in senderFrame && typeof senderFrame.isDestroyed === "function"
      ? senderFrame.isDestroyed()
      : false;
  const trusted =
    registration &&
    !event.sender.isDestroyed() &&
    senderFrame &&
    !frameDestroyed &&
    senderFrame === event.sender.mainFrame &&
    isTrustedRendererUrl(senderFrame.url, registration.entryUrl) &&
    allowedRoles.includes(registration.role);

  if (!trusted) {
    logSecurityRejection("ipc", registration?.role ?? "unregistered", senderFrame?.url);
    throw new Error(`${UNTRUSTED_IPC_ERROR_CODE}: IPC caller is not an authorized application window`);
  }
  return registration.role;
}

export function isTrustedRendererUrl(candidateUrl: string, entryUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const entry = new URL(entryUrl);
    if (candidate.protocol !== entry.protocol) return false;
    if (entry.protocol === "file:") {
      return normalizedEntry(candidate) === normalizedEntry(entry);
    }
    return candidate.origin === entry.origin && candidate.pathname === entry.pathname;
  } catch {
    return false;
  }
}

function normalizedEntry(url: URL): string {
  const normalized = new URL(url.href);
  normalized.search = "";
  normalized.hash = "";
  return normalized.href;
}

function logSecurityRejection(kind: string, role: WindowRole | "unregistered", url?: string): void {
  if (securityLogger) {
    securityLogger.warn({
      module: "security",
      event: `rejected_${kind}`,
      context: {
        role,
        source: sanitizeUrl(url)
      }
    });
    return;
  }
  console.warn(`[security] rejected ${kind}`, {
    role,
    source: sanitizeUrl(url)
  });
}

function sanitizeUrl(url?: string): string {
  if (!url) return "missing";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return "file://local";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
    return `${parsed.protocol}//redacted`;
  } catch {
    return "invalid";
  }
}
