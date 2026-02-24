import {
  GENERATED_TILESET_MANIFEST,
  type GeneratedTilesetManifestEntry,
} from "./tilesets.generated";

export type Nh3dTilesetEntry = GeneratedTilesetManifestEntry;

const fallbackTileSize = 32;
const fallbackBackgroundTileId = 0;
const tilesetBackgroundTilePresetByLabel: Readonly<Record<string, number>> = {
  "Absurdly Evil 64": 869,
  "DawnHack 16": 869,
  "DawnHack 24": 869,
  "DawnHack 32": 869,
  "Nevanda 3.6": 1476,
};
const tilesetBackgroundTilePresetByPath: Readonly<Record<string, number>> = {
  "assets/3.6/DawnHack 16.bmp": 869,
  "assets/3.6/DawnHack 24.bmp": 869,
  "assets/3.6/DawnHack 32.bmp": 869,
  "assets/3.6/Nevanda 3.6.png": 1476,
};

const dedupedTilesets: Nh3dTilesetEntry[] = [];
const seenPaths = new Set<string>();
for (const rawEntry of GENERATED_TILESET_MANIFEST) {
  const path = String(rawEntry?.path || "").trim();
  const label = String(rawEntry?.label || "").trim();
  const tileSize = Math.max(
    1,
    Math.trunc(Number.isFinite(rawEntry?.tileSize) ? rawEntry.tileSize : 32),
  );
  if (!path || seenPaths.has(path)) {
    continue;
  }
  seenPaths.add(path);
  dedupedTilesets.push({
    path,
    label: label || path,
    tileSize,
  });
}

export const nh3dTilesetCatalog: ReadonlyArray<Nh3dTilesetEntry> =
  dedupedTilesets;
const preferredDefaultTilesetPath = "assets/3.6/Nevanda 3.6.png";
const preferredDefaultTilesetLabel = "Nevanda 3.6";
export const defaultNh3dTilesetPath: string =
  nh3dTilesetCatalog.find((entry) => entry.path === preferredDefaultTilesetPath)
    ?.path ??
  nh3dTilesetCatalog.find((entry) => entry.label === preferredDefaultTilesetLabel)
    ?.path ??
  nh3dTilesetCatalog[0]?.path ??
  "";

const tilesetByPath = new Map(
  nh3dTilesetCatalog.map((entry) => [entry.path, entry]),
);

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
