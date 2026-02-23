import type { TerrainSnapshot } from "../types";
import { getMergedGlyphOverride } from "./overrides";
import { getGlyphCatalogRanges, resolveGlyph } from "./registry";
import type {
  GlyphDisposition,
  ResolvedGlyph,
  TileBehaviorResult,
  TileEffectKind,
  TileGeometryKind,
  TileMaterialKind,
} from "./types";

// NetHack hero role glyph block starts at 329 (e.g. archeologist),
// so 330 misses one valid player glyph and can leak a player sprite in FPS.
const PLAYER_GLYPH_MIN = 327;
const PLAYER_GLYPH_MAX = 360;

function getGlyphKindRange(
  kind: string,
): { start: number; endExclusive: number } | null {
  const ranges = getGlyphCatalogRanges();
  for (const range of ranges) {
    if (range.kind === kind) {
      return { start: range.start, endExclusive: range.endExclusive };
    }
  }
  return null;
}

function getCmapIndex(glyph: number): number | null {
  const range = getGlyphKindRange("cmap");
  if (!range) {
    return null;
  }
  if (glyph < range.start || glyph >= range.endExclusive) {
    return null;
  }
  return glyph - range.start;
}

export function getDefaultFloorGlyph(): number {
  const range = getGlyphKindRange("cmap");
  if (!range) {
    return 0;
  }
  // drawing.c: S_room is index 19 ("floor of a room").
  return range.start + 19;
}

export function getDefaultDarkFloorGlyph(): number {
  const range = getGlyphKindRange("cmap");
  if (!range) {
    return getDefaultFloorGlyph();
  }
  // drawing.c: index 21 is dark corridor, which is a good unseen-dark fallback.
  return range.start + 21;
}

export function getDefaultDarkWallGlyph(): number {
  const range = getGlyphKindRange("cmap");
  if (!range) {
    return getDefaultDarkFloorGlyph();
  }
  // drawing.c: index 0 is stone/out-of-bounds and classifies as dark wall.
  return range.start;
}

export function isDarkCorridorCmapGlyph(glyph: number): boolean {
  return getCmapIndex(glyph) === 21;
}

export function isDoorwayCmapGlyph(glyph: number): boolean {
  const cmapIndex = getCmapIndex(glyph);
  return (
    cmapIndex === 12 || // doorway
    cmapIndex === 13 || // open vertical door
    cmapIndex === 14 || // open horizontal door
    cmapIndex === 15 || // closed vertical door
    cmapIndex === 16 // closed horizontal door
  );
}

export function isSinkCmapGlyph(glyph: number): boolean {
  // drawing.c: cmap index 30 is sink (S_sink).
  return getCmapIndex(glyph) === 30;
}

type CmapSemantic =
  | "wall"
  | "floor"
  | "door_open"
  | "door_closed"
  | "stairs_up"
  | "stairs_down"
  | "fountain"
  | "water"
  | "trap"
  | "feature"
  | "dark_floor"
  | "dark_wall";

function semanticForCmapIndex(cmapIndex: number): CmapSemantic {
  // drawing.c indices in NetHack 3.6/3.7 use a stable layout for core terrain.
  if (cmapIndex === 0) return "dark_wall"; // stone/out-of-bounds

  // Core walls and wall-like obstacles.
  if (cmapIndex >= 1 && cmapIndex <= 11) return "wall";
  if (cmapIndex === 15 || cmapIndex === 16) return "door_closed";
  if (cmapIndex === 17 || cmapIndex === 18) return "wall"; // bars/tree
  if (cmapIndex === 37 || cmapIndex === 38) return "wall"; // raised drawbridges

  // Doors and floors.
  if (cmapIndex === 12) return "floor"; // doorway
  if (cmapIndex === 13 || cmapIndex === 14) return "door_open";

  if (cmapIndex === 19) return "floor"; // room
  if (cmapIndex === 20 || cmapIndex === 21) return "dark_floor"; // dark room/corridor
  if (cmapIndex === 22) return "floor"; // lit corridor

  // Stairs/ladders.
  if (cmapIndex === 23 || cmapIndex === 25) return "stairs_up";
  if (cmapIndex === 24 || cmapIndex === 26) return "stairs_down";

  // Water-ish terrain.
  if (cmapIndex === 31) return "fountain";
  if (cmapIndex === 32 || cmapIndex === 34 || cmapIndex === 41) return "water";

  // Traps (including the vibrating square).
  if (cmapIndex >= 42 && cmapIndex <= 64) return "trap";

  // Everything else is treated as a passable floor feature.
  return "feature";
}

