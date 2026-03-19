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
const updaterCancelIpcChannel = "nh3d:updater-cancel";
const updaterExportLogsIpcChannel = "nh3d:updater-export-logs";
const updaterActivateIpcChannel = "nh3d:updater-activate";
const mainWindowStateById = new Map();
const activeUpdateJobBySenderId = new Map();

const updateRootDirPath = path.join(app.getPath("userData"), "game-updates");
const updateCurrentFilesDirPath = path.join(updateRootDirPath, "current");
const updateStagingDirPath = path.join(updateRootDirPath, "staging");
const updateFailureLogsDirPath = path.join(updateRootDirPath, "failure-logs");
const updateLastFailureLogPath = path.join(
  updateRootDirPath,
  "last-update-failure.json",
);
const updateFetchTimeoutMs = 30000;
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

function normalizeErrorForLog(error) {
  if (error instanceof Error) {
    return {
      name: normalizeNullableString(error.name),
      message: normalizeNullableString(error.message),
      stack: normalizeNullableString(error.stack),
      code: normalizeNullableString(error.code),
    };
  }
  return {
    name: null,
    message: normalizeNullableString(String(error ?? "")),
    stack: null,
    code: null,
  };
}

function createUpdateAttemptTrace(manifestUrl) {
  return {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    manifestUrl,
    appVersion: app.getVersion(),
    platform: process.platform,
    versions: {
      node: normalizeNullableString(process.versions?.node ?? process.version),
      electron: normalizeNullableString(process.versions?.electron),
      chrome: normalizeNullableString(process.versions?.chrome),
    },
    events: [],
    calls: [],
  };
}

function appendUpdateTraceEvent(updateTrace, stage, details = null) {
  if (!updateTrace || !normalizeString(stage)) {
    return;
  }
  const entry = {
    at: new Date().toISOString(),
    stage,
  };
  if (details !== null && details !== undefined) {
    entry.details = details;
  }
  updateTrace.events.push(entry);
}

function beginUpdateTraceCall(updateTrace, call) {
  if (!updateTrace || !isPlainObject(call)) {
    return null;
  }
  const startedAt = new Date();
  const entry = {
    index: updateTrace.calls.length + 1,
    type: normalizeString(call.type) || "unknown",
    url: normalizeNullableString(call.url),
    path: normalizeNullableString(call.path),
    expectedSize:
      typeof call.expectedSize === "number" && Number.isFinite(call.expectedSize)
        ? Math.max(0, Math.trunc(call.expectedSize))
        : null,
    expectedSha256: normalizeNullableString(call.expectedSha256),
    startedAt: startedAt.toISOString(),
    completedAt: null,
    durationMs: null,
    outcome: "pending",
    httpStatus: null,
    httpStatusText: null,
    responseContentLength: null,
    bytesReceived: null,
    error: null,
  };
  updateTrace.calls.push(entry);
  return {
    entry,
    startedAtMs: startedAt.getTime(),
  };
}

function completeUpdateTraceCall(traceHandle, patch) {
  if (!traceHandle) {
    return;
  }
  const completedAt = new Date();
  traceHandle.entry.completedAt = completedAt.toISOString();
  traceHandle.entry.durationMs = Math.max(
    0,
    completedAt.getTime() - traceHandle.startedAtMs,
  );
  if (isPlainObject(patch)) {
    for (const [key, value] of Object.entries(patch)) {
      traceHandle.entry[key] = value;
    }
  }
}

