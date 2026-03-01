const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

app.setVersion("0.8.3");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

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