function semanticForCmapGlyph(glyph: number): CmapSemantic | null {
  const cmapIndex = getCmapIndex(glyph);
  if (cmapIndex === null) {
    return null;
  }
  return semanticForCmapIndex(cmapIndex);
}

function isPlayerGlyph(glyph: number, runtimeChar: string | null): boolean {
  if (glyph < PLAYER_GLYPH_MIN || glyph > PLAYER_GLYPH_MAX) {
    return false;
  }
  return runtimeChar === "@" || !runtimeChar;
}

function fallbackGlyphChar(glyph: number, resolved: ResolvedGlyph): string {
  if (resolved.char && resolved.char.length > 0) {
    return resolved.char;
  }
  return glyph >= 0 ? "?" : " ";
}

function inferDisposition(
  effective: ResolvedGlyph,
  isPlayer: boolean,
): GlyphDisposition {
  if (isPlayer) {
    return "friendly";
  }

  switch (effective.kind) {
    case "pet":
    case "ridden":
      return "friendly";
    case "mon":
    case "warning":
    case "explode":
    case "zap":
    case "swallow":
      return "hostile";
    case "detect":
    case "statue":
    case "invis":
      return "neutral";
    default:
      return "unknown";
  }
}

function textColorFor(
  disposition: GlyphDisposition,
  effective: ResolvedGlyph,
  effectKind: TileEffectKind | null,
): string {
  if (effectKind === "warning") return "#FFF9E8";
  if (effectKind === "zap") return "#F3FBFF";
  if (effectKind === "explode") return "#FFF4EC";
  if (effectKind === "swallow") return "#FAF2FF";

  switch (effective.kind) {
    case "obj":
    case "body":
      return "#FFF7D6";
    case "cmap":
      return "#F4F4F4";
    default:
      break;
  }

  switch (disposition) {
    case "friendly":
      return "#F7FFF9";
    case "hostile":
      return "#FFF5F5";
    case "neutral":
      return "#F3F8FF";
    default:
      return "#F4F4F4";
  }
}

