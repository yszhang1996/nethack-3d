import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");

function runGit(args) {
  return spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
}

function main() {
  const preCommitHookPath = path.join(projectRoot, ".githooks", "pre-commit");
  if (fs.existsSync(preCommitHookPath)) {
    try {
      fs.chmodSync(preCommitHookPath, 0o755);
    } catch {
      // Ignore chmod failures on filesystems that do not support POSIX mode bits.
    }
  }

  const isInsideGitResult = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (isInsideGitResult.status !== 0) {
    return;
  }

  const setHooksPathResult = runGit(["config", "core.hooksPath", ".githooks"]);
  if (setHooksPathResult.status !== 0) {
    const errorMessage =
      setHooksPathResult.stderr?.trim() ||
      setHooksPathResult.stdout?.trim() ||
      "Failed to set git hooks path.";
    throw new Error(errorMessage);
  }
}

try {
  main();
} catch (error) {
  console.warn(
    error instanceof Error ? error.message : "Failed to configure git hooks.",
  );
}
