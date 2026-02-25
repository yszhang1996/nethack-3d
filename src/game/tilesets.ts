import {
  GENERATED_TILESET_MANIFEST,
  type GeneratedTilesetManifestEntry,
} from "./tilesets.generated";

export type Nh3dTilesetSource = "builtin" | "user";

export type Nh3dTilesetEntry = GeneratedTilesetManifestEntry & {
  readonly source: Nh3dTilesetSource;
  readonly assetUrl: string;
};

export type Nh3dUserTilesetRegistration = {
  readonly id: string;
  readonly label: string;
  readonly tileSize: number;
  readonly blob: Blob;
};

const fallbackTileSize = 32;
const fallbackBackgroundTileId = 0;
const fallbackSolidChromaKeyColorHex = "#466d6c";
const defaultTilesetAtlasTileColumns = 40;
const userTilesetPathPrefix = "user:";
const tilesetBackgroundTilePresetByLabel: Readonly<Record<string, number>> = {
  "Absurdly Evil": 869,
  DawnHack: 869,
  "DawnHack 16": 869,
  "DawnHack 24": 869,
  "DawnHack 32": 869,
  "Nevanda 3.6": 1476,
  "Vanilla NetHack Tiles": 1476,
};
const tilesetBackgroundTilePresetByPath: Readonly<Record<string, number>> = {
  "assets/3.6/Absurdly Evil.png": 869,
  "assets/3.6/DawnHack.bmp": 869,
  "assets/3.6/DawnHack 16.bmp": 869,
  "assets/3.6/DawnHack 24.bmp": 869,
  "assets/3.6/DawnHack 32.bmp": 869,
  "assets/3.6/Nevanda 3.6.png": 1476,
  "assets/3.6/Vanilla NetHack Tiles": 1476,
};
const tilesetSolidChromaKeyPresetByLabel: Readonly<Record<string, string>> = {
  "Absurdly Evil 64": "#466d6c",
  "Absurdly Evil": "#466d6c",
  DawnHack: "#466d6c",
  "Nevanda 3.6": "#466d6c",
  "Vanilla NetHack Tiles": "#476C6C",
};
const tilesetSolidChromaKeyPresetByPath: Readonly<Record<string, string>> = {
  "assets/3.6/Absurdly Evil.png": "#466d6c",
  "assets/3.6/DawnHack.bmp": "#466d6c",
  "assets/3.6/Nevanda 3.6.png": "#466d6c",
  "assets/3.6/Vanilla NetHack Tiles": "#476C6C",
};
// Tile width in pixels (NetHack community convention: 16/24/32/64...).
const tilesetTileWidthPresetByLabel: Readonly<Record<string, number>> = {
  "Absurdly Evil": 64,
  DawnHack: 32,
  "Nevanda 3.6": 32,
  "Vanilla NetHack Tiles": 16,
};
const tilesetTileWidthPresetByPath: Readonly<Record<string, number>> = {
  "assets/3.6/Absurdly Evil.png": 64,
  "assets/3.6/DawnHack.bmp": 16,
  "assets/3.6/Nevanda 3.6.png": 32,
  "assets/3.6/Vanilla NetHack Tiles.png": 16,
};

function resolveConfiguredTilesetTileSize(
  path: string,
  label: string,
  fallbackValue: number,
): number {
  const presetByPath = tilesetTileWidthPresetByPath[path];
  if (typeof presetByPath === "number" && Number.isFinite(presetByPath)) {
    return Math.max(1, Math.trunc(presetByPath));
  }
  const presetByLabel = tilesetTileWidthPresetByLabel[label];
  if (typeof presetByLabel === "number" && Number.isFinite(presetByLabel)) {
    return Math.max(1, Math.trunc(presetByLabel));
  }
  return Math.max(1, Math.trunc(fallbackValue));
}

const builtinTilesets: Nh3dTilesetEntry[] = [];
const seenPaths = new Set<string>();
for (const rawEntry of GENERATED_TILESET_MANIFEST) {
  const path = String(rawEntry?.path || "").trim();
  const label = String(rawEntry?.label || "").trim();
  const tileSize = resolveConfiguredTilesetTileSize(
    path,
    label || path,
    Number.isFinite(rawEntry?.tileSize) ? rawEntry.tileSize : 32,
  );
  if (!path || seenPaths.has(path)) {
    continue;
  }
  seenPaths.add(path);
  builtinTilesets.push({
    path,
    label: label || path,
    tileSize,
    source: "builtin",
    assetUrl: path,
  });
}

let userTilesets: Nh3dTilesetEntry[] = [];
let tilesetCatalog: Nh3dTilesetEntry[] = [...builtinTilesets];
let tilesetByPath = new Map(tilesetCatalog.map((entry) => [entry.path, entry]));

function rebuildTilesetCatalog(): void {
  tilesetCatalog = [...builtinTilesets, ...userTilesets];
  tilesetByPath = new Map(tilesetCatalog.map((entry) => [entry.path, entry]));
}

function isLikelyBlobUrl(path: string): boolean {
  return path.startsWith("blob:");
}

function revokeUserTilesetAssetUrls(
  entries: ReadonlyArray<Nh3dTilesetEntry>,
): void {
  for (const entry of entries) {
    if (!isLikelyBlobUrl(entry.assetUrl)) {
      continue;
    }
    try {
      URL.revokeObjectURL(entry.assetUrl);
    } catch {
      // Ignore invalid/expired blob URLs.
    }
  }
}

