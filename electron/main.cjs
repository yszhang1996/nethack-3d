const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setVersion("0.9.1");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const mainWindowStateById = new Map();
const splashImageFileName = "NetHack3D-splash.bmp";

function closeSplashWindow(splashWindow) {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  splashWindow.destroy();
}

function getSplashImagePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, splashImageFileName);
  }
  return path.join(__dirname, "..", "build", splashImageFileName);
}

function createSplashWindow(displayBounds) {
  const splashWindow = new BrowserWindow({
    width: Math.min(960, displayBounds.width),
    height: Math.min(640, displayBounds.height),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const splashImagePath = getSplashImagePath();
  const splashImageMarkup = fs.existsSync(splashImagePath)
    ? `<img alt="NetHack 3D" src="${pathToFileURL(splashImagePath).toString()}"/>`
    : `<div class="fallback">NetHack 3D</div>`;
  const splashHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #000;
        overflow: hidden;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .fallback {
        color: #fff;
        font-family: "Courier New", monospace;
        font-size: 32px;
        letter-spacing: 0.08em;
      }
    </style>
  </head>
  <body>${splashImageMarkup}</body>
</html>`;

  splashWindow.once("ready-to-show", () => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });
  splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`,
  );

  return splashWindow;
}

function showMainWindowIfReady(mainWindow, state) {
  if (state.shown || mainWindow.isDestroyed()) {
    return;
  }
  if (!state.readyToShow || !state.appRendered) {
    return;
  }
  state.shown = true;
  closeSplashWindow(state.splashWindow);
  state.splashWindow = null;
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
  const primaryDisplay = screen.getPrimaryDisplay();
  const primaryBounds = primaryDisplay.bounds;
  const mainWindow = new BrowserWindow({
    x: primaryBounds.x,
    y: primaryBounds.y,
    width: primaryBounds.width,
    height: primaryBounds.height,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    fullscreen: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const splashWindow =
    process.platform === "linux" && app.isPackaged
      ? createSplashWindow(primaryBounds)
      : null;
  const state = {
    readyToShow: false,
    appRendered: false,
    shown: false,
    splashWindow,
  };
  mainWindowStateById.set(mainWindow.id, state);

  mainWindow.once("ready-to-show", () => {
    state.readyToShow = true;
    showMainWindowIfReady(mainWindow, state);
  });

  mainWindow.webContents.on("did-fail-load", () => {
    state.shown = true;
    closeSplashWindow(state.splashWindow);
    state.splashWindow = null;
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on("closed", () => {
    closeSplashWindow(state.splashWindow);
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
