import type { TerrainSnapshot } from "../types";
import { resolveGlyph } from "./registry";
import type { ResolvedGlyph, TileBehaviorResult } from "./types";

const PLAYER_GLYPH_MIN = 331;
const PLAYER_GLYPH_MAX = 360;

const OPEN_DOOR_GLYPHS = new Set([2390, 2391, 2409, 2410]);
const CLOSED_DOOR_GLYPHS = new Set([2389, 2392, 2411, 2412]);
const DARK_OVERLAY_GLYPHS = new Set([2377, 2397, 2398]);

function isPlayerGlyph(glyph: number, runtimeChar: string | null): boolean {
  if (glyph < PLAYER_GLYPH_MIN || glyph > PLAYER_GLYPH_MAX) {
    return false;
  }
  return runtimeChar === "@" || !runtimeChar;
}

function isStructuralWallGlyph(glyph: number): boolean {
  return glyph >= 2378 && glyph <= 2394;
}

function getDoorState(
  glyph: number,
  char: string | null
): "open" | "closed" | null {
  if (OPEN_DOOR_GLYPHS.has(glyph)) return "open";
  if (CLOSED_DOOR_GLYPHS.has(glyph)) return "closed";
  if (char === "+") return "closed";
  return null;
}

function fallbackGlyphChar(glyph: number, resolved: ResolvedGlyph): string {
  if (resolved.char && resolved.char.length > 0) {
    return resolved.char;
  }
  return glyph >= 0 ? "?" : " ";
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
  const darkOverlay = DARK_OVERLAY_GLYPHS.has(input.glyph);
  const playerGlyph = isPlayerGlyph(input.glyph, runtimeChar);

  let effective = resolved;
  let darkenFactor = 1;
  if (darkOverlay) {
    if (input.priorTerrain) {
      effective = resolveGlyph(
        input.priorTerrain.glyph,
        input.priorTerrain.char ?? null,
        input.priorTerrain.color ?? null
      );
    }
    darkenFactor = input.glyph === 2398 ? 0.45 : 0.6;
  }

  const effectiveChar = effective.char;
  const doorState = getDoorState(effective.glyph, effectiveChar);

  let materialKind: TileBehaviorResult["materialKind"] = "default";
  let geometryKind: TileBehaviorResult["geometryKind"] = "floor";
  let isWall = false;

  if (effectiveChar === ".") {
    materialKind = "floor";
    geometryKind = "floor";
  } else if (doorState === "closed") {
    materialKind = "door";
    geometryKind = "wall";
    isWall = true;
  } else if (doorState === "open") {
    materialKind = "door";
    geometryKind = "floor";
  } else if (effectiveChar) {
    if (effectiveChar === " ") {
      if (darkOverlay && input.glyph === 2397) {
        materialKind = "floor";
        geometryKind = "floor";
      } else {
        materialKind = "wall";
        geometryKind = "wall";
        isWall = true;
      }
    } else if (effectiveChar === "#") {
      materialKind = darkOverlay && input.glyph === 2398 ? "dark" : "floor";
      geometryKind = "floor";
    } else if (effectiveChar === "|" || effectiveChar === "-") {
      if (isStructuralWallGlyph(effective.glyph)) {
        materialKind = "wall";
        geometryKind = "wall";
        isWall = true;
      } else {
        materialKind = "floor";
        geometryKind = "floor";
      }
    } else if (playerGlyph) {
      materialKind = "player";
      geometryKind = "floor";
    } else if (effectiveChar === "@") {
      materialKind = "monster";
      geometryKind = "floor";
    } else if (effectiveChar === "{") {
      materialKind = "fountain";
      geometryKind = "floor";
    } else if (/[a-zA-Z:;&'"]/.test(effectiveChar)) {
      materialKind = "monster";
      geometryKind = "floor";
    } else if (/[)(\[%*$?!=/\\<>]/.test(effectiveChar)) {
      materialKind = "item";
      geometryKind = "floor";
    } else {
      materialKind = "floor";
      geometryKind = "floor";
    }
  } else {
    if (isStructuralWallGlyph(effective.glyph)) {
      materialKind = "wall";
      geometryKind = "wall";
      isWall = true;
    } else if (effective.glyph >= 2395 && effective.glyph <= 2397) {
      materialKind = "floor";
      geometryKind = "floor";
    } else if (playerGlyph) {
      materialKind = "player";
      geometryKind = "floor";
    } else if (effective.glyph >= 400 && effective.glyph <= 500) {
      materialKind = "monster";
      geometryKind = "floor";
    } else if (effective.glyph >= 1900 && effective.glyph <= 2400) {
      materialKind = "item";
      geometryKind = "floor";
    } else {
      materialKind = "floor";
      geometryKind = "floor";
    }
  }

  const glyphChar = darkOverlay
    ? fallbackGlyphChar(input.glyph, resolved)
    : fallbackGlyphChar(effective.glyph, effective);

  return {
    resolved,
    effective,
    materialKind,
    geometryKind,
    isWall,
    isPlayerGlyph: playerGlyph,
    isDarkOverlay: darkOverlay,
    darkenFactor,
    glyphChar,
  };
}
