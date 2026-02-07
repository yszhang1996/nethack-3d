export {
  GLYPH_CATALOG,
  GLYPH_CATALOG_META,
  GLYPH_CATALOG_RANGES,
} from "./glyph-catalog.generated";
export { classifyTileBehavior } from "./behavior";
export {
  getGlyphCatalogEntry,
  getGlyphCatalogMeta,
  getGlyphCatalogRanges,
  getGlyphKind,
  resolveGlyph,
} from "./registry";
export type {
  GlyphCatalogEntry,
  GlyphCatalogMeta,
  GlyphCatalogRange,
  GlyphKind,
  ResolvedGlyph,
  TileBehaviorResult,
  TileGeometryKind,
  TileMaterialKind,
} from "./types";
