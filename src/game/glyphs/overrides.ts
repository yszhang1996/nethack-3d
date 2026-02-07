import type { GlyphKind } from "./types";
import type { GlyphRenderOverride } from "./types";

const glyphOverrides = new Map<number, GlyphRenderOverride>();
const kindOverrides = new Map<GlyphKind | "unknown", GlyphRenderOverride>();

export function setGlyphOverride(
  glyph: number,
  override: GlyphRenderOverride
): void {
  glyphOverrides.set(glyph, { ...override });
}

export function getGlyphOverride(glyph: number): GlyphRenderOverride | null {
  return glyphOverrides.get(glyph) || null;
}

export function clearGlyphOverride(glyph: number): void {
  glyphOverrides.delete(glyph);
}

export function setGlyphKindOverride(
  kind: GlyphKind | "unknown",
  override: GlyphRenderOverride
): void {
  kindOverrides.set(kind, { ...override });
}

export function getGlyphKindOverride(
  kind: GlyphKind | "unknown"
): GlyphRenderOverride | null {
  return kindOverrides.get(kind) || null;
}

export function clearGlyphKindOverride(kind: GlyphKind | "unknown"): void {
  kindOverrides.delete(kind);
}

export function getMergedGlyphOverride(
  glyph: number,
  kind: GlyphKind | "unknown"
): GlyphRenderOverride | null {
  const byKind = kindOverrides.get(kind);
  const byGlyph = glyphOverrides.get(glyph);
  if (!byKind && !byGlyph) {
    return null;
  }
  return {
    ...(byKind || {}),
    ...(byGlyph || {}),
  };
}

export function clearAllGlyphOverrides(): void {
  glyphOverrides.clear();
  kindOverrides.clear();
}

export function getAllGlyphOverrides(): {
  byGlyph: Record<number, GlyphRenderOverride>;
  byKind: Record<string, GlyphRenderOverride>;
} {
  const byGlyph: Record<number, GlyphRenderOverride> = {};
  const byKind: Record<string, GlyphRenderOverride> = {};

  for (const [glyph, override] of glyphOverrides.entries()) {
    byGlyph[glyph] = { ...override };
  }
  for (const [kind, override] of kindOverrides.entries()) {
    byKind[kind] = { ...override };
  }

  return { byGlyph, byKind };
}
