import { spawnSync } from "node:child_process";
import { defineConfig, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { copyWasm } from "./scripts/wasm/copy-wasm.mjs";
import {
  TILESET_MANIFEST_SOURCE_DIR,
  generateTilesetManifest,
} from "./scripts/tilesets/generate-tileset-manifest.mjs";

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

export default defineConfig({
  plugins: [copyWasmPlugin(), tilesetManifestPlugin(), react()],
  define: {
    "import.meta.env.VITE_NH3D_BUILD_COMMIT_SHA": JSON.stringify(
      resolvedBuildCommitSha,
    ),
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
