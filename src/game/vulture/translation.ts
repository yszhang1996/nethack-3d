import type { TileMaterialKind } from "../glyphs";
import { getGlyphCatalogEntry, getGlyphCatalogRanges } from "../glyphs/registry";
import { VULTURE_MONSTER_KEYS_367 } from "./vulture-monster-keys.367.generated";

export type VultureTileProjectionMode = "sprite" | "iso_floor";

type VultureTilePointer = {
  category: string;
  name: string;
};

type VultureRawTileEntry =
  | {
      kind: "asset";
      path: string;
      hsX: number;
      hsY: number;
    }
  | {
      kind: "redirect";
      target: VultureTilePointer;
    };

type VultureResolvedTileEntry = {
  path: string;
  hsX: number;
  hsY: number;
};

export type VultureTileLookup = {
  category: string;
  name: string;
  projection: VultureTileProjectionMode;
};

export type VultureWallFaceDirection = "west" | "north" | "east" | "south";

type VultureWallHeightToken = "F" | "H";

type VultureWallDecorStyle =
  | "BRICK"
  | "BRICK_BANNER"
  | "BRICK_PAINTING"
  | "BRICK_POCKET"
  | "BRICK_PILLAR"
  | "MARBLE"
  | "VINE_COVERED"
  | "STUCCO"
  | "ROUGH"
  | "DARK"
  | "LIGHT";

type VultureFloorDecorStyle =
  | "COBBLESTONE"
  | "ROUGH"
  | "CERAMIC"
  | "LAVA"
  | "WATER"
  | "ICE"
  | "MURAL"
  | "MURAL2"
  | "CARPET"
  | "MOSS_COVERED"
  | "MARBLE"
  | "ROUGH_LIT"
  | "AIR"
  | "DARK";

type DrawTranslatedTileParams = {
  context: CanvasRenderingContext2D;
  size: number;
  glyph: number;
  tileIndex?: number | null;
  tileX?: number | null;
  tileY?: number | null;
  materialKind: TileMaterialKind | null;
  forBillboard: boolean;
};

type DrawLookupTileParams = {
  context: CanvasRenderingContext2D;
  size: number;
  lookup: VultureTileLookup;
  forBillboard: boolean;
};

type DrawLookupSourcePreviewParams = {
  context: CanvasRenderingContext2D;
  size: number;
  lookup: VultureTileLookup;
};

type ResolveWallFaceLookupParams = {
  face: VultureWallFaceDirection;
  wallX: number;
  wallY: number;
  floorX: number;
  floorY: number;
  floorTileIndex?: number | null;
  floorGlyph?: number | null;
  floorMaterialKind?: TileMaterialKind | null;
  wallMaterialKind?: TileMaterialKind | null;
  halfHeight?: boolean;
};

type ImageState = HTMLImageElement | "loading" | null;

const explosionTypeNames = [
  "DARK",
  "NOXIOUS",
  "MUDDY",
  "WET",
  "MAGICAL",
  "FIERY",
  "FROSTY",
] as const;

const zapTileNames = [
  "ZAP_VERTICAL",
  "ZAP_HORIZONTAL",
  "ZAP_SLANT_LEFT",
  "ZAP_SLANT_RIGHT",
] as const;

const genericFloorLookup: VultureTileLookup = {
  category: "floor",
  name: "FLOOR_COBBLESTONE_1_1",
  projection: "iso_floor",
};

const brickWallDecorVariants = [
  "BRICK",
  "BRICK_BANNER",
  "BRICK_PAINTING",
  "BRICK_POCKET",
  "BRICK_PILLAR",
] as const;

const floorDecorPatternByStyle: Readonly<
  Record<VultureFloorDecorStyle, { width: number; height: number }>
> = {
  COBBLESTONE: { width: 3, height: 3 },
  ROUGH: { width: 3, height: 3 },
  CERAMIC: { width: 3, height: 3 },
  LAVA: { width: 3, height: 3 },
  WATER: { width: 3, height: 3 },
  ICE: { width: 3, height: 3 },
  MURAL: { width: 3, height: 2 },
  MURAL2: { width: 3, height: 2 },
  CARPET: { width: 3, height: 2 },
  MOSS_COVERED: { width: 3, height: 3 },
  MARBLE: { width: 3, height: 3 },
  ROUGH_LIT: { width: 3, height: 3 },
  AIR: { width: 3, height: 3 },
  DARK: { width: 1, height: 1 },
};

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function clampTileSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 32;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeTileNameToken(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[a-z]/g, (char) => char.toUpperCase())
    .replace(/[^A-Z0-9_]/g, "_");
}

function normalizeMapCoordinate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function positiveModulo(value: number, divisor: number): number {
  const normalizedDivisor = Math.max(1, Math.trunc(divisor));
  return ((Math.trunc(value) % normalizedDivisor) + normalizedDivisor) % normalizedDivisor;
}

export class VultureTilesetTranslator {
  private readonly dataRootUrl: string;

  private readonly configUrl: string;

  private readonly onAssetReady: (() => void) | null;

  private readonly imageByUrl = new Map<string, ImageState>();

  private readonly rawEntryByToken = new Map<string, VultureRawTileEntry>();

  private readonly resolvedEntryByToken = new Map<
    string,
    VultureResolvedTileEntry | null
  >();

  private readonly defaultTargetByCategory = new Map<
    string,
    VultureTilePointer
  >();

  private readonly rangeStartByKind = new Map<string, number>();

  private readonly cmapIndexByTileIndex = new Map<number, number>();

