const { contextBridge, ipcRenderer } = require("electron");

const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const updaterGetActiveInfoIpcChannel = "nh3d:updater-get-active-info";
const updaterApplyIpcChannel = "nh3d:updater-apply";
const updaterCancelIpcChannel = "nh3d:updater-cancel";
const updaterProgressIpcChannel = "nh3d:updater-progress";
const updaterActivateIpcChannel = "nh3d:updater-activate";
const updateProgressListeners = new Set();

ipcRenderer.on(updaterProgressIpcChannel, (_event, payload) => {
  for (const listener of updateProgressListeners) {
    try {
      listener(payload);
    } catch {
      // Ignore renderer listener errors so updates continue streaming.
    }
  }
});

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
    onUpdateProgress: (listener) => {
      if (typeof listener !== "function") {
        return false;
      }
      updateProgressListeners.add(listener);
      return true;
    },
    offUpdateProgress: (listener) => {
      if (typeof listener !== "function") {
        return false;
      }
      return updateProgressListeners.delete(listener);
    },
    activateInstalledUpdate: () =>
      ipcRenderer.invoke(updaterActivateIpcChannel),
  },
});
