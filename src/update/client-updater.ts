import {
  parseNh3dUpdateManifest,
  resolveNh3dPendingUpdateCommits,
  resolveNh3dPendingUpdateCount,
} from "./manifest";
import type {
  Nh3dActiveBuildInfo,
  Nh3dClientUpdateApplyResult,
  Nh3dClientUpdateCancelResult,
  Nh3dClientUpdateCheckResult,
} from "./types";

const fallbackUpdateManifestUrl =
  "https://raw.githubusercontent.com/JamesIV4/nethack-3d/main/build/client-updates/manifest.json";
const manifestFetchTimeoutMs = 20000;

type Nh3dElectronUpdaterBridge = {
  getActiveUpdateInfo?: () => Promise<unknown>;
  applyGameUpdate?: (manifestUrl: string) => Promise<unknown>;
  cancelGameUpdate?: () => Promise<unknown>;
  activateInstalledUpdate?: () => Promise<unknown>;
};

type Nh3dElectronBridge = {
  updater?: Nh3dElectronUpdaterBridge;
};

type Nh3dAndroidBridge = {
  getActiveGameUpdateInfo?: () => string;
  applyGameUpdate?: (manifestUrl: string) => string;
  cancelGameUpdate?: () => string;
};

type Nh3dUpdateWindow = Window & {
  nh3dElectron?: Nh3dElectronBridge;
  nh3dAndroid?: Nh3dAndroidBridge;
};

function resolveManifestUrlOverride(): string {
  const envValue =
    typeof import.meta.env.VITE_NH3D_UPDATE_MANIFEST_URL === "string"
      ? import.meta.env.VITE_NH3D_UPDATE_MANIFEST_URL.trim()
      : "";
  if (!envValue) {
    return fallbackUpdateManifestUrl;
  }
  return envValue;
}

function resolveBundledBuildCommitSha(): string | null {
  const envValue =
    typeof import.meta.env.VITE_NH3D_BUILD_COMMIT_SHA === "string"
      ? import.meta.env.VITE_NH3D_BUILD_COMMIT_SHA.trim()
      : "";
  return envValue.length > 0 ? envValue : null;
}

function resolveBundledUpdateBuildId(): string | null {
  const envValue =
    typeof import.meta.env.VITE_NH3D_BUNDLED_UPDATE_BUILD_ID === "string"
      ? import.meta.env.VITE_NH3D_BUNDLED_UPDATE_BUILD_ID.trim()
      : "";
  return envValue.length > 0 ? envValue : null;
}

function resolveBundledUpdateCommitSha(): string | null {
  const envValue =
    typeof import.meta.env.VITE_NH3D_BUNDLED_UPDATE_COMMIT_SHA === "string"
      ? import.meta.env.VITE_NH3D_BUNDLED_UPDATE_COMMIT_SHA.trim()
      : "";
  return envValue.length > 0 ? envValue : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function parseActiveBuildInfo(value: unknown): Nh3dActiveBuildInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      buildId: null,
      commitSha: null,
      updatedAt: null,
    };
  }
  const payload = value as Record<string, unknown>;
  return {
    buildId: normalizeNullableString(payload.buildId),
    commitSha: normalizeNullableString(payload.commitSha),
    updatedAt:
      normalizeNullableString(payload.updatedAt) ??
      normalizeNullableString(payload.appliedAt),
  };
}

function parseApplyResult(value: unknown): Nh3dClientUpdateApplyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      applied: false,
      alreadyInstalled: false,
      canceled: false,
      buildId: null,
      reloadTriggered: false,
      clientUpdateRequired: false,
      error: "Client update host returned an invalid response.",
    };
  }
  const payload = value as Record<string, unknown>;
  return {
    ok: normalizeBoolean(payload.ok),
    applied: normalizeBoolean(payload.applied),
    alreadyInstalled: normalizeBoolean(payload.alreadyInstalled),
    canceled: normalizeBoolean(payload.canceled),
    buildId: normalizeNullableString(payload.buildId),
    reloadTriggered: normalizeBoolean(payload.reloadTriggered),
    clientUpdateRequired: normalizeBoolean(payload.clientUpdateRequired),
    error: normalizeNullableString(payload.error),
  };
}

function parseCancelResult(value: unknown): Nh3dClientUpdateCancelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      canceled: false,
      error: "Client update host returned an invalid cancel response.",
    };
  }
  const payload = value as Record<string, unknown>;
  return {
    ok: normalizeBoolean(payload.ok),
    canceled: normalizeBoolean(payload.canceled),
    error: normalizeNullableString(payload.error),
  };
}

function getUpdateWindow(): Nh3dUpdateWindow {
  return window as Nh3dUpdateWindow;
}