function resolveUpdateFailureLogPath(timestampIsoUtc) {
  const safeTimestamp = String(timestampIsoUtc || "")
    .replace(/[:.]/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const suffix = safeTimestamp || String(Date.now());
  return path.join(updateFailureLogsDirPath, `update-failure-${suffix}.json`);
}

function resolveUpdateExportLogPath(timestampIsoUtc) {
  const safeTimestamp = String(timestampIsoUtc || "")
    .replace(/[:.]/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const suffix = safeTimestamp || String(Date.now());
  return path.join(updateFailureLogsDirPath, `update-export-${suffix}.json`);
}

async function persistUpdateFailureTrace(updateTrace, error) {
  if (!updateTrace) {
    return null;
  }
  const failedAt = new Date().toISOString();
  const payload = {
    ...updateTrace,
    failedAt,
    error: normalizeErrorForLog(error),
  };
  const logPath = resolveUpdateFailureLogPath(failedAt);
  try {
    await writeJsonFile(logPath, payload);
    await writeJsonFile(updateLastFailureLogPath, payload);
    return logPath;
  } catch (writeError) {
    console.warn("Failed to persist update failure trace:", writeError);
    return null;
  }
}

async function exportCurrentUpdateTraceSnapshot(requestedBySenderId = null) {
  const exportedAt = new Date().toISOString();
  const activeJobs = [];
  for (const [senderId, job] of activeUpdateJobBySenderId.entries()) {
    const activeTrace = isPlainObject(job?.updateTrace)
      ? job.updateTrace
      : null;
    if (activeTrace) {
      appendUpdateTraceEvent(activeTrace, "manual-export", {
        requestedBySenderId,
      });
    }
    activeJobs.push({
      senderId,
      isAborted: job?.abortController?.signal?.aborted === true,
      trace: activeTrace,
    });
  }

  const snapshotPayload = {
    schemaVersion: 1,
    exportedAt,
    requestedBySenderId,
    activeJobCount: activeJobs.length,
    activeJobs,
    lastFailure: readJsonFileSync(updateLastFailureLogPath),
  };

  const logPath = resolveUpdateExportLogPath(exportedAt);
  await writeJsonFile(logPath, snapshotPayload);
  return {
    ok: true,
    path: logPath,
    error: null,
  };
}

function createUpdateAbortError() {
  const error = new Error("Update download canceled.");
  error.name = "AbortError";
  return error;
}

function resolveUpdateFetchSignal(cancellationSignal) {
  if (
    typeof AbortSignal !== "function" ||
    typeof AbortSignal.timeout !== "function"
  ) {
    return cancellationSignal ?? undefined;
  }
  const timeoutSignal = AbortSignal.timeout(updateFetchTimeoutMs);
  if (cancellationSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([cancellationSignal, timeoutSignal]);
  }
  return cancellationSignal ?? timeoutSignal;
}

function resolveUpdateFailureMessage(error) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return "Update download timed out. Check your connection and try again.";
    }
    const normalizedMessage = normalizeString(error.message);
    if (normalizedMessage) {
      return normalizedMessage;
    }
  }
  return "Failed to apply update.";
}

function throwIfUpdateCanceled(cancellationSignal) {
  if (!cancellationSignal?.aborted) {
    return;
  }
  const cancellationReason = cancellationSignal.reason;
  if (cancellationReason instanceof Error) {
    throw cancellationReason;
  }
  throw createUpdateAbortError();
}

