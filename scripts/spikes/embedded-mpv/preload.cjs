const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("mpvSpike", {
  action: (op, value) => ipcRenderer.invoke("mpv-spike:action", { op, value }),
  bounds: (value) => ipcRenderer.invoke("mpv-spike:bounds", value),
  heartbeat: (gapMs,phase) => ipcRenderer.invoke("mpv-spike:heartbeat", gapMs,phase),
  onKey: (listener) => { const handler=(_event,code)=>listener(code);ipcRenderer.on("mpv-spike:key",handler);return ()=>ipcRenderer.removeListener("mpv-spike:key",handler); },
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("mpv-spike:state", handler);
    return () => ipcRenderer.removeListener("mpv-spike:state", handler);
  }
});
