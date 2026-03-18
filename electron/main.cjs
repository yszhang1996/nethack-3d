const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

app.setVersion("0.9.1");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const mainWindowStateById = new Map();

function showMainWindowIfReady(mainWindow, state) {
  if (state.shown || mainWindow.isDestroyed()) {
    return;
  }
  if (!state.readyToShow || !state.appRendered) {
    return;
  }
  state.shown = true;
  mainWindow.setFullScreen(true);
  mainWindow.show();
}

ipcMain.handle(quitIpcChannel, () => {
  // Bypass renderer beforeunload prompts for explicit in-game quit requests.
  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  app.quit();
});

ipcMain.on(appRenderedIpcChannel, (event) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow) {
    return;
  }
  const state = mainWindowStateById.get(mainWindow.id);
  if (!state) {
    return;
  }
  state.appRendered = true;
  showMainWindowIfReady(mainWindow, state);
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
  const state = {
    readyToShow: false,
    appRendered: false,
    shown: false,
  };
  mainWindowStateById.set(mainWindow.id, state);

  mainWindow.once("ready-to-show", () => {
    state.readyToShow = true;
    showMainWindowIfReady(mainWindow, state);
  });

  mainWindow.webContents.on("did-fail-load", () => {
    state.shown = true;
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on("closed", () => {
    mainWindowStateById.delete(mainWindow.id);
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
