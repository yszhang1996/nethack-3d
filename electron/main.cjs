const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

app.setVersion("0.9.1");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const quitIpcChannel = "nh3d:quit-app";

ipcMain.handle(quitIpcChannel, () => {
  // Bypass renderer beforeunload prompts for explicit in-game quit requests.
  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  app.quit();
});

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    fullscreenable: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.setFullScreen(true);
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {
      // Ignore external browser launch errors.
    });
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-prevent-unload", (event) => {
    // Allow Alt+F4 / native close to quit immediately even if the renderer
    // registered a beforeunload prompt while gameplay is active.
    event.preventDefault();
  });

  if (!app.isPackaged && devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  const indexHtmlPath = path.join(__dirname, "..", "dist", "index.html");
  mainWindow.loadFile(indexHtmlPath);
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