  private cmapTileLookupInitialized = false;

  private configLoadingStarted = false;

  private configLoaded = false;

  private pendingAssetReadyCallback = false;

  private disposed = false;

  public readonly nominalTileSize = 112;

  public constructor(options: {
    dataRootUrl: string;
    onAssetReady?: () => void;
  }) {
    const normalizedDataRootUrl = trimSlashes(String(options.dataRootUrl || ""));
    this.dataRootUrl = normalizedDataRootUrl;
    this.configUrl = `${normalizedDataRootUrl}/config/vulture_tiles.conf`;
    this.onAssetReady =
      typeof options.onAssetReady === "function" ? options.onAssetReady : null;
  }

  public dispose(): void {
    this.disposed = true;
    this.imageByUrl.clear();
    this.rawEntryByToken.clear();
    this.resolvedEntryByToken.clear();
    this.defaultTargetByCategory.clear();
    this.rangeStartByKind.clear();
    this.cmapIndexByTileIndex.clear();
    this.cmapTileLookupInitialized = false;
    this.configLoadingStarted = false;
    this.configLoaded = false;
    this.pendingAssetReadyCallback = false;
  }

  public drawTranslatedTile(params: DrawTranslatedTileParams): boolean {
    if (this.disposed) {
      return false;
    }
    this.ensureConfigLoadingStarted();
    if (!this.configLoaded) {
      return false;
    }

    const normalizedGlyph = Math.trunc(params.glyph);
    const normalizedTileIndex =
      typeof params.tileIndex === "number" && Number.isFinite(params.tileIndex)
        ? Math.trunc(params.tileIndex)
        : null;
    const normalizedTileX = normalizeMapCoordinate(params.tileX);
    const normalizedTileY = normalizeMapCoordinate(params.tileY);
    const lookup = this.resolveLookupForTile({
      glyph: normalizedGlyph,
      tileIndex: normalizedTileIndex,
      tileX: normalizedTileX,
      tileY: normalizedTileY,
      materialKind: params.materialKind,
      forBillboard: params.forBillboard,
    });
    if (!lookup) {
      return false;
    }

    return this.drawLookupTile({
      context: params.context,
      size: params.size,
      lookup,
      forBillboard: params.forBillboard,
    });
  }

  public resolveLookupForTile(params: {
    glyph: number;
    tileIndex?: number | null;
    tileX?: number | null;
    tileY?: number | null;
    materialKind: TileMaterialKind | null;
    forBillboard: boolean;
  }): VultureTileLookup | null {
    if (this.disposed) {
      return null;
    }
    this.ensureConfigLoadingStarted();
    if (!this.configLoaded) {
      return null;
    }
    const normalizedGlyph = Math.trunc(params.glyph);
    const normalizedTileIndex =
      typeof params.tileIndex === "number" && Number.isFinite(params.tileIndex)
        ? Math.trunc(params.tileIndex)
        : null;
    const normalizedTileX = normalizeMapCoordinate(params.tileX);
    const normalizedTileY = normalizeMapCoordinate(params.tileY);
    return (
      (normalizedTileIndex !== null && normalizedTileIndex >= 0
        ? this.resolveTileLookupForTileIndex(
            normalizedTileIndex,
            params.materialKind,
            normalizedTileX,
            normalizedTileY,
          )
        : null) ??
      this.resolveTileLookupForGlyph(
        normalizedGlyph,
        params.materialKind,
        params.forBillboard,
        normalizedTileX,
        normalizedTileY,
      )
    );
  }

  public drawLookupTile(params: DrawLookupTileParams): boolean {
    if (this.disposed) {
      return false;
    }
    this.ensureConfigLoadingStarted();
    if (!this.configLoaded) {
      return false;
    }
    const resolvedTile = this.resolveTileEntry(
      params.lookup.category,
      params.lookup.name,
    );
    if (!resolvedTile) {
      return false;
    }

    const imageUrl = this.resolveAssetUrl(resolvedTile.path);
    const image = this.getLoadedImage(imageUrl);
    if (!image) {
      return false;
    }

    const size = clampTileSize(params.size);
    if (params.lookup.projection === "iso_floor" && !params.forBillboard) {
      this.drawIsoFloorToTopDownTexture(
        params.context,
        size,
        image,
        resolvedTile.hsX,
        resolvedTile.hsY,
        params.lookup.category === "floor",
      );
      return true;
    }

    this.drawSpriteWithHotspot(
      params.context,
      size,
      image,
      resolvedTile.hsX,
      resolvedTile.hsY,
      params.forBillboard,
    );
    return true;
  }

