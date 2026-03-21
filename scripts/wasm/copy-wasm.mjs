import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const targets = [
  {
    id: "wasm-367",
    packageName: "@neth4ck/wasm-367",
    packageJsDest: resolve(
      PROJECT_ROOT,
      "node_modules/@neth4ck/wasm-367/build/nethack.js",
    ),
    packageWasmDest: resolve(
      PROJECT_ROOT,
      "node_modules/@neth4ck/wasm-367/build/nethack.wasm",
    ),
    publicJsDest: resolve(PROJECT_ROOT, "public/nethack-367.js"),
    publicWasmDest: resolve(PROJECT_ROOT, "public/nethack-367.wasm"),
    overrideBuildDirEnvVar: "NH3D_WASM_367_OVERRIDE_BUILD_DIR",
  },
  {
    id: "wasm-37",
    packageName: "@neth4ck/wasm-37",
    packageJsDest: resolve(
      PROJECT_ROOT,
      "node_modules/@neth4ck/wasm-37/build/nethack.js",
    ),
    packageWasmDest: resolve(
      PROJECT_ROOT,
      "node_modules/@neth4ck/wasm-37/build/nethack.wasm",
    ),
    publicJsDest: resolve(PROJECT_ROOT, "public/nethack-37.js"),
    publicWasmDest: resolve(PROJECT_ROOT, "public/nethack-37.wasm"),
    overrideBuildDirEnvVar: null,
  },
];

function getOptionalOverrideBuildDir(target) {
  if (!target.overrideBuildDirEnvVar) {
    return "";
  }
  const rawValue = process.env[target.overrideBuildDirEnvVar];
  if (typeof rawValue !== "string") {
    return "";
  }
  const normalized = rawValue.trim();
  return normalized ? resolve(normalized) : "";
}

function ensureFileExists(filePath, message) {
  if (!existsSync(filePath)) {
    throw new Error(message);
  }
}

function hasCheckedInPublicRuntimeOverride(target) {
  return Boolean(
    target.publicJsDest &&
      existsSync(target.publicJsDest) &&
      existsSync(target.publicWasmDest),
  );
}

function getViteOptimizedDepBaseName(packageName) {
  return packageName.replace("/", "_");
}

function purgeViteOptimizedDepCache(target) {
  const viteCacheDir = resolve(PROJECT_ROOT, "node_modules/.vite");
  if (!existsSync(viteCacheDir)) {
    return;
  }

  const optimizedDepBaseName = getViteOptimizedDepBaseName(target.packageName);
  const candidateDirs = [resolve(viteCacheDir, "deps")];

  for (const entry of readdirSync(viteCacheDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("deps_temp_")) {
      candidateDirs.push(resolve(viteCacheDir, entry.name));
    }
  }

  for (const dirPath of candidateDirs) {
    for (const extension of [".js", ".js.map"]) {
      const filePath = resolve(dirPath, `${optimizedDepBaseName}${extension}`);
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    }
  }
}

function copyTargetToPublicRuntimeOverride(target) {
  const overrideBuildDir = getOptionalOverrideBuildDir(target);
  const sourceJsPath = overrideBuildDir
    ? resolve(overrideBuildDir, "nethack.js")
    : target.packageJsDest;
  const sourceWasmPath = overrideBuildDir
    ? resolve(overrideBuildDir, "nethack.wasm")
    : target.packageWasmDest;

  ensureFileExists(
    sourceJsPath,
    `${target.packageName} JS build not found at ${sourceJsPath}`,
  );
  ensureFileExists(
    sourceWasmPath,
    `${target.packageName} wasm build not found at ${sourceWasmPath}`,
  );

  copyFileSync(sourceJsPath, target.publicJsDest);
  copyFileSync(sourceWasmPath, target.publicWasmDest);
}

export function copyWasm() {
  mkdirSync(resolve(PROJECT_ROOT, "public"), { recursive: true });
  for (const target of targets) {
    const overrideBuildDir = getOptionalOverrideBuildDir(target);
    const useCheckedInPublicRuntimeOverride =
      hasCheckedInPublicRuntimeOverride(target);
    const sourceJsPath = overrideBuildDir
      ? resolve(overrideBuildDir, "nethack.js")
      : target.packageJsDest;
    const sourceWasmPath = overrideBuildDir
      ? resolve(overrideBuildDir, "nethack.wasm")
      : target.packageWasmDest;

    ensureFileExists(
      sourceWasmPath,
      overrideBuildDir
        ? `${target.packageName} override wasm not found at ${sourceWasmPath}`
        : `${target.packageName} build not found -- run npm install first`,
    );
    ensureFileExists(
      sourceJsPath,
      overrideBuildDir
        ? `${target.packageName} override JS not found at ${sourceJsPath}`
        : `${target.packageName} JS build not found -- run npm install first`,
    );

    if (overrideBuildDir) {
      // The runtime factory is imported from node_modules, but the wasm binary is
      // loaded from public/. Copy both override artifacts into the installed
      // package build dir first so dev/build/glyph tooling all consume the same
      // in-progress runtime bits from the forked wasm package. Also remove any
      // stale Vite optimized-dependency wrappers for this package so the next
      // dev server restart imports the swapped-in JS instead of a cached copy.
      copyFileSync(sourceJsPath, target.packageJsDest);
      copyFileSync(sourceWasmPath, target.packageWasmDest);
      purgeViteOptimizedDepCache(target);
    }

    if (useCheckedInPublicRuntimeOverride) {
      // A checked-in public runtime pair is the deployable source of truth while
      // we temporarily carry a forked wasm package build. Leave it untouched so
      // CI/builds do not silently revert to the published package artifacts.
      continue;
    }

    copyFileSync(target.packageWasmDest, target.publicWasmDest);
  }
}

export function copyPublicRuntimeOverrides(targetIds = []) {
  mkdirSync(resolve(PROJECT_ROOT, "public"), { recursive: true });
  const requestedIds =
    targetIds.length > 0 ? new Set(targetIds) : new Set(targets.map((t) => t.id));
  for (const target of targets) {
    if (!requestedIds.has(target.id)) {
      continue;
    }
    copyTargetToPublicRuntimeOverride(target);
  }
}

function getRequestedPublicRuntimeOverrideTargetIds(argv) {
  const ids = [];
  for (const arg of argv) {
    const prefix = "--public-runtime-override=";
    if (arg.startsWith(prefix)) {
      const targetId = arg.slice(prefix.length).trim();
      if (targetId) {
        ids.push(targetId);
      }
    }
  }
  return ids;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targetIds = getRequestedPublicRuntimeOverrideTargetIds(process.argv.slice(2));
  if (targetIds.length > 0) {
    copyPublicRuntimeOverrides(targetIds);
  } else {
    copyWasm();
  }
}
