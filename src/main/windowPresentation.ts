import type { BrowserWindow } from "electron";

type MainWindowPresentation = Pick<BrowserWindow, "maximize" | "show">;

export function showMainWindowMaximized(window: MainWindowPresentation): void {
  window.maximize();
  window.show();
}
