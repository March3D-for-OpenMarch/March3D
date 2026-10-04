const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("march3d", {
  isElectron: true,
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.send("window:close"),
  openDevTools: () => ipcRenderer.send("devtools:open"),

  inspectElement: (x, y) =>
    ipcRenderer.send("devtools:inspect-element", { x, y }),
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
  openDotsFile: () => ipcRenderer.invoke("dots:open"),
  openSyncedDotsFile: () => ipcRenderer.invoke("dots:open-synced"),
  probeOpenMarchSync: () => ipcRenderer.invoke("sync:probe"),
  readFile: (filePath) => ipcRenderer.invoke("file:read", filePath),
  readEmbeddedAudio: (filePath) =>
    ipcRenderer.invoke("audio:read-embedded", filePath),
  watchFile: (filePath) => ipcRenderer.invoke("dots:watch", filePath),
  stopWatching: () => ipcRenderer.invoke("dots:stop-watch"),
  onDotsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dots-file-changed", listener);
    return () => ipcRenderer.removeListener("dots-file-changed", listener);
  },
  openAudioFile: () => ipcRenderer.invoke("audio:open"),
  onOpenMarchSync: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("openmarch-sync", listener);
    return () => ipcRenderer.removeListener("openmarch-sync", listener);
  },
});
