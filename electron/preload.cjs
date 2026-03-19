const { contextBridge, ipcRenderer } = require("electron");

const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const updaterGetActiveInfoIpcChannel = "nh3d:updater-get-active-info";
const updaterApplyIpcChannel = "nh3d:updater-apply";
const updaterActivateIpcChannel = "nh3d:updater-activate";

contextBridge.exposeInMainWorld("nh3dElectron", {
  quitGame: () => ipcRenderer.invoke(quitIpcChannel),
  signalAppRendered: () => ipcRenderer.send(appRenderedIpcChannel),
  updater: {
    getActiveUpdateInfo: () =>
      ipcRenderer.invoke(updaterGetActiveInfoIpcChannel),
    applyGameUpdate: (manifestUrl) =>
      ipcRenderer.invoke(updaterApplyIpcChannel, { manifestUrl }),
    activateInstalledUpdate: () =>
      ipcRenderer.invoke(updaterActivateIpcChannel),
  },
});