  public drawLookupSourcePreview(params: DrawLookupSourcePreviewParams): boolean {
    if (this.disposed) {
      return false;
    }
    this.ensureConfigLoadingStarted();
    if (!this.configLoaded) {
      return false;
    }
    const resolvedTile = this.resolveTileEntry(
      params.lookup.category,
      params.lookup.name,
    );
    if (!resolvedTile) {
      return false;
    }
    const imageUrl = this.resolveAssetUrl(resolvedTile.path);
    const image = this.getLoadedImage(imageUrl);
    if (!image) {
      return false;
    }

    const size = clampTileSize(params.size);
    const sourceWidth = Math.max(1, image.width);
    const sourceHeight = Math.max(1, image.height);
    const scale = Math.max(
      0.001,
      Math.min(size / sourceWidth, size / sourceHeight),
    );
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
    const drawX = Math.floor((size - drawWidth) * 0.5);
    const drawY = Math.floor((size - drawHeight) * 0.5);

    params.context.clearRect(0, 0, size, size);
    params.context.imageSmoothingEnabled = false;
    params.context.drawImage(
      image,
      0,
      0,
      sourceWidth,
      sourceHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
    return true;
  }

  public drawFallbackTile(
    context: CanvasRenderingContext2D,
    size: number,
    forBillboard: boolean,
  ): void {
    const normalizedSize = clampTileSize(size);
    context.fillStyle = forBillboard ? "rgba(84, 84, 84, 0.82)" : "#6b736f";
    context.fillRect(0, 0, normalizedSize, normalizedSize);
    context.strokeStyle = "rgba(0, 0, 0, 0.32)";
    context.lineWidth = Math.max(1, Math.round(normalizedSize * 0.05));
    context.strokeRect(0, 0, normalizedSize, normalizedSize);
  }

  private makeToken(category: string, name: string): string {
    return `${category}.${name}`;
  }

  private resolveAssetUrl(relativePath: string): string {
    const normalizedRelativePath = String(relativePath || "")
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "");
    return `${this.dataRootUrl}/${normalizedRelativePath}`;
  }

  private getLoadedImage(url: string): HTMLImageElement | null {
    if (this.disposed) {
      return null;
    }
    const cached = this.imageByUrl.get(url);
    if (cached instanceof HTMLImageElement) {
      return cached;
    }
    if (cached === "loading" || cached === null) {
      return null;
    }

    const image = new Image();
    this.imageByUrl.set(url, "loading");
    image.onload = () => {
      if (this.disposed) {
        return;
      }
      this.imageByUrl.set(url, image);
      this.notifyAssetReady();
    };
    image.onerror = () => {
      if (this.disposed) {
        return;
      }
      this.imageByUrl.set(url, null);
    };
    image.src = url;
    return null;
  }

