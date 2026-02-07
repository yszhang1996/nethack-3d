export type GlyphKind =
  | "mon"
  | "pet"
  | "invis"
  | "detect"
  | "body"
  | "ridden"
  | "obj"
  | "cmap"
  | "explode"
  | "zap"
  | "swallow"
  | "warning"
  | "statue"
  | "unexplored"
  | "nothing";

export interface GlyphCatalogEntry {
  glyph: number;
  kind: GlyphKind;
  ch: number;
  color: number;
  special: number;
}

export interface GlyphCatalogRange {
  key: string;
  kind: GlyphKind;
  start: number;
  endExclusive: number;
}

export interface GlyphCatalogMeta {
  sourceJsPath: string;
  sourceWasmPath: string;
  sourceJsSha256: string;
  sourceWasmSha256: string;
  maxGlyph: number;
  noGlyph: number;
}

export interface ResolvedGlyph {
  glyph: number;
  kind: GlyphKind | "unknown";
  char: string | null;
  color: number | null;
  special: number | null;
  isKnown: boolean;
}

export type TileMaterialKind =
  | "floor"
  | "wall"
  | "door"
  | "dark"
  | "fountain"
  | "player"
  | "monster"
  | "item"
  | "default";

export type TileGeometryKind = "floor" | "wall";

export interface TileBehaviorResult {
  resolved: ResolvedGlyph;
  effective: ResolvedGlyph;
  materialKind: TileMaterialKind;
  geometryKind: TileGeometryKind;
  isWall: boolean;
  isPlayerGlyph: boolean;
  isDarkOverlay: boolean;
  darkenFactor: number;
  glyphChar: string;
}
