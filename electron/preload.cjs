const { contextBridge, ipcRenderer } = require("electron");

const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const updaterGetActiveInfoIpcChannel = "nh3d:updater-get-active-info";
const updaterApplyIpcChannel = "nh3d:updater-apply";
const updaterCancelIpcChannel = "nh3d:updater-cancel";
const updaterExportLogsIpcChannel = "nh3d:updater-export-logs";
const updaterActivateIpcChannel = "nh3d:updater-activate";

contextBridge.exposeInMainWorld("nh3dElectron", {
  quitGame: () => ipcRenderer.invoke(quitIpcChannel),
  signalAppRendered: () => ipcRenderer.send(appRenderedIpcChannel),
  updater: {
    getActiveUpdateInfo: () =>
      ipcRenderer.invoke(updaterGetActiveInfoIpcChannel),
    applyGameUpdate: (manifestUrl) =>
      ipcRenderer.invoke(updaterApplyIpcChannel, { manifestUrl }),
    cancelGameUpdate: () =>
      ipcRenderer.invoke(updaterCancelIpcChannel),
    exportUpdateLogs: () =>
      ipcRenderer.invoke(updaterExportLogsIpcChannel),
    activateInstalledUpdate: () =>
      ipcRenderer.invoke(updaterActivateIpcChannel),
  },
});