function applyCmapSemantic(semantic: CmapSemantic): {
  materialKind: TileMaterialKind;
  geometryKind: TileGeometryKind;
  isWall: boolean;
  effectKind: TileEffectKind | null;
} {
  switch (semantic) {
    case "wall":
      return {
        materialKind: "wall",
        geometryKind: "wall",
        isWall: true,
        effectKind: null,
      };
    case "dark_wall":
      return {
        materialKind: "dark_wall",
        geometryKind: "wall",
        isWall: true,
        effectKind: null,
      };
    case "door_closed":
      return {
        materialKind: "door",
        geometryKind: "wall",
        isWall: true,
        effectKind: null,
      };
    case "door_open":
      return {
        materialKind: "door",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "stairs_up":
      return {
        materialKind: "stairs_up",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "stairs_down":
      return {
        materialKind: "stairs_down",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "floor":
      return {
        materialKind: "floor",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "dark_floor":
      return {
        materialKind: "dark",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "fountain":
      return {
        materialKind: "fountain",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "water":
      return {
        materialKind: "water",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "trap":
      return {
        materialKind: "trap",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "feature":
    default:
      return {
        materialKind: "feature",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
  }
}

function baseMaterialForDisposition(
  disposition: GlyphDisposition,
): TileMaterialKind {
  switch (disposition) {
    case "friendly":
      return "monster_friendly";
    case "hostile":
      return "monster_hostile";
    case "neutral":
      return "monster_neutral";
    default:
      return "monster_hostile";
  }
}

function classifyByKind(
  effective: ResolvedGlyph,
  isPlayer: boolean,
): {
  materialKind: TileMaterialKind;
  geometryKind: TileGeometryKind;
  isWall: boolean;
  effectKind: TileEffectKind | null;
} {
  if (isPlayer) {
    return {
      materialKind: "player",
      geometryKind: "floor",
      isWall: false,
      effectKind: null,
    };
  }

  switch (effective.kind) {
    case "cmap": {
      const semantic = semanticForCmapGlyph(effective.glyph) || "feature";
      return applyCmapSemantic(semantic);
    }
    case "obj":
    case "body":
      return {
        materialKind: "item",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "warning":
      return {
        materialKind: "effect_warning",
        geometryKind: "floor",
        isWall: false,
        effectKind: "warning",
      };
    case "zap":
      return {
        materialKind: "effect_zap",
        geometryKind: "floor",
        isWall: false,
        effectKind: "zap",
      };
    case "explode":
      return {
        materialKind: "effect_explode",
        geometryKind: "floor",
        isWall: false,
        effectKind: "explode",
      };
    case "swallow":
      return {
        materialKind: "effect_swallow",
        geometryKind: "floor",
        isWall: false,
        effectKind: "swallow",
      };
    case "statue":
      return {
        materialKind: "monster_neutral",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    case "mon":
    case "pet":
    case "detect":
    case "ridden":
    case "invis":
      return {
        materialKind: baseMaterialForDisposition(
          inferDisposition(effective, false),
        ),
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
    default:
      return {
        materialKind: "default",
        geometryKind: "floor",
        isWall: false,
        effectKind: null,
      };
  }
}

export function classifyTileBehavior(input: {
  glyph: number;
  runtimeChar?: string | null;
  runtimeColor?: number | null;
  priorTerrain?: TerrainSnapshot | null;
}): TileBehaviorResult {
  const runtimeChar =
    typeof input.runtimeChar === "string" && input.runtimeChar.length > 0
      ? input.runtimeChar.charAt(0)
      : null;

  const resolved = resolveGlyph(input.glyph, runtimeChar, input.runtimeColor);
  const resolvedCmapSemantic =
    resolved.kind === "cmap" ? semanticForCmapGlyph(resolved.glyph) : null;
  const isDeterministicDarkCmap =
    resolvedCmapSemantic === "dark_floor" ||
    resolvedCmapSemantic === "dark_wall";
  const darkOverlayIndex = getCmapIndex(input.glyph);
  const isDarkOverlay =
    darkOverlayIndex === 0 ||
    darkOverlayIndex === 20 ||
    darkOverlayIndex === 21;
  const isPlayer = isPlayerGlyph(input.glyph, runtimeChar);

  let effective = resolved;
  let darkenFactor = 1;
  // Keep explicit dark cmap tiles deterministic; only unknown overlays borrow prior terrain.
  if (isDarkOverlay && !isDeterministicDarkCmap) {
    if (input.priorTerrain) {
      effective = resolveGlyph(
        input.priorTerrain.glyph,
        input.priorTerrain.char ?? null,
        input.priorTerrain.color ?? null,
      );
    }
    darkenFactor = darkOverlayIndex === 21 ? 0.45 : 0.6;
  }

  const disposition = inferDisposition(effective, isPlayer);
  const byKind = classifyByKind(effective, isPlayer);
  let materialKind = byKind.materialKind;
  let geometryKind = byKind.geometryKind;
  let isWall = byKind.isWall;
  let effectKind = byKind.effectKind;
  let glyphChar = isDarkOverlay
    ? fallbackGlyphChar(input.glyph, resolved)
    : fallbackGlyphChar(effective.glyph, effective);
  let textColor = textColorFor(disposition, effective, effectKind);
  let resolvedDisposition: GlyphDisposition = disposition;

  const override = getMergedGlyphOverride(input.glyph, effective.kind);
  if (override) {
    if (override.materialKind) materialKind = override.materialKind;
    if (override.geometryKind) geometryKind = override.geometryKind;
    if (typeof override.isWall === "boolean") isWall = override.isWall;
    if (
      typeof override.glyphChar === "string" &&
      override.glyphChar.length > 0
    ) {
      glyphChar = override.glyphChar.charAt(0);
    }
    if (
      typeof override.textColor === "string" &&
      override.textColor.length > 0
    ) {
      textColor = override.textColor;
    }
    if (typeof override.darkenFactor === "number") {
      darkenFactor = override.darkenFactor;
    }
    if (override.disposition) {
      resolvedDisposition = override.disposition;
      if (!override.textColor) {
        textColor = textColorFor(resolvedDisposition, effective, effectKind);
      }
    }
    if (override.effectKind !== undefined) {
      effectKind = override.effectKind;
      if (!override.textColor) {
        textColor = textColorFor(resolvedDisposition, effective, effectKind);
      }
    }
  }

  // Dot glyphs should always render flat, even when the underlying semantic is wall-like.
  if (glyphChar.trim() === ".") {
    if (materialKind === "wall" || materialKind === "dark_wall") {
      materialKind = "floor";
    }
    geometryKind = "floor";
    isWall = false;
  }

  return {
    resolved,
    effective,
    materialKind,
    geometryKind,
    isWall,
    isPlayerGlyph: isPlayer,
    isDarkOverlay,
    darkenFactor,
    glyphChar,
    textColor,
    disposition: resolvedDisposition,
    effectKind,
  };
}
