import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { copyWasm } from "./scripts/wasm/copy-wasm.mjs";
import {
  TILESET_MANIFEST_SOURCE_DIR,
  generateTilesetManifest,
} from "./scripts/tilesets/generate-tileset-manifest.mjs";

function resolveInstalledPackageVersion(packageName: string): string {
  try {
    const packageJsonPath = path.join(
      process.cwd(),
      "node_modules",
      packageName,
      "package.json",
    );
    const payload = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof payload.version === "string" && payload.version.trim()
      ? payload.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

function resolveRuntimeBuildJsPath(
  packageName: string,
  relativeBuildPath: string,
  publicOverrideFilename: string,
): string {
  const publicOverridePath = path.join(
    process.cwd(),
    "public",
    publicOverrideFilename,
  );
  if (existsSync(publicOverridePath)) {
    return publicOverridePath;
  }
  return path.join(
    process.cwd(),
    "node_modules",
    packageName,
    relativeBuildPath,
  );
}

function buildFileContains(filePath: string, snippet: string): boolean {
  try {
    return readFileSync(filePath, "utf8").includes(snippet);
  } catch {
    return false;
  }
}

function copyWasmPlugin() {
  return {
    name: "copy-nethack-wasm",
    buildStart() {
      copyWasm();
    },
  };
}

function tilesetManifestPlugin() {
  const watchedPath = TILESET_MANIFEST_SOURCE_DIR.replace(/\\/g, "/");
  const isTilesetAssetPath = (path: string): boolean => {
    const normalizedPath = path.replace(/\\/g, "/");
    return (
      normalizedPath.startsWith(watchedPath) &&
      /\.(png|bmp|gif|jpe?g|webp)$/i.test(normalizedPath)
    );
  };

  const regenerate = () => {
    generateTilesetManifest();
  };

  return {
    name: "generate-tileset-manifest",
    buildStart() {
      regenerate();
    },
    configureServer(server: ViteDevServer) {
      regenerate();
      server.watcher.add(TILESET_MANIFEST_SOURCE_DIR);
      const handleTilesetFileEvent = (path: string) => {
        if (!isTilesetAssetPath(path)) {
          return;
        }
        regenerate();
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", handleTilesetFileEvent);
      server.watcher.on("unlink", handleTilesetFileEvent);
      server.watcher.on("change", handleTilesetFileEvent);
    },
  };
}

const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const isElectronBuild = process.env.BUILD_TARGET === "electron";
const enableCrossOriginIsolation =
  process.env.NH3D_ENABLE_CROSS_ORIGIN_ISOLATION === "true";
const wasm367RuntimeBuildJsPath = resolveRuntimeBuildJsPath(
  "@neth4ck/wasm-367",
  path.join("build", "nethack.js"),
  "nethack-367.js",
);
const wasm37RuntimeBuildJsPath = resolveRuntimeBuildJsPath(
  "@neth4ck/wasm-37",
  path.join("build", "nethack.js"),
  "nethack-37.js",
);
const wasm367UsesPublicRuntimeOverride = wasm367RuntimeBuildJsPath.endsWith(
  `${path.sep}public${path.sep}nethack-367.js`,
);
const wasm37UsesPublicRuntimeOverride = wasm37RuntimeBuildJsPath.endsWith(
  `${path.sep}public${path.sep}nethack-37.js`,
);
const wasm367CompatTag = `wasm-367-${resolveInstalledPackageVersion("@neth4ck/wasm-367")}`;
const wasm37CompatTag = `wasm-37-${resolveInstalledPackageVersion("@neth4ck/wasm-37")}`;
const wasm367HasRecoverSavefile = buildFileContains(
  wasm367RuntimeBuildJsPath,
  'Module["_recover_savefile"]',
);
// The low-level recover_savefile() export alone is not sufficient for the web
// client. A usable browser-side autosave resume path also needs a dedicated
// bridge that can prepare lock state before libnhmain reaches unixunix.c/getlock().
const wasm367HasCheckpointResumeBridge = buildFileContains(
  wasm367RuntimeBuildJsPath,
  'Module["_resume_checkpoint_save"]',
);
const resolvedBuildCommitSha = (() => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
})();
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const bundledClientUpdateState = (() => {
  const manifestPath = path.join(
    process.cwd(),
    "build",
    "client-updates",
    "manifest.json",
  );
  try {
    const payload = JSON.parse(readFileSync(manifestPath, "utf8"));
    const latest =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { latest?: unknown }).latest
        : null;
    if (!latest || typeof latest !== "object" || Array.isArray(latest)) {
      return {
        buildId: "",
        commitSha: "",
      };
    }
    const latestPayload = latest as Record<string, unknown>;
    return {
      buildId:
        typeof latestPayload.buildId === "string"
          ? latestPayload.buildId.trim()
          : "",
      commitSha:
        typeof latestPayload.commitSha === "string"
          ? latestPayload.commitSha.trim()
          : "",
    };
  } catch {
    return {
      buildId: "",
      commitSha: "",
    };
  }
})();

export default defineConfig({
  plugins: [copyWasmPlugin(), tilesetManifestPlugin(), react()],
  optimizeDeps: {
    // These wasm packages are intentionally replaceable with in-progress local
    // fork builds. Avoid Vite's prebundle cache so dev always loads the current
    // package JS instead of a stale optimized snapshot.
    exclude: ["@neth4ck/wasm-367", "@neth4ck/wasm-37"],
  },
  define: {
    "import.meta.env.VITE_NH3D_BUILD_COMMIT_SHA": JSON.stringify(
      resolvedBuildCommitSha,
    ),
    "import.meta.env.VITE_NH3D_BUNDLED_UPDATE_BUILD_ID": JSON.stringify(
      bundledClientUpdateState.buildId,
    ),
    "import.meta.env.VITE_NH3D_BUNDLED_UPDATE_COMMIT_SHA": JSON.stringify(
      bundledClientUpdateState.commitSha,
    ),
    "import.meta.env.VITE_NH3D_WASM_367_COMPAT_TAG":
      JSON.stringify(wasm367CompatTag),
    "import.meta.env.VITE_NH3D_WASM_367_USE_PUBLIC_RUNTIME_OVERRIDE":
      JSON.stringify(wasm367UsesPublicRuntimeOverride),
    "import.meta.env.VITE_NH3D_WASM_367_HAS_RECOVER_SAVEFILE": JSON.stringify(
      wasm367HasRecoverSavefile,
    ),
    "import.meta.env.VITE_NH3D_WASM_367_HAS_CHECKPOINT_RESUME_BRIDGE":
      JSON.stringify(wasm367HasCheckpointResumeBridge),
    "import.meta.env.VITE_NH3D_WASM_37_COMPAT_TAG":
      JSON.stringify(wasm37CompatTag),
    // "import.meta.env.VITE_NH3D_WASM_37_USE_PUBLIC_RUNTIME_OVERRIDE":
    //   JSON.stringify(wasm37UsesPublicRuntimeOverride),
  },
  base: isGitHubActions ? "/nethack-3d/" : isElectronBuild ? "./" : "/",
  server: {
    allowedHosts: true,
    ...(enableCrossOriginIsolation
      ? { headers: crossOriginIsolationHeaders }
      : {}),
  },
  ...(enableCrossOriginIsolation
    ? {
        preview: {
          headers: crossOriginIsolationHeaders,
        },
      }
    : {}),
  worker: {
    format: "es",
  },
});
