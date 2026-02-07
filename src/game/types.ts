import * as THREE from "three";

export type TileMap = Map<string, THREE.Mesh>;

export interface GlyphOverlay {
  texture: THREE.CanvasTexture | null;
  material: THREE.MeshBasicMaterial;
  baseColorHex: string;
  textureKey: string;
}

export type GlyphOverlayMap = Map<string, GlyphOverlay>;
export type TerrainSnapshot = { glyph: number; char?: string; color?: number };
