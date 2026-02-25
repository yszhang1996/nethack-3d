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

export default defineConfig({
  plugins: [copyWasmPlugin(), tilesetManifestPlugin(), react()],
  base: isGitHubActions ? "/nethack-3d/" : isElectronBuild ? "./" : "/",
  server: {
    allowedHosts: true,
  },
  worker: {
    format: "es",
  },
});
