import { BrowserWindow, screen, type Rectangle } from "electron";
import path from "node:path";
import { IPC_CHANNELS, type VideoRecord } from "../shared/videoTypes.js";
import type { PlayerTimelinePreviewContent, PlayerTimelinePreviewRequest } from "../shared/playerTimelinePreview.js";
import { configureWindowSecurity } from "./security.js";
import { RENDERER_ENTRY_URL } from "./rendererProtocol.js";

export function timelinePreviewBounds(content: Rectangle, workArea: Rectangle, x: number, y: number, width: number, height: number): Rectangle {
  const left = Math.max(content.x, workArea.x), top = Math.max(content.y, workArea.y);
  const right = Math.min(content.x + content.width, workArea.x + workArea.width);
  const bottom = Math.min(content.y + content.height, workArea.y + workArea.height);
  width = Math.min(width, Math.max(1, right - left));
  height = Math.min(height, Math.max(1, bottom - top));
  return { x: Math.round(Math.max(left, Math.min(right - width, content.x + x - width / 2))),
    y: Math.round(Math.max(top, Math.min(bottom - height, content.y + y - height))), width: Math.ceil(width), height: Math.ceil(height) };
}

/** Owned, non-activating window overlays the native video HWND without resizing it. */
export class PlayerTimelinePreview {
  private window: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private revision = 0;
  private disposed = false;
  private readonly hideListener = () => this.hide();

  constructor(private readonly parent: BrowserWindow,
    private readonly options: { currentDir: string; isPackaged: boolean; devServerUrl: string }) {
    for (const event of ["blur", "move", "resize", "minimize", "hide", "enter-full-screen", "leave-full-screen"]) (parent as NodeJS.EventEmitter).on(event, this.hideListener);
    parent.once("closed", () => this.close());
    parent.webContents.on("did-start-navigation", this.hideListener);
  }

  async update(request: PlayerTimelinePreviewRequest, video?: VideoRecord): Promise<void> {
    if (!request || !video) { this.hide(); return; }
    if (this.disposed || this.parent.isDestroyed() || !this.parent.isVisible() || !this.parent.isFocused()) return;
    const revision = ++this.revision;
    if (!this.window || this.window.isDestroyed()) {
      const entryUrl = this.options.isPackaged ? RENDERER_ENTRY_URL : this.options.devServerUrl;
      this.window = new BrowserWindow({
        // Layered composition is required with the app's software-rendered Chromium:
        // an ordinary click-through HWND can show only its border above native MPV.
        parent: this.parent, width: 160, height: 112, show: false, frame: false, transparent: true,
        focusable: false, skipTaskbar: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, hasShadow: true,
        backgroundColor: "#202824", webPreferences: {
          contextIsolation: true, nodeIntegration: false, sandbox: true,
          preload: path.join(this.options.currentDir, "preload.cjs"),
          additionalArguments: ["--video-manager-window-role=timeline-preview", `--video-manager-entry-url=${encodeURIComponent(entryUrl)}`]
        }
      });
      this.window.setMenu(null);
      this.window.setIgnoreMouseEvents(true, { forward: true });
      configureWindowSecurity(this.window, { role: "timeline-preview", entryUrl });
      this.loading = this.window.loadURL(entryUrl);
    }
    try { await this.loading; } catch { this.close(); return; }
    if (revision !== this.revision || this.disposed || !this.window || this.window.isDestroyed() || this.parent.isDestroyed()) return;
    const imageHeight = video.width && video.height ? Math.min(240, Math.max(1, Math.round(160 * video.height / video.width))) : 90;
    const timeMs = Math.min(request.timeMs, Math.max(0, (video.durationMs ?? Number.MAX_SAFE_INTEGER) - 1));
    const payload: PlayerTimelinePreviewContent = { url: `local-video://preview/${encodeURIComponent(video.id)}/${timeMs}?v=${encodeURIComponent(video.updatedAt)}`, timeMs, imageHeight, ...(request.cachedOnly ? { cachedOnly: true } : {}) };
    const content = this.parent.getContentBounds(), scale = this.parent.webContents.getZoomFactor();
    const display = screen.getDisplayMatching(this.parent.getBounds());
    this.window.webContents.setZoomFactor(scale);
    // Bounds change only this preview window, never the video surface or player layout.
    this.window.setBounds(timelinePreviewBounds(content, display.bounds, request.x * scale, request.y * scale, 160 * scale, (imageHeight + 22) * scale));
    this.window.webContents.send(IPC_CHANNELS.playerTimelinePreview, payload);
    this.window.showInactive();
  }

  hide(): void {
    ++this.revision;
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      this.window.webContents.send(IPC_CHANNELS.playerTimelinePreview, null);
    }
  }

  close(): void {
    this.hide(); this.disposed = true;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    for (const event of ["blur", "move", "resize", "minimize", "hide", "enter-full-screen", "leave-full-screen"]) (this.parent as NodeJS.EventEmitter).removeListener(event, this.hideListener);
    if (!this.parent.isDestroyed()) this.parent.webContents.removeListener("did-start-navigation", this.hideListener);
  }
}
