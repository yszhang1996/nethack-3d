import {
  GLYPH_CATALOG,
  GLYPH_CATALOG_META,
  GLYPH_CATALOG_RANGES,
} from "./glyph-catalog.generated";
import type {
  GlyphCatalogEntry,
  GlyphCatalogMeta,
  GlyphCatalogRange,
  GlyphKind,
  ResolvedGlyph,
} from "./types";

function normalizeRuntimeChar(runtimeChar?: string | null): string | null {
  if (typeof runtimeChar !== "string" || runtimeChar.length === 0) {
    return null;
  }
  return runtimeChar.charAt(0);
}

function normalizeRuntimeColor(runtimeColor?: number | null): number | null {
  return typeof runtimeColor === "number" && Number.isFinite(runtimeColor)
    ? runtimeColor
    : null;
}

function codePointToChar(codePoint: number): string | null {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

export function getGlyphCatalogMeta(): GlyphCatalogMeta {
  return GLYPH_CATALOG_META;
}

export function getGlyphCatalogRanges(): readonly GlyphCatalogRange[] {
  return GLYPH_CATALOG_RANGES;
}

export function getGlyphCatalogEntry(glyph: number): GlyphCatalogEntry | null {
  if (!Number.isInteger(glyph) || glyph < 0 || glyph >= GLYPH_CATALOG.length) {
    return null;
  }
  return GLYPH_CATALOG[glyph] || null;
}

export function getGlyphKind(glyph: number): GlyphKind | "unknown" {
  const entry = getGlyphCatalogEntry(glyph);
  return entry ? entry.kind : "unknown";
}

export function resolveGlyph(
  glyph: number,
  runtimeChar?: string | null,
  runtimeColor?: number | null
): ResolvedGlyph {
  const entry = getGlyphCatalogEntry(glyph);
  const normalizedRuntimeChar = normalizeRuntimeChar(runtimeChar);
  const normalizedRuntimeColor = normalizeRuntimeColor(runtimeColor);

  if (!entry) {
    return {
      glyph,
      kind: "unknown",
      char: normalizedRuntimeChar,
      color: normalizedRuntimeColor,
      special: null,
      isKnown: false,
    };
  }

  const catalogChar = codePointToChar(entry.ch);
  return {
    glyph,
    kind: entry.kind,
    char: normalizedRuntimeChar ?? catalogChar,
    color: typeof entry.color === "number" ? entry.color : normalizedRuntimeColor,
    special: typeof entry.special === "number" ? entry.special : null,
    isKnown: true,
  };
}
