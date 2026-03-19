import type {
  Nh3dUpdateCommit,
  Nh3dUpdateFileEntry,
  Nh3dUpdateHistoryEntry,
  Nh3dUpdateLatestEntry,
  Nh3dUpdateManifest,
} from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

function parseCommit(value: unknown): Nh3dUpdateCommit | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const message = normalizeString(value.message);
  if (!message) {
    return null;
  }
  return {
    sha: normalizeString(value.sha),
    message,
    authoredAt: normalizeNullableString(value.authoredAt),
  };
}

function parseFileEntry(value: unknown): Nh3dUpdateFileEntry | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const path = normalizeString(value.path).replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.includes("..")) {
    return null;
  }
  return {
    path,
    size: normalizeNumber(value.size),
    sha256: normalizeNullableString(value.sha256),
    url: normalizeNullableString(value.url),
  };
}

function parseHistoryEntry(value: unknown): Nh3dUpdateHistoryEntry | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const buildId = normalizeString(value.buildId);
  if (!buildId) {
    return null;
  }
  const rawCommits = Array.isArray(value.commits) ? value.commits : [];
  const commits = rawCommits
    .map((entry) => parseCommit(entry))
    .filter((entry): entry is Nh3dUpdateCommit => entry !== null);

  return {
    buildId,
    commitSha: normalizeNullableString(value.commitSha),
    createdAt: normalizeNullableString(value.createdAt),
    clientVersion: normalizeNullableString(value.clientVersion),
    requiresClientUpgrade: normalizeBoolean(value.requiresClientUpgrade),
    clientUpgradeMessage: normalizeString(value.clientUpgradeMessage),
    commits,
  };
}

function parseLatestEntry(value: unknown): Nh3dUpdateLatestEntry | null {
  const parsedHistoryEntry = parseHistoryEntry(value);
  if (!parsedHistoryEntry || !isPlainObject(value)) {
    return null;
  }
  const filesBasePath = normalizeString(value.filesBasePath).replace(/\\/g, "/");
  const rawFiles = Array.isArray(value.files) ? value.files : [];
  const files = rawFiles
    .map((entry) => parseFileEntry(entry))
    .filter((entry): entry is Nh3dUpdateFileEntry => entry !== null);

  if (!filesBasePath || filesBasePath.startsWith("/") || filesBasePath.includes("..")) {
    return null;
  }
  if (files.length === 0) {
    return null;
  }
  return {
    ...parsedHistoryEntry,
    filesBasePath,
    files,
  };
}

export function parseNh3dUpdateManifest(payload: unknown): Nh3dUpdateManifest | null {
  if (!isPlainObject(payload)) {
    return null;
  }

  const latest = parseLatestEntry(payload.latest);
  const rawHistory = Array.isArray(payload.history) ? payload.history : [];
  const parsedHistory = rawHistory
    .map((entry) => parseHistoryEntry(entry))
    .filter((entry): entry is Nh3dUpdateHistoryEntry => entry !== null);

  const historyByBuildId = new Map<string, Nh3dUpdateHistoryEntry>();
  for (const entry of parsedHistory) {
    if (!historyByBuildId.has(entry.buildId)) {
      historyByBuildId.set(entry.buildId, entry);
    }
  }

  if (latest && !historyByBuildId.has(latest.buildId)) {
    historyByBuildId.set(latest.buildId, {
      buildId: latest.buildId,
      commitSha: latest.commitSha,
      createdAt: latest.createdAt,
      clientVersion: latest.clientVersion,
      requiresClientUpgrade: latest.requiresClientUpgrade,
      clientUpgradeMessage: latest.clientUpgradeMessage,
      commits: latest.commits,
    });
  }

  const history = Array.from(historyByBuildId.values());
  history.sort((a, b) => {
    const aTime = Date.parse(a.createdAt ?? "");
    const bTime = Date.parse(b.createdAt ?? "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return b.buildId.localeCompare(a.buildId);
  });

  return {
    manifestVersion:
      typeof payload.manifestVersion === "number" &&
      Number.isFinite(payload.manifestVersion)
        ? Math.max(1, Math.trunc(payload.manifestVersion))
        : 1,
    channel: normalizeString(payload.channel) || "stable",
    generatedAt: normalizeNullableString(payload.generatedAt),
    latest,
    history,
  };
}

export function resolveNh3dPendingUpdateCommits(
  manifest: Nh3dUpdateManifest,
  localBuildId: string | null,
): Nh3dUpdateCommit[] {
  const latest = manifest.latest;
  if (!latest) {
    return [];
  }

  if (!localBuildId) {
    return latest.commits;
  }
  if (localBuildId === latest.buildId) {
    return [];
  }

  const historyIndex = manifest.history.findIndex(
    (entry) => entry.buildId === localBuildId,
  );
  if (historyIndex <= 0) {
    return latest.commits;
  }

  const flattened: Nh3dUpdateCommit[] = [];
  for (let index = 0; index < historyIndex; index += 1) {
    flattened.push(...manifest.history[index].commits);
  }
  if (flattened.length > 0) {
    return flattened;
  }
  return latest.commits;
}

export function resolveNh3dPendingUpdateCount(
  hasUpdate: boolean,
  commits: Nh3dUpdateCommit[],
): number {
  if (!hasUpdate) {
    return 0;
  }
  if (commits.length > 0) {
    return commits.length;
  }
  return 1;
}
