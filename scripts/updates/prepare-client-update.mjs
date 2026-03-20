import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");
const distDirPath = path.join(projectRoot, "dist");
const outputRootPath = path.join(projectRoot, "build", "client-updates");
const outputLatestPath = path.join(outputRootPath, "latest");
const manifestPath = path.join(outputRootPath, "manifest.json");
const channelConfigPath = path.join(scriptDir, "channel-config.json");
const packageJsonPath = path.join(projectRoot, "package.json");
const historyLimit = 20;
const excludedManifestRelativePaths = new Set([".nojekyll"]);

function parseCliArguments(argv) {
  const options = {
    pendingMessageFilePath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--pending-message-file") {
      const candidate = argv[index + 1];
      if (!candidate) {
        throw new Error("--pending-message-file requires a path argument.");
      }
      options.pendingMessageFilePath = path.resolve(process.cwd(), candidate);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function runGitCommand(args, fallbackValue = "") {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    return fallbackValue;
  }
  return result.stdout.trim();
}

function parseGitBatchBlobOutput(rawOutput, expectedCount) {
  if (!Buffer.isBuffer(rawOutput)) {
    return null;
  }
  const fileBytes = [];
  let offset = 0;
  for (let index = 0; index < expectedCount; index += 1) {
    const headerLineEnd = rawOutput.indexOf(0x0a, offset);
    if (headerLineEnd < 0) {
      return null;
    }
    const header = rawOutput.toString("utf8", offset, headerLineEnd).trim();
    offset = headerLineEnd + 1;
    const [sha = "", type = "", rawSize = ""] = header.split(" ");
    if (!sha || type !== "blob" || !/^\d+$/.test(rawSize)) {
      return null;
    }
    const size = Number.parseInt(rawSize, 10);
    if (!Number.isFinite(size) || size < 0) {
      return null;
    }
    if (offset + size > rawOutput.length) {
      return null;
    }
    fileBytes.push(rawOutput.subarray(offset, offset + size));
    offset += size;
    if (offset >= rawOutput.length || rawOutput[offset] !== 0x0a) {
      return null;
    }
    offset += 1;
  }
  return fileBytes;
}

function readGitCanonicalFileBytesBatch(repoRelativePaths) {
  if (!Array.isArray(repoRelativePaths) || repoRelativePaths.length === 0) {
    return [];
  }
  const hashInput = `${repoRelativePaths.join("\n")}\n`;
  const hashResult = spawnSync("git", ["hash-object", "-w", "--stdin-paths"], {
    cwd: projectRoot,
    input: hashInput,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (hashResult.error || hashResult.status !== 0) {
    return null;
  }
  const blobShas = String(hashResult.stdout || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (blobShas.length !== repoRelativePaths.length) {
    return null;
  }

  const batchInput = Buffer.from(`${blobShas.join("\n")}\n`, "utf8");
  const blobResult = spawnSync("git", ["cat-file", "--batch"], {
    cwd: projectRoot,
    input: batchInput,
    encoding: null,
    shell: false,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (blobResult.error || blobResult.status !== 0) {
    return null;
  }
  return parseGitBatchBlobOutput(blobResult.stdout, blobShas.length);
}

function sanitizeCommitMessage(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function parseCommitLines(lines) {
  return lines
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", authoredAt = "", ...messageParts] = line.split("\t");
      return {
        sha: sha.trim(),
        authoredAt: authoredAt.trim() || null,
        message: sanitizeCommitMessage(messageParts.join("\t")),
      };
    })
    .filter((entry) => entry.message.length > 0);
}

function parseCommitSubjectFromMessageFile(rawMessage) {
  const lines = rawMessage.split(/\r?\n/g);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = sanitizeCommitMessage(trimmed);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

async function readPendingCommitFromMessageFile(filePath) {
  if (!filePath) {
    return null;
  }
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const message = parseCommitSubjectFromMessageFile(raw);
  if (!message) {
    return null;
  }
  return {
    sha: "",
    authoredAt: new Date().toISOString(),
    message,
  };
}

function normalizeHistoryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value;
  const buildId = typeof payload.buildId === "string" ? payload.buildId.trim() : "";
  if (!buildId) {
    return null;
  }

  const rawCommits = Array.isArray(payload.commits) ? payload.commits : [];
  const commits = rawCommits
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const commitPayload = entry;
      const message = sanitizeCommitMessage(commitPayload.message);
      if (!message) {
        return null;
      }
      return {
        sha:
          typeof commitPayload.sha === "string"
            ? commitPayload.sha.trim()
            : "",
        authoredAt:
          typeof commitPayload.authoredAt === "string"
            ? commitPayload.authoredAt.trim() || null
            : null,
        message,
      };
    })
    .filter((entry) => entry !== null);

  return {
    buildId,
    commitSha:
      typeof payload.commitSha === "string"
        ? payload.commitSha.trim() || null
        : null,
    createdAt:
      typeof payload.createdAt === "string"
        ? payload.createdAt.trim() || null
        : null,
    clientVersion:
      typeof payload.clientVersion === "string"
        ? payload.clientVersion.trim() || null
        : null,
    requiresClientUpgrade: payload.requiresClientUpgrade === true,
    clientUpgradeMessage:
      typeof payload.clientUpgradeMessage === "string"
        ? payload.clientUpgradeMessage.trim()
        : "",
    commits,
  };
}

async function ensureDirectoryExists(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, payload) {
  await ensureDirectoryExists(path.dirname(filePath));
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(filePath, raw, "utf8");
}

function findRootRelativeUrlAttributes(indexHtmlRaw) {
  if (typeof indexHtmlRaw !== "string" || !indexHtmlRaw) {
    return [];
  }
  const matches = indexHtmlRaw.match(/\b(?:src|href)=["']\/(?!\/)[^"']+/gi);
  return Array.isArray(matches) ? matches : [];
}

async function assertDistUpdateFilesAreFileSchemeCompatible() {
  const distIndexHtmlPath = path.join(distDirPath, "index.html");
  let indexHtmlRaw = "";
  try {
    indexHtmlRaw = await fs.readFile(distIndexHtmlPath, "utf8");
  } catch {
    throw new Error(
      "dist/index.html is missing. Run npm run build:electron before preparing client update files.",
    );
  }

  const rootRelativeUrlAttributes = findRootRelativeUrlAttributes(indexHtmlRaw);
  if (rootRelativeUrlAttributes.length === 0) {
    return;
  }

  const sampleAttributes = rootRelativeUrlAttributes.slice(0, 3).join(", ");
  throw new Error(
    `dist/index.html contains root-relative URLs (${sampleAttributes}). ` +
      "Run npm run build:electron (or set BUILD_TARGET=electron) before npm run updates:package.",
  );
}

async function collectRelativeFilePaths(rootPath, currentPath = rootPath) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const filePaths = [];
  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await collectRelativeFilePaths(rootPath, entryPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path
      .relative(rootPath, entryPath)
      .replace(/\\/g, "/");
    filePaths.push(relativePath);
  }
  filePaths.sort((left, right) => left.localeCompare(right));
  return filePaths;
}

async function buildFileManifest(buildRootPath) {
  const relativeFilePaths = await collectRelativeFilePaths(buildRootPath);
  const manifestRelativeFilePaths = relativeFilePaths.filter(
    (relativePath) => !excludedManifestRelativePaths.has(relativePath),
  );
  const manifestRepoRelativeFilePaths = manifestRelativeFilePaths.map(
    (relativePath) =>
      path
        .relative(projectRoot, path.join(buildRootPath, relativePath))
        .replace(/\\/g, "/"),
  );
  const canonicalFileBytes = readGitCanonicalFileBytesBatch(
    manifestRepoRelativeFilePaths,
  );
  if (
    !Array.isArray(canonicalFileBytes) ||
    canonicalFileBytes.length !== manifestRelativeFilePaths.length
  ) {
    throw new Error(
      "Unable to read canonical Git bytes for update files. Refusing to generate manifest with non-canonical hashes.",
    );
  }

  const files = [];
  for (let index = 0; index < manifestRelativeFilePaths.length; index += 1) {
    const relativePath = manifestRelativeFilePaths[index];
    const fileBytes = canonicalFileBytes[index];
    const digest = createHash("sha256").update(fileBytes).digest("hex");
    files.push({
      path: relativePath,
      size: null,
      sha256: digest,
    });
  }
  return files;
}

function resolveBuildStateId(files) {
  const hash = createHash("sha256");
  for (const fileEntry of files) {
    hash.update(fileEntry.path);
    hash.update("\0");
    hash.update(fileEntry.sha256);
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 20);
}

async function loadChannelConfig() {
  const payload = await readJsonFile(channelConfigPath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      channel: "stable",
      requireClientUpgrade: false,
      clientUpgradeMessage: "",
    };
  }

  return {
    channel:
      typeof payload.channel === "string" && payload.channel.trim()
        ? payload.channel.trim()
        : "stable",
    requireClientUpgrade: payload.requireClientUpgrade === true,
    clientUpgradeMessage:
      typeof payload.clientUpgradeMessage === "string"
        ? payload.clientUpgradeMessage.trim()
        : "",
  };
}

function resolveCommitRange(previousCommitSha, options = {}) {
  const fallbackToHead = options.fallbackToHead !== false;
  const recentCommitFallback = () =>
    runGitCommand(["log", "-n", "20", "--pretty=format:%H%x09%cI%x09%s"], "");
  const hasCommit = (commitSha) =>
    runGitCommand(["cat-file", "-e", `${commitSha}^{commit}`], "__missing__") !==
    "__missing__";
  const isAncestor = (ancestorSha) =>
    runGitCommand(
      ["merge-base", "--is-ancestor", ancestorSha, "HEAD"],
      "__not_ancestor__",
    ) !== "__not_ancestor__";

  if (!previousCommitSha) {
    return recentCommitFallback();
  }
  if (!hasCommit(previousCommitSha)) {
    return recentCommitFallback();
  }
  const rangeOutput = runGitCommand(
    ["log", "--pretty=format:%H%x09%cI%x09%s", `${previousCommitSha}..HEAD`],
    "",
  );
  if (rangeOutput.trim().length > 0) {
    return rangeOutput;
  }
  if (isAncestor(previousCommitSha)) {
    return "";
  }
  if (!fallbackToHead) {
    return recentCommitFallback();
  }
  return recentCommitFallback();
}

async function main() {
  const cliOptions = parseCliArguments(process.argv.slice(2));
  const distStats = await fs.stat(distDirPath).catch(() => null);
  if (!distStats || !distStats.isDirectory()) {
    throw new Error(
      "dist/ is missing. Run npm run build before preparing client update files.",
    );
  }
  await assertDistUpdateFilesAreFileSchemeCompatible();

  const packageJson = await readJsonFile(packageJsonPath);
  const clientVersion =
    packageJson && typeof packageJson.version === "string"
      ? packageJson.version.trim()
      : null;

  const existingManifest = await readJsonFile(manifestPath);
  const existingLatest =
    existingManifest &&
    typeof existingManifest === "object" &&
    !Array.isArray(existingManifest) &&
    existingManifest.latest &&
    typeof existingManifest.latest === "object" &&
    !Array.isArray(existingManifest.latest)
      ? existingManifest.latest
      : null;

  const previousCommitSha =
    existingLatest && typeof existingLatest.commitSha === "string"
      ? existingLatest.commitSha.trim() || null
      : null;
  const channelConfig = await loadChannelConfig();
  const fullCommitSha = runGitCommand(["rev-parse", "HEAD"], "") || null;
  const pendingCommit = await readPendingCommitFromMessageFile(
    cliOptions.pendingMessageFilePath,
  );
  const commitLines = resolveCommitRange(previousCommitSha, {
    fallbackToHead: pendingCommit === null,
  });
  const commitsFromGit = parseCommitLines(commitLines);
  const commits =
    pendingCommit === null
      ? commitsFromGit
      : [pendingCommit, ...commitsFromGit];

  await fs.rm(outputLatestPath, { recursive: true, force: true });
  await ensureDirectoryExists(outputRootPath);
  await fs.cp(distDirPath, outputLatestPath, {
    recursive: true,
    force: true,
  });

  const files = await buildFileManifest(outputLatestPath);
  const createdAt = new Date().toISOString();
  const buildId = resolveBuildStateId(files);

  const latestEntry = {
    buildId,
    commitSha: fullCommitSha,
    createdAt,
    clientVersion,
    requiresClientUpgrade: channelConfig.requireClientUpgrade,
    clientUpgradeMessage: channelConfig.clientUpgradeMessage,
    commits,
    filesBasePath: "latest",
    files,
  };

  const existingHistoryRaw =
    existingManifest &&
    typeof existingManifest === "object" &&
    !Array.isArray(existingManifest) &&
    Array.isArray(existingManifest.history)
      ? existingManifest.history
      : [];
  const existingHistory = existingHistoryRaw
    .map((entry) => normalizeHistoryEntry(entry))
    .filter((entry) => entry !== null && entry.buildId !== buildId);

  const nextHistory = [
    normalizeHistoryEntry(latestEntry),
    ...existingHistory,
  ]
    .filter((entry) => entry !== null)
    .slice(0, historyLimit);

  const nextManifest = {
    manifestVersion: 1,
    channel: channelConfig.channel,
    generatedAt: createdAt,
    latest: latestEntry,
    history: nextHistory,
  };

  await writeJsonFile(manifestPath, nextManifest);

  console.log(`Prepared client update state: ${buildId}`);
  console.log(`Manifest: ${path.relative(projectRoot, manifestPath)}`);
  console.log(
    `Files in rolling payload: ${files.length} (client update required: ${channelConfig.requireClientUpgrade})`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to prepare client update.",
  );
  process.exit(1);
});
