import {
  GENERATED_TILESET_MANIFEST,
  type GeneratedTilesetManifestEntry,
} from "./tilesets.generated";

export type Nh3dTilesetEntry = GeneratedTilesetManifestEntry;

const fallbackTileSize = 32;

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
export const defaultNh3dTilesetPath: string =
  nh3dTilesetCatalog[0]?.path ?? "";

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

