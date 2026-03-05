const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

app.setVersion("0.8.3");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const mimeTypeByExtension = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

let packagedStaticServer = null;

function resolveMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return mimeTypeByExtension[extension] || "application/octet-stream";
}

function resolveRequestedPath(rootDir, requestPathname) {
  const normalizedPath = String(requestPathname || "/").replace(/\\/g, "/");
  const withIndex =
    normalizedPath.endsWith("/") || normalizedPath === ""
      ? `${normalizedPath}index.html`
      : normalizedPath;
  const relativePath = withIndex.replace(/^\/+/, "");
  const fullPath = path.resolve(rootDir, relativePath);
  const normalizedRoot = path.resolve(rootDir);
  if (!fullPath.startsWith(normalizedRoot)) {
    return null;
  }
  return fullPath;
}

async function createPackagedStaticServer(rootDir) {
  const server = http.createServer(async (request, response) => {
    const sendResponse = (statusCode, body, contentType = "text/plain; charset=utf-8") => {
      response.writeHead(statusCode, {
        ...crossOriginIsolationHeaders,
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      response.end(body);
    };

    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const resolvedPath = resolveRequestedPath(rootDir, requestUrl.pathname);
      if (!resolvedPath) {
        sendResponse(403, "Forbidden");
        return;
      }

      let filePath = resolvedPath;
      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
      } catch {
        filePath = path.join(rootDir, "index.html");
      }

      const fileBuffer = await fs.readFile(filePath);
      response.writeHead(200, {
        ...crossOriginIsolationHeaders,
        "Content-Type": resolveMimeType(filePath),
        "Content-Length": String(fileBuffer.byteLength),
        "Cache-Control": "no-store",
      });
      response.end(fileBuffer);
    } catch (error) {
      sendResponse(500, `Internal server error: ${String(error)}`);
    }
  });

  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start packaged static server"));
        return;
      }
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function createMainWindow() {
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
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  if (app.isPackaged) {
    if (!packagedStaticServer) {
      const distPath = path.join(__dirname, "..", "dist");
      packagedStaticServer = await createPackagedStaticServer(distPath);
    }
    await mainWindow.loadURL(packagedStaticServer.origin);
    return;
  }

  const indexHtmlPath = path.join(__dirname, "..", "dist", "index.html");
  await mainWindow.loadFile(indexHtmlPath);
}

function disposePackagedStaticServer() {
  if (!packagedStaticServer) {
    return;
  }
  try {
    packagedStaticServer.server.close();
  } catch {
    // Ignore shutdown errors.
  }
  packagedStaticServer = null;
}

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  disposePackagedStaticServer();
});

app.on("window-all-closed", () => {
  disposePackagedStaticServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
