import { spawnSync } from "node:child_process";
import process from "node:process";

const isDryRun = process.env.NH3D_APPIMAGE_DRY_RUN === "1";
const stageLinuxRuntimeDepsCommand = [
  "mkdir -p build/linux-libs",
  "if [ -f /lib/x86_64-linux-gnu/libcups.so.2 ]; then cp -f /lib/x86_64-linux-gnu/libcups.so.2 build/linux-libs/libcups.so.2; " +
    "elif [ -f /usr/lib/x86_64-linux-gnu/libcups.so.2 ]; then cp -f /usr/lib/x86_64-linux-gnu/libcups.so.2 build/linux-libs/libcups.so.2; " +
    "else echo 'Missing libcups.so.2 on this Linux environment.' >&2; exit 1; fi",
].join(" && ");

function runOrExit(command, args) {
  if (isDryRun) {
    console.log(`[dry-run] ${command} ${args.join(" ")}`);
    return;
  }

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    const message = result.error.code === "ENOENT"
      ? `Required command not found: ${command}`
      : result.error.message;
    console.error(message);
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function bashQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveWslShell() {
  const result = spawnSync(
    "wsl",
    ["sh", "-lc", "getent passwd \"$USER\" | cut -d: -f7"],
    { encoding: "utf8", shell: false },
  );

  if (result.error || result.status !== 0) {
    return "bash";
  }

  const shellPath = result.stdout.trim();
  return shellPath || "bash";
}

function runNative() {
  console.log("Using native Linux/macOS AppImage build flow.");
  if (process.platform === "linux") {
    runOrExit("bash", ["-lc", stageLinuxRuntimeDepsCommand]);
  }
  runOrExit("npm", ["run", "build:electron"]);
  runOrExit("npx", ["electron-builder", "--linux", "AppImage", "--x64"]);
}

function runViaWsl() {
  const windowsCwd = process.cwd().replace(/\\/g, "/");
  let wslCwd = "";

  const wslPathResult = spawnSync("wsl", ["wslpath", "-a", windowsCwd], {
    encoding: "utf8",
    shell: false,
  });

  if (!wslPathResult.error && wslPathResult.status === 0) {
    wslCwd = wslPathResult.stdout.trim();
  } else {
    const drivePathMatch = windowsCwd.match(/^([A-Za-z]):\/(.*)$/);
    if (drivePathMatch) {
      const driveLetter = drivePathMatch[1].toLowerCase();
      const pathRemainder = drivePathMatch[2];
      wslCwd = `/mnt/${driveLetter}/${pathRemainder}`;
    } else {
      console.error(
        "Failed to resolve the current path in WSL. Install and initialize a WSL distribution first.",
      );
      if (wslPathResult.stderr) {
        console.error(wslPathResult.stderr.trim());
      }
      process.exit(1);
    }
  }

  const wslShell = resolveWslShell();
  const wslInstallOptionalDepsCommand =
    `cd ${bashQuote(wslCwd)} && npm install --include=optional --no-audit --no-fund`;
  const wslStageLinuxRuntimeDepsCommand =
    `cd ${bashQuote(wslCwd)} && ${stageLinuxRuntimeDepsCommand}`;
  const wslRollupOptionalDepCheckCommand =
    `cd ${bashQuote(wslCwd)} && [ -f node_modules/@rollup/rollup-linux-x64-gnu/package.json ]`;
  const wslCommand =
    `cd ${bashQuote(wslCwd)} && npm run build:electron && npx electron-builder --linux AppImage --x64`;

  if (!isDryRun) {
    const wslNodeCheck = spawnSync(
      "wsl",
      [wslShell, "-lic", "command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1"],
      { shell: false },
    );
    if (wslNodeCheck.error || wslNodeCheck.status !== 0) {
      console.error(
        "WSL is available, but node/npm were not found in the non-interactive shell used by this script.",
      );
      console.error(`Ensure your shell init exposes node/npm for \`wsl ${wslShell} -lic\` commands, then rerun.`);
      process.exit(1);
    }

    const wslRollupOptionalDepCheck = spawnSync(
      "wsl",
      [wslShell, "-lic", wslRollupOptionalDepCheckCommand],
      { shell: false },
    );
    if (wslRollupOptionalDepCheck.error || wslRollupOptionalDepCheck.status !== 0) {
      console.log(
        "Linux optional dependencies are missing in node_modules for the WSL build. Installing them in WSL...",
      );
      runOrExit("wsl", [wslShell, "-lic", wslInstallOptionalDepsCommand]);
    }

    runOrExit("wsl", [wslShell, "-lic", wslStageLinuxRuntimeDepsCommand]);
  }

  console.log(`Using WSL AppImage build flow from: ${wslCwd} (shell: ${wslShell})`);
  runOrExit("wsl", [wslShell, "-lic", wslCommand]);
}

if (process.platform === "win32") {
  runViaWsl();
} else {
  runNative();
}
