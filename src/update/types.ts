export type Nh3dUpdateCommit = {
  sha: string;
  message: string;
  authoredAt: string | null;
};

export type Nh3dUpdateFileEntry = {
  path: string;
  size: number | null;
  sha256: string | null;
  url: string | null;
};

export type Nh3dUpdateHistoryEntry = {
  buildId: string;
  commitSha: string | null;
  createdAt: string | null;
  clientVersion: string | null;
  requiresClientUpgrade: boolean;
  clientUpgradeMessage: string;
  commits: Nh3dUpdateCommit[];
};

export type Nh3dUpdateLatestEntry = Nh3dUpdateHistoryEntry & {
  filesBasePath: string;
  files: Nh3dUpdateFileEntry[];
};

export type Nh3dUpdateManifest = {
  manifestVersion: number;
  channel: string;
  generatedAt: string | null;
  latest: Nh3dUpdateLatestEntry | null;
  history: Nh3dUpdateHistoryEntry[];
};

export type Nh3dActiveBuildInfo = {
  buildId: string | null;
  commitSha: string | null;
  updatedAt: string | null;
  hostWarningMessage: string | null;
};

export type Nh3dClientUpdateCheckResult = {
  supported: boolean;
  manifestUrl: string | null;
  localBuildId: string | null;
  latestBuildId: string | null;
  hasUpdate: boolean;
  pendingCount: number;
  pendingCommits: Nh3dUpdateCommit[];
  clientUpdateRequired: boolean;
  clientUpdateMessage: string;
  hostWarningMessage: string | null;
  error: string | null;
};

export type Nh3dClientUpdateApplyResult = {
  ok: boolean;
  applied: boolean;
  alreadyInstalled: boolean;
  canceled: boolean;
  buildId: string | null;
  reloadTriggered: boolean;
  clientUpdateRequired: boolean;
  error: string | null;
};

export type Nh3dClientUpdateCancelResult = {
  ok: boolean;
  canceled: boolean;
  error: string | null;
};

export type Nh3dClientUpdateProgressStatus =
  | "info"
  | "success"
  | "warning"
  | "error";

export type Nh3dClientUpdateProgressEvent = {
  at: string | null;
  phase: string;
  status: Nh3dClientUpdateProgressStatus;
  message: string;
  detail: string | null;
  progressPercent: number | null;
  fileIndex: number | null;
  fileCount: number | null;
  filePath: string | null;
};