function ensureUserSuffix(label: string): string {
  const trimmed = String(label || "").trim();
  if (!trimmed) {
    return "User Tileset (user)";
  }
  return /\(user\)$/i.test(trimmed) ? trimmed : `${trimmed} (user)`;
}

export function getNh3dUserTilesetPath(id: string): string {
  return `${userTilesetPathPrefix}${String(id || "").trim()}`;
}

export function isNh3dUserTilesetPath(path: string): boolean {
  return String(path || "")
    .trim()
    .startsWith(userTilesetPathPrefix);
}

export function setNh3dUserTilesets(
  registrations: ReadonlyArray<Nh3dUserTilesetRegistration>,
): void {
  revokeUserTilesetAssetUrls(userTilesets);

  const nextUserTilesets: Nh3dTilesetEntry[] = [];
  const seenUserPaths = new Set<string>();
  for (const registration of registrations) {
    const id = String(registration?.id || "").trim();
    if (!id) {
      continue;
    }
    const path = getNh3dUserTilesetPath(id);
    if (seenUserPaths.has(path)) {
      continue;
    }
    seenUserPaths.add(path);
    const tileSize = Math.max(
      1,
      Math.trunc(
        Number.isFinite(registration?.tileSize) ? registration.tileSize : 32,
      ),
    );
    const label = ensureUserSuffix(registration?.label || path);
    let assetUrl = "";
    if (
      registration?.blob instanceof Blob &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
    ) {
      assetUrl = URL.createObjectURL(registration.blob);
    }
    nextUserTilesets.push({
      path,
      label,
      tileSize,
      source: "user",
      assetUrl,
    });
  }

  userTilesets = nextUserTilesets;
  rebuildTilesetCatalog();
}

export function clearNh3dUserTilesets(): void {
  setNh3dUserTilesets([]);
}

export function getNh3dTilesetCatalog(): ReadonlyArray<Nh3dTilesetEntry> {
  return tilesetCatalog;
}

export const nh3dTilesetCatalog: ReadonlyArray<Nh3dTilesetEntry> =
  builtinTilesets;

const preferredDefaultTilesetPath = "assets/3.6/Nevanda 3.6.png";
const preferredDefaultTilesetLabel = "Nevanda 3.6";
export const defaultNh3dTilesetPath: string =
  builtinTilesets.find((entry) => entry.path === preferredDefaultTilesetPath)
    ?.path ??
  builtinTilesets.find((entry) => entry.label === preferredDefaultTilesetLabel)
    ?.path ??
  builtinTilesets[0]?.path ??
  "";

export function findNh3dTilesetByPath(
  path: string | null | undefined,
): Nh3dTilesetEntry | null {
  if (typeof path !== "string") {
    return null;
  }
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return null;
  }
  return tilesetByPath.get(normalizedPath) ?? null;
}

export function isNh3dTilesetPathAvailable(
  path: string | null | undefined,
): boolean {
  return findNh3dTilesetByPath(path) !== null;
}

export function getNh3dTilesetTileSize(
  path: string | null | undefined,
): number {
  return findNh3dTilesetByPath(path)?.tileSize ?? fallbackTileSize;
}

export function resolveNh3dTilesetAssetUrl(
  path: string | null | undefined,
): string | null {
  const tileset = findNh3dTilesetByPath(path);
  if (!tileset) {
    return null;
  }
  return String(tileset.assetUrl || "").trim() || null;
}

function normalizeHexColorOrFallback(
  rawValue: unknown,
  fallback: string,
): string {
  const normalized = String(rawValue || "").trim();
  const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return fallback;
  }
  return `#${match[1].toLowerCase()}`;
}

export function resolveDefaultNh3dTilesetSolidChromaKeyColorHex(
  path: string | null | undefined,
): string {
  const tileset = findNh3dTilesetByPath(path);
  if (!tileset) {
    return fallbackSolidChromaKeyColorHex;
  }
  const presetByPath = tilesetSolidChromaKeyPresetByPath[tileset.path];
  if (typeof presetByPath === "string" && presetByPath.trim()) {
    return normalizeHexColorOrFallback(
      presetByPath,
      fallbackSolidChromaKeyColorHex,
    );
  }
  const presetByLabel = tilesetSolidChromaKeyPresetByLabel[tileset.label];
  if (typeof presetByLabel === "string" && presetByLabel.trim()) {
    return normalizeHexColorOrFallback(
      presetByLabel,
      fallbackSolidChromaKeyColorHex,
    );
  }
  return fallbackSolidChromaKeyColorHex;
}

export function resolveConfiguredNh3dTilesetAtlasWidth(
  path: string | null | undefined,
): number | null {
  const tileset = findNh3dTilesetByPath(path);
  if (!tileset || tileset.source !== "builtin") {
    return null;
  }
  return defaultTilesetAtlasTileColumns * tileset.tileSize;
}

export function resolveDefaultNh3dTilesetBackgroundTileId(
  path: string | null | undefined,
): number {
  const tileset = findNh3dTilesetByPath(path);
  if (!tileset) {
    return fallbackBackgroundTileId;
  }
  const presetByPath = tilesetBackgroundTilePresetByPath[tileset.path];
  if (typeof presetByPath === "number" && Number.isFinite(presetByPath)) {
    return Math.max(0, Math.trunc(presetByPath));
  }
  const presetByLabel = tilesetBackgroundTilePresetByLabel[tileset.label];
  if (typeof presetByLabel === "number" && Number.isFinite(presetByLabel)) {
    return Math.max(0, Math.trunc(presetByLabel));
  }
  return fallbackBackgroundTileId;
}