async function fetchJsonFromUrl(
  url,
  cancellationSignal = null,
  updateTrace = null,
) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch API is not available in the Electron host.");
  }
  const traceCall = beginUpdateTraceCall(updateTrace, {
    type: "manifest-fetch",
    url,
  });
  throwIfUpdateCanceled(cancellationSignal);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: resolveUpdateFetchSignal(cancellationSignal),
    });
    if (traceCall) {
      traceCall.entry.httpStatus = response.status;
      traceCall.entry.httpStatusText = response.statusText;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch update manifest (${response.status} ${response.statusText}).`,
      );
    }
    throwIfUpdateCanceled(cancellationSignal);
    const payload = await response.json();
    completeUpdateTraceCall(traceCall, {
      outcome: "ok",
    });
    return payload;
  } catch (error) {
    const outcome = cancellationSignal?.aborted
      ? "canceled"
      : error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "error";
    completeUpdateTraceCall(traceCall, {
      outcome,
      error: normalizeErrorForLog(error),
    });
    throw error;
  }
}

async function downloadFileWithValidation(
  fileUrl,
  destinationPath,
  expectedSize,
  expectedSha256,
  cancellationSignal = null,
  tracePath = null,
  updateTrace = null,
) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch API is not available in the Electron host.");
  }
  const traceCall = beginUpdateTraceCall(updateTrace, {
    type: "file-download",
    url: fileUrl,
    path: tracePath,
    expectedSize,
    expectedSha256,
  });
  throwIfUpdateCanceled(cancellationSignal);
  try {
    const response = await fetch(fileUrl, {
      cache: "no-store",
      signal: resolveUpdateFetchSignal(cancellationSignal),
    });
    if (traceCall) {
      traceCall.entry.httpStatus = response.status;
      traceCall.entry.httpStatusText = response.statusText;
      const contentLengthValue = response.headers.get("content-length");
      const parsedContentLength =
        typeof contentLengthValue === "string" &&
        /^\d+$/.test(contentLengthValue.trim())
          ? Number.parseInt(contentLengthValue, 10)
          : null;
      traceCall.entry.responseContentLength =
        typeof parsedContentLength === "number" &&
        Number.isFinite(parsedContentLength)
          ? parsedContentLength
          : null;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to download ${fileUrl} (${response.status} ${response.statusText}).`,
      );
    }

    const fileBytes = Buffer.from(await response.arrayBuffer());
    if (traceCall) {
      traceCall.entry.bytesReceived = fileBytes.length;
    }
    throwIfUpdateCanceled(cancellationSignal);
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
    completeUpdateTraceCall(traceCall, {
      outcome: "ok",
    });
  } catch (error) {
    const outcome = cancellationSignal?.aborted
      ? "canceled"
      : error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "error";
    completeUpdateTraceCall(traceCall, {
      outcome,
      error: normalizeErrorForLog(error),
    });
    throw error;
  }
}

