const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const packageJson = require("../package.json");

if (typeof packageJson.version === "string") {
  app.setVersion(packageJson.version);
}

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const quitIpcChannel = "nh3d:quit-app";
const appRenderedIpcChannel = "nh3d:app-rendered";
const updaterGetActiveInfoIpcChannel = "nh3d:updater-get-active-info";
const updaterApplyIpcChannel = "nh3d:updater-apply";
const updaterActivateIpcChannel = "nh3d:updater-activate";
const mainWindowStateById = new Map();

const updateRootDirPath = path.join(app.getPath("userData"), "game-updates");
const updateCurrentFilesDirPath = path.join(updateRootDirPath, "current");
const updateStagingDirPath = path.join(updateRootDirPath, "staging");
const activeUpdateMetadataPath = path.join(
  updateRootDirPath,
  "active-update.json",
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeRelativePath(value) {
  const normalized = normalizeString(value).replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("/") || normalized.includes("..")) {
    return null;
  }
  return normalized;
}

function parseManifestFileEntry(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const relativePath = normalizeRelativePath(value.path);
  if (!relativePath) {
    return null;
  }
  const size =
    typeof value.size === "number" && Number.isFinite(value.size)
      ? Math.max(0, Math.trunc(value.size))
      : null;
  const sha256 = normalizeNullableString(value.sha256);
  const url = normalizeNullableString(value.url);
  return {
    path: relativePath,
    size,
    sha256,
    url,
  };
}

function parseManifestLatestEntry(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const buildId = normalizeString(value.buildId);
  const filesBasePath = normalizeRelativePath(value.filesBasePath);
  const rawFiles = Array.isArray(value.files) ? value.files : [];
  const files = rawFiles
    .map((entry) => parseManifestFileEntry(entry))
    .filter(Boolean);
  if (!buildId || !filesBasePath || files.length === 0) {
    return null;
  }

  return {
    buildId,
    commitSha: normalizeNullableString(value.commitSha),
    clientVersion: normalizeNullableString(value.clientVersion),
    requiresClientUpgrade: normalizeBoolean(value.requiresClientUpgrade),
    filesBasePath,
    files,
  };
}

function parseUpdateManifest(payload) {
  if (!isPlainObject(payload)) {
    return null;
  }
  const latest = parseManifestLatestEntry(payload.latest);
  if (!latest) {
    return null;
  }
  return { latest };
}

function readJsonFileSync(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseActiveUpdateMetadata(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const buildId = normalizeNullableString(value.buildId);
  const buildRootPath = normalizeNullableString(value.buildRootPath);
  const commitSha = normalizeNullableString(value.commitSha);
  const updatedAt = normalizeNullableString(value.updatedAt);
  const manifestUrl = normalizeNullableString(value.manifestUrl);
  const clientVersion = normalizeNullableString(value.clientVersion);
  if (!buildId || !buildRootPath) {
    return null;
  }
  return {
    buildId,
    buildRootPath,
    commitSha,
    updatedAt,
    manifestUrl,
    clientVersion,
  };
}

function readActiveUpdateMetadataSync() {
  const parsed = parseActiveUpdateMetadata(readJsonFileSync(activeUpdateMetadataPath));
  if (!parsed) {
    return null;
  }
  const indexHtmlPath = path.join(parsed.buildRootPath, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    return null;
  }
  return parsed;
}

function toPublicActiveUpdateInfo(metadata) {
  if (!metadata) {
    return null;
  }
  return {
    buildId: metadata.buildId,
    commitSha: metadata.commitSha,
    updatedAt: metadata.updatedAt,
    clientVersion: metadata.clientVersion,
    manifestUrl: metadata.manifestUrl,
  };
}

function resolveLaunchIndexHtmlPath() {
  const activeUpdate = readActiveUpdateMetadataSync();
  if (activeUpdate) {
    return path.join(activeUpdate.buildRootPath, "index.html");
  }
  return path.join(__dirname, "..", "dist", "index.html");
}

async function removeDirectoryIfPresent(targetPath) {
  await fsp.rm(targetPath, { recursive: true, force: true });
}

function resolveManifestFileUrl(manifestUrl, latestManifestEntry, fileEntry) {
  if (fileEntry.url) {
    return new URL(fileEntry.url, manifestUrl).toString();
  }
  const basePath = latestManifestEntry.filesBasePath.replace(/\/+$/, "");
  const relativePath = fileEntry.path.replace(/^\/+/, "");
  return new URL(`${basePath}/${relativePath}`, manifestUrl).toString();
}

async function fetchJsonFromUrl(url) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch API is not available in the Electron host.");
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch update manifest (${response.status} ${response.statusText}).`,
    );
  }
  return response.json();
}

async function downloadFileWithValidation(
  fileUrl,
  destinationPath,
  expectedSize,
  expectedSha256,
) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch API is not available in the Electron host.");
  }
  const response = await fetch(fileUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${fileUrl} (${response.status} ${response.statusText}).`,
    );
  }

  const fileBytes = Buffer.from(await response.arrayBuffer());
  if (typeof expectedSize === "number" && fileBytes.length !== expectedSize) {
    throw new Error(
      `Downloaded file size mismatch for ${fileUrl}: expected ${expectedSize}, got ${fileBytes.length}.`,
    );
  }
  if (expectedSha256) {
    const actualSha256 = crypto
      .createHash("sha256")
      .update(fileBytes)
      .digest("hex");
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(
        `SHA256 mismatch for ${fileUrl}: expected ${expectedSha256}, got ${actualSha256}.`,
      );
    }
  }

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsp.writeFile(destinationPath, fileBytes);
}

