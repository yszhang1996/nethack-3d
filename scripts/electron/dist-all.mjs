import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const isParallel = args.has("--parallel");
const isDryRun = args.has("--dry-run");
const npmExecPath = process.env.npm_execpath;
const npmRunner = npmExecPath
  ? {
    command: process.execPath,
    baseArgs: [npmExecPath],
  }
  : {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    baseArgs: [],
  };

function runOrExit(command, commandArgs, extraEnv = {}) {
  const printable = `${command} ${commandArgs.join(" ")}`;
  if (isDryRun) {
    console.log(`[dry-run] ${printable}`);
    return;
  }

  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...extraEnv,
    },
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

function runNpmOrExit(npmArgs, extraEnv = {}) {
  runOrExit(
    npmRunner.command,
    [...npmRunner.baseArgs, ...npmArgs],
    extraEnv,
  );
}

function runParallelJobsOrExit(jobs) {
  if (isDryRun) {
    for (const job of jobs) {
      const cmd = `${job.command} ${job.args.join(" ")}`;
      console.log(`[dry-run] [${job.label}] ${cmd}`);
    }
    return Promise.resolve();
  }

  const childPromises = jobs.map((job) => {
    const child = spawn(job.command, job.args, {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        ...(job.env ?? {}),
      },
    });

    return new Promise((resolve, reject) => {
      child.on("error", (error) => {
        const message = error.code === "ENOENT"
          ? `Required command not found for ${job.label}: ${job.command}`
          : error.message;
        reject(new Error(message));
      });

      child.on("exit", (code) => {
        if (code && code !== 0) {
          reject(new Error(`${job.label} job failed with exit code ${code}`));
          return;
        }
        resolve();
      });
    });
  });

  return Promise.all(childPromises);
}

async function main() {
  console.log("Building Electron web assets once...");
  runNpmOrExit(["run", "build:electron"]);

  const windowsElectronBuilderNpmArgs = [
    ...npmRunner.baseArgs,
    "exec",
    "--",
    "electron-builder",
    "--win",
    "nsis",
    "portable",
    "--x64",
  ];
  const linuxAllTargetsArgs = ["scripts/electron/dist-linux-appimage.mjs"];

  if (isParallel) {
    console.log("Packaging Windows and Linux targets in parallel...");
    await runParallelJobsOrExit([
      {
        label: "windows",
        command: npmRunner.command,
        args: windowsElectronBuilderNpmArgs,
      },
      {
        label: "linux",
        command: "node",
        args: linuxAllTargetsArgs,
        env: { NH3D_SKIP_ELECTRON_BUILD: "1" },
      },
    ]);
  } else {
    console.log("Packaging Windows setup + portable...");
    runOrExit(npmRunner.command, windowsElectronBuilderNpmArgs);
    console.log("Packaging Linux AppImage...");
    runOrExit("node", linuxAllTargetsArgs, { NH3D_SKIP_ELECTRON_BUILD: "1" });
  }

  console.log("Done. Artifacts are in release/.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