function resolveElectronUpdaterBridge(): Nh3dElectronUpdaterBridge | null {
  const bridge = getUpdateWindow().nh3dElectron?.updater;
  if (!bridge) {
    return null;
  }
  if (typeof bridge.applyGameUpdate !== "function") {
    return null;
  }
  return bridge;
}

function resolveAndroidBridge(): Nh3dAndroidBridge | null {
  const bridge = getUpdateWindow().nh3dAndroid;
  if (!bridge) {
    return null;
  }
  if (typeof bridge.applyGameUpdate !== "function") {
    return null;
  }
  return bridge;
}

export function supportsNh3dClientUpdates(): boolean {
  if (import.meta.env.DEV) {
    return false;
  }
  return Boolean(resolveElectronUpdaterBridge() || resolveAndroidBridge());
}

export function supportsNh3dClientUpdateCancellation(): boolean {
  if (import.meta.env.DEV) {
    return false;
  }
  const electronBridge = getUpdateWindow().nh3dElectron?.updater;
  if (electronBridge && typeof electronBridge.cancelGameUpdate === "function") {
    return true;
  }
  const androidBridge = getUpdateWindow().nh3dAndroid;
  return Boolean(
    androidBridge && typeof androidBridge.cancelGameUpdate === "function",
  );
}

async function readActiveBuildInfoFromBridge(): Promise<Nh3dActiveBuildInfo> {
  const electronBridge = resolveElectronUpdaterBridge();
  if (
    electronBridge &&
    typeof electronBridge.getActiveUpdateInfo === "function"
  ) {
    try {
      const raw = await electronBridge.getActiveUpdateInfo();
      return parseActiveBuildInfo(raw);
    } catch {
      return parseActiveBuildInfo(null);
    }
  }

  const androidBridge = resolveAndroidBridge();
  if (
    androidBridge &&
    typeof androidBridge.getActiveGameUpdateInfo === "function"
  ) {
    try {
      const raw = androidBridge.getActiveGameUpdateInfo();
      if (typeof raw !== "string" || !raw.trim()) {
        return parseActiveBuildInfo(null);
      }
      return parseActiveBuildInfo(JSON.parse(raw));
    } catch {
      return parseActiveBuildInfo(null);
    }
  }

  return parseActiveBuildInfo(null);
}