async function applyGameUpdateFromManifestUrl(manifestUrl) {
  if (!app.isPackaged) {
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: "Updater is disabled in development builds.",
    };
  }

  const normalizedManifestUrl = normalizeNullableString(manifestUrl);
  if (!normalizedManifestUrl) {
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: "Update manifest URL is required.",
    };
  }

  const parsedManifest = parseUpdateManifest(
    await fetchJsonFromUrl(normalizedManifestUrl),
  );
  if (!parsedManifest?.latest) {
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: "Update manifest payload is invalid.",
    };
  }

  const latest = parsedManifest.latest;
  const activeMetadata = readActiveUpdateMetadataSync();
  if (activeMetadata?.buildId === latest.buildId) {
    return {
      ok: true,
      applied: false,
      alreadyInstalled: true,
      buildId: latest.buildId,
      reloadTriggered: false,
      clientUpdateRequired: latest.requiresClientUpgrade,
      error: null,
    };
  }

  const stagingBuildDirPath = path.join(updateStagingDirPath, "current");
  const targetBuildDirPath = updateCurrentFilesDirPath;
  await removeDirectoryIfPresent(stagingBuildDirPath);
  await fsp.mkdir(stagingBuildDirPath, { recursive: true });

  try {
    for (const fileEntry of latest.files) {
      const relativePath = normalizeRelativePath(fileEntry.path);
      if (!relativePath) {
        throw new Error(`Unsafe update file path: ${String(fileEntry.path)}`);
      }
      const sourceUrl = resolveManifestFileUrl(
        normalizedManifestUrl,
        latest,
        fileEntry,
      );
      const destinationPath = path.join(stagingBuildDirPath, relativePath);
      await downloadFileWithValidation(
        sourceUrl,
        destinationPath,
        fileEntry.size,
        fileEntry.sha256,
      );
    }

    const stagedIndexHtmlPath = path.join(stagingBuildDirPath, "index.html");
    if (!fs.existsSync(stagedIndexHtmlPath)) {
      throw new Error("Update package is missing index.html.");
    }

    await fsp.mkdir(updateRootDirPath, { recursive: true });
    await removeDirectoryIfPresent(targetBuildDirPath);
    await fsp.rename(stagingBuildDirPath, targetBuildDirPath);

    const updatedAt = new Date().toISOString();
    const nextMetadata = {
      buildId: latest.buildId,
      buildRootPath: targetBuildDirPath,
      commitSha: latest.commitSha,
      updatedAt,
      manifestUrl: normalizedManifestUrl,
      clientVersion: latest.clientVersion,
    };
    await writeJsonFile(activeUpdateMetadataPath, nextMetadata);

    return {
      ok: true,
      applied: true,
      alreadyInstalled: false,
      buildId: latest.buildId,
      reloadTriggered: false,
      clientUpdateRequired: latest.requiresClientUpgrade,
      error: null,
    };
  } catch (error) {
    await removeDirectoryIfPresent(stagingBuildDirPath);
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: error instanceof Error ? error.message : "Failed to apply update.",
    };
  }
}

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

ipcMain.handle(updaterGetActiveInfoIpcChannel, () => {
  return toPublicActiveUpdateInfo(readActiveUpdateMetadataSync());
});

ipcMain.handle(updaterApplyIpcChannel, async (_event, payload) => {
  const manifestUrl = isPlainObject(payload)
    ? normalizeNullableString(payload.manifestUrl)
    : null;
  return applyGameUpdateFromManifestUrl(manifestUrl);
});

ipcMain.handle(updaterActivateIpcChannel, async (event) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { activated: false };
  }

  if (!app.isPackaged && devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    return { activated: true };
  }

  const indexHtmlPath = resolveLaunchIndexHtmlPath();
  await mainWindow.loadFile(indexHtmlPath);
  return { activated: true };
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

  const indexHtmlPath = resolveLaunchIndexHtmlPath();
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
