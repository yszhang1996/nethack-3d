const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const path = require("node:path");

app.setVersion("0.9.1");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const mainWindowStateById = new Map();

function hasLaunchArgument(...switchNames) {
  return switchNames.some(
    (switchName) =>
      app.commandLine.hasSwitch(switchName) ||
      process.argv.includes(`--${switchName}`),
  );
}

function resolveWindowMode() {
  if (hasLaunchArgument("windowed", "window")) {
    return "windowed";
  }
  if (
    hasLaunchArgument(
      "borderless",
      "borderless-window",
      "borderlesswindow",
    )
  ) {
    return "borderless";
  }
  return process.platform === "win32" ? "borderless" : "fullscreen";
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}

function showMainWindowIfReady(mainWindow, state) {
  if (state.shown || mainWindow.isDestroyed()) {
    return;
  }
  if (!state.readyToShow || !state.appRendered) {
    return;
  }
  state.shown = true;
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
  const workAreaBounds = primaryDisplay.workArea;
  const windowMode = resolveWindowMode();
  const baseWindowOptions = {
    minWidth: 1024,
    minHeight: 700,
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
  };
  let mainWindowOptions;
  if (windowMode === "windowed") {
    mainWindowOptions = {
      ...baseWindowOptions,
      width: Math.max(1024, Math.min(workAreaBounds.width, 1280)),
      height: Math.max(700, Math.min(workAreaBounds.height, 800)),
      center: true,
      frame: true,
      fullscreen: false,
      fullscreenable: true,
    };
  } else if (windowMode === "borderless") {
    mainWindowOptions = {
      ...baseWindowOptions,
      x: primaryBounds.x,
      y: primaryBounds.y,
      width: primaryBounds.width,
      height: primaryBounds.height,
      frame: false,
      fullscreen: false,
      fullscreenable: true,
    };
  } else {
    mainWindowOptions = {
      ...baseWindowOptions,
      x: primaryBounds.x,
      y: primaryBounds.y,
      width: primaryBounds.width,
      height: primaryBounds.height,
      frame: false,
      fullscreen: true,
      fullscreenable: true,
    };
  }
  const mainWindow = new BrowserWindow(mainWindowOptions);
  mainWindow.webContents.setZoomFactor(1);
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

app.on("child-process-gone", (_event, details) => {
  if (details.type !== "GPU") {
    return;
  }
  console.error(
    `Electron GPU process exited (reason=${details.reason}, exitCode=${details.exitCode ?? "n/a"})`,
  );
});

app.on("render-process-gone", (_event, _webContents, details) => {
  console.error(
    `Electron renderer process exited (reason=${details.reason}, exitCode=${details.exitCode ?? "n/a"})`,
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
