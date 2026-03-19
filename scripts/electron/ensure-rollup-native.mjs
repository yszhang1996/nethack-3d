import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import process from "node:process";

const require = createRequire(import.meta.url);

function getLinuxLibcKind() {
  try {
    const report = process.report?.getReport?.();
    if (report?.header?.glibcVersionRuntime) {
      return "gnu";
    }
  } catch {
    // Ignore detection issues and fallback to musl for non-glibc environments.
  }
  return "musl";
}

function resolveRollupNativePackage() {
  if (process.platform === "win32") {
    if (process.arch === "x64") return "@rollup/rollup-win32-x64-msvc";
    if (process.arch === "arm64") return "@rollup/rollup-win32-arm64-msvc";
    if (process.arch === "ia32") return "@rollup/rollup-win32-ia32-msvc";
    return null;
  }

  if (process.platform === "linux") {
    const libc = getLinuxLibcKind();
    if (process.arch === "x64") {
      return libc === "gnu"
        ? "@rollup/rollup-linux-x64-gnu"
        : "@rollup/rollup-linux-x64-musl";
    }
    if (process.arch === "arm64") {
      return libc === "gnu"
        ? "@rollup/rollup-linux-arm64-gnu"
        : "@rollup/rollup-linux-arm64-musl";
    }
    if (process.arch === "arm") {
      return libc === "gnu"
        ? "@rollup/rollup-linux-arm-gnueabihf"
        : "@rollup/rollup-linux-arm-musleabihf";
    }
    return null;
  }

  if (process.platform === "darwin") {
    if (process.arch === "x64") return "@rollup/rollup-darwin-x64";
    if (process.arch === "arm64") return "@rollup/rollup-darwin-arm64";
    return null;
  }

  return null;
}

function hasPackage(packageName) {
  try {
    require.resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function installPackage(packageName) {
  const installArgs = [
    "install",
    "--no-save",
    "--package-lock=false",
    packageName,
  ];
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...installArgs], {
        stdio: "inherit",
        shell: false,
      })
    : spawnSync("npm", installArgs, {
        stdio: "inherit",
        shell: process.platform === "win32",
      });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

const nativePackage = resolveRollupNativePackage();
if (!nativePackage) {
  console.log(
    `Skipping Rollup native optional dependency check for unsupported platform: ${process.platform}/${process.arch}`,
  );
  process.exit(0);
}

if (hasPackage(nativePackage)) {
  console.log(`Rollup native dependency present: ${nativePackage}`);
  process.exit(0);
}

console.log(`Installing missing Rollup native dependency: ${nativePackage}`);
installPackage(nativePackage);
