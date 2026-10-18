import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import type { DataStorageApi } from "../../shared/dataStorage.js";
import { DataDirectoryManager, DataDirectoryUnavailableError } from "./dataDirectory.js";

export async function initializeDataStorage(defaultDirectory: string): Promise<DataDirectoryManager> {
  const manager = new DataDirectoryManager(defaultDirectory, app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath());
  try { await manager.initialize(); }
  catch (error) {
    await app.whenReady();
    if (error instanceof DataDirectoryUnavailableError) {
      const choice = await dialog.showMessageBox({ type: "warning", title: "数据目录不可用", message: error.message,
        buttons: ["退出", "重新定位已有资料库"], defaultId: 0, cancelId: 0 });
      if (choice.response === 1) {
        const selected = await dialog.showOpenDialog({ title: "选择原有资料库文件夹（应包含 library.sqlite）", properties: ["openDirectory"] });
        if (!selected.canceled && selected.filePaths[0]) {
          try { await manager.recoverExistingDirectory(selected.filePaths[0]); return manager; }
          catch { dialog.showErrorBox("无法恢复资料库", "所选目录无法验证或正在使用。原目录记录已保留，请检查磁盘及文件权限。"); }
        }
      }
    } else dialog.showErrorBox("无法打开应用数据", error instanceof Error ? error.message : "请保留原数据并检查目录定位记录。");
    app.exit(1);
    throw error;
  }
  return manager;
}

export async function prepareDataStorage(manager: DataDirectoryManager): Promise<void> {
  let window: BrowserWindow | undefined;
  try { await manager.prepareStartup(message => {
    if (!window) {
      window = new BrowserWindow({ width: 520, height: 200, resizable: false, closable: false, autoHideMenuBar: true,
        title: "映匣 · 数据迁移", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{background:#111318;color:#eceef2;font:16px system-ui;padding:24px;line-height:1.8}p{color:#adb5c3;font-size:14px}</style><strong>正在迁移应用数据</strong><p>正在复制并校验资料库、字幕和缓存。请勿关闭程序或断开磁盘，完成后会自动打开资料库。</p>')}`);
      window.on("closed", () => { window = undefined; });
    }
    window.setTitle(`映匣 · ${message}`);
  }); } catch {
    dialog.showErrorBox("无法完成数据目录切换", "目录定位记录无法安全保存，原数据已保留。请检查默认目录权限和可用空间后重新启动。");
    app.exit(1);
  } finally { window?.destroy(); }
}

export function createDataStorageApi(manager: DataDirectoryManager): DataStorageApi {
  let busy = false;
  return {
    getDataStorage: async () => manager.getStatus(),
    openDataDirectory: async () => {
      if (await shell.openPath(manager.getStatus().currentDirectory)) throw new Error("无法打开数据目录，请检查磁盘连接。");
    },
    chooseDataDirectory: async () => {
      if (busy) throw new Error("目录选择正在进行，请稍候。");
      busy = true;
      try {
        const result = await dialog.showOpenDialog({ title: "选择存放位置（将在其中新建专用的映匣数据文件夹）",
          defaultPath: path.dirname(manager.getStatus().currentDirectory), properties: ["openDirectory", "createDirectory"] });
        return result.canceled || !result.filePaths[0] ? null : await manager.choose(result.filePaths[0]);
      } finally { busy = false; }
    },
    migrateDataDirectory: async token => {
      await manager.schedule(token);
      // Relaunch starts only after the old process exits, including query workers,
      // FFmpeg tasks and every SQLite handle. Copying never overlaps those writers.
      setTimeout(() => { app.relaunch(); app.quit(); }, 150);
      return { restarting: true };
    }
  };
}