async function fetchManifestPayload(manifestUrl: string): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, manifestFetchTimeoutMs);

  try {
    const response = await fetch(manifestUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Update manifest request failed (${response.status} ${response.statusText}).`,
      );
    }
    return response.json();
  } catch (error) {
    if (timedOut) {
      throw new Error("Update manifest request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function checkForNh3dClientUpdates(
  manifestUrlOverride?: string,
): Promise<Nh3dClientUpdateCheckResult> {
  const supported = supportsNh3dClientUpdates();
  const manifestUrl =
    normalizeNullableString(manifestUrlOverride) ??
    resolveManifestUrlOverride();

  if (!supported) {
    return {
      supported: false,
      manifestUrl,
      localBuildId: null,
      latestBuildId: null,
      hasUpdate: false,
      pendingCount: 0,
      pendingCommits: [],
      clientUpdateRequired: false,
      clientUpdateMessage: "",
      error: null,
    };
  }

  try {
    const [activeInfo, rawManifest] = await Promise.all([
      readActiveBuildInfoFromBridge(),
      fetchManifestPayload(manifestUrl),
    ]);
    const manifest = parseNh3dUpdateManifest(rawManifest);
    if (!manifest || !manifest.latest) {
      throw new Error("Update manifest payload is invalid.");
    }

    const localBuildId = activeInfo.buildId;
    const localCommitSha = activeInfo.commitSha;
    const latestBuildId = manifest.latest.buildId;
    const latestCommitSha = manifest.latest.commitSha;
    const bundledBuildCommitSha = resolveBundledBuildCommitSha();
    const bundledUpdateBuildId = resolveBundledUpdateBuildId();
    const bundledUpdateCommitSha = resolveBundledUpdateCommitSha();
    const localBuildMatchesLatest =
      localBuildId !== null && localBuildId === latestBuildId;
    const localCommitMatchesLatest =
      localCommitSha !== null &&
      latestCommitSha !== null &&
      localCommitSha === latestCommitSha;
    const bundledUpdateBuildMatchesLatest =
      !localBuildId &&
      bundledUpdateBuildId !== null &&
      bundledUpdateBuildId === latestBuildId;
    const bundledUpdateCommitMatchesLatest =
      !localBuildId &&
      bundledUpdateCommitSha !== null &&
      latestCommitSha !== null &&
      bundledUpdateCommitSha === latestCommitSha;
    const bundledCommitMatchesLatest =
      !localBuildId &&
      bundledBuildCommitSha !== null &&
      latestCommitSha !== null &&
      bundledBuildCommitSha === latestCommitSha;
    const hasUpdate = !(
      localBuildMatchesLatest ||
      localCommitMatchesLatest ||
      bundledUpdateBuildMatchesLatest ||
      bundledUpdateCommitMatchesLatest ||
      bundledCommitMatchesLatest
    );
    const pendingCommits = hasUpdate
      ? resolveNh3dPendingUpdateCommits(
          manifest,
          localBuildId,
          localCommitSha,
        )
      : [];
    const pendingCount = resolveNh3dPendingUpdateCount(
      hasUpdate,
      pendingCommits,
    );

    return {
      supported,
      manifestUrl,
      localBuildId,
      latestBuildId,
      hasUpdate,
      pendingCount,
      pendingCommits,
      clientUpdateRequired: hasUpdate && manifest.latest.requiresClientUpgrade,
      clientUpdateMessage: hasUpdate
        ? manifest.latest.clientUpgradeMessage
        : "",
      error: null,
    };
  } catch (error) {
    return {
      supported,
      manifestUrl,
      localBuildId: null,
      latestBuildId: null,
      hasUpdate: false,
      pendingCount: 0,
      pendingCommits: [],
      clientUpdateRequired: false,
      clientUpdateMessage: "",
      error:
        error instanceof Error ? error.message : "Failed to check for updates.",
    };
  }
}

export async function applyNh3dClientUpdate(
  manifestUrlOverride?: string,
): Promise<Nh3dClientUpdateApplyResult> {
  const manifestUrl =
    normalizeNullableString(manifestUrlOverride) ??
    resolveManifestUrlOverride();

  const electronBridge = resolveElectronUpdaterBridge();
  if (electronBridge && typeof electronBridge.applyGameUpdate === "function") {
    try {
      const rawResult = await electronBridge.applyGameUpdate(manifestUrl);
      return parseApplyResult(rawResult);
    } catch (error) {
      return {
        ok: false,
        applied: false,
        alreadyInstalled: false,
        canceled: false,
        buildId: null,
        reloadTriggered: false,
        clientUpdateRequired: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply game update.",
      };
    }
  }

  const androidBridge = resolveAndroidBridge();
  if (androidBridge && typeof androidBridge.applyGameUpdate === "function") {
    try {
      const rawResult = androidBridge.applyGameUpdate(manifestUrl);
      const parsedResult =
        typeof rawResult === "string" && rawResult.trim()
          ? JSON.parse(rawResult)
          : null;
      return parseApplyResult(parsedResult);
    } catch (error) {
      return {
        ok: false,
        applied: false,
        alreadyInstalled: false,
        canceled: false,
        buildId: null,
        reloadTriggered: false,
        clientUpdateRequired: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply game update.",
      };
    }
  }

  return {
    ok: false,
    applied: false,
    alreadyInstalled: false,
    canceled: false,
    buildId: null,
    reloadTriggered: false,
    clientUpdateRequired: false,
    error: "This platform does not support client updates.",
  };
}

export async function cancelNh3dClientUpdate(): Promise<Nh3dClientUpdateCancelResult> {
  const electronBridge = getUpdateWindow().nh3dElectron?.updater;
  if (electronBridge && typeof electronBridge.cancelGameUpdate === "function") {
    try {
      const rawResult = await electronBridge.cancelGameUpdate();
      return parseCancelResult(rawResult);
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel game update download.",
      };
    }
  }

  const androidBridge = getUpdateWindow().nh3dAndroid;
  if (androidBridge && typeof androidBridge.cancelGameUpdate === "function") {
    try {
      const rawResult = androidBridge.cancelGameUpdate();
      const parsedResult =
        typeof rawResult === "string" && rawResult.trim()
          ? JSON.parse(rawResult)
          : null;
      return parseCancelResult(parsedResult);
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel game update download.",
      };
    }
  }

  return {
    ok: false,
    canceled: false,
    error: "This platform does not support canceling client updates.",
  };
}

export async function activateNh3dClientUpdateIfNeeded(): Promise<boolean> {
  const electronBridge = resolveElectronUpdaterBridge();
  if (
    !electronBridge ||
    typeof electronBridge.activateInstalledUpdate !== "function"
  ) {
    return false;
  }

  try {
    const raw = await electronBridge.activateInstalledUpdate();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }
    const payload = raw as Record<string, unknown>;
    return payload.activated === true;
  } catch {
    return false;
  }
}
