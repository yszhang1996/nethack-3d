const { contextBridge, ipcRenderer } = require("electron");

const quitIpcChannel = "nh3d:quit-app";

contextBridge.exposeInMainWorld("nh3dElectron", {
  quitGame: () => ipcRenderer.invoke(quitIpcChannel),
});