async function applyGameUpdateFromManifestUrl(
  manifestUrl,
  cancellationSignal = null,
  updateTraceOverride = null,
) {
  if (!app.isPackaged) {
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      canceled: false,
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
      canceled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: "Update manifest URL is required.",
    };
  }

  const updateTrace =
    updateTraceOverride && isPlainObject(updateTraceOverride)
      ? updateTraceOverride
      : createUpdateAttemptTrace(normalizedManifestUrl);
  appendUpdateTraceEvent(updateTrace, "apply-started");
  const stagingBuildDirPath = path.join(updateStagingDirPath, "current");
  const targetBuildDirPath = updateCurrentFilesDirPath;

  try {
    const parsedManifest = parseUpdateManifest(
      await fetchJsonFromUrl(
        normalizedManifestUrl,
        cancellationSignal,
        updateTrace,
      ),
    );
    if (!parsedManifest?.latest) {
      throw new Error("Update manifest payload is invalid.");
    }
    appendUpdateTraceEvent(updateTrace, "manifest-parsed", {
      buildId: parsedManifest.latest.buildId,
      fileCount: parsedManifest.latest.files.length,
    });

    const latest = parsedManifest.latest;
    const activeMetadata = readActiveUpdateMetadataSync();
    if (activeMetadata?.buildId === latest.buildId) {
      appendUpdateTraceEvent(updateTrace, "already-installed", {
        buildId: latest.buildId,
      });
      return {
        ok: true,
        applied: false,
        alreadyInstalled: true,
        canceled: false,
        buildId: latest.buildId,
        reloadTriggered: false,
        clientUpdateRequired: latest.requiresClientUpgrade,
        error: null,
      };
    }

    appendUpdateTraceEvent(updateTrace, "prepare-staging");
    await removeDirectoryIfPresent(stagingBuildDirPath);
    await fsp.mkdir(stagingBuildDirPath, { recursive: true });

    throwIfUpdateCanceled(cancellationSignal);
    for (const fileEntry of latest.files) {
      throwIfUpdateCanceled(cancellationSignal);
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
        cancellationSignal,
        relativePath,
        updateTrace,
      );
    }

    throwIfUpdateCanceled(cancellationSignal);
    const stagedIndexHtmlPath = path.join(stagingBuildDirPath, "index.html");
    if (!fs.existsSync(stagedIndexHtmlPath)) {
      throw new Error("Update package is missing index.html.");
    }

    appendUpdateTraceEvent(updateTrace, "activate-staged-build");
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
    appendUpdateTraceEvent(updateTrace, "metadata-written", {
      buildId: latest.buildId,
      updatedAt,
    });

    return {
      ok: true,
      applied: true,
      alreadyInstalled: false,
      canceled: false,
      buildId: latest.buildId,
      reloadTriggered: false,
      clientUpdateRequired: latest.requiresClientUpgrade,
      error: null,
    };
  } catch (error) {
    appendUpdateTraceEvent(updateTrace, "apply-failed", {
      error: normalizeErrorForLog(error),
    });
    await removeDirectoryIfPresent(stagingBuildDirPath);
    if (cancellationSignal?.aborted) {
      return {
        ok: false,
        applied: false,
        alreadyInstalled: false,
        canceled: true,
        buildId: null,
        reloadTriggered: false,
        clientUpdateRequired: false,
        error: "Update download canceled.",
      };
    }
    const failureLogPath = await persistUpdateFailureTrace(updateTrace, error);
    const baseErrorMessage = resolveUpdateFailureMessage(error);
    const errorMessage = failureLogPath
      ? `${baseErrorMessage} Debug log: ${failureLogPath}`
      : baseErrorMessage;
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      canceled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: errorMessage,
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
  if (!state.readyToShow || (!state.appRendered && !state.didFinishLoad)) {
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

ipcMain.handle(updaterApplyIpcChannel, async (event, payload) => {
  const manifestUrl = isPlainObject(payload)
    ? normalizeNullableString(payload.manifestUrl)
    : null;
  const senderId = event.sender.id;
  if (activeUpdateJobBySenderId.has(senderId)) {
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      canceled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: "An update download is already in progress.",
    };
  }

  const abortController = new AbortController();
  const updateTrace = createUpdateAttemptTrace(manifestUrl);
  const activeJob = { abortController, updateTrace };
  activeUpdateJobBySenderId.set(senderId, activeJob);
  const handleSenderDestroyed = () => {
    abortController.abort(createUpdateAbortError());
  };
  event.sender.once("destroyed", handleSenderDestroyed);

  try {
    return await applyGameUpdateFromManifestUrl(
      manifestUrl,
      abortController.signal,
      updateTrace,
    );
  } finally {
    event.sender.removeListener("destroyed", handleSenderDestroyed);
    const existingJob = activeUpdateJobBySenderId.get(senderId);
    if (existingJob === activeJob) {
      activeUpdateJobBySenderId.delete(senderId);
    }
  }
});

ipcMain.handle(updaterCancelIpcChannel, (event) => {
  const activeJob = activeUpdateJobBySenderId.get(event.sender.id);
  if (!activeJob) {
    return {
      ok: true,
      canceled: false,
      error: null,
    };
  }
  activeJob.abortController.abort(createUpdateAbortError());
  return {
    ok: true,
    canceled: true,
    error: null,
  };
});

ipcMain.handle(updaterExportLogsIpcChannel, async (event) => {
  try {
    return await exportCurrentUpdateTraceSnapshot(event.sender.id);
  } catch (error) {
    return {
      ok: false,
      path: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to export updater trace logs.",
    };
  }
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
    didFinishLoad: false,
    shown: false,
  };
  mainWindowStateById.set(mainWindow.id, state);

  mainWindow.once("ready-to-show", () => {
    state.readyToShow = true;
    showMainWindowIfReady(mainWindow, state);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    state.didFinishLoad = true;
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