  private notifyAssetReady(): void {
    if (this.disposed || !this.onAssetReady || this.pendingAssetReadyCallback) {
      return;
    }
    this.pendingAssetReadyCallback = true;
    const flush = (): void => {
      if (this.disposed) {
        return;
      }
      this.pendingAssetReadyCallback = false;
      this.onAssetReady?.();
    };
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => flush());
      return;
    }
    flush();
  }

  private ensureConfigLoadingStarted(): void {
    if (this.disposed || this.configLoadingStarted) {
      return;
    }
    this.configLoadingStarted = true;
    void this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch(this.configUrl);
      if (this.disposed) {
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const configText = await response.text();
      if (this.disposed) {
        return;
      }
      this.parseConfig(configText);
      this.configLoaded = true;
      this.notifyAssetReady();
    } catch (error) {
      if (this.disposed) {
        return;
      }
      console.warn(
        `Failed to load Vulture tile config from '${this.configUrl}':`,
        error,
      );
      this.configLoaded = false;
    }
  }

  private parseConfig(configText: string): void {
    this.rawEntryByToken.clear();
    this.resolvedEntryByToken.clear();
    this.defaultTargetByCategory.clear();

    const lines = String(configText || "").split(/\r?\n/g);
    const assetPattern =
      /^([a-z]+)\.([A-Za-z0-9_]+)\s*=\s*"([^"]+)"\s*(-?\d+)\s*(-?\d+)\s*$/;
    const redirectPattern =
      /^([a-z]+)\.([A-Za-z0-9_]+)\s*=>\s*([a-z]+)\.([A-Za-z0-9_]+)\s*$/;

    for (const rawLine of lines) {
      const lineWithoutComment = rawLine.replace(/\s*#.*$/, "").trim();
      if (!lineWithoutComment) {
        continue;
      }

      const assetMatch = lineWithoutComment.match(assetPattern);
      if (assetMatch) {
        const category = assetMatch[1];
        const name = normalizeTileNameToken(assetMatch[2]);
        const path = assetMatch[3];
        const hsX = Number.parseInt(assetMatch[4], 10);
        const hsY = Number.parseInt(assetMatch[5], 10);
        const token = this.makeToken(category, name);
        this.rawEntryByToken.set(token, {
          kind: "asset",
          path,
          hsX: Number.isFinite(hsX) ? hsX : 0,
          hsY: Number.isFinite(hsY) ? hsY : 0,
        });
        continue;
      }

      const redirectMatch = lineWithoutComment.match(redirectPattern);
      if (!redirectMatch) {
        continue;
      }

      const sourceCategory = redirectMatch[1];
      const sourceName = redirectMatch[2];
      const targetCategory = redirectMatch[3];
      const targetName = normalizeTileNameToken(redirectMatch[4]);
      if (sourceName.toLowerCase() === "default") {
        this.defaultTargetByCategory.set(sourceCategory, {
          category: targetCategory,
          name: targetName,
        });
        continue;
      }
      const token = this.makeToken(
        sourceCategory,
        normalizeTileNameToken(sourceName),
      );
      this.rawEntryByToken.set(token, {
        kind: "redirect",
        target: {
          category: targetCategory,
          name: targetName,
        },
      });
    }
  }

  private resolveTileEntry(
    category: string,
    name: string,
  ): VultureResolvedTileEntry | null {
    return this.resolveTileEntryRecursive(category, name, new Set<string>());
  }

  private resolveTileEntryRecursive(
    category: string,
    name: string,
    stack: Set<string>,
  ): VultureResolvedTileEntry | null {
    const normalizedName = normalizeTileNameToken(name);
    const token = this.makeToken(category, normalizedName);
    if (this.resolvedEntryByToken.has(token)) {
      return this.resolvedEntryByToken.get(token) ?? null;
    }
    if (stack.has(token)) {
      this.resolvedEntryByToken.set(token, null);
      return null;
    }
    stack.add(token);

    const rawEntry = this.rawEntryByToken.get(token);
    if (rawEntry?.kind === "asset") {
      const resolved: VultureResolvedTileEntry = {
        path: rawEntry.path,
        hsX: rawEntry.hsX,
        hsY: rawEntry.hsY,
      };
      this.resolvedEntryByToken.set(token, resolved);
      return resolved;
    }

    const target =
      rawEntry?.kind === "redirect"
        ? rawEntry.target
        : this.defaultTargetByCategory.get(category) ?? null;
    if (!target) {
      this.resolvedEntryByToken.set(token, null);
      return null;
    }

    const resolved = this.resolveTileEntryRecursive(
      target.category,
      target.name,
      stack,
    );
    this.resolvedEntryByToken.set(token, resolved);
    return resolved;
  }

  private getRangeStart(kind: string): number | null {
    if (this.rangeStartByKind.size === 0) {
      for (const range of getGlyphCatalogRanges()) {
        this.rangeStartByKind.set(range.kind, range.start);
      }
    }
    return this.rangeStartByKind.get(kind) ?? null;
  }

  private resolveMonsterKeyForGlyph(
    glyphKind: string,
    glyph: number,
  ): string | null {
    const rangeStart = this.getRangeStart(glyphKind);
    if (rangeStart === null) {
      return null;
    }
    const monsterIndex = Math.trunc(glyph) - rangeStart;
    if (
      monsterIndex < 0 ||
      monsterIndex >= VULTURE_MONSTER_KEYS_367.length ||
      !Number.isFinite(monsterIndex)
    ) {
      return null;
    }
    return VULTURE_MONSTER_KEYS_367[monsterIndex] ?? null;
  }

  private ensureCmapTileLookupInitialized(): void {
    if (this.cmapTileLookupInitialized) {
      return;
    }
    this.cmapTileLookupInitialized = true;
    this.cmapIndexByTileIndex.clear();

    const range = getGlyphCatalogRanges().find((entry) => entry.kind === "cmap");
    if (!range) {
      return;
    }

    for (let glyph = range.start; glyph < range.endExclusive; glyph += 1) {
      const entry = getGlyphCatalogEntry(glyph);
      if (
        !entry ||
        typeof entry.tileIndex !== "number" ||
        !Number.isFinite(entry.tileIndex)
      ) {
        continue;
      }
      const tileIndex = Math.trunc(entry.tileIndex);
      if (tileIndex < 0 || this.cmapIndexByTileIndex.has(tileIndex)) {
        continue;
      }
      this.cmapIndexByTileIndex.set(tileIndex, glyph - range.start);
    }
  }

  public resolveCmapIndexForTileIndex(tileIndex: number): number | null {
    this.ensureCmapTileLookupInitialized();
    const cmapIndex = this.cmapIndexByTileIndex.get(Math.trunc(tileIndex));
    return typeof cmapIndex === "number" ? cmapIndex : null;
  }

  public resolveWallFaceLookup(
    params: ResolveWallFaceLookupParams,
  ): VultureTileLookup | null {
    const floorCmapIndex = this.resolveCmapIndexFromContext(
      params.floorTileIndex ?? null,
      params.floorGlyph ?? null,
      params.floorMaterialKind ?? null,
    );
    if (this.isWallOrUnmappedCmapIndex(floorCmapIndex)) {
      return null;
    }

    const wallStyle = this.resolveWallDecorStyle({
      floorCmapIndex,
      wallMaterialKind: params.wallMaterialKind ?? null,
      wallX: params.wallX,
      wallY: params.wallY,
      floorX: params.floorX,
      floorY: params.floorY,
    });
    const heightToken: VultureWallHeightToken =
      params.halfHeight === true ? "H" : "F";
    const faceToken =
      params.face === "west"
        ? "W"
        : params.face === "north"
          ? "N"
          : params.face === "east"
            ? "E"
            : "S";
    return {
      category: "wall",
      name: `WALL_${wallStyle}_${heightToken}_${faceToken}`,
      projection: "sprite",
    };
  }

  private resolveTileLookupForTileIndex(
    tileIndex: number,
    materialKind: TileMaterialKind | null,
    floorX: number | null,
    floorY: number | null,
  ): VultureTileLookup | null {
    const cmapIndex = this.resolveCmapIndexForTileIndex(tileIndex);
    if (typeof cmapIndex !== "number") {
      return null;
    }
    return this.resolveCmapLookup(cmapIndex, materialKind, floorX, floorY);
  }

  private resolveCmapIndexForGlyph(glyph: number): number | null {
    const entry = getGlyphCatalogEntry(Math.trunc(glyph));
    if (!entry || entry.kind !== "cmap") {
      return null;
    }
    const rangeStart = this.getRangeStart("cmap");
    if (rangeStart === null) {
      return null;
    }
    return entry.glyph - rangeStart;
  }

  private resolveCmapIndexFromContext(
    tileIndex: number | null,
    glyph: number | null,
    materialKind: TileMaterialKind | null,
  ): number | null {
    if (typeof tileIndex === "number" && Number.isFinite(tileIndex)) {
      const cmapIndex = this.resolveCmapIndexForTileIndex(tileIndex);
      if (typeof cmapIndex === "number") {
        return cmapIndex;
      }
    }

    if (typeof glyph === "number" && Number.isFinite(glyph)) {
      const cmapIndex = this.resolveCmapIndexForGlyph(glyph);
      if (typeof cmapIndex === "number") {
        return cmapIndex;
      }
    }

    switch (materialKind) {
      case "dark_wall":
        return 0;
      case "wall":
        return 1;
      case "door":
        return 21;
      case "dark":
        return 20;
      case "water":
        return 32;
      case "floor":
      case "stairs_up":
      case "stairs_down":
      case "trap":
      case "feature":
      case "fountain":
      case "player":
      case "monster_hostile":
      case "monster_friendly":
      case "monster_neutral":
      case "item":
      case "effect_warning":
      case "effect_zap":
      case "effect_explode":
      case "effect_swallow":
      case "default":
        return 19;
      default:
        return null;
    }
  }

  private isWallOrUnmappedCmapIndex(cmapIndex: number | null): boolean {
    if (typeof cmapIndex !== "number" || !Number.isFinite(cmapIndex)) {
      return true;
    }
    return cmapIndex >= 0 && cmapIndex <= 11;
  }

  private resolvePseudoRoomSelector(
    floorX: number | null,
    floorY: number | null,
  ): number {
    // Vulture uses room indices from map state; we approximate that with stable
    // room-cell hashing so floor and wall decor stay deterministic.
    if (floorX === null || floorY === null) {
      return 1;
    }
    const roomCellX = Math.floor(floorX / 8);
    const roomCellY = Math.floor(floorY / 8);
    const roomSeed =
      Math.imul(roomCellX + 17, 73856093) ^
      Math.imul(roomCellY + 31, 19349663);
    return Math.abs(roomSeed) % 4;
  }

  private resolveFloorDecorStyleForCmap(
    cmapIndex: number,
    floorX: number | null,
    floorY: number | null,
  ): VultureFloorDecorStyle | null {
    // Ported from Vulture floor decor selection (vultures_map.c):
    // floor type -> decor style, with cobblestone rooms split across
    // ceramic/cobblestone/moss/marble themes.
    switch (cmapIndex) {
      case 19: {
        const roomSelector = this.resolvePseudoRoomSelector(floorX, floorY);
        switch (roomSelector) {
          case 0:
            return "CERAMIC";
          case 1:
            return "COBBLESTONE";
          case 2:
            return "MOSS_COVERED";
          case 3:
            return "MARBLE";
          default:
            return "COBBLESTONE";
        }
      }
      case 20:
        return "DARK";
      case 21:
        return "ROUGH";
      case 22:
        return "ROUGH_LIT";
      case 32:
      case 41:
        return "WATER";
      case 33:
        return "ICE";
      case 34:
        return "LAVA";
      case 39:
        return "AIR";
      default:
        return null;
    }
  }

  private resolveFloorPatternCoordinate(
    coordinate: number | null,
    size: number,
  ): number {
    const normalizedSize = Math.max(1, Math.trunc(size));
    if (coordinate === null) {
      return Math.min(1, normalizedSize - 1);
    }
    return positiveModulo(coordinate, normalizedSize);
  }

  private resolveFloorLookup(
    floorStyle: VultureFloorDecorStyle,
    floorX: number | null,
    floorY: number | null,
  ): VultureTileLookup {
    // Vulture picks floor tile variants by coordinate modulo style dimensions.
    const pattern =
      floorDecorPatternByStyle[floorStyle] ?? floorDecorPatternByStyle.COBBLESTONE;
    const patternX = this.resolveFloorPatternCoordinate(floorX, pattern.width);
    const patternY = this.resolveFloorPatternCoordinate(floorY, pattern.height);
    return {
      category: "floor",
      name: `FLOOR_${floorStyle}_${patternX}_${patternY}`,
      projection: "iso_floor",
    };
  }

  public resolveDoorwayFloorLookup(
    floorX: number | null,
    floorY: number | null,
  ): VultureTileLookup {
    return this.resolveFloorLookup(
      "ROUGH",
      normalizeMapCoordinate(floorX),
      normalizeMapCoordinate(floorY),
    );
  }

  private resolveWallDecorStyle(params: {
    floorCmapIndex: number | null;
    wallMaterialKind: TileMaterialKind | null;
    wallX: number;
    wallY: number;
    floorX: number;
    floorY: number;
  }): VultureWallDecorStyle {
    if (params.wallMaterialKind === "dark_wall") {
      return "DARK";
    }
    const floorCmapIndex =
      typeof params.floorCmapIndex === "number" &&
      Number.isFinite(params.floorCmapIndex)
        ? Math.trunc(params.floorCmapIndex)
        : null;
    if (floorCmapIndex === 21 || floorCmapIndex === 22) {
      return "ROUGH";
    }
    // Doors, bars, trees and drawbridges use rough floor backdrops in Vulture.
    if (
      (floorCmapIndex !== null && floorCmapIndex >= 12 && floorCmapIndex <= 18) ||
      floorCmapIndex === 35 ||
      floorCmapIndex === 36 ||
      floorCmapIndex === 37 ||
      floorCmapIndex === 38
    ) {
      return "ROUGH";
    }
    if (floorCmapIndex === 19) {
      const roomSelector = this.resolvePseudoRoomSelector(
        params.floorX,
        params.floorY,
      );
      switch (roomSelector) {
        case 0:
          return "STUCCO";
        case 1: {
          const brickVariantSeed =
            params.wallY * params.wallX + params.wallY + params.wallX;
          const brickVariantIndex =
            Math.abs(brickVariantSeed) % brickWallDecorVariants.length;
          return brickWallDecorVariants[brickVariantIndex];
        }
        case 2:
          return "VINE_COVERED";
        case 3:
          return "MARBLE";
        default:
          return "BRICK";
      }
    }
    return "BRICK";
  }

  private resolveWallLookup(
    cmapIndex: number,
    materialKind: TileMaterialKind | null,
  ): VultureTileLookup {
    const wallPrefix =
      materialKind === "dark_wall" || cmapIndex === 0
        ? "WALL_DARK_F"
        : "WALL_ROUGH_F";
    // Vulture resolves wall faces from neighboring floor cells (mapdata.cpp +
    // levelwin.cpp). For our cube model, pick an orientation proxy from the
    // cmap symbol to keep wall UVs deterministic.
    const faceSuffix =
      cmapIndex === 1 || cmapIndex === 10 || cmapIndex === 11 ? "E" : "S";
    return {
      category: "wall",
      name: `${wallPrefix}_${faceSuffix}`,
      projection: "sprite",
    };
  }

  private resolveCmapLookup(
    cmapIndex: number,
    materialKind: TileMaterialKind | null,
    floorX: number | null,
    floorY: number | null,
  ): VultureTileLookup {
    const floorDecorStyle = this.resolveFloorDecorStyleForCmap(
      cmapIndex,
      floorX,
      floorY,
    );
    if (floorDecorStyle) {
      return this.resolveFloorLookup(floorDecorStyle, floorX, floorY);
    }

    switch (cmapIndex) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
        return this.resolveWallLookup(cmapIndex, materialKind);
      case 12:
        // Doorway openings sit on rough floor in Vulture mapdata.
        return this.resolveFloorLookup("ROUGH", floorX, floorY);
      case 13:
        return {
          category: "misc",
          name: "VDOOR_WOOD_OPEN",
          projection: "sprite",
        };
      case 14:
        return {
          category: "misc",
          name: "HDOOR_WOOD_OPEN",
          projection: "sprite",
        };
      case 15:
        return {
          category: "misc",
          name: "VDOOR_WOOD_CLOSED",
          projection: "sprite",
        };
      case 16:
        return {
          category: "misc",
          name: "HDOOR_WOOD_CLOSED",
          projection: "sprite",
        };
      case 17:
        return {
          category: "misc",
          name: "BARS",
          projection: "sprite",
        };
      case 18:
        return {
          category: "misc",
          name: "TREE",
          projection: "sprite",
        };
      case 23:
        return {
          category: "misc",
          name: "STAIRS_UP",
          projection: "sprite",
        };
      case 24:
        return {
          category: "misc",
          name: "STAIRS_DOWN",
          projection: "sprite",
        };
      case 25:
        return {
          category: "misc",
          name: "LADDER_UP",
          projection: "sprite",
        };
      case 26:
        return {
          category: "misc",
          name: "LADDER_DOWN",
          projection: "sprite",
        };
      case 27:
        return {
          category: "misc",
          name: "ALTAR",
          projection: "sprite",
        };
      case 28:
        return {
          category: "misc",
          name: "GRAVE",
          projection: "sprite",
        };
      case 29:
        return {
          category: "misc",
          name: "THRONE",
          projection: "sprite",
        };
      case 30:
        return {
          category: "misc",
          name: "SINK",
          projection: "sprite",
        };
      case 31:
        return {
          category: "misc",
          name: "FOUNTAIN",
          projection: "sprite",
        };
      case 37:
        return {
          category: "misc",
          name: "VCDBRIDGE",
          projection: "sprite",
        };
      case 38:
        return {
          category: "misc",
          name: "HCDBRIDGE",
          projection: "sprite",
        };
      case 35:
        return {
          category: "misc",
          name: "VODBRIDGE",
          projection: "sprite",
        };
      case 36:
        return {
          category: "misc",
          name: "HODBRIDGE",
          projection: "sprite",
        };
      case 40:
        return {
          category: "misc",
          name: "CLOUD",
          projection: "sprite",
        };
      case 42:
        return { category: "misc", name: "TRAP_ARROW", projection: "sprite" };
      case 43:
        return { category: "misc", name: "DART_TRAP", projection: "sprite" };
      case 44:
        return {
          category: "misc",
          name: "FALLING_ROCK_TRAP",
          projection: "sprite",
        };
      case 45:
        return {
          category: "misc",
          name: "SQUEAKY_BOARD",
          projection: "sprite",
        };
      case 46:
        return { category: "misc", name: "TRAP_BEAR", projection: "sprite" };
      case 47:
        return { category: "misc", name: "LAND_MINE", projection: "sprite" };
      case 48:
        return {
          category: "misc",
          name: "ROLLING_BOULDER_TRAP",
          projection: "sprite",
        };
      case 49:
        return { category: "misc", name: "GAS_TRAP", projection: "sprite" };
      case 50:
        return { category: "misc", name: "TRAP_WATER", projection: "sprite" };
      case 51:
        return { category: "misc", name: "TRAP_FIRE", projection: "sprite" };
      case 52:
        return { category: "misc", name: "TRAP_PIT", projection: "sprite" };
      case 53:
        return { category: "misc", name: "SPIKED_PIT", projection: "sprite" };
      case 54:
        return { category: "misc", name: "HOLE", projection: "sprite" };
      case 55:
        return { category: "misc", name: "TRAP_DOOR", projection: "sprite" };
      case 56:
        return {
          category: "misc",
          name: "TRAP_TELEPORTER",
          projection: "sprite",
        };
      case 57:
        return {
          category: "misc",
          name: "LEVEL_TELEPORTER",
          projection: "sprite",
        };
      case 58:
        return {
          category: "misc",
          name: "MAGIC_PORTAL",
          projection: "sprite",
        };
      case 59:
        return { category: "misc", name: "WEB_TRAP", projection: "sprite" };
      case 60:
        return { category: "object", name: "STATUE", projection: "sprite" };
      case 61:
        return { category: "misc", name: "MAGIC_TRAP", projection: "sprite" };
      case 62:
        return {
          category: "misc",
          name: "TRAP_ANTI_MAGIC",
          projection: "sprite",
        };
      case 63:
        return {
          category: "misc",
          name: "TRAP_POLYMORPH",
          projection: "sprite",
        };
      case 64:
        return { category: "misc", name: "MAGIC_TRAP", projection: "sprite" };
      default:
        if (materialKind === "dark_wall" || materialKind === "wall") {
          return this.resolveWallLookup(cmapIndex, materialKind);
        }
        if (materialKind === "dark") {
          return this.resolveFloorLookup("DARK", floorX, floorY);
        }
        return genericFloorLookup;
    }
  }

  private resolveTileLookupForGlyph(
    glyph: number,
    materialKind: TileMaterialKind | null,
    forBillboard: boolean,
    floorX: number | null,
    floorY: number | null,
  ): VultureTileLookup | null {
    const entry = getGlyphCatalogEntry(glyph);
    if (!entry) {
      return null;
    }

    switch (entry.kind) {
      case "mon":
      case "pet":
      case "detect":
      case "ridden": {
        const key = this.resolveMonsterKeyForGlyph(entry.kind, glyph);
        if (!key) {
          return null;
        }
        return {
          category: "monster",
          name: key,
          projection: "sprite",
        };
      }
      case "statue": {
        const key = this.resolveMonsterKeyForGlyph("statue", glyph);
        if (!key) {
          return null;
        }
        return {
          category: "statue",
          name: key,
          projection: "sprite",
        };
      }
      case "cmap": {
        const rangeStart = this.getRangeStart("cmap");
        if (rangeStart === null) {
          return null;
        }
        const cmapIndex = glyph - rangeStart;
        return this.resolveCmapLookup(cmapIndex, materialKind, floorX, floorY);
      }
      case "warning": {
        const rangeStart = this.getRangeStart("warning");
        if (rangeStart === null) {
          return null;
        }
        const warningIndex = glyph - rangeStart;
        return {
          category: "misc",
          name: `WARNLEV_${warningIndex + 1}`,
          projection: "sprite",
        };
      }
      case "zap": {
        const rangeStart = this.getRangeStart("zap");
        if (rangeStart === null) {
          return null;
        }
        const zapIndex = glyph - rangeStart;
        const zapName = zapTileNames[zapIndex % zapTileNames.length];
        return {
          category: "misc",
          name: zapName,
          projection: "sprite",
        };
      }
      case "explode": {
        const rangeStart = this.getRangeStart("explode");
        if (rangeStart === null) {
          return null;
        }
        const explosionOffset = glyph - rangeStart;
        const typeIndex = Math.floor(explosionOffset / 9);
        const frameIndex = (explosionOffset % 9) + 1;
        const typeName =
          explosionTypeNames[typeIndex] ?? explosionTypeNames[0];
        return {
          category: "explosion",
          name: `${typeName}_${frameIndex}`,
          projection: "sprite",
        };
      }
      case "obj":
      case "body":
        return forBillboard
          ? {
              category: "object",
              name: "STRANGE_OBJECT",
              projection: "sprite",
            }
          : genericFloorLookup;
      default:
        return null;
    }
  }

  private drawIsoFloorToTopDownTexture(
    context: CanvasRenderingContext2D,
    size: number,
    image: HTMLImageElement,
    hsX: number,
    hsY: number,
    solidifyOpaqueEdges: boolean = false,
  ): void {
    const hotspotX = -hsX;
    const hotspotY = -hsY;
    const sourceWidth = Math.max(1, image.width);
    const sourceHeight = Math.max(1, image.height);

    const scaleX = size / sourceWidth;
    const scaleY = size / sourceHeight;
    const matrixA = scaleX;
    const matrixB = -scaleX;
    const matrixC = scaleY;
    const matrixD = scaleY;
    const matrixE = size * 0.5 - matrixA * hotspotX - matrixC * hotspotY;
    const matrixF = size * 0.5 - matrixB * hotspotX - matrixD * hotspotY;

    context.save();
    context.imageSmoothingEnabled = false;
    context.setTransform(matrixA, matrixB, matrixC, matrixD, matrixE, matrixF);
    context.drawImage(image, 0, 0);
    context.restore();
    this.dilateTransparentPixels(context, size, 2);
    if (solidifyOpaqueEdges) {
      this.solidifyOpaqueTileToBorders(context, size);
    }
  }

  private dilateOpaquePixels(
    data: Uint8ClampedArray,
    size: number,
    iterations: number,
  ): void {
    if (iterations <= 0 || size <= 1) {
      return;
    }
    const directions: ReadonlyArray<readonly [number, number]> = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (let pass = 0; pass < iterations; pass += 1) {
      const source = new Uint8ClampedArray(data);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = (y * size + x) * 4;
          if (source[index + 3] > 0) {
            continue;
          }
          let bestNeighborIndex = -1;
          let bestNeighborAlpha = 0;
          for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
              continue;
            }
            const neighborIndex = (ny * size + nx) * 4;
            const neighborAlpha = source[neighborIndex + 3];
            if (neighborAlpha <= bestNeighborAlpha) {
              continue;
            }
            bestNeighborAlpha = neighborAlpha;
            bestNeighborIndex = neighborIndex;
          }
          if (bestNeighborIndex < 0) {
            continue;
          }
          data[index] = source[bestNeighborIndex];
          data[index + 1] = source[bestNeighborIndex + 1];
          data[index + 2] = source[bestNeighborIndex + 2];
          data[index + 3] = source[bestNeighborIndex + 3];
        }
      }
    }
  }

  private extendOpaqueRunsToBorders(
    data: Uint8ClampedArray,
    size: number,
  ): void {
    const rowHasOpaque = new Array<boolean>(size).fill(false);
    for (let y = 0; y < size; y += 1) {
      let firstOpaqueX = -1;
      let lastOpaqueX = -1;
      for (let x = 0; x < size; x += 1) {
        const alpha = data[(y * size + x) * 4 + 3];
        if (alpha <= 0) {
          continue;
        }
        if (firstOpaqueX < 0) {
          firstOpaqueX = x;
        }
        lastOpaqueX = x;
      }
      if (firstOpaqueX < 0 || lastOpaqueX < 0) {
        continue;
      }
      rowHasOpaque[y] = true;
      const firstIndex = (y * size + firstOpaqueX) * 4;
      const lastIndex = (y * size + lastOpaqueX) * 4;
      for (let x = 0; x < firstOpaqueX; x += 1) {
        const index = (y * size + x) * 4;
        data[index] = data[firstIndex];
        data[index + 1] = data[firstIndex + 1];
        data[index + 2] = data[firstIndex + 2];
        data[index + 3] = data[firstIndex + 3];
      }
      for (let x = lastOpaqueX + 1; x < size; x += 1) {
        const index = (y * size + x) * 4;
        data[index] = data[lastIndex];
        data[index + 1] = data[lastIndex + 1];
        data[index + 2] = data[lastIndex + 2];
        data[index + 3] = data[lastIndex + 3];
      }
    }
    for (let y = 0; y < size; y += 1) {
      if (rowHasOpaque[y]) {
        continue;
      }
      let sourceRow = -1;
      for (let search = y - 1; search >= 0; search -= 1) {
        if (rowHasOpaque[search]) {
          sourceRow = search;
          break;
        }
      }
      if (sourceRow < 0) {
        for (let search = y + 1; search < size; search += 1) {
          if (rowHasOpaque[search]) {
            sourceRow = search;
            break;
          }
        }
      }
      if (sourceRow < 0) {
        continue;
      }
      for (let x = 0; x < size; x += 1) {
        const srcIndex = (sourceRow * size + x) * 4;
        const destIndex = (y * size + x) * 4;
        data[destIndex] = data[srcIndex];
        data[destIndex + 1] = data[srcIndex + 1];
        data[destIndex + 2] = data[srcIndex + 2];
        data[destIndex + 3] = data[srcIndex + 3];
      }
      rowHasOpaque[y] = true;
    }
  }

  private solidifyOpaqueTileToBorders(
    context: CanvasRenderingContext2D,
    size: number,
  ): void {
    const imageData = context.getImageData(0, 0, size, size);
    const data = imageData.data;
    this.dilateOpaquePixels(data, size, 3);
    this.extendOpaqueRunsToBorders(data, size);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) {
        continue;
      }
      data[i + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
  }

  private dilateTransparentPixels(
    context: CanvasRenderingContext2D,
    size: number,
    iterations: number,
  ): void {
    if (iterations <= 0) {
      return;
    }
    const imageData = context.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let pass = 0; pass < iterations; pass += 1) {
      const source = new Uint8ClampedArray(data);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = (y * size + x) * 4;
          if (source[index + 3] > 0) {
            continue;
          }
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let sumA = 0;
          let sampleCount = 0;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
              continue;
            }
            const neighborIndex = (ny * size + nx) * 4;
            const alpha = source[neighborIndex + 3];
            if (alpha <= 0) {
              continue;
            }
            sumR += source[neighborIndex];
            sumG += source[neighborIndex + 1];
            sumB += source[neighborIndex + 2];
            sumA += alpha;
            sampleCount += 1;
          }
          if (sampleCount <= 0) {
            continue;
          }
          data[index] = Math.round(sumR / sampleCount);
          data[index + 1] = Math.round(sumG / sampleCount);
          data[index + 2] = Math.round(sumB / sampleCount);
          data[index + 3] = Math.round(sumA / sampleCount);
        }
      }
    }
    context.putImageData(imageData, 0, 0);
  }

  private drawSpriteWithHotspot(
    context: CanvasRenderingContext2D,
    size: number,
    image: HTMLImageElement,
    hsX: number,
    hsY: number,
    forBillboard: boolean,
  ): void {
    const hotspotX = -hsX;
    const hotspotY = -hsY;
    const sourceWidth = Math.max(1, image.width);
    const sourceHeight = Math.max(1, image.height);
    const scale = forBillboard
      ? Math.max(0.001, size / Math.max(1, this.nominalTileSize))
      : Math.max(0.001, Math.min(size / sourceWidth, size / sourceHeight));
    const targetHotspotX = size * 0.5;
    const targetHotspotY = forBillboard ? size * 0.9 : size * 0.5;
    const drawX = targetHotspotX - hotspotX * scale;
    const drawY = targetHotspotY - hotspotY * scale;
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      drawX,
      drawY,
      sourceWidth * scale,
      sourceHeight * scale,
    );
  }
}
