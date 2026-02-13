/*
 * Main entry point for the NetHack 3D client.
 * This module runs NetHack WASM locally in-browser and renders the game in 3D using Three.js.
 */

import * as THREE from "three";
import { WorkerRuntimeBridge } from "../runtime";
import type { RuntimeBridge, RuntimeEvent } from "../runtime";
import { TILE_SIZE, WALL_HEIGHT } from "./constants";
import { classifyTileBehavior } from "./glyphs/behavior";
import type {
  TileBehaviorResult,
  TileEffectKind,
  TileMaterialKind,
} from "./glyphs";
import type {
  GlyphOverlay,
  GlyphOverlayMap,
  TerrainSnapshot,
  TileMap,
} from "./types";
import type {
  CharacterCreationConfig,
  Nethack3DEngineController,
  Nethack3DEngineOptions,
  Nethack3DEngineUIAdapter,
  NethackConnectionState,
  PlayerStatsSnapshot,
  QuestionDialogState,
} from "./ui-types";

type LightingGrid = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  blocked: Uint8Array;
  undiscoveredMask: Uint8Array;
};

type FloatingMessageEntry = {
  container: HTMLDivElement;
  text: HTMLDivElement;
  fadeTimerId: number;
  removeTimerId: number;
};

type PendingCharacterDamage = {
  amount: number;
  createdAtMs: number;
  expectedDirection: DirectionalAttackContext | null;
};

type DirectionalAttackContext = {
  dx: number;
  dy: number;
  originX: number;
  originY: number;
  capturedAtMs: number;
};

type PendingMonsterDefeatSignal = {
  createdAtMs: number;
  expectedDirection: DirectionalAttackContext | null;
};

type GlyphDamageFlashState = {
  key: string;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  elapsedMs: number;
  durationMs: number;
  baseColorHex: string;
  glyphChar: string;
  darkenFactor: number;
};

type GlyphDamageShakeState = {
  key: string;
  tileX: number;
  tileY: number;
  elapsedMs: number;
  durationMs: number;
  amplitude: number;
  seed: number;
};

type BloodMistParticle = {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  ageMs: number;
  lifetimeMs: number;
  radius: number;
  baseScale: THREE.Vector2;
};

type DamageNumberParticle = {
  kind: "damage" | "heal";
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  ageMs: number;
  lifetimeMs: number;
  radius: number;
  baseScale: THREE.Vector2;
};

type TileRevealFadeState = {
  elapsedMs: number;
  durationMs: number;
  opacity: number;
};

type CharacterCreationQuestionPayload = {
  text: string;
  choices: string;
  defaultChoice: string;
  menuItems: any[];
};

/**
 * The main game engine class. It encapsulates all the logic for the 3D client.
 */
class Nethack3DEngine implements Nethack3DEngineController {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private readonly mountElement: HTMLElement | null;
  private readonly uiAdapter: Nethack3DEngineUIAdapter | null;

  private tileMap: TileMap = new Map();
  private glyphOverlayMap: GlyphOverlayMap = new Map();
  private tileStateCache: Map<string, string> = new Map();
  private lastKnownTerrain: Map<string, TerrainSnapshot> = new Map();
  private glyphTextureCache: Map<
    string,
    { texture: THREE.CanvasTexture; refCount: number }
  > = new Map();
  private pendingTileUpdates: Map<string, any> = new Map();
  private tileFlushScheduled: boolean = false;
  private playerPos = { x: 0, y: 0 };
  private gameMessages: string[] = [];
  private floatingMessageLayer: HTMLDivElement | null = null;
  private floatingMessageEntries: FloatingMessageEntry[] = [];
  private hasSeenPlayerPosition: boolean = false;
  private hasPlayerMovedOnce: boolean = false;
  private lastMovementInputAtMs: number = 0;
  private readonly maxFloatingMessages: number = 12;
  private readonly movementUnlockWindowMs: number = 5000;
  private readonly floatingMessageStackSpacingPx: number = 30;
  private readonly floatingMessageFadeDelayMs: number = 1500;
  private readonly floatingMessageFadeDurationMs: number = 520;
  private readonly floatingMessageRisePx: number = 44;
  private statusDebugHistory: any[] = [];
  private currentInventory: any[] = []; // Store current inventory items
  private pendingInventoryDialog: boolean = false; // Flag to show inventory dialog after update
  private lastInfoMenu: { title: string; lines: string[] } | null = null;
  private isInventoryDialogVisible: boolean = false;
  private isInfoDialogVisible: boolean = false;
  private activeQuestionText: string = "";
  private activeQuestionChoices: string = "";
  private activeQuestionDefaultChoice: string = "";
  private activeQuestionMenuItems: any[] = [];
  private activeQuestionVisibleMenuItems: any[] = [];
  private activeQuestionMenuPageIndex: number = 0;
  private activeQuestionMenuPageCount: number = 1;
  private activeQuestionPageSelectionMap: Map<string, string> = new Map();
  private activeQuestionIsPickupDialog: boolean = false;
  private activePickupSelections: Set<string> = new Set();
  private activePickupFocusIndex: number = 0;
  private activeQuestionMenuFocusIndex: number = 0;
  private activeQuestionActionFocusIndex: number = -1;
  private positionHideTimerId: number | null = null;
  private positionInputModeActive: boolean = false;
  private positionCursor = { x: 0, y: 0 };
  private hasRuntimePositionCursor: boolean = false;
  private positionCursorOutline: THREE.Line | null = null;
  private readonly positionCursorOutlineColorHex: number = 0xffe15a;
  private readonly positionCursorOutlineInset: number = 0.04;
  private readonly positionCursorGroundZ: number = 0.03;
  private readonly positionCursorWallZ: number = WALL_HEIGHT + 0.03;

  // Player stats tracking
  private playerStats = {
    name: "Adventurer",
    hp: 10,
    maxHp: 10,
    power: 0,
    maxPower: 0,
    level: 1,
    experience: 0,
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    armor: 10,
    dungeon: "Dungeons of Doom",
    dlevel: 1,
    gold: 0,
    alignment: "Neutral",
    hunger: "Not Hungry",
    encumbrance: "",
    time: 1,
    score: 0,
  };

  private session: RuntimeBridge | null = null;
  private readonly metaInputPrefix = "__META__:";
  private readonly menuSelectionInputPrefix = "__MENU_SELECT__:";
  private readonly textInputPrefix = "__TEXT_INPUT__:";
  private isTextInputActive: boolean = false;
  private characterCreationConfig: CharacterCreationConfig = { mode: "create" };
  private characterCreationMode: "random" | "create" = "create";
  private readonly questionMenuPageAccelerators: string[] =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  private altOrMetaHeld: boolean = false;
  private metaCommandModeActive: boolean = false;
  private metaCommandBuffer: string = "";
  private metaCommandModal: HTMLDivElement | null = null;
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  // Camera controls
  private cameraDistance: number = 20;
  private cameraPitch: number = Math.PI / 2 - 0.3; // Elevation above the board (0 = horizon)
  private cameraYaw: number = 0; // Azimuth around the board (0 = facing north)
  private readonly minCameraPitch: number = 0.2;
  private readonly maxCameraPitch: number = Math.PI / 2 - 0.01;
  private readonly rotationSpeed: number = 0.01;
  private isMiddleMouseDown: boolean = false;
  private isRightMouseDown: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private touchSwipeStart: {
    x: number;
    y: number;
    startedAtMs: number;
  } | null = null;
  private readonly touchSwipeMinDistancePx: number = 26;
  private readonly touchSwipeMaxDurationMs: number = 720;
  private minDistance: number = 5;
  private maxDistance: number = 50;
  private readonly maxRendererPixelRatio: number = 2;

  // Direction question handling
  private isInDirectionQuestion: boolean = false;

  // General question handling (pauses all movement)
  private isInQuestion: boolean = false;
  private numberPadModeEnabled: boolean = true;

  // Camera panning
  private cameraPanX: number = 0;
  private cameraPanY: number = 0;
  private cameraFollowHalfLifeMs: number = 85;
  private cameraFollowInitialized: boolean = false;
  private cameraFollowTarget = new THREE.Vector3();
  private cameraFollowCurrent = new THREE.Vector3();
  private lastFrameTimeMs: number | null = null;
  private lastKnownPlayerHp: number | null = null;
  private pendingCharacterDamageQueue: PendingCharacterDamage[] = [];
  private readonly pendingCharacterDamageMaxAgeMs: number = 420;
  private readonly glyphDamageFlashDurationMs: number = 180;
  private readonly glyphDamageFlashTextureSize: number = 256;
  private readonly glyphDamageFlashRed = new THREE.Color("#ff2d2d");
  private readonly glyphDamageFlashWhite = new THREE.Color("#ffffff");
  private readonly glyphDamageFlashColor = new THREE.Color("#ffffff");
  private glyphDamageFlashes: Map<string, GlyphDamageFlashState> = new Map();
  private glyphDamageShakes: Map<string, GlyphDamageShakeState> = new Map();
  private damageParticles: BloodMistParticle[] = [];
  private playerDamageNumberParticles: DamageNumberParticle[] = [];
  private bloodMistTexture: THREE.CanvasTexture | null = null;
  private lastParsedDamageMessage: string = "";
  private lastParsedDamageAtMs: number = 0;
  private lastParsedDefeatMessage: string = "";
  private lastParsedDefeatAtMs: number = 0;
  private lastDirectionalAttackContext: DirectionalAttackContext | null = null;
  private pendingMonsterDefeatSignals: PendingMonsterDefeatSignal[] = [];
  private readonly pendingMonsterDefeatMaxAgeMs: number = 820;
  private readonly directionalAttackContextMaxAgeMs: number = 900;
  private readonly glyphDamageShakeDurationMs: number = 155;
  private readonly glyphDefeatShakeDurationMs: number = 240;
  private readonly glyphDamageShakeAmplitude: number = TILE_SIZE * 0.08;
  private readonly glyphDefeatShakeAmplitude: number = TILE_SIZE * 0.14;
  private readonly bloodParticleHitLifetimeMs: number = 620;
  private readonly bloodParticleDefeatLifetimeMs: number = 1250;
  private readonly bloodParticleHitCountMin: number = 5;
  private readonly bloodParticleHitCountMax: number = 10;
  private readonly bloodParticleDefeatCountMin: number = 18;
  private readonly bloodParticleDefeatCountMax: number = 32;
  private readonly bloodParticleSpawnJitter: number = 0.12;
  private readonly damageParticleGravity: number = 67;
  private readonly damageParticleDrag: number = 4.2;
  private readonly playerDamageNumberGravity: number = 18.4;
  private readonly playerDamageNumberDrag: number = 2.4;
  private readonly playerDamageNumberLifetimeMs: number = 1860;
  private readonly playerDamageNumberFadeDelayMs: number = 250;
  private readonly playerHealNumberLifetimeMs: number = 1200;
  private readonly playerHealNumberFadeDelayMs: number = 250;
  private readonly playerDamageNumberWallBounce: number = 0.35;
  private readonly damageParticleFloorZ: number = 0.02;
  private readonly damageParticleWallBounce: number = 0.24;
  private readonly tileRevealFadeDurationMs: number = 240;
  private tileRevealFades: Map<string, TileRevealFadeState> = new Map();

  // Pre-create geometries and materials
  private floorGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  private wallGeometry = new THREE.BoxGeometry(
    TILE_SIZE,
    TILE_SIZE,
    WALL_HEIGHT,
  );

  // Materials for different glyph types
  private materials = {
    floor: new THREE.MeshLambertMaterial({ color: 0x6a4d28 }),
    stairs_up: new THREE.MeshLambertMaterial({
      color: 0x3f8753,
      emissive: 0x15301d,
    }),
    stairs_down: new THREE.MeshLambertMaterial({
      color: 0x7d5cc8,
      emissive: 0x251b3a,
    }),
    wall: new THREE.MeshLambertMaterial({ color: 0x5f6773 }),
    dark_wall: new THREE.MeshLambertMaterial({ color: 0x4a5060 }),
    door: new THREE.MeshLambertMaterial({
      color: 0x5a3b22,
      emissive: 0x1b120a,
    }),
    dark: new THREE.MeshLambertMaterial({ color: 0x17385f }),
    water: new THREE.MeshLambertMaterial({
      color: 0x1a6dbe,
      emissive: 0x08253f,
    }),
    trap: new THREE.MeshLambertMaterial({
      color: 0xac6c2e,
      emissive: 0x3a230f,
    }),
    feature: new THREE.MeshLambertMaterial({ color: 0x73768b }),
    fountain: new THREE.MeshLambertMaterial({
      color: 0x2ea8ff,
      emissive: 0x0b2f4d,
    }),
    player: new THREE.MeshLambertMaterial({
      color: 0x39ff88,
      emissive: 0x114d2a,
    }),
    monster_hostile: new THREE.MeshLambertMaterial({
      color: 0x9f3434,
      emissive: 0x311010,
    }),
    monster_friendly: new THREE.MeshLambertMaterial({
      color: 0x2f8f4f,
      emissive: 0x12301c,
    }),
    monster_neutral: new THREE.MeshLambertMaterial({
      color: 0x2f6fa8,
      emissive: 0x10263a,
    }),
    item: new THREE.MeshLambertMaterial({
      color: 0xa87f1a,
      emissive: 0x352707,
    }),
    effect_warning: new THREE.MeshLambertMaterial({
      color: 0x9d6e1f,
      emissive: 0x302109,
    }),
    effect_zap: new THREE.MeshLambertMaterial({
      color: 0x2f8290,
      emissive: 0x0e2730,
    }),
    effect_explode: new THREE.MeshLambertMaterial({
      color: 0xa7582d,
      emissive: 0x341b0f,
    }),
    effect_swallow: new THREE.MeshLambertMaterial({
      color: 0x68469a,
      emissive: 0x221733,
    }),
    default: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };
  private effectColors: Record<TileEffectKind, THREE.Color> = {
    warning: new THREE.Color(0xffd166),
    zap: new THREE.Color(0x7df9ff),
    explode: new THREE.Color(0xffb46b),
    swallow: new THREE.Color(0xd8a8ff),
  };
  private lightingOverlayMesh: THREE.Mesh | null = null;
  private lightingOverlayTexture: THREE.CanvasTexture | null = null;
  private lightingOverlayCanvas: HTMLCanvasElement | null = null;
  private lightingOverlayContext: CanvasRenderingContext2D | null = null;
  private lightingOverlayGridMeta: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
    tilePixels: number;
  } | null = null;
  private lightingDirty: boolean = true;
  private readonly lightingRadiusTiles: number = 14;
  private readonly lightingTilePixels: number = 30;
  private readonly lightingFloorFalloffPower: number = 1.08;
  private readonly lightingMaxDarkAlpha: number = 0.82;
  private readonly lightingUndiscoveredDarkScale: number = 0.25;
  private readonly lightingDitherStrength: number = 0.05;
  private readonly lightingBayer4: number[] = [
    0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
  ].map((value) => (value + 0.5) / 16);

  private isPersistentTerrainKind(kind: string): boolean {
    switch (kind) {
      case "cmap":
      case "obj":
      case "body":
      case "statue":
      case "unexplored":
      case "nothing":
        return true;
      default:
        return false;
    }
  }

  private markLightingDirty(): void {
    this.lightingDirty = true;
  }

  private isUndiscoveredKind(kind: string): boolean {
    return kind === "unexplored" || kind === "nothing";
  }

  private stopTileRevealFade(key: string): void {
    this.tileRevealFades.delete(key);
    const overlay = this.glyphOverlayMap.get(key);
    if (overlay) {
      overlay.material.opacity = 1;
      overlay.material.needsUpdate = true;
    }
  }

  private startTileRevealFade(key: string): void {
    const overlay = this.glyphOverlayMap.get(key);
    if (!overlay) {
      return;
    }

    const state: TileRevealFadeState = {
      elapsedMs: 0,
      durationMs: this.tileRevealFadeDurationMs,
      opacity: 0,
    };
    this.tileRevealFades.set(key, state);
    overlay.material.opacity = state.opacity;
    overlay.material.needsUpdate = true;
  }

  private updateTileRevealFades(deltaSeconds: number): void {
    if (!this.tileRevealFades.size) {
      return;
    }

    const deltaMs = deltaSeconds * 1000;
    const entries = Array.from(this.tileRevealFades.entries());

    for (const [key, state] of entries) {
      const overlay = this.glyphOverlayMap.get(key);
      if (!overlay || !this.tileMap.has(key)) {
        this.tileRevealFades.delete(key);
        continue;
      }

      state.elapsedMs += deltaMs;
      const progress = THREE.MathUtils.clamp(
        state.elapsedMs / state.durationMs,
        0,
        1,
      );
      const eased = 1 - Math.pow(1 - progress, 2);
      state.opacity = eased;
      overlay.material.opacity = state.opacity;
      overlay.material.needsUpdate = true;

      if (progress >= 1) {
        this.tileRevealFades.delete(key);
        overlay.material.opacity = 1;
      }
    }
  }

  private clearTileRevealFades(): void {
    const keys = Array.from(this.tileRevealFades.keys());
    this.tileRevealFades.clear();

    for (const key of keys) {
      const overlay = this.glyphOverlayMap.get(key);
      if (overlay) {
        overlay.material.opacity = 1;
      }
    }
  }

  private parseTileKey(key: string): { x: number; y: number } | null {
    const commaIndex = key.indexOf(",");
    if (commaIndex < 0) {
      return null;
    }
    const x = Number(key.slice(0, commaIndex));
    const y = Number(key.slice(commaIndex + 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  private buildLightingGrid(): LightingGrid | null {
    if (this.tileMap.size === 0) {
      return null;
    }

    const cells: Array<{
      x: number;
      y: number;
      isWall: boolean;
      isUndiscovered: boolean;
    }> = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    this.tileMap.forEach((mesh, key) => {
      const parsed = this.parseTileKey(key);
      if (!parsed) {
        return;
      }

      const { x, y } = parsed;
      cells.push({
        x,
        y,
        isWall: Boolean(mesh.userData?.isWall),
        isUndiscovered: Boolean(mesh.userData?.isUndiscovered),
      });

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });

    if (!cells.length) {
      return null;
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const blocked = new Uint8Array(width * height);
    const undiscoveredMask = new Uint8Array(width * height);
    undiscoveredMask.fill(1);

    for (const cell of cells) {
      const index = (cell.y - minY) * width + (cell.x - minX);
      blocked[index] = cell.isWall ? 1 : 0;
      undiscoveredMask[index] = cell.isUndiscovered ? 1 : 0;
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      blocked,
      undiscoveredMask,
    };
  }

  private worldToLightingPixel(
    grid: LightingGrid,
    worldX: number,
    worldY: number,
  ): { x: number; y: number } {
    const tilePixels = this.lightingTilePixels;
    return {
      x: (worldX - (grid.minX - 0.5)) * tilePixels,
      y: (worldY - (grid.minY - 0.5)) * tilePixels,
    };
  }

  private disposeLightingOverlay(): void {
    if (this.lightingOverlayMesh) {
      this.scene.remove(this.lightingOverlayMesh);
      this.lightingOverlayMesh.geometry.dispose();
      const material = this.lightingOverlayMesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
      this.lightingOverlayMesh = null;
    }

    if (this.lightingOverlayTexture) {
      this.lightingOverlayTexture.dispose();
      this.lightingOverlayTexture = null;
    }

    this.lightingOverlayCanvas = null;
    this.lightingOverlayContext = null;
    this.lightingOverlayGridMeta = null;
  }

  private ensureLightingOverlayResources(grid: LightingGrid): boolean {
    const tilePixels = this.lightingTilePixels;
    const widthPixels = Math.max(1, grid.width * tilePixels);
    const heightPixels = Math.max(1, grid.height * tilePixels);

    const shouldRebuild =
      !this.lightingOverlayMesh ||
      !this.lightingOverlayTexture ||
      !this.lightingOverlayCanvas ||
      !this.lightingOverlayContext ||
      !this.lightingOverlayGridMeta ||
      this.lightingOverlayGridMeta.minX !== grid.minX ||
      this.lightingOverlayGridMeta.maxX !== grid.maxX ||
      this.lightingOverlayGridMeta.minY !== grid.minY ||
      this.lightingOverlayGridMeta.maxY !== grid.maxY ||
      this.lightingOverlayGridMeta.width !== grid.width ||
      this.lightingOverlayGridMeta.height !== grid.height ||
      this.lightingOverlayGridMeta.tilePixels !== tilePixels;

    if (shouldRebuild) {
      this.disposeLightingOverlay();

      const canvas = document.createElement("canvas");
      canvas.width = widthPixels;
      canvas.height = heightPixels;
      const context = canvas.getContext("2d");
      if (!context) {
        return false;
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.generateMipmaps = false;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;

      const geometry = new THREE.PlaneGeometry(
        grid.width * TILE_SIZE,
        grid.height * TILE_SIZE,
      );
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        ((grid.minX + grid.maxX) * TILE_SIZE) / 2,
        ((-grid.minY - grid.maxY) * TILE_SIZE) / 2,
        WALL_HEIGHT,
      );
      mesh.renderOrder = 900;
      this.scene.add(mesh);

      this.lightingOverlayMesh = mesh;
      this.lightingOverlayTexture = texture;
      this.lightingOverlayCanvas = canvas;
      this.lightingOverlayContext = context;
      this.lightingOverlayGridMeta = {
        minX: grid.minX,
        maxX: grid.maxX,
        minY: grid.minY,
        maxY: grid.maxY,
        width: grid.width,
        height: grid.height,
        tilePixels,
      };
    }

    return Boolean(
      this.lightingOverlayTexture &&
      this.lightingOverlayCanvas &&
      this.lightingOverlayContext,
    );
  }

  private renderLightingOverlay(grid: LightingGrid): void {
    if (
      !this.lightingOverlayTexture ||
      !this.lightingOverlayCanvas ||
      !this.lightingOverlayContext
    ) {
      return;
    }

    const canvas = this.lightingOverlayCanvas;
    const context = this.lightingOverlayContext;
    const widthPixels = canvas.width;
    const heightPixels = canvas.height;

    context.clearRect(0, 0, widthPixels, heightPixels);

    context.globalCompositeOperation = "source-over";
    context.fillStyle = `rgba(0, 0, 0, ${this.lightingMaxDarkAlpha})`;
    context.fillRect(0, 0, widthPixels, heightPixels);

    const playerPixel = this.worldToLightingPixel(
      grid,
      this.playerPos.x,
      this.playerPos.y,
    );
    const radiusPixels = this.lightingRadiusTiles * this.lightingTilePixels;

    context.globalCompositeOperation = "destination-out";
    const radial = context.createRadialGradient(
      playerPixel.x,
      playerPixel.y,
      0,
      playerPixel.x,
      playerPixel.y,
      radiusPixels,
    );
    const stops = 16;
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      const alpha = Math.pow(
        Math.max(0, 1 - t),
        this.lightingFloorFalloffPower,
      );
      radial.addColorStop(t, `rgba(0, 0, 0, ${alpha})`);
    }
    context.fillStyle = radial;
    context.beginPath();
    context.arc(playerPixel.x, playerPixel.y, radiusPixels, 0, Math.PI * 2);
    context.fill();

    const imageData = context.getImageData(0, 0, widthPixels, heightPixels);
    const data = imageData.data;
    const tilePixels = this.lightingTilePixels;
    for (let y = 0; y < heightPixels; y++) {
      const cellY = Math.min(grid.height - 1, Math.floor(y / tilePixels));
      for (let x = 0; x < widthPixels; x++) {
        const index = (y * widthPixels + x) * 4;
        const cellX = Math.min(grid.width - 1, Math.floor(x / tilePixels));
        const cellIndex = cellY * grid.width + cellX;
        let alpha = data[index + 3] / 255;
        if (grid.undiscoveredMask[cellIndex]) {
          alpha *= this.lightingUndiscoveredDarkScale;
        }
        const dither =
          (this.lightingBayer4[(x & 3) + ((y & 3) << 2)] - 0.5) *
          this.lightingDitherStrength;
        const adjusted = THREE.MathUtils.clamp(alpha + dither, 0, 1);
        data[index + 3] = Math.round(adjusted * 255);
      }
    }
    context.putImageData(imageData, 0, 0);

    context.globalCompositeOperation = "source-over";
    this.lightingOverlayTexture.needsUpdate = true;
  }

  private updateLightingOverlay(): void {
    if (!this.lightingDirty) {
      return;
    }
    this.lightingDirty = false;

    const grid = this.buildLightingGrid();
    if (!grid) {
      this.disposeLightingOverlay();
      return;
    }

    if (!this.ensureLightingOverlayResources(grid)) {
      this.lightingDirty = true;
      return;
    }

    this.renderLightingOverlay(grid);
  }

  constructor(options: Nethack3DEngineOptions = {}) {
    this.mountElement = options.mountElement ?? null;
    this.uiAdapter = options.uiAdapter ?? null;
    this.characterCreationConfig = options.characterCreationConfig ?? {
      mode: "create",
    };
    this.characterCreationMode = this.characterCreationConfig.mode;
    this.initThreeJS();
    this.initUI();
    this.connectToRuntime();
    if (this.uiAdapter) {
      this.uiAdapter.setNumberPadModeEnabled(this.numberPadModeEnabled);
    }

    // Set initial camera position looking straight down with a slight tilt
    this.cameraDistance = 15;
    this.cameraPitch = THREE.MathUtils.clamp(
      Math.PI / 2 - 0.2,
      this.minCameraPitch,
      this.maxCameraPitch,
    );
    // Yaw is in radians; start at 180 degrees to face the board correctly.
    this.cameraYaw = Math.PI;
  }

  private initThreeJS(): void {
    // --- Basic Three.js setup ---
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.updateRendererResolution();
    this.renderer.setClearColor(0x000011); // Dark blue void background
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const host = this.mountElement ?? document.body;
    host.appendChild(this.renderer.domElement);
    this.loadCameraSmoothingFromCSS();

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);

    // --- Event Listeners ---
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    window.addEventListener("keydown", this.handleKeyDown.bind(this), false);
    window.addEventListener("keyup", this.handleKeyUp.bind(this), false);
    window.addEventListener("blur", this.handleWindowBlur.bind(this), false);

    // Mouse controls for camera
    window.addEventListener("wheel", this.handleMouseWheel.bind(this), false);
    window.addEventListener(
      "mousedown",
      this.handleMouseDown.bind(this),
      false,
    );
    window.addEventListener(
      "mousemove",
      this.handleMouseMove.bind(this),
      false,
    );
    window.addEventListener("mouseup", this.handleMouseUp.bind(this), false);
    this.renderer.domElement.addEventListener(
      "touchstart",
      this.handleTouchStart.bind(this),
      { passive: false },
    );
    this.renderer.domElement.addEventListener(
      "touchmove",
      this.handleTouchMove.bind(this),
      { passive: false },
    );
    this.renderer.domElement.addEventListener(
      "touchend",
      this.handleTouchEnd.bind(this),
      { passive: false },
    );
    this.renderer.domElement.addEventListener(
      "touchcancel",
      this.handleTouchCancel.bind(this),
      false,
    );
    window.addEventListener("contextmenu", (e) => e.preventDefault(), false); // Prevent right-click menu

    // Start render loop
    this.animate();
  }

  private loadCameraSmoothingFromCSS(): void {
    const cssValue = getComputedStyle(document.documentElement)
      .getPropertyValue("--camera-follow-half-life-ms")
      .trim();
    const parsed = Number.parseFloat(cssValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      this.cameraFollowHalfLifeMs = parsed;
    }
  }

  private ensureMetaCommandModal(): HTMLDivElement {
    if (this.metaCommandModal) {
      return this.metaCommandModal;
    }

    const modal = document.createElement("div");
    modal.id = "meta-command-modal";
    modal.className = "nh3d-meta-command";
    modal.setAttribute("aria-hidden", "true");
    modal.textContent = "#";
    document.body.appendChild(modal);
    this.metaCommandModal = modal;
    return modal;
  }

  private projectWorldToScreen(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): { x: number; y: number; visible: boolean } {
    const vector = new THREE.Vector3(worldX, worldY, worldZ);
    vector.project(this.camera);

    if (
      !Number.isFinite(vector.x) ||
      !Number.isFinite(vector.y) ||
      !Number.isFinite(vector.z)
    ) {
      return { x: 0, y: 0, visible: false };
    }

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const x = canvasRect.left + ((vector.x + 1) * canvasRect.width) / 2;
    const y = canvasRect.top + ((-vector.y + 1) * canvasRect.height) / 2;
    const visible = vector.z >= -1 && vector.z <= 1;
    return { x, y, visible };
  }

  private updateMetaCommandModalPosition(): void {
    if (!this.metaCommandModeActive || !this.metaCommandModal) {
      return;
    }

    const projected = this.projectWorldToScreen(
      this.playerPos.x * TILE_SIZE,
      -this.playerPos.y * TILE_SIZE,
      WALL_HEIGHT + 0.3,
    );
    if (!projected.visible) {
      this.metaCommandModal.style.visibility = "hidden";
      return;
    }

    this.metaCommandModal.style.visibility = "visible";
    this.metaCommandModal.style.left = `${Math.round(projected.x)}px`;
    this.metaCommandModal.style.top = `${Math.round(projected.y - 34)}px`;
  }

  private updateMetaCommandModal(): void {
    const modal = this.metaCommandModal;
    if (!modal) {
      return;
    }

    if (!this.metaCommandModeActive) {
      modal.classList.remove("is-visible");
      modal.style.visibility = "hidden";
      modal.setAttribute("aria-hidden", "true");
      return;
    }

    modal.textContent = `#${this.metaCommandBuffer}`;
    modal.classList.add("is-visible");
    modal.setAttribute("aria-hidden", "false");
    this.updateMetaCommandModalPosition();
  }

  private initUI(): void {
    this.ensureMetaCommandModal();

    if (this.uiAdapter) {
      this.uiAdapter.setStatus("Starting local NetHack runtime...");
      this.uiAdapter.setConnectionStatus("Disconnected", "disconnected");
      this.uiAdapter.setLoadingVisible(true);
      this.uiAdapter.setExtendedCommands([]);
      return;
    }

    const statusElement = document.getElementById("game-status");
    if (statusElement) {
      statusElement.innerHTML = "Starting local NetHack runtime...";
    }

    const floatingMessageLayer = document.createElement("div");
    floatingMessageLayer.id = "floating-log-message-layer";
    document.body.appendChild(floatingMessageLayer);
    this.floatingMessageLayer = floatingMessageLayer;
  }

  private async connectToRuntime(): Promise<void> {
    console.log("Starting local NetHack runtime");
    this.updateConnectionStatus("Starting", "starting");

    this.session = new WorkerRuntimeBridge(
      (payload: RuntimeEvent) => {
        this.handleRuntimeEvent(payload);
      },
      {
        characterCreation: {
          mode: this.characterCreationConfig.mode,
          name: this.characterCreationConfig.name,
          role: this.characterCreationConfig.role,
          race: this.characterCreationConfig.race,
          gender: this.characterCreationConfig.gender,
          align: this.characterCreationConfig.align,
        },
      },
    );

    try {
      await this.session.start();
      this.updateConnectionStatus("Running", "running");
      this.updateStatus("Local NetHack runtime started");
      // this.addGameMessage("Local NetHack runtime started");
      this.setLoadingVisible(false);
    } catch (error) {
      console.error("Failed to start local NetHack runtime:", error);
      this.updateConnectionStatus("Error", "error");
      this.updateStatus("Failed to start local NetHack runtime");
      this.addGameMessage("Failed to start local NetHack runtime");
      this.setLoadingVisible(true);
    }
  }

  private handleRuntimeEvent(data: RuntimeEvent): void {
    switch (data.type) {
      case "map_glyph":
        this.tryResolvePendingCharacterDamage(data);
        this.enqueueTileUpdate(data);
        break;

      case "map_glyph_batch":
        if (Array.isArray(data.tiles)) {
          for (const tile of data.tiles) {
            this.tryResolvePendingCharacterDamage(tile);
            this.enqueueTileUpdate(tile);
          }
        }
        break;

      case "player_position":
        if (this.positionInputModeActive) {
          console.log(
            `🎯 Ignoring player_position (${data.x}, ${data.y}) while position-input mode is active`,
          );
          break;
        }
        console.log(
          `🎯 Received player position update: (${data.x}, ${data.y})`,
        );
        const oldPos = { ...this.playerPos };
        this.recordPlayerMovement(oldPos.x, oldPos.y, data.x, data.y);
        this.playerPos = { x: data.x, y: data.y };
        this.markLightingDirty();
        console.log(
          `🎯 Player position changed from (${oldPos.x}, ${oldPos.y}) to (${data.x}, ${data.y})`,
        );
        this.updateStatus(`Player at (${data.x}, ${data.y}) - NetHack 3D`);
        break;

      case "force_player_redraw":
        if (this.positionInputModeActive) {
          console.log(
            `🎯 Ignoring force_player_redraw while position-input mode is active`,
          );
          break;
        }
        // Force update player visual position when NetHack doesn't send map updates
        console.log(
          `🎯 Force redraw player from (${data.oldPosition.x}, ${data.oldPosition.y}) to (${data.newPosition.x}, ${data.newPosition.y})`,
        );

        // Update the player position first
        this.recordPlayerMovement(
          data.oldPosition.x,
          data.oldPosition.y,
          data.newPosition.x,
          data.newPosition.y,
        );
        this.playerPos = { x: data.newPosition.x, y: data.newPosition.y };
        this.markLightingDirty();

        // Clear the old player visual position by redrawing it as floor
        const oldKey = `${data.oldPosition.x},${data.oldPosition.y}`;
        const oldOverlay = this.glyphOverlayMap.get(oldKey);
        if (oldOverlay) {
          console.log(
            `🎯 Clearing old player overlay at (${data.oldPosition.x}, ${data.oldPosition.y})`,
          );
          this.disposeGlyphOverlay(oldOverlay);
          this.glyphOverlayMap.delete(oldKey);
        }

        // Redraw the old player position using last known terrain to avoid color flicker.
        const oldTerrain = this.lastKnownTerrain.get(oldKey);
        if (oldTerrain) {
          this.updateTile(
            data.oldPosition.x,
            data.oldPosition.y,
            oldTerrain.glyph,
            oldTerrain.char,
            oldTerrain.color,
          );
        } else {
          // Don't guess terrain when cache is missing; request authoritative tile data.
          this.requestTileUpdate(data.oldPosition.x, data.oldPosition.y);
        }

        // Create a fake player glyph at the new position to ensure visual update
        // Use a typical player glyph number (runtime commonly reports 330 for @).
        this.updateTile(data.newPosition.x, data.newPosition.y, 330, "@", 0);
        console.log(
          `🎯 Player visual updated to position (${data.newPosition.x}, ${data.newPosition.y})`,
        );
        break;

      case "position_input_state":
        this.setPositionInputMode(Boolean(data.active));
        break;

      case "position_cursor":
        if (typeof data.x === "number" && typeof data.y === "number") {
          this.setPositionCursorPosition(data.x, data.y);
        }
        break;

      case "text":
        this.captureMonsterDefeatFromMessage(data.text);
        this.captureDamageFromMessage(data.text);
        this.addGameMessage(data.text);
        break;

      case "raw_print":
        this.captureMonsterDefeatFromMessage(data.text);
        this.captureDamageFromMessage(data.text);
        this.addGameMessage(data.text);
        break;

      case "menu_item":
        // Menu rows are accumulated and delivered with question/inventory events.
        // Ignore incremental item updates to avoid noisy unknown-type logs.
        break;

      case "direction_question":
        // Special handling for direction questions - show UI and pause movement
        this.isInQuestion = true;
        this.showDirectionQuestion(data.text);
        break;
      case "number_pad_mode":
        this.setNumberPadModeEnabled(Boolean(data.enabled));
        break;

      case "question":
        if (this.isCharacterCreationQuestion(String(data.text || ""))) {
          const payload = this.toCharacterCreationQuestionPayload(data);
          if (this.characterCreationMode === "random") {
            this.autoAnswerCharacterCreationQuestion(payload);
            return;
          }
          this.isInQuestion = true;
          this.showQuestion(
            payload.text,
            payload.choices,
            payload.defaultChoice,
            payload.menuItems,
          );
          return;
        }

        // For non-character creation questions, show normal dialog and pause movement
        this.isInQuestion = true;
        this.showQuestion(
          data.text,
          data.choices,
          data.default,
          data.menuItems,
        );
        break;

      case "text_request":
        this.showTextInputRequest(
          String(data.text || ""),
          typeof data.maxLength === "number" ? data.maxLength : 256,
        );
        break;

      case "inventory_update":
        // Handle inventory updates without showing dialog
        const itemCount = data.items ? data.items.length : 0;
        const actualItems = data.items
          ? data.items.filter((item: any) => !item.isCategory)
          : [];
        console.log(
          `📦 Received inventory update with ${itemCount} total items (${actualItems.length} actual items)`,
        );

        // Store the current inventory for later display
        this.currentInventory = data.items || [];

        // If we have a pending inventory dialog request, show it now
        if (this.pendingInventoryDialog) {
          console.log("📦 Showing inventory dialog with fresh data");
          this.pendingInventoryDialog = false;
          this.showInventoryDialog();
        }

        // Update inventory display if we have an inventory UI element
        this.updateInventoryDisplay(data.items);

        break;

      case "info_menu":
        this.lastInfoMenu = {
          title: String(data.title || "NetHack Information"),
          lines: Array.isArray(data.lines) ? data.lines : [],
        };
        this.showInfoMenuDialog(
          this.lastInfoMenu.title,
          this.lastInfoMenu.lines,
        );
        break;

      case "position_request":
        // Only show meaningful position requests, filter out spam
        if (
          data.text &&
          data.text.trim() &&
          !data.text.includes("cursor") &&
          !data.text.includes("Select a position")
        ) {
          this.showPositionRequest(data.text);
        }
        break;

      case "name_request":
        // Runtime handles askname with startup-configured fallback to avoid
        // feedback loops from repeated async name_request events.
        console.log("Name request received from runtime:", data);
        break;

      case "extended_commands":
        this.uiAdapter?.setExtendedCommands(
          this.normalizeRuntimeExtendedCommands(data.commands),
        );
        break;

      case "area_refresh_complete":
        console.log(
          `🔄 Area refresh completed: ${data.tilesRefreshed} tiles refreshed around (${data.centerX}, ${data.centerY})`,
        );
        this.addGameMessage(
          `Refreshed ${data.tilesRefreshed} tiles around (${data.centerX}, ${data.centerY})`,
        );
        break;

      case "tile_not_found":
        console.log(
          `⚠️ Tile not found at (${data.x}, ${data.y}): ${data.message}`,
        );
        break;

      case "clear_scene":
        console.log("🧹 Clearing 3D scene for level transition");
        this.clearScene();
        if (data.message) {
          this.addGameMessage(data.message);
        }
        break;

      case "status_update":
        console.log(
          `Status update: ${data.fieldName || data.field} = "${data.value}" (type=${data.valueType || "unknown"})`,
        );
        this.updatePlayerStats(data.field, data.value, data);
        break;

      case "damage_event":
        if (
          typeof data.x === "number" &&
          typeof data.y === "number" &&
          typeof data.amount === "number"
        ) {
          this.triggerDamageEffectsAtTile(data.x, data.y, data.amount);
        }
        break;

      default:
        console.log("Unknown message type:", data.type, data);
    }
  }

  private normalizeRuntimeExtendedCommands(rawCommands: unknown): string[] {
    if (!Array.isArray(rawCommands)) {
      return [];
    }

    const uniqueCommands: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawCommands) {
      const normalized = String(raw || "")
        .trim()
        .toLowerCase();
      if (!normalized || normalized === "#" || normalized === "?") {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      uniqueCommands.push(normalized);
    }
    return uniqueCommands;
  }

  private isDamageFlashableBehavior(behavior: TileBehaviorResult): boolean {
    if (behavior.isPlayerGlyph) {
      return true;
    }

    return this.isMonsterLikeBehavior(behavior);
  }

  private isMonsterLikeBehavior(behavior: TileBehaviorResult): boolean {
    if (behavior.isPlayerGlyph) {
      return false;
    }

    switch (behavior.effective.kind) {
      case "mon":
      case "pet":
      case "ridden":
      case "detect":
      case "invis":
        return true;
      default:
        return false;
    }
  }

  private classifyTilePayload(tile: any): TileBehaviorResult | null {
    if (
      !tile ||
      typeof tile.x !== "number" ||
      typeof tile.y !== "number" ||
      typeof tile.glyph !== "number"
    ) {
      return null;
    }

    const key = `${tile.x},${tile.y}`;
    return classifyTileBehavior({
      glyph: tile.glyph,
      runtimeChar: typeof tile.char === "string" ? tile.char : null,
      runtimeColor: typeof tile.color === "number" ? tile.color : null,
      priorTerrain: this.lastKnownTerrain.get(key) ?? null,
    });
  }

  private extractDamageAmountFromMessage(message: string): number | null {
    const patterns = [
      /\bfor\s+(-?\d+)\s+damage\b/i,
      /\btakes?\s+(-?\d+)\s+damage\b/i,
      /\bdeals?\s+(-?\d+)\s+damage\b/i,
      /\b(-?\d+)\s+points?\s+of\s+damage\b/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (!match || !match[1]) {
        continue;
      }

      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed !== 0) {
        return Math.abs(parsed);
      }
    }

    return null;
  }

  private isPlayerAttackMessage(message: string): boolean {
    if (/\byou miss\b/i.test(message)) {
      return false;
    }
    return /\byou\s+(?:hit|bite|kick|claw|slash|strike|punch|shoot|zap|stab|maul|wound|smite|throw|thrust)\b/i.test(
      message,
    );
  }

  private isPlayerHitMonsterMessage(message: string): boolean {
    return /\byou hit (?:the |an? )?.+[.!]?$/i.test(message);
  }

  private isMonsterDefeatMessage(message: string): boolean {
    return /\byou (?:kill|destroy) (?:the |an? )?.+[.!]?$/i.test(message);
  }

  private getDirectionVectorFromInput(
    input: string,
  ): { dx: number; dy: number } | null {
    switch (input) {
      case "k":
      case "K":
      case "ArrowUp":
      case "Numpad8":
        return { dx: 0, dy: -1 };
      case "j":
      case "J":
      case "ArrowDown":
      case "Numpad2":
        return { dx: 0, dy: 1 };
      case "h":
      case "H":
      case "ArrowLeft":
      case "Numpad4":
        return { dx: -1, dy: 0 };
      case "l":
      case "L":
      case "ArrowRight":
      case "Numpad6":
        return { dx: 1, dy: 0 };
      case "y":
      case "Y":
      case "Home":
      case "Numpad7":
        return { dx: -1, dy: -1 };
      case "u":
      case "U":
      case "PageUp":
      case "Numpad9":
        return { dx: 1, dy: -1 };
      case "b":
      case "B":
      case "End":
      case "Numpad1":
        return { dx: -1, dy: 1 };
      case "n":
      case "N":
      case "PageDown":
      case "Numpad3":
        return { dx: 1, dy: 1 };
      default:
        break;
    }

    if (!this.numberPadModeEnabled) {
      return null;
    }

    switch (input) {
      case "8":
        return { dx: 0, dy: -1 };
      case "2":
        return { dx: 0, dy: 1 };
      case "4":
        return { dx: -1, dy: 0 };
      case "6":
        return { dx: 1, dy: 0 };
      case "7":
        return { dx: -1, dy: -1 };
      case "9":
        return { dx: 1, dy: -1 };
      case "1":
        return { dx: -1, dy: 1 };
      case "3":
        return { dx: 1, dy: 1 };
      default:
        return null;
    }
  }

  private updateDirectionalAttackContext(input: string): void {
    const direction = this.getDirectionVectorFromInput(input);
    if (!direction) {
      return;
    }
    this.lastDirectionalAttackContext = {
      dx: direction.dx,
      dy: direction.dy,
      originX: this.playerPos.x,
      originY: this.playerPos.y,
      capturedAtMs: Date.now(),
    };
  }

  private getRecentDirectionalAttackContext(
    nowMs: number,
  ): DirectionalAttackContext | null {
    const context = this.lastDirectionalAttackContext;
    if (!context) {
      return null;
    }
    if (nowMs - context.capturedAtMs > this.directionalAttackContextMaxAgeMs) {
      return null;
    }
    return { ...context };
  }

  private isTileInDirectionalAttackPath(
    tileX: number,
    tileY: number,
    context: DirectionalAttackContext | null,
  ): boolean {
    if (!context) {
      return false;
    }

    const deltaX = tileX - context.originX;
    const deltaY = tileY - context.originY;
    if (deltaX === 0 && deltaY === 0) {
      return false;
    }

    return Math.sign(deltaX) === context.dx && Math.sign(deltaY) === context.dy;
  }

  private queuePendingMonsterDefeatSignal(): void {
    const now = Date.now();
    this.pendingMonsterDefeatSignals.push({
      createdAtMs: now,
      expectedDirection: this.getRecentDirectionalAttackContext(now),
    });
    if (this.pendingMonsterDefeatSignals.length > 8) {
      this.pendingMonsterDefeatSignals.splice(
        0,
        this.pendingMonsterDefeatSignals.length - 8,
      );
    }
  }

  private prunePendingMonsterDefeatSignals(nowMs: number): void {
    this.pendingMonsterDefeatSignals = this.pendingMonsterDefeatSignals.filter(
      (entry) => nowMs - entry.createdAtMs <= this.pendingMonsterDefeatMaxAgeMs,
    );
  }

  private consumePendingMonsterDefeatSignal(
    tileX: number,
    tileY: number,
  ): boolean {
    const now = Date.now();
    this.prunePendingMonsterDefeatSignals(now);
    const index = this.pendingMonsterDefeatSignals.findIndex((entry) =>
      this.isTileInDirectionalAttackPath(tileX, tileY, entry.expectedDirection),
    );
    if (index < 0) {
      return false;
    }
    this.pendingMonsterDefeatSignals.splice(index, 1);
    return true;
  }

  private captureMonsterDefeatFromMessage(messageLike: unknown): void {
    if (typeof messageLike !== "string") {
      return;
    }

    const normalized = messageLike.replace(/\s+/g, " ").trim();
    if (!normalized || !this.isMonsterDefeatMessage(normalized)) {
      return;
    }

    const now = Date.now();
    if (
      normalized === this.lastParsedDefeatMessage &&
      now - this.lastParsedDefeatAtMs < 120
    ) {
      return;
    }

    this.lastParsedDefeatMessage = normalized;
    this.lastParsedDefeatAtMs = now;
    this.queuePendingMonsterDefeatSignal();
  }

  private queuePendingCharacterDamage(amount: number): void {
    const sanitized = Math.max(1, Math.round(Math.abs(amount)));
    const now = Date.now();
    this.pendingCharacterDamageQueue.push({
      amount: sanitized,
      createdAtMs: now,
      expectedDirection: this.getRecentDirectionalAttackContext(now),
    });

    if (this.pendingCharacterDamageQueue.length > 8) {
      this.pendingCharacterDamageQueue.splice(
        0,
        this.pendingCharacterDamageQueue.length - 8,
      );
    }
  }

  private prunePendingCharacterDamage(nowMs: number): void {
    this.pendingCharacterDamageQueue = this.pendingCharacterDamageQueue.filter(
      (entry) =>
        nowMs - entry.createdAtMs <= this.pendingCharacterDamageMaxAgeMs,
    );
  }

  private tryTriggerDirectionalMonsterHitSpray(amount: number): boolean {
    const now = Date.now();
    const context = this.getRecentDirectionalAttackContext(now);
    if (!context) {
      return false;
    }

    let targetX: number | null = null;
    let targetY: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [key, mesh] of this.tileMap.entries()) {
      if (!mesh.userData?.isMonsterLikeCharacter) {
        continue;
      }
      const [rawX, rawY] = key.split(",");
      const x = Number.parseInt(rawX, 10);
      const y = Number.parseInt(rawY, 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      if (!this.isTileInDirectionalAttackPath(x, y, context)) {
        continue;
      }
      const distance = Math.max(
        Math.abs(x - context.originX),
        Math.abs(y - context.originY),
      );
      if (distance < 1 || distance >= bestDistance) {
        continue;
      }
      bestDistance = distance;
      targetX = x;
      targetY = y;
    }

    if (targetX === null || targetY === null) {
      return false;
    }

    this.triggerDamageEffectsAtTile(targetX, targetY, amount, "hit");
    return true;
  }

  private captureDamageFromMessage(messageLike: unknown): void {
    if (typeof messageLike !== "string") {
      return;
    }

    const normalized = messageLike.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return;
    }

    const explicitPlayerHit = this.isPlayerHitMonsterMessage(normalized);
    const playerAttack =
      explicitPlayerHit || this.isPlayerAttackMessage(normalized);
    if (!playerAttack) {
      return;
    }

    let amount = this.extractDamageAmountFromMessage(normalized);
    if (!amount) {
      // No explicit number from NetHack? still produce a lightweight hit cue.
      amount = 1;
    }
    if (!amount) {
      return;
    }

    const now = Date.now();
    if (
      normalized === this.lastParsedDamageMessage &&
      now - this.lastParsedDamageAtMs < 120
    ) {
      return;
    }
    this.lastParsedDamageMessage = normalized;
    this.lastParsedDamageAtMs = now;

    if (
      explicitPlayerHit &&
      this.tryTriggerDirectionalMonsterHitSpray(amount)
    ) {
      return;
    }

    this.queuePendingCharacterDamage(amount);
  }

  private tryResolvePendingCharacterDamage(tile: any): void {
    if (!this.pendingCharacterDamageQueue.length) {
      return;
    }

    const now = Date.now();
    this.prunePendingCharacterDamage(now);
    if (!this.pendingCharacterDamageQueue.length) {
      return;
    }

    const behavior = this.classifyTilePayload(tile);
    if (
      !behavior ||
      behavior.isPlayerGlyph ||
      !this.isDamageFlashableBehavior(behavior)
    ) {
      return;
    }

    if (typeof tile.x !== "number" || typeof tile.y !== "number") {
      return;
    }

    const queueIndex = this.pendingCharacterDamageQueue.findIndex((entry) =>
      this.isTileInDirectionalAttackPath(
        tile.x,
        tile.y,
        entry.expectedDirection,
      ),
    );
    if (queueIndex < 0) {
      return;
    }

    const [nextDamage] = this.pendingCharacterDamageQueue.splice(queueIndex, 1);
    if (!nextDamage) {
      return;
    }

    this.triggerDamageEffectsAtTile(tile.x, tile.y, nextDamage.amount);
  }

  private triggerDamageEffectsAtTile(
    x: number,
    y: number,
    amount: number,
    variant: "hit" | "defeat" = "hit",
  ): void {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(amount)
    ) {
      return;
    }

    const damage = Math.max(1, Math.round(Math.abs(amount)));
    const key = `${x},${y}`;
    const isPlayerTarget = x === this.playerPos.x && y === this.playerPos.y;
    if (variant === "hit") {
      this.startGlyphDamageFlash(key);
    }
    if (isPlayerTarget && variant === "hit") {
      this.spawnPlayerDamageNumberParticle(x, y, damage);
    }
    this.startGlyphDamageShake(x, y, variant);
    this.spawnBloodMistParticles(x, y, damage, variant);
  }

  private enqueueTileUpdate(tile: any): void {
    if (!tile || typeof tile.x !== "number" || typeof tile.y !== "number") {
      return;
    }

    const key = `${tile.x},${tile.y}`;
    this.pendingTileUpdates.set(key, tile);

    if (this.tileFlushScheduled) {
      return;
    }

    this.tileFlushScheduled = true;
    requestAnimationFrame(() => this.flushPendingTileUpdates());
  }

  private flushPendingTileUpdates(): void {
    this.tileFlushScheduled = false;
    if (!this.pendingTileUpdates.size) {
      return;
    }

    const updates = Array.from(this.pendingTileUpdates.values());
    this.pendingTileUpdates.clear();

    for (const tile of updates) {
      const key = `${tile.x},${tile.y}`;
      const signature = `${tile.glyph}|${tile.char ?? ""}|${tile.color ?? ""}`;
      if (this.tileStateCache.get(key) === signature) {
        continue;
      }

      this.tileStateCache.set(key, signature);
      this.updateTile(tile.x, tile.y, tile.glyph, tile.char, tile.color);
    }
  }

  /**
   * Request a view update for a specific tile from the local runtime
   * @param x The x coordinate of the tile
   * @param y The y coordinate of the tile
   */
  public requestTileUpdate(x: number, y: number): void {
    if (this.session) {
      console.log(`Requesting tile update for (${x}, ${y})`);
      this.session.requestTileUpdate(x, y);
    } else {
      console.log("Cannot request tile update - runtime not started");
    }
  }
  public requestAreaUpdate(
    centerX: number,
    centerY: number,
    radius: number = 3,
  ): void {
    if (this.session) {
      console.log(
        `Requesting area update centered at (${centerX}, ${centerY}) with radius ${radius}`,
      );
      this.session.requestAreaUpdate(centerX, centerY, radius);
    } else {
      console.log("Cannot request area update - runtime not started");
    }
  }
  public requestPlayerAreaUpdate(radius: number = 5): void {
    this.requestAreaUpdate(this.playerPos.x, this.playerPos.y, radius);
  }

  private acquireGlyphTexture(
    textureKey: string,
    factory: () => THREE.CanvasTexture,
  ): THREE.CanvasTexture {
    const cached = this.glyphTextureCache.get(textureKey);
    if (cached) {
      cached.refCount += 1;
      return cached.texture;
    }

    const texture = factory();
    this.glyphTextureCache.set(textureKey, { texture, refCount: 1 });
    return texture;
  }

  private releaseGlyphTexture(textureKey: string): void {
    if (!textureKey) {
      return;
    }
    const cached = this.glyphTextureCache.get(textureKey);
    if (!cached) {
      return;
    }

    cached.refCount -= 1;
    if (cached.refCount <= 0) {
      cached.texture.dispose();
      this.glyphTextureCache.delete(textureKey);
    }
  }

  private disposeGlyphOverlay(overlay: GlyphOverlay): void {
    this.releaseGlyphTexture(overlay.textureKey);
    overlay.texture = null;
    overlay.textureKey = "";
    overlay.material.dispose();
  }

  private toneColor(hex: string, factor: number): string {
    const color = new THREE.Color(`#${hex}`);
    color.multiplyScalar(THREE.MathUtils.clamp(factor, 0, 1));
    return color.getHexString();
  }

  private relativeLuminance(color: THREE.Color): number {
    const channel = (value: number): number => {
      if (value <= 0.03928) return value / 12.92;
      return Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const r = channel(color.r);
    const g = channel(color.g);
    const b = channel(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  private contrastRatio(background: THREE.Color, text: THREE.Color): number {
    const l1 = this.relativeLuminance(background);
    const l2 = this.relativeLuminance(text);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  private ensureTextContrast(
    tonedBackgroundHex: string,
    textColor: string,
    minContrast: number = 4.5,
  ): string {
    const background = new THREE.Color(`#${tonedBackgroundHex}`);
    const text = new THREE.Color();
    text.set(textColor || "#ffffff");

    if (this.contrastRatio(background, text) >= minContrast) {
      return background.getHexString();
    }

    for (let i = 0; i < 6; i++) {
      background.multiplyScalar(0.85);
      if (this.contrastRatio(background, text) >= minContrast) {
        return background.getHexString();
      }
    }

    return background.getHexString();
  }

  private ensureGlyphOverlay(
    key: string,
    baseMaterial: THREE.MeshLambertMaterial,
  ): GlyphOverlay {
    const baseColorHex = baseMaterial.color.getHexString();
    let overlay = this.glyphOverlayMap.get(key);
    const needsNewOverlay =
      !overlay ||
      overlay.baseColorHex !== baseColorHex ||
      overlay.material instanceof THREE.MeshLambertMaterial === true;

    if (needsNewOverlay) {
      if (overlay) {
        this.disposeGlyphOverlay(overlay);
      }

      const materialClone = new THREE.MeshBasicMaterial({
        color: 0xdddddd,
        transparent: true,
        opacity: 1,
      });
      overlay = {
        texture: null,
        material: materialClone,
        baseColorHex,
        textureKey: "",
      };
      this.glyphOverlayMap.set(key, overlay);
    }

    return overlay!;
  }

  private createGlyphTexture(
    baseColorHex: string,
    glyphChar: string,
    textColor: string,
    darkenFactor: number = 1,
    size: number = 256,
  ): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create glyph texture canvas context");
    }
    this.drawGlyphTextureToCanvas(
      context,
      size,
      baseColorHex,
      glyphChar,
      textColor,
      darkenFactor,
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;

    return texture;
  }

  private drawGlyphTextureToCanvas(
    context: CanvasRenderingContext2D,
    size: number,
    baseColorHex: string,
    glyphChar: string,
    textColor: string,
    darkenFactor: number = 1,
  ): void {
    context.clearRect(0, 0, size, size);

    const tonedBackground = this.toneColor(
      baseColorHex,
      0.8 * THREE.MathUtils.clamp(darkenFactor, 0, 1),
    );
    const contrastBackground = this.ensureTextContrast(
      tonedBackground,
      textColor,
    );
    context.fillStyle = `#${contrastBackground}`;
    context.fillRect(0, 0, size, size);

    const trimmed = glyphChar.trim();
    if (trimmed.length === 0) {
      return;
    }

    const fontSize = Math.floor(size * 0.6);
    context.font = `bold ${fontSize}px monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = textColor;
    context.fillText(trimmed, size / 2, size / 2);
  }

  private startGlyphDamageFlash(key: string): void {
    const mesh = this.tileMap.get(key);
    const overlay = this.glyphOverlayMap.get(key);
    if (
      !mesh ||
      !overlay ||
      !overlay.texture ||
      !mesh.userData ||
      !mesh.userData.isDamageFlashableCharacter
    ) {
      return;
    }

    const glyphChar =
      typeof mesh.userData.glyphChar === "string"
        ? mesh.userData.glyphChar
        : "";
    if (!glyphChar.trim()) {
      return;
    }

    const baseColorHex =
      typeof mesh.userData.glyphBaseColorHex === "string" &&
      mesh.userData.glyphBaseColorHex
        ? mesh.userData.glyphBaseColorHex
        : overlay.baseColorHex;
    const darkenFactor =
      typeof mesh.userData.glyphDarkenFactor === "number"
        ? THREE.MathUtils.clamp(mesh.userData.glyphDarkenFactor, 0, 1)
        : 1;

    let state = this.glyphDamageFlashes.get(key);
    if (!state) {
      const canvas = document.createElement("canvas");
      const size = this.glyphDamageFlashTextureSize;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      texture.anisotropy = Math.min(
        4,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;

      state = {
        key,
        canvas,
        context,
        texture,
        elapsedMs: 0,
        durationMs: this.glyphDamageFlashDurationMs,
        baseColorHex,
        glyphChar,
        darkenFactor,
      };
      this.glyphDamageFlashes.set(key, state);
    } else {
      state.elapsedMs = 0;
      state.baseColorHex = baseColorHex;
      state.glyphChar = glyphChar;
      state.darkenFactor = darkenFactor;
    }

    overlay.material.map = state.texture;
    overlay.material.needsUpdate = true;
    this.renderGlyphDamageFlash(state, 1);
  }

  private renderGlyphDamageFlash(
    state: GlyphDamageFlashState,
    intensity: number,
  ): void {
    const clamped = THREE.MathUtils.clamp(intensity, 0, 1);
    this.glyphDamageFlashColor
      .copy(this.glyphDamageFlashWhite)
      .lerp(this.glyphDamageFlashRed, clamped);
    const flashTextColor = `#${this.glyphDamageFlashColor.getHexString()}`;

    this.drawGlyphTextureToCanvas(
      state.context,
      state.canvas.width,
      state.baseColorHex,
      state.glyphChar,
      flashTextColor,
      state.darkenFactor,
    );
    state.texture.needsUpdate = true;
  }

  private stopGlyphDamageFlash(key: string): void {
    const state = this.glyphDamageFlashes.get(key);
    if (!state) {
      return;
    }

    const overlay = this.glyphOverlayMap.get(key);
    if (overlay) {
      overlay.material.map = overlay.texture;
      overlay.material.needsUpdate = true;
    }

    state.texture.dispose();
    this.glyphDamageFlashes.delete(key);
  }

  private updateGlyphDamageFlashes(deltaSeconds: number): void {
    if (this.glyphDamageFlashes.size === 0) {
      return;
    }

    const deltaMs = deltaSeconds * 1000;
    const entries = Array.from(this.glyphDamageFlashes.entries());

    for (const [key, state] of entries) {
      if (!this.tileMap.has(key) || !this.glyphOverlayMap.has(key)) {
        this.stopGlyphDamageFlash(key);
        continue;
      }

      state.elapsedMs += deltaMs;
      const progress = THREE.MathUtils.clamp(
        state.elapsedMs / state.durationMs,
        0,
        1,
      );
      const intensity = Math.exp(-8.5 * progress);
      this.renderGlyphDamageFlash(state, intensity);

      const overlay = this.glyphOverlayMap.get(key);
      if (overlay) {
        overlay.material.map = state.texture;
      }

      if (progress >= 1) {
        this.stopGlyphDamageFlash(key);
      }
    }
  }

  private startGlyphDamageShake(
    tileX: number,
    tileY: number,
    variant: "hit" | "defeat",
  ): void {
    const key = `${tileX},${tileY}`;
    const mesh = this.tileMap.get(key);
    if (!mesh) {
      return;
    }

    const amplitude =
      variant === "defeat"
        ? this.glyphDefeatShakeAmplitude
        : this.glyphDamageShakeAmplitude;
    const durationMs =
      variant === "defeat"
        ? this.glyphDefeatShakeDurationMs
        : this.glyphDamageShakeDurationMs;

    const existing = this.glyphDamageShakes.get(key);
    if (existing) {
      existing.elapsedMs = 0;
      existing.durationMs = Math.max(existing.durationMs, durationMs);
      existing.amplitude = Math.max(existing.amplitude, amplitude);
      return;
    }

    this.glyphDamageShakes.set(key, {
      key,
      tileX,
      tileY,
      elapsedMs: 0,
      durationMs,
      amplitude,
      seed: Math.random() * Math.PI * 2,
    });
  }

  private stopGlyphDamageShake(key: string): void {
    const state = this.glyphDamageShakes.get(key);
    if (!state) {
      return;
    }

    const mesh = this.tileMap.get(key);
    if (mesh) {
      const baseZ = mesh.userData?.isWall ? WALL_HEIGHT / 2 : 0;
      mesh.position.set(
        state.tileX * TILE_SIZE,
        -state.tileY * TILE_SIZE,
        baseZ,
      );
    }

    this.glyphDamageShakes.delete(key);
  }

  private updateGlyphDamageShakes(deltaSeconds: number): void {
    if (this.glyphDamageShakes.size === 0) {
      return;
    }

    const deltaMs = deltaSeconds * 1000;
    const entries = Array.from(this.glyphDamageShakes.entries());

    for (const [key, state] of entries) {
      const mesh = this.tileMap.get(key);
      if (!mesh) {
        this.glyphDamageShakes.delete(key);
        continue;
      }

      state.elapsedMs += deltaMs;
      const progress = THREE.MathUtils.clamp(
        state.elapsedMs / state.durationMs,
        0,
        1,
      );
      const envelope = Math.pow(1 - progress, 2);
      const jitter = state.amplitude * envelope;
      const oscillationBase = state.elapsedMs / 1000;
      const offsetX =
        Math.sin(oscillationBase * 74 + state.seed) * jitter +
        Math.sin(oscillationBase * 33 + state.seed * 1.37) * jitter * 0.5;
      const offsetY =
        Math.cos(oscillationBase * 81 + state.seed * 0.91) * jitter +
        Math.cos(oscillationBase * 29 + state.seed * 1.71) * jitter * 0.4;
      const baseZ = mesh.userData?.isWall ? WALL_HEIGHT / 2 : 0;

      mesh.position.set(
        state.tileX * TILE_SIZE + offsetX,
        -state.tileY * TILE_SIZE + offsetY,
        baseZ,
      );

      if (progress >= 1) {
        this.stopGlyphDamageShake(key);
      }
    }
  }

  private getBloodMistTexture(): THREE.CanvasTexture {
    if (this.bloodMistTexture) {
      return this.bloodMistTexture;
    }

    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create blood mist canvas context");
    }

    context.clearRect(0, 0, size, size);
    const gradient = context.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.015,
      size * 0.5,
      size * 0.5,
      size * 0.34,
    );
    gradient.addColorStop(0, "rgba(210, 22, 22, 1)");
    gradient.addColorStop(0.22, "rgba(170, 10, 10, 0.99)");
    gradient.addColorStop(0.58, "rgba(118, 4, 4, 0.73)");
    gradient.addColorStop(0.9, "rgba(74, 0, 0, 0.13)");
    gradient.addColorStop(1, "rgba(74, 0, 0, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
    context.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    this.bloodMistTexture = texture;
    return texture;
  }

  private createDamageNumberTexture(
    label: string,
    options?: { fillStyle?: string; strokeStyle?: string },
  ): {
    texture: THREE.CanvasTexture;
    aspectRatio: number;
  } {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create damage number canvas context");
    }

    context.clearRect(0, 0, size, size);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `900 ${Math.floor(size * 0.52)}px "Segoe UI", "Segoe UI Variable", sans-serif`;
    context.lineWidth = Math.max(3, Math.floor(size * 0.045));
    context.strokeStyle = options?.strokeStyle ?? "rgba(18, 0, 0, 0.95)";
    context.fillStyle = options?.fillStyle ?? "#ff3a3a";
    context.strokeText(label, size / 2, size / 2);
    context.fillText(label, size / 2, size / 2);

    const measured = context.measureText(label).width;
    const aspectRatio = THREE.MathUtils.clamp(
      measured / (size * 0.42),
      0.6,
      2.3,
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;

    return { texture, aspectRatio };
  }

  private spawnPlayerDamageNumberParticle(
    tileX: number,
    tileY: number,
    damage: number,
  ): void {
    const label = `-${Math.max(1, Math.round(Math.abs(damage)))}`;
    const { texture, aspectRatio } = this.createDamageNumberTexture(label);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    material.opacity = 1;

    const sprite = new THREE.Sprite(material);
    const scaleMultiplier = 2.5;
    const scaleY = 0.42 * scaleMultiplier;
    const widthTighten = 0.72;
    const scaleX = THREE.MathUtils.clamp(
      scaleY * aspectRatio * widthTighten,
      0.26 * scaleMultiplier,
      0.92 * scaleMultiplier,
    );
    const baseScale = new THREE.Vector2(scaleX, scaleY);
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    sprite.position.set(
      tileX * TILE_SIZE,
      -tileY * TILE_SIZE,
      this.damageParticleFloorZ + 0.28,
    );
    this.alignPlayerDamageNumberToCamera(sprite);
    sprite.renderOrder = 940;
    this.scene.add(sprite);

    const launchSpeed = (1.95 + Math.random() * 0.45) * 5;
    const launchAngleRad = THREE.MathUtils.degToRad(10);
    const launchAzimuthRad = Math.random() * Math.PI * 2;
    const horizontalSpeed = launchSpeed * Math.sin(launchAngleRad);
    const verticalSpeed = launchSpeed * Math.cos(launchAngleRad);

    this.playerDamageNumberParticles.push({
      kind: "damage",
      sprite,
      velocity: new THREE.Vector3(
        Math.cos(launchAzimuthRad) * horizontalSpeed,
        Math.sin(launchAzimuthRad) * horizontalSpeed,
        verticalSpeed,
      ),
      ageMs: 0,
      lifetimeMs: this.playerDamageNumberLifetimeMs,
      radius: 0.09,
      baseScale,
    });
  }

  private spawnPlayerHealNumberParticle(
    tileX: number,
    tileY: number,
    healAmount: number,
  ): void {
    const label = `+${Math.max(1, Math.round(Math.abs(healAmount)))}`;
    const { texture, aspectRatio } = this.createDamageNumberTexture(label, {
      fillStyle: "#5dff86",
      strokeStyle: "rgba(0, 28, 0, 0.95)",
    });
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    material.opacity = 1;

    const sprite = new THREE.Sprite(material);
    const scaleMultiplier = 2.3;
    const scaleY = 0.42 * scaleMultiplier;
    const widthTighten = 0.72;
    const scaleX = THREE.MathUtils.clamp(
      scaleY * aspectRatio * widthTighten,
      0.26 * scaleMultiplier,
      0.92 * scaleMultiplier,
    );
    const baseScale = new THREE.Vector2(scaleX, scaleY);
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    sprite.position.set(
      tileX * TILE_SIZE,
      -tileY * TILE_SIZE,
      this.damageParticleFloorZ + 0.24,
    );
    this.alignPlayerDamageNumberToCamera(sprite);
    sprite.renderOrder = 940;
    this.scene.add(sprite);

    const verticalSpeed = 3.2 + Math.random() * 0.8;
    this.playerDamageNumberParticles.push({
      kind: "heal",
      sprite,
      velocity: new THREE.Vector3(0, 0, verticalSpeed),
      ageMs: 0,
      lifetimeMs: this.playerHealNumberLifetimeMs,
      radius: 0.09,
      baseScale,
    });
  }

  private alignPlayerDamageNumberToCamera(sprite: THREE.Sprite): void {
    sprite.quaternion.copy(this.camera.quaternion);
  }

  private spawnBloodMistParticles(
    tileX: number,
    tileY: number,
    damage: number,
    variant: "hit" | "defeat",
  ): void {
    const sanitized = Math.max(1, Math.round(Math.abs(damage)));
    const texture = this.getBloodMistTexture();
    const awayFromPlayer = new THREE.Vector2(
      tileX - this.playerPos.x,
      -(tileY - this.playerPos.y),
    );
    if (awayFromPlayer.lengthSq() < 0.0001) {
      const randomAngle = Math.random() * Math.PI * 2;
      awayFromPlayer.set(Math.cos(randomAngle), Math.sin(randomAngle));
    } else {
      awayFromPlayer.normalize();
    }

    const spreadRadians =
      variant === "defeat"
        ? THREE.MathUtils.degToRad(52)
        : THREE.MathUtils.degToRad(32);
    const count =
      variant === "defeat"
        ? THREE.MathUtils.randInt(
            this.bloodParticleDefeatCountMin,
            this.bloodParticleDefeatCountMax,
          )
        : THREE.MathUtils.randInt(
            this.bloodParticleHitCountMin,
            this.bloodParticleHitCountMax,
          );
    const particleCount =
      count + (variant === "defeat" ? Math.min(12, sanitized) : 0);
    const baseLifetimeMs =
      variant === "defeat"
        ? this.bloodParticleDefeatLifetimeMs
        : this.bloodParticleHitLifetimeMs;
    const lifetimeJitterMs = variant === "defeat" ? 580 : 260;
    const baseHorizontalSpeed = variant === "defeat" ? 4.2 : 3.1;
    const horizontalBoost = variant === "defeat" ? 0.24 : 0.16;
    const baseVerticalSpeed = variant === "defeat" ? 3.1 : 2.3;
    const minScale = variant === "defeat" ? 0.086 : 0.049;
    const maxScale = variant === "defeat" ? 0.214 : 0.118;

    for (let i = 0; i < particleCount; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      material.opacity = variant === "defeat" ? 0.95 : 0.88;

      const sprite = new THREE.Sprite(material);
      const sizeFactor = Math.pow(Math.random(), 1.35);
      const baseScaleValue = THREE.MathUtils.lerp(
        minScale,
        maxScale,
        sizeFactor,
      );
      const baseScale = new THREE.Vector2(
        baseScaleValue * (0.82 + Math.random() * 0.36),
        baseScaleValue * (0.82 + Math.random() * 0.36),
      );
      sprite.scale.set(baseScale.x, baseScale.y, 1);
      sprite.position.set(
        tileX * TILE_SIZE +
          (Math.random() - 0.5) * this.bloodParticleSpawnJitter,
        -tileY * TILE_SIZE +
          (Math.random() - 0.5) * this.bloodParticleSpawnJitter,
        this.damageParticleFloorZ + 0.16 + Math.random() * 0.24,
      );
      sprite.renderOrder = 930;
      this.scene.add(sprite);

      const directionAngle =
        Math.atan2(awayFromPlayer.y, awayFromPlayer.x) +
        (Math.random() - 0.5) * spreadRadians;
      const horizontalSpeed =
        baseHorizontalSpeed +
        Math.random() * (baseHorizontalSpeed * 0.7) +
        sanitized * horizontalBoost +
        (1 - sizeFactor) * (variant === "defeat" ? 2.6 : 1.9);
      const verticalSpeed =
        baseVerticalSpeed +
        Math.random() * (variant === "defeat" ? 3.2 : 2.2) +
        (1 - sizeFactor) * (variant === "defeat" ? 1.9 : 1.2);

      this.damageParticles.push({
        sprite,
        velocity: new THREE.Vector3(
          Math.cos(directionAngle) * horizontalSpeed,
          Math.sin(directionAngle) * horizontalSpeed,
          verticalSpeed,
        ),
        ageMs: 0,
        lifetimeMs: baseLifetimeMs + Math.random() * lifetimeJitterMs,
        radius: baseScaleValue * 0.52,
        baseScale,
      });
    }
  }

  private disposeDamageParticle(index: number): void {
    if (index < 0 || index >= this.damageParticles.length) {
      return;
    }

    const [particle] = this.damageParticles.splice(index, 1);
    this.scene.remove(particle.sprite);

    const material = particle.sprite.material;
    if (material instanceof THREE.SpriteMaterial) {
      if (material.map && material.map !== this.bloodMistTexture) {
        material.map.dispose();
      }
      material.dispose();
    }
  }

  private disposePlayerDamageNumberParticle(index: number): void {
    if (index < 0 || index >= this.playerDamageNumberParticles.length) {
      return;
    }

    const [particle] = this.playerDamageNumberParticles.splice(index, 1);
    this.scene.remove(particle.sprite);

    const material = particle.sprite.material;
    if (material instanceof THREE.SpriteMaterial) {
      if (material.map) {
        material.map.dispose();
      }
      material.dispose();
    }
  }

  private resolvePlayerDamageNumberAgainstWallTile(
    particle: DamageNumberParticle,
    tileX: number,
    tileY: number,
  ): boolean {
    const position = particle.sprite.position;
    const half = TILE_SIZE / 2;
    const centerX = tileX * TILE_SIZE;
    const centerY = -tileY * TILE_SIZE;
    const minX = centerX - half;
    const maxX = centerX + half;
    const minY = centerY - half;
    const maxY = centerY + half;
    const radius = particle.radius;

    const closestX = THREE.MathUtils.clamp(position.x, minX, maxX);
    const closestY = THREE.MathUtils.clamp(position.y, minY, maxY);
    let nx = position.x - closestX;
    let ny = position.y - closestY;
    const distSq = nx * nx + ny * ny;

    if (distSq >= radius * radius) {
      return false;
    }

    let penetration = 0;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      nx /= dist;
      ny /= dist;
      penetration = radius - dist;
    } else {
      const toLeft = position.x - minX;
      const toRight = maxX - position.x;
      const toBottom = position.y - minY;
      const toTop = maxY - position.y;
      const minPenetration = Math.min(toLeft, toRight, toBottom, toTop);

      if (minPenetration === toLeft) {
        nx = -1;
        ny = 0;
        penetration = toLeft + radius;
      } else if (minPenetration === toRight) {
        nx = 1;
        ny = 0;
        penetration = toRight + radius;
      } else if (minPenetration === toBottom) {
        nx = 0;
        ny = -1;
        penetration = toBottom + radius;
      } else {
        nx = 0;
        ny = 1;
        penetration = toTop + radius;
      }
    }

    position.x += nx * penetration;
    position.y += ny * penetration;

    const velocityIntoWall =
      particle.velocity.x * nx + particle.velocity.y * ny;
    if (velocityIntoWall < 0) {
      const bounce = (1 + this.playerDamageNumberWallBounce) * velocityIntoWall;
      particle.velocity.x -= bounce * nx;
      particle.velocity.y -= bounce * ny;
      particle.velocity.x *= 0.78;
      particle.velocity.y *= 0.78;
    }

    return true;
  }

  private resolvePlayerDamageNumberWallCollision(
    particle: DamageNumberParticle,
  ): void {
    if (particle.sprite.position.z > WALL_HEIGHT + 0.22) {
      return;
    }

    const approxTileX = Math.round(particle.sprite.position.x / TILE_SIZE);
    const approxTileY = Math.round(-particle.sprite.position.y / TILE_SIZE);

    for (let x = approxTileX - 1; x <= approxTileX + 1; x += 1) {
      for (let y = approxTileY - 1; y <= approxTileY + 1; y += 1) {
        const wall = this.tileMap.get(`${x},${y}`);
        if (!wall || !wall.userData?.isWall) {
          continue;
        }
        this.resolvePlayerDamageNumberAgainstWallTile(particle, x, y);
      }
    }
  }

  private resolveDamageParticleAgainstWallTile(
    particle: BloodMistParticle,
    tileX: number,
    tileY: number,
  ): boolean {
    const position = particle.sprite.position;
    const half = TILE_SIZE / 2;
    const centerX = tileX * TILE_SIZE;
    const centerY = -tileY * TILE_SIZE;
    const minX = centerX - half;
    const maxX = centerX + half;
    const minY = centerY - half;
    const maxY = centerY + half;
    const radius = particle.radius;

    const closestX = THREE.MathUtils.clamp(position.x, minX, maxX);
    const closestY = THREE.MathUtils.clamp(position.y, minY, maxY);
    let nx = position.x - closestX;
    let ny = position.y - closestY;
    const distSq = nx * nx + ny * ny;

    if (distSq >= radius * radius) {
      return false;
    }

    let penetration = 0;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      nx /= dist;
      ny /= dist;
      penetration = radius - dist;
    } else {
      const toLeft = position.x - minX;
      const toRight = maxX - position.x;
      const toBottom = position.y - minY;
      const toTop = maxY - position.y;
      const minPenetration = Math.min(toLeft, toRight, toBottom, toTop);

      if (minPenetration === toLeft) {
        nx = -1;
        ny = 0;
        penetration = toLeft + radius;
      } else if (minPenetration === toRight) {
        nx = 1;
        ny = 0;
        penetration = toRight + radius;
      } else if (minPenetration === toBottom) {
        nx = 0;
        ny = -1;
        penetration = toBottom + radius;
      } else {
        nx = 0;
        ny = 1;
        penetration = toTop + radius;
      }
    }

    position.x += nx * penetration;
    position.y += ny * penetration;

    const velocityIntoWall =
      particle.velocity.x * nx + particle.velocity.y * ny;
    if (velocityIntoWall < 0) {
      const bounce = (1 + this.damageParticleWallBounce) * velocityIntoWall;
      particle.velocity.x -= bounce * nx;
      particle.velocity.y -= bounce * ny;
      particle.velocity.x *= 0.78;
      particle.velocity.y *= 0.78;
    }

    return true;
  }

  private resolveDamageParticleWallCollision(
    particle: BloodMistParticle,
  ): void {
    if (particle.sprite.position.z > WALL_HEIGHT + 0.22) {
      return;
    }

    const approxTileX = Math.round(particle.sprite.position.x / TILE_SIZE);
    const approxTileY = Math.round(-particle.sprite.position.y / TILE_SIZE);

    for (let x = approxTileX - 1; x <= approxTileX + 1; x += 1) {
      for (let y = approxTileY - 1; y <= approxTileY + 1; y += 1) {
        const wall = this.tileMap.get(`${x},${y}`);
        if (!wall || !wall.userData?.isWall) {
          continue;
        }
        this.resolveDamageParticleAgainstWallTile(particle, x, y);
      }
    }
  }

  private updateDamageParticles(deltaSeconds: number): void {
    if (!this.damageParticles.length) {
      return;
    }

    const deltaMs = deltaSeconds * 1000;
    const drag = Math.exp(-this.damageParticleDrag * deltaSeconds);

    for (let i = this.damageParticles.length - 1; i >= 0; i -= 1) {
      const particle = this.damageParticles[i];
      particle.ageMs += deltaMs;
      const speed = particle.velocity.length();
      const travelPerFrame = speed * deltaSeconds;
      const subSteps = THREE.MathUtils.clamp(
        Math.ceil(travelPerFrame / (TILE_SIZE * 0.35)),
        1,
        4,
      );
      const stepSeconds = deltaSeconds / subSteps;
      const dragPerStep = Math.pow(drag, 1 / subSteps);

      for (let step = 0; step < subSteps; step += 1) {
        particle.velocity.z -= this.damageParticleGravity * stepSeconds;
        particle.velocity.x *= dragPerStep;
        particle.velocity.y *= dragPerStep;

        particle.sprite.position.x += particle.velocity.x * stepSeconds;
        particle.sprite.position.y += particle.velocity.y * stepSeconds;
        particle.sprite.position.z += particle.velocity.z * stepSeconds;

        this.resolveDamageParticleWallCollision(particle);

        if (particle.sprite.position.z < this.damageParticleFloorZ) {
          particle.sprite.position.z = this.damageParticleFloorZ;
          if (particle.velocity.z < 0) {
            particle.velocity.z *= -0.22;
          }
          particle.velocity.x *= 0.82;
          particle.velocity.y *= 0.82;
        }
      }

      const material = particle.sprite.material;
      if (!(material instanceof THREE.SpriteMaterial)) {
        this.disposeDamageParticle(i);
        continue;
      }

      const lifeT = THREE.MathUtils.clamp(
        particle.ageMs / particle.lifetimeMs,
        0,
        1,
      );
      material.opacity = Math.max(0, 1 - Math.pow(lifeT, 2.1));

      const scaleBoost = 1 + lifeT * 0.34;
      particle.sprite.scale.set(
        particle.baseScale.x * scaleBoost,
        particle.baseScale.y * scaleBoost,
        1,
      );

      if (lifeT >= 1 || material.opacity <= 0.01) {
        this.disposeDamageParticle(i);
      }
    }
  }

  private updatePlayerDamageNumberParticles(deltaSeconds: number): void {
    if (!this.playerDamageNumberParticles.length) {
      return;
    }

    const deltaMs = deltaSeconds * 1000;
    const drag = Math.exp(-this.playerDamageNumberDrag * deltaSeconds);

    for (let i = this.playerDamageNumberParticles.length - 1; i >= 0; i -= 1) {
      const particle = this.playerDamageNumberParticles[i];
      particle.ageMs += deltaMs;
      if (particle.kind === "damage") {
        particle.velocity.z -= this.playerDamageNumberGravity * deltaSeconds;
        particle.velocity.x *= drag;
        particle.velocity.y *= drag;
      }

      particle.sprite.position.x += particle.velocity.x * deltaSeconds;
      particle.sprite.position.y += particle.velocity.y * deltaSeconds;
      particle.sprite.position.z += particle.velocity.z * deltaSeconds;
      if (particle.kind === "heal") {
        particle.sprite.position.x = this.playerPos.x * TILE_SIZE;
        particle.sprite.position.y = -this.playerPos.y * TILE_SIZE;
      }
      this.alignPlayerDamageNumberToCamera(particle.sprite);

      if (particle.kind === "damage") {
        this.resolvePlayerDamageNumberWallCollision(particle);

        if (particle.sprite.position.z < this.damageParticleFloorZ) {
          particle.sprite.position.z = this.damageParticleFloorZ;
          if (particle.velocity.z < 0) {
            particle.velocity.z *= -0.22;
          }
          particle.velocity.x *= 0.82;
          particle.velocity.y *= 0.82;
        }
      }

      const material = particle.sprite.material;
      if (!(material instanceof THREE.SpriteMaterial)) {
        this.disposePlayerDamageNumberParticle(i);
        continue;
      }

      const lifeT = THREE.MathUtils.clamp(
        particle.ageMs / particle.lifetimeMs,
        0,
        1,
      );
      if (particle.kind === "heal") {
        const fadeDelayMs = this.playerHealNumberFadeDelayMs;
        const fadeDurationMs = Math.max(1, particle.lifetimeMs - fadeDelayMs);
        const fadeT = THREE.MathUtils.clamp(
          (particle.ageMs - fadeDelayMs) / fadeDurationMs,
          0,
          1,
        );
        material.opacity = Math.max(0, 1 - fadeT * 1.4);
      } else {
        const fadeDelayMs = this.playerDamageNumberFadeDelayMs;
        const fadeDurationMs = Math.max(1, particle.lifetimeMs - fadeDelayMs);
        const fadeT = THREE.MathUtils.clamp(
          (particle.ageMs - fadeDelayMs) / fadeDurationMs,
          0,
          1,
        );
        material.opacity = Math.max(0, 1 - fadeT * fadeT);
      }

      const scaleBoost = 1 + (1 - lifeT) * 0.08;
      particle.sprite.scale.set(
        particle.baseScale.x * scaleBoost,
        particle.baseScale.y * scaleBoost,
        1,
      );

      if (lifeT >= 1 || material.opacity <= 0.01) {
        this.disposePlayerDamageNumberParticle(i);
      }
    }
  }

  private updateDamageEffects(deltaSeconds: number): void {
    this.updateGlyphDamageFlashes(deltaSeconds);
    this.updateGlyphDamageShakes(deltaSeconds);
    this.updateDamageParticles(deltaSeconds);
    this.updatePlayerDamageNumberParticles(deltaSeconds);
    const now = Date.now();
    this.prunePendingCharacterDamage(now);
    this.prunePendingMonsterDefeatSignals(now);
  }

  private clearDamageEffects(): void {
    const flashKeys = Array.from(this.glyphDamageFlashes.keys());
    for (const key of flashKeys) {
      this.stopGlyphDamageFlash(key);
    }

    const shakeKeys = Array.from(this.glyphDamageShakes.keys());
    for (const key of shakeKeys) {
      this.stopGlyphDamageShake(key);
    }

    for (let i = this.damageParticles.length - 1; i >= 0; i -= 1) {
      this.disposeDamageParticle(i);
    }
    for (let i = this.playerDamageNumberParticles.length - 1; i >= 0; i -= 1) {
      this.disposePlayerDamageNumberParticle(i);
    }

    this.pendingCharacterDamageQueue = [];
    this.pendingMonsterDefeatSignals = [];
    this.lastDirectionalAttackContext = null;
    this.lastParsedDamageMessage = "";
    this.lastParsedDamageAtMs = 0;
    this.lastParsedDefeatMessage = "";
    this.lastParsedDefeatAtMs = 0;
  }

  private applyGlyphMaterial(
    key: string,
    mesh: THREE.Mesh,
    baseMaterial: THREE.MeshLambertMaterial,
    glyphChar: string,
    textColor: string,
    isWall: boolean,
    darkenFactor: number = 1,
  ): void {
    const overlay = this.ensureGlyphOverlay(key, baseMaterial);
    const baseColorHex = baseMaterial.color.getHexString();
    const clampedDarken = THREE.MathUtils.clamp(darkenFactor, 0, 1);
    const textureKey = `${baseColorHex}|${glyphChar}|${textColor}|${clampedDarken.toFixed(3)}`;

    if (overlay.textureKey !== textureKey) {
      if (overlay.textureKey) {
        this.releaseGlyphTexture(overlay.textureKey);
      }

      overlay.baseColorHex = baseColorHex;
      overlay.material.color.set("#ffffff");
      overlay.texture = this.acquireGlyphTexture(textureKey, () =>
        this.createGlyphTexture(
          baseColorHex,
          glyphChar,
          textColor,
          clampedDarken,
        ),
      );
      overlay.material.map = overlay.texture;
      overlay.material.needsUpdate = true;
      overlay.textureKey = textureKey;
    }
    overlay.material.color.set("#ffffff");

    const flashState = this.glyphDamageFlashes.get(key);
    if (flashState) {
      flashState.baseColorHex = baseColorHex;
      flashState.glyphChar = glyphChar;
      flashState.darkenFactor = clampedDarken;
      overlay.material.map = flashState.texture;
      overlay.material.needsUpdate = true;
    }

    const revealState = this.tileRevealFades.get(key);
    if (revealState) {
      overlay.material.opacity = revealState.opacity;
      overlay.material.needsUpdate = true;
    } else {
      overlay.material.opacity = 1;
    }

    if (isWall) {
      mesh.material = [
        baseMaterial,
        baseMaterial,
        baseMaterial,
        baseMaterial,
        overlay.material,
        baseMaterial,
      ];
    } else {
      mesh.material = overlay.material;
    }
  }

  private getMaterialByKind(kind: TileMaterialKind): THREE.MeshLambertMaterial {
    switch (kind) {
      case "floor":
        return this.materials.floor;
      case "stairs_up":
        return this.materials.stairs_up;
      case "stairs_down":
        return this.materials.stairs_down;
      case "wall":
        return this.materials.wall;
      case "dark_wall":
        return this.materials.dark_wall;
      case "door":
        return this.materials.door;
      case "dark":
        return this.materials.dark;
      case "water":
        return this.materials.water;
      case "trap":
        return this.materials.trap;
      case "feature":
        return this.materials.feature;
      case "fountain":
        return this.materials.fountain;
      case "player":
        return this.materials.player;
      case "monster_hostile":
        return this.materials.monster_hostile;
      case "monster_friendly":
        return this.materials.monster_friendly;
      case "monster_neutral":
        return this.materials.monster_neutral;
      case "item":
        return this.materials.item;
      case "effect_warning":
        return this.materials.effect_warning;
      case "effect_zap":
        return this.materials.effect_zap;
      case "effect_explode":
        return this.materials.effect_explode;
      case "effect_swallow":
        return this.materials.effect_swallow;
      default:
        return this.materials.default;
    }
  }

  private clearScene(): void {
    this.clearDamageEffects();
    this.clearTileRevealFades();
    this.lastKnownPlayerHp = null;
    this.positionInputModeActive = false;
    this.hasRuntimePositionCursor = false;
    this.clearPositionCursor();
    console.log("🧹 Clearing all tiles and glyph overlays from 3D scene");

    // Clear all tile meshes
    this.tileMap.forEach((mesh, key) => {
      this.scene.remove(mesh);
    });
    this.tileMap.clear();

    // Clear glyph overlays and dispose textures/materials
    this.glyphOverlayMap.forEach((overlay) => {
      this.disposeGlyphOverlay(overlay);
    });
    this.glyphOverlayMap.clear();
    this.glyphTextureCache.forEach(({ texture }) => texture.dispose());
    this.glyphTextureCache.clear();
    this.disposeLightingOverlay();
    this.tileStateCache.clear();
    this.lastKnownTerrain.clear();
    this.pendingTileUpdates.clear();
    this.tileFlushScheduled = false;
    this.markLightingDirty();

    console.log("🧹 Scene cleared - ready for new level");
  }

  private ensurePositionCursorOutline(): THREE.Line {
    if (this.positionCursorOutline) {
      return this.positionCursorOutline;
    }

    const half = TILE_SIZE / 2 - this.positionCursorOutlineInset;
    const z = 0;
    const points = [
      new THREE.Vector3(-half, half, z),
      new THREE.Vector3(half, half, z),
      new THREE.Vector3(half, -half, z),
      new THREE.Vector3(-half, -half, z),
      new THREE.Vector3(-half, half, z),
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: this.positionCursorOutlineColorHex,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
    });

    const outline = new THREE.Line(geometry, material);
    outline.visible = false;
    outline.renderOrder = 1000;
    this.scene.add(outline);
    this.positionCursorOutline = outline;
    return outline;
  }

  private setPositionInputMode(active: boolean): void {
    if (!active) {
      this.positionInputModeActive = false;
      this.hasRuntimePositionCursor = false;
      this.clearPositionCursor();
      return;
    }

    if (this.positionInputModeActive === active) {
      return;
    }

    this.positionInputModeActive = true;

    // Preserve any cursor published before the active-state event arrives.
    if (!this.hasRuntimePositionCursor) {
      this.positionCursor = { ...this.playerPos };
    }
    this.updatePositionCursorOutline();
  }

  private setPositionCursorPosition(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    this.positionCursor = { x, y };
    this.hasRuntimePositionCursor = true;
    if (this.positionInputModeActive) {
      this.updatePositionCursorOutline();
    }
  }

  private updatePositionCursorOutline(): void {
    if (!this.positionInputModeActive) {
      this.clearPositionCursor();
      return;
    }

    const outline = this.ensurePositionCursorOutline();
    const key = `${this.positionCursor.x},${this.positionCursor.y}`;
    const targetTileMesh = this.tileMap.get(key);
    const outlineZ = targetTileMesh?.userData?.isWall
      ? this.positionCursorWallZ
      : this.positionCursorGroundZ;
    outline.position.set(
      this.positionCursor.x * TILE_SIZE,
      -this.positionCursor.y * TILE_SIZE,
      outlineZ,
    );
    outline.visible = true;
  }

  private clearPositionCursor(): void {
    if (this.positionCursorOutline) {
      this.positionCursorOutline.visible = false;
    }
  }

  private updateTile(
    x: number,
    y: number,
    glyph: number,
    char?: string,
    color?: number,
  ): void {
    const key = `${x},${y}`;
    let mesh = this.tileMap.get(key);
    const hadMesh = Boolean(mesh);
    const wasMonsterLikeCharacter = mesh
      ? Boolean(mesh.userData?.isMonsterLikeCharacter)
      : false;
    const wasUndiscovered = mesh
      ? Boolean(mesh.userData?.isUndiscovered)
      : true;
    const behavior = classifyTileBehavior({
      glyph,
      runtimeChar: char ?? null,
      runtimeColor: typeof color === "number" ? color : null,
      priorTerrain: this.lastKnownTerrain.get(key) ?? null,
    });
    const isMonsterLikeCharacter = this.isMonsterLikeBehavior(behavior);
    const triggerMonsterDefeatBurst =
      wasMonsterLikeCharacter &&
      !isMonsterLikeCharacter &&
      this.consumePendingMonsterDefeatSignal(x, y);
    const isUndiscovered = this.isUndiscoveredKind(behavior.effective.kind);
    const shouldRevealFade = !isUndiscovered && (!hadMesh || wasUndiscovered);

    if (!behavior.isPlayerGlyph) {
      if (this.isPersistentTerrainKind(behavior.resolved.kind)) {
        this.lastKnownTerrain.set(key, {
          glyph,
          char: behavior.resolved.char ?? undefined,
          color: behavior.resolved.color ?? undefined,
        });
      }
    } else {
      const oldPos = { ...this.playerPos };
      this.recordPlayerMovement(oldPos.x, oldPos.y, x, y);
      this.playerPos = { x, y };
      this.updateStatus(`Player at (${x}, ${y}) - NetHack 3D`);
    }

    const material = this.getMaterialByKind(behavior.materialKind);
    const geometry =
      behavior.geometryKind === "wall" ? this.wallGeometry : this.floorGeometry;
    const targetZ = behavior.isWall ? WALL_HEIGHT / 2 : 0;

    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x * TILE_SIZE, -y * TILE_SIZE, targetZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.tileMap.set(key, mesh);
    } else {
      mesh.geometry = geometry;
      mesh.position.set(x * TILE_SIZE, -y * TILE_SIZE, targetZ);
    }

    mesh.userData.isWall = behavior.isWall;
    mesh.userData.effectKind = behavior.effectKind;
    mesh.userData.disposition = behavior.disposition;
    mesh.userData.isPlayerGlyph = behavior.isPlayerGlyph;
    mesh.userData.isMonsterLikeCharacter = isMonsterLikeCharacter;
    mesh.userData.isDamageFlashableCharacter =
      this.isDamageFlashableBehavior(behavior);
    mesh.userData.glyphChar = behavior.glyphChar;
    mesh.userData.glyphTextColor = behavior.textColor;
    mesh.userData.glyphDarkenFactor = behavior.darkenFactor;
    mesh.userData.glyphBaseColorHex = material.color.getHexString();
    mesh.userData.isUndiscovered = isUndiscovered;

    this.applyGlyphMaterial(
      key,
      mesh,
      material,
      behavior.glyphChar,
      behavior.textColor,
      behavior.isWall,
      behavior.darkenFactor,
    );
    if (isUndiscovered) {
      this.stopTileRevealFade(key);
    } else if (shouldRevealFade) {
      this.startTileRevealFade(key);
    }
    if (triggerMonsterDefeatBurst) {
      this.triggerDamageEffectsAtTile(x, y, 1, "defeat");
    }
    this.markLightingDirty();
  }
  private addGameMessage(message: string): void {
    if (!message || message.trim() === "") return;

    this.gameMessages.unshift(message);
    if (this.gameMessages.length > 100) {
      this.gameMessages.pop();
    }

    if (this.uiAdapter) {
      this.uiAdapter.setGameMessages([...this.gameMessages]);
    } else {
      const logElement = document.getElementById("game-log");
      if (logElement) {
        logElement.innerHTML = this.gameMessages.join("<br>");
        logElement.scrollTop = 0; // Keep newest messages at top
      }
    }

    if (this.hasPlayerMovedOnce) {
      this.showFloatingGameMessage(message);
    }
  }

  private recordPlayerMovement(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void {
    const moved = fromX !== toX || fromY !== toY;

    if (!this.hasSeenPlayerPosition) {
      this.hasSeenPlayerPosition = true;
      return;
    }

    const hasRecentMovementInput =
      Date.now() - this.lastMovementInputAtMs <= this.movementUnlockWindowMs;

    if (!this.hasPlayerMovedOnce && moved && hasRecentMovementInput) {
      this.hasPlayerMovedOnce = true;
    }
  }

  private showFloatingGameMessage(message: string): void {
    if (this.uiAdapter) {
      this.uiAdapter.pushFloatingMessage(message);
      return;
    }

    if (
      !this.floatingMessageLayer ||
      !document.body.contains(this.floatingMessageLayer)
    ) {
      return;
    }

    const text = message.replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      return;
    }

    const messageContainer = document.createElement("div");
    messageContainer.className = "floating-message-container";

    const floatingText = document.createElement("div");
    floatingText.textContent = text;
    floatingText.className = "floating-message-text";
    messageContainer.appendChild(floatingText);
    this.floatingMessageLayer.appendChild(messageContainer);

    const entry: FloatingMessageEntry = {
      container: messageContainer,
      text: floatingText,
      fadeTimerId: 0,
      removeTimerId: 0,
    };
    this.floatingMessageEntries.unshift(entry);

    while (this.floatingMessageEntries.length > this.maxFloatingMessages) {
      const oldest =
        this.floatingMessageEntries[this.floatingMessageEntries.length - 1];
      this.removeFloatingMessageEntry(oldest, false);
    }
    this.relayoutFloatingMessages();

    entry.fadeTimerId = window.setTimeout(() => {
      floatingText.style.transform = `translateY(-${this.floatingMessageRisePx}px)`;
      floatingText.style.opacity = "0";
    }, this.floatingMessageFadeDelayMs);

    entry.removeTimerId = window.setTimeout(
      () => {
        this.removeFloatingMessageEntry(entry);
      },
      this.floatingMessageFadeDelayMs + this.floatingMessageFadeDurationMs + 80,
    );
  }

  private relayoutFloatingMessages(): void {
    for (let i = 0; i < this.floatingMessageEntries.length; i += 1) {
      const entry = this.floatingMessageEntries[i];
      entry.container.style.top = `${-i * this.floatingMessageStackSpacingPx}px`;
    }
  }

  private removeFloatingMessageEntry(
    entry: FloatingMessageEntry,
    relayout: boolean = true,
  ): void {
    window.clearTimeout(entry.fadeTimerId);
    window.clearTimeout(entry.removeTimerId);

    const index = this.floatingMessageEntries.indexOf(entry);
    if (index >= 0) {
      this.floatingMessageEntries.splice(index, 1);
    }

    entry.container.remove();

    if (relayout) {
      this.relayoutFloatingMessages();
    }
  }

  private updateStatus(status: string): void {
    if (this.uiAdapter) {
      this.uiAdapter.setStatus(status);
      return;
    }

    const statusElement = document.getElementById("game-status");
    if (statusElement) {
      statusElement.innerHTML = status;
    }
  }

  private updateConnectionStatus(
    status: string,
    state: NethackConnectionState,
  ): void {
    if (this.uiAdapter) {
      this.uiAdapter.setConnectionStatus(status, state);
      return;
    }

    const connElement = document.getElementById("connection-status");
    if (connElement) {
      connElement.innerHTML = status;
      connElement.setAttribute("data-state", state);
    }
  }

  private setLoadingVisible(visible: boolean): void {
    if (this.uiAdapter) {
      this.uiAdapter.setLoadingVisible(visible);
      return;
    }

    const loading = document.getElementById("loading");
    if (!loading) {
      return;
    }
    if (visible) {
      loading.classList.remove("is-hidden");
    } else {
      loading.classList.add("is-hidden");
    }
  }

  private parseGoldStatusValue(rawValue: string): number | null {
    const clean = rawValue.trim();
    if (!clean) {
      return null;
    }

    // NetHack may encode gold as "\G....E:<amount>" for status rendering.
    // In this format, the leading digits are metadata and the value after
    // the trailing colon is the actual gold amount.
    if (clean.startsWith("\\G")) {
      const encodedAmountMatch = clean.match(/:(-?\d+)\s*$/);
      if (encodedAmountMatch) {
        return parseInt(encodedAmountMatch[1], 10);
      }
    }

    const numericMatch = clean.match(/-?\d+/);
    if (!numericMatch) {
      return null;
    }

    return parseInt(numericMatch[0], 10);
  }

  private updatePlayerStats(
    field: number,
    value: string | number | null,
    data: any,
  ): void {
    const legacyByIndex: { [key: number]: string } = {
      0: "name",
      1: "strength",
      2: "dexterity",
      3: "constitution",
      4: "intelligence",
      5: "wisdom",
      6: "charisma",
      7: "alignment",
      8: "score",
      9: "hp",
      10: "maxhp",
      11: "power",
      12: "maxpower",
      13: "armor",
      14: "level",
      15: "experience",
      16: "time",
      17: "hunger",
      18: "encumbrance",
      19: "dungeon",
      20: "dlevel",
      21: "gold",
    };

    const byName: { [key: string]: string } = {
      BL_TITLE: "name",
      BL_STR: "strength",
      BL_DX: "dexterity",
      BL_CO: "constitution",
      BL_IN: "intelligence",
      BL_WI: "wisdom",
      BL_CH: "charisma",
      BL_ALIGN: "alignment",
      BL_SCORE: "score",
      BL_HP: "hp",
      BL_HPMAX: "maxhp",
      BL_ENE: "power",
      BL_ENEMAX: "maxpower",
      BL_AC: "armor",
      BL_XP: "level",
      BL_EXP: "experience",
      BL_TIME: "time",
      BL_HUNGER: "hunger",
      BL_CAP: "encumbrance",
      BL_DNUM: "dungeon",
      BL_DLEVEL: "dlevel",
      BL_GOLD: "gold",
    };

    const rawFieldName =
      typeof data?.fieldName === "string" ? data.fieldName : null;
    const mappedField =
      (rawFieldName && byName[rawFieldName]) || legacyByIndex[field] || null;

    // Keep a rolling debug history for runtime inspection from devtools.
    this.statusDebugHistory.unshift({
      ts: Date.now(),
      field,
      fieldName: rawFieldName,
      mappedField,
      value,
      valueType: data?.valueType,
      chg: data?.chg,
      percent: data?.percent,
      color: data?.color,
      colormask: data?.colormask,
    });
    if (this.statusDebugHistory.length > 200) {
      this.statusDebugHistory.pop();
    }

    if (!mappedField || value === null || value === undefined) {
      console.log(
        `Skipping status update: field=${field}, fieldName=${rawFieldName}, value=${value}`,
      );
      return;
    }

    const numericFields = new Set([
      "hp",
      "maxhp",
      "power",
      "maxpower",
      "level",
      "experience",
      "time",
      "armor",
      "score",
      "gold",
      "dlevel",
      "strength",
      "dexterity",
      "constitution",
      "intelligence",
      "wisdom",
      "charisma",
    ]);

    let parsedValue: any = value;
    if (numericFields.has(mappedField)) {
      if (typeof value === "number") {
        parsedValue = value;
      } else {
        const clean = String(value).trim();
        if (mappedField === "gold") {
          const parsedGold = this.parseGoldStatusValue(clean);
          if (parsedGold === null) {
            console.log(`Could not parse gold status from "${value}"`);
            return;
          }
          parsedValue = parsedGold;
        } else {
          const match = clean.match(/-?\d+/);
          if (!match) {
            console.log(
              `Could not parse numeric status ${mappedField} from "${value}"`,
            );
            return;
          }
          parsedValue = parseInt(match[0], 10);
        }
      }
    } else {
      parsedValue = String(value).trim();
    }

    console.log(`Updating status ${mappedField}: ${parsedValue}`);
    let playerDamageTaken: number | null = null;
    let playerHealingGained: number | null = null;
    if (mappedField === "hp" && typeof parsedValue === "number") {
      const previousHp = this.lastKnownPlayerHp;
      if (typeof previousHp === "number" && Number.isFinite(previousHp)) {
        if (parsedValue < previousHp) {
          playerDamageTaken = Math.round(previousHp - parsedValue);
        } else if (parsedValue > previousHp) {
          playerHealingGained = Math.round(parsedValue - previousHp);
        }
      }
    }

    if (mappedField === "maxhp") {
      this.playerStats.maxHp = parsedValue;
    } else if (mappedField === "maxpower") {
      this.playerStats.maxPower = parsedValue;
    } else if (mappedField === "dlevel") {
      this.playerStats.dlevel = parsedValue;
    } else {
      (this.playerStats as any)[mappedField] = parsedValue;
    }

    if (mappedField === "hp") {
      this.lastKnownPlayerHp = parsedValue;
      if (playerDamageTaken && playerDamageTaken > 0) {
        this.triggerDamageEffectsAtTile(
          this.playerPos.x,
          this.playerPos.y,
          playerDamageTaken,
        );
      }
      if (playerHealingGained && playerHealingGained > 0) {
        this.spawnPlayerHealNumberParticle(
          this.playerPos.x,
          this.playerPos.y,
          playerHealingGained,
        );
      }
    }

    this.updateStatsDisplay();
  }

  private updateStatsDisplay(): void {
    if (this.uiAdapter) {
      const snapshot: PlayerStatsSnapshot = {
        ...this.playerStats,
      };
      this.uiAdapter.setPlayerStats(snapshot);
      return;
    }

    // Update or create the stats bar
    let statsBar = document.getElementById("stats-bar");
    if (!statsBar) {
      // Create the stats bar at the top of the screen
      statsBar = document.createElement("div");
      statsBar.id = "stats-bar";
      document.body.appendChild(statsBar);

      // Adjust the game log position to accommodate the stats bar
      const gameLogContainer = document.querySelector(
        ".top-left-ui",
      ) as HTMLElement;
      if (gameLogContainer) {
        gameLogContainer.classList.add("with-stats");
      }
    }

    // Create HP bar component
    const hpPercentage =
      this.playerStats.maxHp > 0
        ? (this.playerStats.hp / this.playerStats.maxHp) * 100
        : 0;
    const hpColor =
      hpPercentage > 60 ? "#00ff00" : hpPercentage > 30 ? "#ffaa00" : "#ff0000";

    // Build the complete stats display
    statsBar.innerHTML = `
      <div class="nh3d-stats-name">
        ${this.playerStats.name} (Lvl ${this.playerStats.level})
      </div>

      <div class="nh3d-stats-meter">
        <div class="nh3d-stats-meter-label nh3d-stats-meter-label-hp">
          HP: ${this.playerStats.hp}/${this.playerStats.maxHp}
        </div>
        <div class="nh3d-stats-meter-track">
          <div class="nh3d-stats-meter-fill" id="nh3d-stats-hp-fill"></div>
        </div>
      </div>

      ${
        this.playerStats.maxPower > 0
          ? `<div class="nh3d-stats-meter">
               <div class="nh3d-stats-meter-label nh3d-stats-meter-label-pw">
                 Pw: ${this.playerStats.power}/${this.playerStats.maxPower}
               </div>
               <div class="nh3d-stats-meter-track">
                 <div class="nh3d-stats-meter-fill nh3d-stats-meter-fill-pw" id="nh3d-stats-pw-fill"></div>
               </div>
             </div>`
          : ""
      }

      <div class="nh3d-stats-group">
        <div class="nh3d-stats-core">St:${this.playerStats.strength}</div>
        <div class="nh3d-stats-core">Dx:${this.playerStats.dexterity}</div>
        <div class="nh3d-stats-core">Co:${this.playerStats.constitution}</div>
        <div class="nh3d-stats-core">In:${this.playerStats.intelligence}</div>
        <div class="nh3d-stats-core">Wi:${this.playerStats.wisdom}</div>
        <div class="nh3d-stats-core">Ch:${this.playerStats.charisma}</div>
      </div>

      <div class="nh3d-stats-group">
        <div class="nh3d-stats-secondary-ac">AC:${this.playerStats.armor}</div>
        <div class="nh3d-stats-secondary-exp">Exp:${this.playerStats.experience}</div>
        <div class="nh3d-stats-secondary-gold">$:${this.playerStats.gold}</div>
        <div class="nh3d-stats-secondary-time">T:${this.playerStats.time}</div>
        <div class="nh3d-stats-hunger">${this.playerStats.hunger}${
          this.playerStats.encumbrance ? " " + this.playerStats.encumbrance : ""
        }</div>
      </div>

      <div class="nh3d-stats-location">
        <div class="nh3d-stats-dungeon">${this.playerStats.dungeon} ${
          this.playerStats.dlevel
        }</div>
      </div>
    `;

    const hpFill = statsBar.querySelector<HTMLElement>("#nh3d-stats-hp-fill");
    if (hpFill) {
      hpFill.style.width = `${THREE.MathUtils.clamp(hpPercentage, 0, 100)}%`;
      hpFill.style.backgroundColor = hpColor;
    }

    if (this.playerStats.maxPower > 0) {
      const powerPercentage =
        (this.playerStats.power / this.playerStats.maxPower) * 100;
      const pwFill = statsBar.querySelector<HTMLElement>("#nh3d-stats-pw-fill");
      if (pwFill) {
        pwFill.style.width = `${THREE.MathUtils.clamp(powerPercentage, 0, 100)}%`;
      }
    }
  }

  private updateInventoryDisplay(items: any[]): void {
    if (this.uiAdapter) {
      this.uiAdapter.setInventory({
        visible: this.isInventoryDialogVisible,
        items: Array.isArray(this.currentInventory)
          ? [...this.currentInventory]
          : [],
      });
      return;
    }

    // Update inventory display without showing a dialog
    // This is for informational inventory updates from NetHack

    if (!items || items.length === 0) {
      console.log("📦 Inventory is empty");
      return;
    }

    // Log inventory items for debugging
    console.log("📦 Current inventory:");
    items.forEach((item, index) => {
      if (item.isCategory) {
        console.log(`  📁 ${item.text}`);
      } else {
        console.log(`  ${item.accelerator || "?"}) ${item.text}`);
      }
    });

    // TODO: If we add an inventory panel to the UI in the future, update it here
    // For now, we just log the inventory and don't show any dialog
  }

  private isMultiSelectLootQuestion(question: string): boolean {
    if (typeof question !== "string") {
      return false;
    }

    const normalizedQuestion = question.trim().toLowerCase();
    return (
      normalizedQuestion.includes("pick up what") ||
      normalizedQuestion.includes("what do you want to pick up") ||
      normalizedQuestion.includes("take out what") ||
      normalizedQuestion.includes("put in what") ||
      normalizedQuestion.includes("what do you want to put in") ||
      normalizedQuestion.includes("put in, then take out what")
    );
  }

  private isCharacterCreationQuestion(questionText: string): boolean {
    const normalized = String(questionText || "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return false;
    }
    if (
      normalized.includes("character") &&
      (normalized.includes("pick") ||
        normalized.includes("class") ||
        normalized.includes("race") ||
        normalized.includes("gender") ||
        normalized.includes("alignment") ||
        normalized.includes("role"))
    ) {
      return true;
    }
    return (
      normalized.includes("what kind of character") ||
      normalized.includes("what role") ||
      normalized.includes("what is your role") ||
      normalized.includes("what race") ||
      normalized.includes("what is your race") ||
      normalized.includes("what gender") ||
      normalized.includes("what is your gender") ||
      normalized.includes("what alignment") ||
      normalized.includes("what is your alignment") ||
      normalized.includes("pick a character for you") ||
      normalized.includes("shall i pick character") ||
      normalized.includes("shall i pick a character")
    );
  }

  private isNumberPadModeQuestion(questionText: string): boolean {
    const normalized = String(questionText || "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized.startsWith("select number_pad mode");
  }

  private setNumberPadModeEnabled(enabled: boolean): void {
    const normalized = Boolean(enabled);
    if (this.numberPadModeEnabled === normalized) {
      return;
    }
    this.numberPadModeEnabled = normalized;
    const modeLabel = normalized ? "numpad" : "hjklyubn";
    console.log(`🎮 Number pad mode set to ${modeLabel}`);
    this.addGameMessage(`Number pad mode: ${modeLabel}`);
    if (this.uiAdapter) {
      this.uiAdapter.setNumberPadModeEnabled(normalized);
    }
  }

  private updateNumberPadModeFromChoice(choice: string): void {
    if (!this.isNumberPadModeQuestion(this.activeQuestionText)) {
      return;
    }
    const normalizedChoice = String(choice || "").trim();
    if (!normalizedChoice) {
      return;
    }
    if (normalizedChoice === "0") {
      this.setNumberPadModeEnabled(false);
      return;
    }
    if (normalizedChoice === "1" || normalizedChoice === "2") {
      this.setNumberPadModeEnabled(true);
    }
  }

  private toCharacterCreationQuestionPayload(
    data: RuntimeEvent,
  ): CharacterCreationQuestionPayload {
    return {
      text: String(data.text || ""),
      choices: String(data.choices || ""),
      defaultChoice: String(data.default || ""),
      menuItems: Array.isArray(data.menuItems) ? [...data.menuItems] : [],
    };
  }

  private autoAnswerCharacterCreationQuestion(
    payload: CharacterCreationQuestionPayload,
  ): void {
    console.log("Auto-handling character creation:", payload.text);
    const firstSelectableItem = payload.menuItems.find(
      (item) => item && !item.isCategory,
    );
    if (firstSelectableItem) {
      this.sendInput(
        this.getMenuSelectionInput(
          firstSelectableItem,
          firstSelectableItem?.accelerator || "a",
        ),
      );
      return;
    }
    if (payload.defaultChoice) {
      this.sendInput(payload.defaultChoice);
      return;
    }
    this.sendInput("a");
  }

  private isSelectableQuestionMenuItem(item: any): boolean {
    if (!item || item.isCategory) {
      return false;
    }
    if (Number.isInteger(item.menuIndex)) {
      return true;
    }
    return (
      typeof item.accelerator === "string" && item.accelerator.trim() !== ""
    );
  }

  private getQuestionMenuSelectionInput(item: any): string {
    if (
      item &&
      typeof item.selectionInput === "string" &&
      item.selectionInput
    ) {
      return item.selectionInput;
    }
    const fallback =
      item && typeof item.accelerator === "string" ? item.accelerator : "";
    return this.getMenuSelectionInput(item, fallback);
  }

  private getVisiblePickupSelectableMenuItems(): any[] {
    if (!Array.isArray(this.activeQuestionVisibleMenuItems)) {
      return [];
    }
    return this.activeQuestionVisibleMenuItems.filter((item) =>
      this.isSelectableQuestionMenuItem(item),
    );
  }

  private normalizeActivePickupFocusIndex(): void {
    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    if (selectableItems.length === 0) {
      this.activePickupFocusIndex = 0;
      return;
    }

    if (
      !Number.isInteger(this.activePickupFocusIndex) ||
      this.activePickupFocusIndex < 0 ||
      this.activePickupFocusIndex >= selectableItems.length
    ) {
      this.activePickupFocusIndex = 0;
    }
  }

  private getActivePickupSelectionInput(): string | null {
    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    if (selectableItems.length === 0) {
      return null;
    }
    this.normalizeActivePickupFocusIndex();
    const focusedItem = selectableItems[this.activePickupFocusIndex];
    const selectionInput = this.getQuestionMenuSelectionInput(focusedItem);
    return typeof selectionInput === "string" && selectionInput.length > 0
      ? selectionInput
      : null;
  }

  private isPickupSelectionInputFocused(selectionInput: string): boolean {
    if (typeof selectionInput !== "string" || selectionInput.length === 0) {
      return false;
    }
    return this.getActivePickupSelectionInput() === selectionInput;
  }

  private setActivePickupFocusBySelectionInput(selectionInput: string): void {
    if (typeof selectionInput !== "string" || selectionInput.length === 0) {
      return;
    }
    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    const index = selectableItems.findIndex((item) => {
      return this.getQuestionMenuSelectionInput(item) === selectionInput;
    });
    if (index >= 0) {
      this.activePickupFocusIndex = index;
      this.clearQuestionActionFocus();
    }
  }

  private updatePickupFocusVisualState(): void {
    if (this.uiAdapter) {
      this.syncQuestionDialogState();
      return;
    }

    const questionDialog = document.getElementById("question-dialog");
    if (!questionDialog) {
      return;
    }

    const focusedSelectionInput = this.isQuestionActionFocused()
      ? null
      : this.getActivePickupSelectionInput();
    const containers = questionDialog.querySelectorAll(".nh3d-pickup-item");
    containers.forEach((container: Element) => {
      const element = container as HTMLElement & { selectionInput?: string };
      const isFocused =
        typeof focusedSelectionInput === "string" &&
        element.selectionInput === focusedSelectionInput;
      element.classList.toggle("nh3d-pickup-item-active", isFocused);
    });
    this.updateQuestionActionFocusVisualStateDom(questionDialog);
  }

  private movePickupFocus(delta: number): void {
    if (!this.activeQuestionIsPickupDialog || delta === 0) {
      return;
    }

    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    if (selectableItems.length === 0) {
      return;
    }

    this.normalizeActivePickupFocusIndex();
    this.clearQuestionActionFocus();
    const itemCount = selectableItems.length;
    const nextIndex =
      (((this.activePickupFocusIndex + delta) % itemCount) + itemCount) %
      itemCount;
    this.activePickupFocusIndex = nextIndex;
    this.updatePickupFocusVisualState();
  }

  private toggleActivePickupFocusSelection(): void {
    const focusedSelectionInput = this.getActivePickupSelectionInput();
    if (!focusedSelectionInput) {
      return;
    }

    if (this.uiAdapter) {
      this.togglePickupChoice(focusedSelectionInput);
      return;
    }

    const questionDialog = document.getElementById("question-dialog");
    if (!questionDialog) {
      return;
    }
    const containers = questionDialog.querySelectorAll(".nh3d-pickup-item");
    for (const container of containers) {
      const element = container as any;
      if (
        element.selectionInput === focusedSelectionInput &&
        typeof element.toggleItem === "function"
      ) {
        element.toggleItem();
        break;
      }
    }
  }

  private getActiveQuestionActionButtons(): Array<"confirm" | "cancel"> {
    if (!this.isInQuestion || this.activeQuestionMenuItems.length === 0) {
      return [];
    }
    const selectableCount = this.getVisiblePickupSelectableMenuItems().length;
    if (selectableCount <= 1) {
      return [];
    }
    if (this.activeQuestionIsPickupDialog) {
      return ["confirm", "cancel"];
    }
    return ["cancel"];
  }

  private getActiveQuestionActionButton(): "confirm" | "cancel" | null {
    const actions = this.getActiveQuestionActionButtons();
    if (actions.length === 0) {
      this.activeQuestionActionFocusIndex = -1;
      return null;
    }
    if (this.activeQuestionActionFocusIndex < 0) {
      return null;
    }
    if (this.activeQuestionActionFocusIndex >= actions.length) {
      this.activeQuestionActionFocusIndex = actions.length - 1;
    }
    return actions[this.activeQuestionActionFocusIndex] ?? null;
  }

  private isQuestionActionFocused(): boolean {
    return this.getActiveQuestionActionButton() !== null;
  }

  private setQuestionActionFocusIndex(index: number): void {
    const actions = this.getActiveQuestionActionButtons();
    if (actions.length === 0) {
      this.activeQuestionActionFocusIndex = -1;
    } else {
      const clamped = Math.max(0, Math.min(actions.length - 1, index));
      this.activeQuestionActionFocusIndex = clamped;
    }
    if (this.activeQuestionIsPickupDialog) {
      this.updatePickupFocusVisualState();
    } else {
      this.updateQuestionMenuFocusVisualState();
    }
  }

  private clearQuestionActionFocus(): void {
    this.activeQuestionActionFocusIndex = -1;
  }

  private moveQuestionActionFocus(delta: number): boolean {
    if (delta === 0) {
      return false;
    }
    const actions = this.getActiveQuestionActionButtons();
    if (actions.length === 0 || this.activeQuestionActionFocusIndex < 0) {
      return false;
    }
    const nextIndex = Math.max(
      0,
      Math.min(actions.length - 1, this.activeQuestionActionFocusIndex + delta),
    );
    this.setQuestionActionFocusIndex(nextIndex);
    return true;
  }

  private focusQuestionActionsStart(): boolean {
    const actions = this.getActiveQuestionActionButtons();
    if (actions.length === 0) {
      return false;
    }
    this.setQuestionActionFocusIndex(0);
    return true;
  }

  private activateFocusedQuestionAction(): boolean {
    const action = this.getActiveQuestionActionButton();
    if (!action) {
      return false;
    }
    if (action === "cancel") {
      this.cancelActivePrompt();
      return true;
    }
    if (action === "confirm") {
      if (this.activeQuestionIsPickupDialog) {
        this.confirmPickupChoices();
      } else {
        this.confirmQuestionMenuChoice();
      }
      return true;
    }
    return false;
  }

  private normalizeActiveQuestionMenuFocusIndex(): void {
    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    if (selectableItems.length === 0) {
      this.activeQuestionMenuFocusIndex = 0;
      return;
    }

    if (
      !Number.isInteger(this.activeQuestionMenuFocusIndex) ||
      this.activeQuestionMenuFocusIndex < 0 ||
      this.activeQuestionMenuFocusIndex >= selectableItems.length
    ) {
      this.activeQuestionMenuFocusIndex = 0;
    }
  }

  private getActiveQuestionMenuSelectionInput(): string | null {
    if (
      this.activeQuestionIsPickupDialog ||
      this.activeQuestionMenuItems.length === 0
    ) {
      return null;
    }

    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    if (selectableItems.length === 0) {
      return null;
    }

    this.normalizeActiveQuestionMenuFocusIndex();
    const focusedItem = selectableItems[this.activeQuestionMenuFocusIndex];
    const selectionInput = this.getQuestionMenuSelectionInput(focusedItem);
    return typeof selectionInput === "string" && selectionInput.length > 0
      ? selectionInput
      : null;
  }

  private isQuestionMenuSelectionInputFocused(selectionInput: string): boolean {
    if (typeof selectionInput !== "string" || selectionInput.length === 0) {
      return false;
    }
    return this.getActiveQuestionMenuSelectionInput() === selectionInput;
  }

  private setActiveQuestionMenuFocusBySelectionInput(
    selectionInput: string,
  ): void {
    if (typeof selectionInput !== "string" || selectionInput.length === 0) {
      return;
    }
    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    const index = selectableItems.findIndex((item) => {
      return this.getQuestionMenuSelectionInput(item) === selectionInput;
    });
    if (index >= 0) {
      this.activeQuestionMenuFocusIndex = index;
      this.clearQuestionActionFocus();
    }
  }

  private updateQuestionMenuFocusVisualState(): void {
    if (this.uiAdapter) {
      this.syncQuestionDialogState();
      return;
    }

    const questionDialog = document.getElementById("question-dialog");
    if (!questionDialog) {
      return;
    }

    const focusedSelectionInput = this.isQuestionActionFocused()
      ? null
      : this.getActiveQuestionMenuSelectionInput();
    const buttons = questionDialog.querySelectorAll(".nh3d-menu-button");
    buttons.forEach((button: Element) => {
      const element = button as HTMLElement & { selectionInput?: string };
      const isFocused =
        typeof focusedSelectionInput === "string" &&
        element.selectionInput === focusedSelectionInput;
      element.classList.toggle("nh3d-menu-button-active", isFocused);
    });
    this.updateQuestionActionFocusVisualStateDom(questionDialog);
  }

  private updateQuestionActionFocusVisualStateDom(
    questionDialog?: HTMLElement,
  ): void {
    const dialog = questionDialog ?? document.getElementById("question-dialog");
    if (!dialog) {
      return;
    }

    const focusedAction = this.getActiveQuestionActionButton();
    const actionButtons = dialog.querySelectorAll("[data-question-action]");
    actionButtons.forEach((button: Element) => {
      const element = button as HTMLElement;
      const action = element.getAttribute("data-question-action");
      const isFocused =
        typeof focusedAction === "string" &&
        focusedAction.length > 0 &&
        action === focusedAction;
      element.classList.toggle("nh3d-action-button-active", isFocused);
    });
  }

  private moveQuestionMenuFocus(delta: number): void {
    if (
      this.activeQuestionIsPickupDialog ||
      this.activeQuestionMenuItems.length === 0 ||
      delta === 0
    ) {
      return;
    }

    const selectableItems = this.getVisiblePickupSelectableMenuItems();
    if (selectableItems.length === 0) {
      return;
    }

    this.normalizeActiveQuestionMenuFocusIndex();
    this.clearQuestionActionFocus();
    const itemCount = selectableItems.length;
    const nextIndex =
      (((this.activeQuestionMenuFocusIndex + delta) % itemCount) + itemCount) %
      itemCount;
    this.activeQuestionMenuFocusIndex = nextIndex;
    this.updateQuestionMenuFocusVisualState();
  }

  private confirmActiveQuestionMenuChoice(): void {
    if (
      !this.isInQuestion ||
      this.activeQuestionIsPickupDialog ||
      this.activeQuestionMenuItems.length === 0
    ) {
      return;
    }

    const selectionInput = this.getActiveQuestionMenuSelectionInput();
    if (!selectionInput) {
      return;
    }

    const selectedItem =
      this.findActiveMenuItemBySelectionInput(selectionInput);
    if (!selectedItem) {
      return;
    }

    this.sendInput(this.getQuestionMenuSelectionInput(selectedItem));
    this.hideQuestion();
  }

  private rebuildActiveQuestionMenuPagination(): void {
    this.activeQuestionVisibleMenuItems = [];
    this.activeQuestionPageSelectionMap.clear();
    this.activeQuestionMenuPageCount = 1;
    this.activeQuestionMenuPageIndex = Math.max(
      0,
      this.activeQuestionMenuPageIndex,
    );
    this.activeQuestionActionFocusIndex = -1;
    if (this.activeQuestionIsPickupDialog) {
      this.activeQuestionMenuFocusIndex = 0;
    } else {
      this.activePickupFocusIndex = 0;
    }

    if (
      !Array.isArray(this.activeQuestionMenuItems) ||
      this.activeQuestionMenuItems.length === 0
    ) {
      this.activePickupFocusIndex = 0;
      this.activeQuestionMenuFocusIndex = 0;
      this.activeQuestionActionFocusIndex = -1;
      return;
    }

    const selectableItems = this.activeQuestionMenuItems.filter((item) =>
      this.isSelectableQuestionMenuItem(item),
    );
    if (selectableItems.length === 0) {
      this.activeQuestionVisibleMenuItems = [...this.activeQuestionMenuItems];
      this.activeQuestionMenuPageIndex = 0;
      this.activePickupFocusIndex = 0;
      this.activeQuestionMenuFocusIndex = 0;
      this.activeQuestionActionFocusIndex = -1;
      return;
    }

    const pageSize = this.questionMenuPageAccelerators.length;
    const pageCount = Math.ceil(selectableItems.length / pageSize);
    this.activeQuestionMenuPageCount = Math.max(1, pageCount);
    this.activeQuestionMenuPageIndex = Math.min(
      this.activeQuestionMenuPageIndex,
      this.activeQuestionMenuPageCount - 1,
    );

    const startSelectable = this.activeQuestionMenuPageIndex * pageSize;
    const endSelectable = startSelectable + pageSize;
    let selectableSeen = 0;
    let selectableInPage = 0;
    let pendingCategoryRows: any[] = [];
    let categoryRowsInjected = false;
    let lastItemWasSelectable = false;

    for (const menuItem of this.activeQuestionMenuItems) {
      if (!this.isSelectableQuestionMenuItem(menuItem)) {
        if (lastItemWasSelectable) {
          pendingCategoryRows = [];
        }
        pendingCategoryRows.push(menuItem);
        categoryRowsInjected = false;
        lastItemWasSelectable = false;
        continue;
      }

      const selectableIndex = selectableSeen;
      selectableSeen += 1;
      lastItemWasSelectable = true;
      if (
        selectableIndex < startSelectable ||
        selectableIndex >= endSelectable
      ) {
        continue;
      }

      if (!categoryRowsInjected && pendingCategoryRows.length > 0) {
        for (const categoryRow of pendingCategoryRows) {
          this.activeQuestionVisibleMenuItems.push({ ...categoryRow });
        }
        categoryRowsInjected = true;
      }

      const gameAccelerator =
        typeof menuItem.accelerator === "string" ? menuItem.accelerator : "";
      const fallbackAccelerator =
        this.questionMenuPageAccelerators[selectableInPage] ?? "?";
      const trimmedGameAccelerator = gameAccelerator.trim();
      const hasUsableGameAccelerator =
        trimmedGameAccelerator.length > 0 && trimmedGameAccelerator !== "?";
      const displayAccelerator = hasUsableGameAccelerator
        ? gameAccelerator
        : fallbackAccelerator;
      const selectionInput = this.getQuestionMenuSelectionInput(menuItem);

      this.activeQuestionVisibleMenuItems.push({
        ...menuItem,
        accelerator: displayAccelerator,
        originalAccelerator: gameAccelerator,
        selectionInput,
      });
      this.activeQuestionPageSelectionMap.set(
        displayAccelerator,
        selectionInput,
      );
      selectableInPage += 1;
    }

    if (this.activeQuestionIsPickupDialog) {
      this.normalizeActivePickupFocusIndex();
      this.activeQuestionMenuFocusIndex = 0;
      this.activeQuestionActionFocusIndex = -1;
    } else {
      this.activePickupFocusIndex = 0;
      this.normalizeActiveQuestionMenuFocusIndex();
      this.activeQuestionActionFocusIndex = -1;
    }
  }

  private resolveQuestionSelectionInput(input: string): string {
    if (typeof input !== "string" || input.length === 0) {
      return "";
    }
    const mapped = this.activeQuestionPageSelectionMap.get(input);
    if (typeof mapped === "string" && mapped.length > 0) {
      return mapped;
    }
    return input;
  }

  private resolveQuestionSelectionInputForKeyPress(key: string): string | null {
    if (typeof key !== "string" || key.length === 0) {
      return null;
    }
    if (this.activeQuestionMenuItems.length === 0) {
      return key;
    }
    const mapped = this.activeQuestionPageSelectionMap.get(key);
    return typeof mapped === "string" && mapped.length > 0 ? mapped : null;
  }

  public goToPreviousQuestionMenuPage(): void {
    this.changeQuestionMenuPage(-1);
  }

  public goToNextQuestionMenuPage(): void {
    this.changeQuestionMenuPage(1);
  }

  private changeQuestionMenuPage(delta: number): void {
    if (
      !this.isInQuestion ||
      this.activeQuestionMenuItems.length === 0 ||
      this.activeQuestionMenuPageCount <= 1
    ) {
      return;
    }
    const nextPage = Math.max(
      0,
      Math.min(
        this.activeQuestionMenuPageCount - 1,
        this.activeQuestionMenuPageIndex + delta,
      ),
    );
    if (nextPage === this.activeQuestionMenuPageIndex) {
      return;
    }
    this.activeQuestionMenuPageIndex = nextPage;
    this.rebuildActiveQuestionMenuPagination();
    if (this.uiAdapter) {
      this.syncQuestionDialogState();
      return;
    }
    this.renderQuestionDialogDom();
  }

  private appendQuestionMenuPaginationControls(
    questionDialog: HTMLElement,
  ): void {
    if (
      this.activeQuestionMenuItems.length === 0 ||
      this.activeQuestionMenuPageCount <= 1
    ) {
      return;
    }

    const controls = document.createElement("div");
    controls.className = "nh3d-question-pagination";

    const prevButton = document.createElement("button");
    prevButton.className = "nh3d-question-page-button";
    prevButton.type = "button";
    prevButton.textContent = "<";
    prevButton.disabled = this.activeQuestionMenuPageIndex <= 0;
    prevButton.onclick = () => this.goToPreviousQuestionMenuPage();

    const nextButton = document.createElement("button");
    nextButton.className = "nh3d-question-page-button";
    nextButton.type = "button";
    nextButton.textContent = ">";
    nextButton.disabled =
      this.activeQuestionMenuPageIndex >= this.activeQuestionMenuPageCount - 1;
    nextButton.onclick = () => this.goToNextQuestionMenuPage();

    const pageText = document.createElement("div");
    pageText.className = "nh3d-question-page-indicator";
    pageText.textContent = `Page ${this.activeQuestionMenuPageIndex + 1} / ${this.activeQuestionMenuPageCount}`;

    controls.appendChild(prevButton);
    controls.appendChild(pageText);
    controls.appendChild(nextButton);
    questionDialog.appendChild(controls);
  }

  private appendQuestionMenuActionControls(questionDialog: HTMLElement): void {
    if (
      this.activeQuestionMenuItems.length === 0 ||
      this.activeQuestionIsPickupDialog
    ) {
      return;
    }
    const selectableItemCount = this.activeQuestionVisibleMenuItems.filter(
      (item) => this.isSelectableQuestionMenuItem(item),
    ).length;
    if (selectableItemCount <= 1) {
      return;
    }

    const actions = document.createElement("div");
    actions.className = "nh3d-menu-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "nh3d-menu-action-button nh3d-menu-action-cancel";
    cancelButton.setAttribute("data-question-action", "cancel");
    cancelButton.textContent = "Cancel";
    cancelButton.onclick = () => this.cancelActivePrompt();

    actions.appendChild(cancelButton);
    questionDialog.appendChild(actions);
  }

  private renderQuestionDialogDom(): void {
    // Create or get question dialog
    let questionDialog = document.getElementById("question-dialog");
    if (!questionDialog) {
      questionDialog = document.createElement("div");
      questionDialog.id = "question-dialog";
      questionDialog.className = "nh3d-dialog nh3d-dialog-question";
      document.body.appendChild(questionDialog);
    }

    // Clear previous content
    questionDialog.innerHTML = "";

    // Add question text
    const questionText = document.createElement("div");
    questionText.className = "nh3d-question-text";
    questionText.textContent = this.activeQuestionText;
    questionDialog.appendChild(questionText);

    // Add menu items if available
    if (
      this.activeQuestionVisibleMenuItems &&
      this.activeQuestionVisibleMenuItems.length > 0
    ) {
      if (this.activeQuestionIsPickupDialog) {
        // Create multi-selection pickup dialog
        this.createPickupDialog(
          questionDialog,
          this.activeQuestionVisibleMenuItems,
          this.activeQuestionText,
        );
        this.updatePickupFocusVisualState();
      } else {
        // Create standard single-selection menu
        this.createStandardMenu(
          questionDialog,
          this.activeQuestionVisibleMenuItems,
        );
        this.updateQuestionMenuFocusVisualState();
      }

      this.appendQuestionMenuActionControls(questionDialog);
      this.appendQuestionMenuPaginationControls(questionDialog);
    } else {
      // Add choice buttons for simple y/n questions
      const choiceContainer = document.createElement("div");
      choiceContainer.className = "nh3d-choice-list";

      const parsedChoices = this.parseQuestionChoices(
        this.activeQuestionText,
        this.activeQuestionChoices,
      );
      const useInventoryChoiceLabels =
        !this.isSimpleYesNoChoicePrompt(parsedChoices);
      const useCompactChoiceLayout =
        parsedChoices.length > 0 &&
        parsedChoices.every((choice) => choice.trim().length === 1);
      if (useCompactChoiceLayout) {
        choiceContainer.classList.add("is-compact");
      }
      if (parsedChoices.length > 0) {
        for (const choice of parsedChoices) {
          const button = document.createElement("button");
          button.className = "nh3d-choice-button";
          if (choice === this.activeQuestionDefaultChoice) {
            button.classList.add("nh3d-choice-button-default");
          }
          button.textContent = this.getQuestionChoiceLabel(
            choice,
            useInventoryChoiceLabels,
          );
          button.onclick = () => {
            this.sendInput(choice);
            this.hideQuestion();
          };
          choiceContainer.appendChild(button);
        }
      }

      questionDialog.appendChild(choiceContainer);
    }

    // Add escape instruction
    const escapeText = document.createElement("div");
    escapeText.className = "nh3d-dialog-hint";
    if (
      this.activeQuestionMenuItems.length > 0 &&
      this.activeQuestionMenuPageCount > 1
    ) {
      escapeText.textContent =
        "Use < and > to change pages. Press ESC to cancel";
    } else {
      escapeText.textContent = "Press ESC to cancel";
    }
    questionDialog.appendChild(escapeText);

    (questionDialog as any).isPickupDialog = this.activeQuestionIsPickupDialog;
    (questionDialog as any).menuItems = [
      ...this.activeQuestionVisibleMenuItems,
    ];

    // Show the dialog
    questionDialog.classList.add("is-visible");
  }

  private showQuestion(
    question: string,
    choices: string,
    defaultChoice: string,
    menuItems: any[],
  ): void {
    this.activeQuestionText = question || "";
    this.activeQuestionChoices = choices || "";
    this.activeQuestionDefaultChoice = defaultChoice || "";
    this.activeQuestionMenuItems = Array.isArray(menuItems)
      ? [...menuItems]
      : [];
    this.activeQuestionIsPickupDialog =
      this.activeQuestionMenuItems.length > 0 &&
      this.isMultiSelectLootQuestion(this.activeQuestionText);
    this.activePickupSelections.clear();
    this.activePickupFocusIndex = 0;
    this.activeQuestionMenuFocusIndex = 0;
    this.activeQuestionActionFocusIndex = -1;
    this.activeQuestionMenuPageIndex = 0;
    this.rebuildActiveQuestionMenuPagination();

    if (this.uiAdapter) {
      this.syncQuestionDialogState();
      return;
    }

    // Temporarily disable automatic "?" expansion to debug menu issues
    // TODO: Re-enable with better logic later
    const needsExpansion = false;

    if (needsExpansion) {
      console.log(
        "🔍 Question includes '?' option, automatically expanding options...",
      );
      // Send "?" to get detailed menu items
      this.sendInput("?");
      // Don't show the dialog yet - wait for expanded menu items
      return;
    }
    this.renderQuestionDialogDom();
  }

  private syncQuestionDialogState(): void {
    if (!this.uiAdapter) {
      return;
    }

    if (!this.isInQuestion) {
      this.uiAdapter.setQuestion(null);
      return;
    }

    const selectedAccelerators = this.activeQuestionVisibleMenuItems
      .filter((item) => {
        if (!this.isSelectableQuestionMenuItem(item)) {
          return false;
        }
        const selectionKey = this.getMenuSelectionStateKey(item);
        return this.activePickupSelections.has(selectionKey);
      })
      .map((item) =>
        typeof item.accelerator === "string" ? item.accelerator : "",
      )
      .filter((value) => value.length > 0);
    const activeActionButton = this.getActiveQuestionActionButton();
    const activeMenuSelectionInput =
      this.activeQuestionMenuItems.length > 0 && !activeActionButton
        ? this.activeQuestionIsPickupDialog
          ? this.getActivePickupSelectionInput()
          : this.getActiveQuestionMenuSelectionInput()
        : null;

    const state: QuestionDialogState = {
      text: this.activeQuestionText,
      choices: this.activeQuestionChoices,
      defaultChoice: this.activeQuestionDefaultChoice,
      menuItems: [...this.activeQuestionVisibleMenuItems],
      isPickupDialog: this.activeQuestionIsPickupDialog,
      selectedAccelerators,
      activePickupSelectionInput: this.activeQuestionIsPickupDialog
        ? activeMenuSelectionInput
        : null,
      activeMenuSelectionInput,
      activeActionButton,
      menuPageIndex: this.activeQuestionMenuPageIndex,
      menuPageCount: this.activeQuestionMenuPageCount,
    };
    this.uiAdapter.setQuestion(state);
  }

  private parseQuestionChoices(question: string, choices: string): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    const addChoice = (choice: string): void => {
      if (!choice || seen.has(choice)) {
        return;
      }
      seen.add(choice);
      merged.push(choice);
    };

    for (const choice of this.expandChoiceSpec(choices)) {
      addChoice(choice);
    }

    const bracketMatch = question ? question.match(/\[([^\]]+)\]/) : null;
    if (bracketMatch && bracketMatch[1]) {
      for (const choice of this.expandChoiceSpec(bracketMatch[1])) {
        addChoice(choice);
      }
    }

    return merged;
  }

  private isSimpleYesNoChoicePrompt(parsedChoices: string[]): boolean {
    if (!Array.isArray(parsedChoices) || parsedChoices.length === 0) {
      return false;
    }

    const normalized = parsedChoices
      .map((choice) =>
        String(choice || "")
          .trim()
          .toLowerCase(),
      )
      .filter((choice) => choice.length > 0);
    if (normalized.length === 0) {
      return false;
    }

    const allowedChoices = new Set(["y", "n", "a", "q"]);
    const hasYes = normalized.includes("y");
    const hasNo = normalized.includes("n");
    const onlySimpleChoices = normalized.every(
      (choice) => choice.length === 1 && allowedChoices.has(choice),
    );
    return hasYes && hasNo && onlySimpleChoices;
  }

  private expandChoiceSpec(spec: string): string[] {
    const normalized = (spec || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+or\s+/gi, " ")
      .replace(/[,/|]/g, " ")
      .replace(/\s+/g, "")
      .replace(/[\[\]]/g, "");

    if (!normalized) {
      return [];
    }

    const expanded: string[] = [];
    const seen = new Set<string>();

    const addChoice = (value: string): void => {
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      expanded.push(value);
    };

    for (let i = 0; i < normalized.length; i += 1) {
      const current = normalized[i];
      const hasRangeEnd =
        i + 2 < normalized.length && normalized[i + 1] === "-";

      if (hasRangeEnd) {
        const end = normalized[i + 2];
        if (this.canExpandChoiceRange(current, end)) {
          const startCode = current.charCodeAt(0);
          const endCode = end.charCodeAt(0);
          const step = startCode <= endCode ? 1 : -1;
          for (
            let code = startCode;
            step > 0 ? code <= endCode : code >= endCode;
            code += step
          ) {
            addChoice(String.fromCharCode(code));
          }
          i += 2;
          continue;
        }
      }

      if (current !== "-") {
        addChoice(current);
      }
    }

    return expanded;
  }

  private canExpandChoiceRange(start: string, end: string): boolean {
    const isLower = (value: string) => value >= "a" && value <= "z";
    const isUpper = (value: string) => value >= "A" && value <= "Z";
    const isDigit = (value: string) => value >= "0" && value <= "9";

    return (
      (isLower(start) && isLower(end)) ||
      (isUpper(start) && isUpper(end)) ||
      (isDigit(start) && isDigit(end))
    );
  }

  private getQuestionChoiceLabel(
    choice: string,
    useInventoryLabels = true,
  ): string {
    const normalizedChoice = choice.trim();
    if (!normalizedChoice) {
      return choice;
    }

    if (!useInventoryLabels) {
      return normalizedChoice;
    }

    const inventoryItem = this.currentInventory.find((item) => {
      if (!item || item.isCategory) {
        return false;
      }

      const accelerator =
        typeof item.accelerator === "string" ? item.accelerator.trim() : "";
      if (!accelerator) {
        return false;
      }

      return (
        accelerator === normalizedChoice ||
        accelerator.toLowerCase() === normalizedChoice.toLowerCase()
      );
    });

    if (!inventoryItem || typeof inventoryItem.text !== "string") {
      return normalizedChoice;
    }

    const itemText = inventoryItem.text.trim();
    if (!itemText) {
      return normalizedChoice;
    }

    return `${normalizedChoice}) ${itemText}`;
  }

  private getDirectionChoiceSet(): Array<{
    key?: string;
    label?: string;
    spacer?: boolean;
  }> {
    if (this.numberPadModeEnabled) {
      return [
        { key: "7", label: "\u2196" },
        { key: "8", label: "\u2191" },
        { key: "9", label: "\u2197" },
        { key: "4", label: "\u2190" },
        { spacer: true },
        { key: "6", label: "\u2192" },
        { key: "1", label: "\u2199" },
        { key: "2", label: "\u2193" },
        { key: "3", label: "\u2198" },
      ];
    }

    return [
      { key: "y", label: "\u2196" },
      { key: "k", label: "\u2191" },
      { key: "u", label: "\u2197" },
      { key: "h", label: "\u2190" },
      { spacer: true },
      { key: "l", label: "\u2192" },
      { key: "b", label: "\u2199" },
      { key: "j", label: "\u2193" },
      { key: "n", label: "\u2198" },
    ];
  }

  private getDirectionAuxChoiceSet(): Array<{ key: string; label: string }> {
    return [
      { key: "<", label: "UP" },
      { key: "s", label: "SELF" },
      { key: ">", label: "DOWN" },
    ];
  }

  private getDirectionHelpText(): string {
    return this.numberPadModeEnabled
      ? "Use numpad (1-4,6-9), arrow keys, <, >, or s. Press ESC to cancel"
      : "Use hjkl/yubn, arrow keys, <, >, or s. Press ESC to cancel";
  }

  private showDirectionQuestion(question: string): void {
    // Set direction question state to pause movement
    this.isInDirectionQuestion = true;

    if (this.uiAdapter) {
      this.uiAdapter.setDirectionQuestion(question);
      return;
    }

    // Create or get direction dialog
    let directionDialog = document.getElementById("direction-dialog");
    if (!directionDialog) {
      directionDialog = document.createElement("div");
      directionDialog.id = "direction-dialog";
      directionDialog.className = "nh3d-dialog nh3d-dialog-direction";
      document.body.appendChild(directionDialog);
    }

    // Clear previous content
    directionDialog.innerHTML = "";

    // Add question text
    const questionText = document.createElement("div");
    questionText.className = "nh3d-direction-text";
    questionText.textContent = question;
    directionDialog.appendChild(questionText);

    // Add direction buttons
    const directionsContainer = document.createElement("div");
    directionsContainer.className = "nh3d-direction-grid";

    const directions = this.getDirectionChoiceSet();

    directions.forEach((dir) => {
      if (dir.spacer || !dir.key || !dir.label) {
        const spacer = document.createElement("div");
        spacer.className = "nh3d-direction-spacer";
        spacer.setAttribute("aria-hidden", "true");
        directionsContainer.appendChild(spacer);
        return;
      }

      const button = document.createElement("button");
      button.className = "nh3d-direction-button";
      const symbol = document.createElement("div");
      symbol.className = "nh3d-direction-symbol";
      symbol.textContent = dir.label;
      const key = document.createElement("div");
      key.className = "nh3d-direction-key";
      key.textContent = dir.key;
      button.appendChild(symbol);
      button.appendChild(key);

      button.onclick = () => {
        this.sendInput(dir.key);
        this.hideDirectionQuestion();
      };

      directionsContainer.appendChild(button);
    });

    directionDialog.appendChild(directionsContainer);

    const auxDirectionsContainer = document.createElement("div");
    auxDirectionsContainer.className = "nh3d-direction-extra-row";
    const auxDirections = this.getDirectionAuxChoiceSet();

    auxDirections.forEach((dir) => {
      const button = document.createElement("button");
      button.className = "nh3d-direction-button nh3d-direction-button-extra";
      const symbol = document.createElement("div");
      symbol.className = "nh3d-direction-symbol";
      symbol.textContent = dir.label;
      const key = document.createElement("div");
      key.className = "nh3d-direction-key";
      key.textContent = dir.key;
      button.appendChild(symbol);
      button.appendChild(key);

      button.onclick = () => {
        this.sendInput(dir.key);
        this.hideDirectionQuestion();
      };

      auxDirectionsContainer.appendChild(button);
    });

    directionDialog.appendChild(auxDirectionsContainer);

    // Add escape instruction
    const escapeText = document.createElement("div");
    escapeText.className = "nh3d-dialog-hint";
    escapeText.textContent = this.getDirectionHelpText();
    directionDialog.appendChild(escapeText);

    const actions = document.createElement("div");
    actions.className = "nh3d-menu-actions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "nh3d-menu-action-button nh3d-menu-action-cancel";
    cancelButton.textContent = "Cancel";
    cancelButton.onclick = () => this.cancelActivePrompt();
    actions.appendChild(cancelButton);
    directionDialog.appendChild(actions);

    // Show the dialog
    directionDialog.classList.add("is-visible");
  }

  private hideDirectionQuestion(): void {
    this.isInDirectionQuestion = false;
    this.isInQuestion = false; // Clear general question state
    if (this.uiAdapter) {
      this.uiAdapter.setDirectionQuestion(null);
      return;
    }

    const directionDialog = document.getElementById("direction-dialog");
    if (directionDialog) {
      directionDialog.classList.remove("is-visible");
    }
  }

  private showInfoMenuDialog(title: string, lines: string[]): void {
    this.isInfoDialogVisible = true;
    if (this.uiAdapter) {
      this.uiAdapter.setInfoMenu({
        title: title || "NetHack Information",
        lines: lines && lines.length > 0 ? [...lines] : [],
      });
      return;
    }

    let infoDialog = document.getElementById("info-menu-dialog");
    if (!infoDialog) {
      infoDialog = document.createElement("div");
      infoDialog.id = "info-menu-dialog";
      infoDialog.className = "nh3d-dialog nh3d-dialog-info";
      document.body.appendChild(infoDialog);
    }

    infoDialog.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.className = "nh3d-info-title";
    titleEl.textContent = title || "NetHack Information";
    infoDialog.appendChild(titleEl);

    const body = document.createElement("div");
    body.className = "nh3d-info-body";
    body.textContent =
      lines && lines.length > 0 ? lines.join("\n") : "(No details)";
    infoDialog.appendChild(body);

    const hint = document.createElement("div");
    hint.className = "nh3d-info-hint";
    hint.textContent =
      "Press SPACE, ENTER, or ESC to close. Press Ctrl+M to reopen.";
    infoDialog.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "nh3d-menu-actions";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "nh3d-menu-action-button nh3d-menu-action-cancel";
    closeButton.textContent = "Close";
    closeButton.onclick = () => this.hideInfoMenuDialog();
    actions.appendChild(closeButton);
    infoDialog.appendChild(actions);

    infoDialog.classList.add("is-visible");
  }

  private hideInfoMenuDialog(): void {
    this.isInfoDialogVisible = false;
    if (this.uiAdapter) {
      this.uiAdapter.setInfoMenu(null);
      return;
    }

    const infoDialog = document.getElementById("info-menu-dialog");
    if (infoDialog) {
      infoDialog.classList.remove("is-visible");
    }
  }

  private toggleInfoMenuDialog(): void {
    if (this.isInfoDialogVisible) {
      this.hideInfoMenuDialog();
      return;
    }

    if (this.lastInfoMenu) {
      this.showInfoMenuDialog(this.lastInfoMenu.title, this.lastInfoMenu.lines);
    } else {
      this.addGameMessage("No recent information panel to reopen.");
    }
  }

  private showInventoryDialog(): void {
    this.isInventoryDialogVisible = true;
    if (this.uiAdapter) {
      this.uiAdapter.setInventory({
        visible: true,
        items: [...this.currentInventory],
      });
      return;
    }

    // Create or get inventory dialog
    let inventoryDialog = document.getElementById("inventory-dialog");
    if (!inventoryDialog) {
      inventoryDialog = document.createElement("div");
      inventoryDialog.id = "inventory-dialog";
      inventoryDialog.className = "nh3d-dialog nh3d-dialog-inventory";
      document.body.appendChild(inventoryDialog);
    }

    // Clear previous content
    inventoryDialog.innerHTML = "";

    // Add title
    const title = document.createElement("div");
    title.className = "nh3d-inventory-title";
    title.textContent = "📦 INVENTORY";
    inventoryDialog.appendChild(title);

    // Add inventory items
    const itemsContainer = document.createElement("div");
    itemsContainer.className = "nh3d-inventory-items";

    if (this.currentInventory.length === 0) {
      const emptyMessage = document.createElement("div");
      emptyMessage.className = "nh3d-inventory-empty";
      emptyMessage.textContent = "Your inventory is empty.";
      itemsContainer.appendChild(emptyMessage);
    } else {
      // Display both categories and items (don't filter out categories)
      this.currentInventory.forEach((item: any, index: number) => {
        if (item.isCategory) {
          // This is a category header
          const categoryHeader = document.createElement("div");
          categoryHeader.className = "nh3d-inventory-category";
          if (index === 0) {
            categoryHeader.classList.add("nh3d-inventory-category-first");
          }
          categoryHeader.textContent = item.text;
          itemsContainer.appendChild(categoryHeader);
        } else {
          // This is an actual item
          const itemDiv = document.createElement("div");
          itemDiv.className = "nh3d-inventory-item";

          const keySpan = document.createElement("span");
          keySpan.className = "nh3d-inventory-key";
          keySpan.textContent = `${item.accelerator || "?"})`;

          const textSpan = document.createElement("span");
          textSpan.className = "nh3d-inventory-text";
          textSpan.textContent = item.text || "Unknown item";

          itemDiv.appendChild(keySpan);
          itemDiv.appendChild(textSpan);
          itemsContainer.appendChild(itemDiv);
        }
      });
    }

    inventoryDialog.appendChild(itemsContainer);

    // Add compact NetHack item handling keybinds
    const keybindsTitle = document.createElement("div");
    keybindsTitle.className = "nh3d-inventory-keybinds-title";
    keybindsTitle.textContent = "🎮 ITEM COMMANDS";
    inventoryDialog.appendChild(keybindsTitle);

    // Create commands container
    const keybindsContainer = document.createElement("div");
    keybindsContainer.className = "nh3d-inventory-keybinds";

    // Create highlighted command list with color-coded keys
    const commandText = `<span class="nh3d-inventory-command-key">a</span>)pply <span class="nh3d-inventory-command-key">d</span>)rop <span class="nh3d-inventory-command-key">e</span>)at <span class="nh3d-inventory-command-key">q</span>)uaff <span class="nh3d-inventory-command-key">r</span>)ead <span class="nh3d-inventory-command-key">t</span>)hrow <span class="nh3d-inventory-command-key">w</span>)ield <span class="nh3d-inventory-command-key">W</span>)ear <span class="nh3d-inventory-command-key">T</span>)ake-off <span class="nh3d-inventory-command-key">P</span>)ut-on <span class="nh3d-inventory-command-key">R</span>)emove <span class="nh3d-inventory-command-key">z</span>)ap <span class="nh3d-inventory-command-key">Z</span>)cast
    Special: <span class="nh3d-inventory-command-key">"</span>)weapons <span class="nh3d-inventory-command-key">[</span>)armor <span class="nh3d-inventory-command-key">=</span>)rings <span class="nh3d-inventory-command-key">"</span>)amulets <span class="nh3d-inventory-command-key">(</span>)tools`;

    keybindsContainer.innerHTML = `<div class="nh3d-inventory-keybinds-text">${commandText}</div>`;
    inventoryDialog.appendChild(keybindsContainer);

    // Add close instructions
    const closeText = document.createElement("div");
    closeText.className = "nh3d-inventory-close";
    closeText.textContent = "Press ENTER, ESC, or 'i' to close";
    inventoryDialog.appendChild(closeText);

    const actions = document.createElement("div");
    actions.className = "nh3d-menu-actions";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "nh3d-menu-action-button nh3d-menu-action-cancel";
    closeButton.textContent = "Close";
    closeButton.onclick = () => this.hideInventoryDialog();
    actions.appendChild(closeButton);
    inventoryDialog.appendChild(actions);

    // Show the dialog
    inventoryDialog.classList.add("is-visible");
  }

  private hideInventoryDialog(): void {
    this.isInventoryDialogVisible = false;
    if (this.uiAdapter) {
      this.uiAdapter.setInventory({
        visible: false,
        items: [...this.currentInventory],
      });
      this.pendingInventoryDialog = false;
      return;
    }

    const inventoryDialog = document.getElementById("inventory-dialog");
    if (inventoryDialog) {
      inventoryDialog.classList.remove("is-visible");
    }
    // Clear any pending inventory dialog flag
    this.pendingInventoryDialog = false;
  }

  private toggleInventoryDialogState(): void {
    if (
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.positionInputModeActive ||
      this.metaCommandModeActive
    ) {
      return;
    }

    this.hideInfoMenuDialog();
    if (this.isInventoryDialogOpen()) {
      console.log("📦 Closing inventory dialog");
      this.hideInventoryDialog();
      return;
    }

    if (this.currentInventory && this.currentInventory.length > 0) {
      console.log("📦 Showing inventory dialog with existing data");
      this.showInventoryDialog();
      return;
    }

    if (!this.session) {
      return;
    }

    console.log("📦 Requesting current inventory from NetHack...");
    this.sendInput("i");
    this.pendingInventoryDialog = true;
  }

  private showPositionRequest(text: string): void {
    if (this.positionHideTimerId !== null) {
      window.clearTimeout(this.positionHideTimerId);
      this.positionHideTimerId = null;
    }

    if (this.uiAdapter) {
      this.uiAdapter.setPositionRequest(text);
      this.positionHideTimerId = window.setTimeout(() => {
        this.uiAdapter?.setPositionRequest(null);
      }, 3000);
      return;
    }

    // Create or get position dialog
    let posDialog = document.getElementById("position-dialog");
    if (!posDialog) {
      posDialog = document.createElement("div");
      posDialog.id = "position-dialog";
      document.body.appendChild(posDialog);
    }

    posDialog.textContent = text;
    posDialog.classList.add("is-visible");

    // Auto-hide after 3 seconds
    this.positionHideTimerId = window.setTimeout(() => {
      if (posDialog) {
        posDialog.classList.remove("is-visible");
      }
    }, 3000);
  }

  private showNameRequest(text: string, maxLength: number): void {
    // Create or get name dialog
    let nameDialog = document.getElementById("name-dialog");
    if (!nameDialog) {
      nameDialog = document.createElement("div");
      nameDialog.id = "name-dialog";
      nameDialog.className = "nh3d-dialog nh3d-dialog-name";
      document.body.appendChild(nameDialog);
    }

    // Clear previous content
    nameDialog.innerHTML = "";

    // Add question text
    const questionText = document.createElement("div");
    questionText.className = "nh3d-name-question";
    questionText.textContent = text;
    nameDialog.appendChild(questionText);

    // Add input field
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = maxLength;
    nameInput.placeholder = "Enter your name";
    nameInput.className = "nh3d-name-input";
    nameDialog.appendChild(nameInput);

    // Add submit button
    const submitButton = document.createElement("button");
    submitButton.textContent = "OK";
    submitButton.className = "nh3d-name-submit";

    const submitName = () => {
      const name = nameInput.value.trim() || "Adventurer";
      this.sendInput(name);
      nameDialog.classList.remove("is-visible");
    };

    submitButton.onclick = submitName;
    nameInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        submitName();
      }
    };

    nameDialog.appendChild(submitButton);

    // Show dialog and focus input
    nameDialog.classList.add("is-visible");
    nameInput.focus();
  }

  private showTextInputRequest(text: string, maxLength = 256): void {
    this.isInQuestion = true;
    this.isTextInputActive = true;

    if (this.uiAdapter) {
      this.uiAdapter.setTextInput({
        text: String(text || ""),
        maxLength,
        placeholder: "Enter text",
      });
    }
  }

  private hideTextInputRequest(): void {
    if (!this.isTextInputActive) {
      return;
    }

    this.isTextInputActive = false;
    this.isInQuestion = false;

    if (this.uiAdapter) {
      this.uiAdapter.setTextInput(null);
    }
  }

  private hideQuestion(): void {
    this.isInQuestion = false; // Clear general question state
    this.activeQuestionText = "";
    this.activeQuestionChoices = "";
    this.activeQuestionDefaultChoice = "";
    this.activeQuestionMenuItems = [];
    this.activeQuestionVisibleMenuItems = [];
    this.activeQuestionMenuPageIndex = 0;
    this.activeQuestionMenuPageCount = 1;
    this.activeQuestionPageSelectionMap.clear();
    this.activeQuestionIsPickupDialog = false;
    this.activePickupSelections.clear();
    this.activePickupFocusIndex = 0;
    this.activeQuestionMenuFocusIndex = 0;
    this.activeQuestionActionFocusIndex = -1;

    if (this.uiAdapter) {
      this.uiAdapter.setQuestion(null);
      return;
    }

    const questionDialog = document.getElementById("question-dialog");
    if (questionDialog) {
      questionDialog.classList.remove("is-visible");
      questionDialog.innerHTML = ""; // Clear content to prevent retention
      // Clear pickup dialog flags
      (questionDialog as any).isPickupDialog = false;
      (questionDialog as any).menuItems = null;
    }
  }

  private createPickupDialog(
    questionDialog: HTMLElement,
    menuItems: any[],
    question: string,
  ): void {
    const selectableItemCount = menuItems.filter((item) =>
      this.isSelectableQuestionMenuItem(item),
    ).length;

    menuItems.forEach((item) => {
      if (
        item.isCategory ||
        !item.accelerator ||
        item.accelerator.trim() === ""
      ) {
        // Category header
        const categoryHeader = document.createElement("div");
        categoryHeader.className = "nh3d-menu-category";
        categoryHeader.textContent = item.text;
        questionDialog.appendChild(categoryHeader);
      } else {
        // Selectable item with checkbox
        const itemContainer = document.createElement("div");
        itemContainer.className = "nh3d-pickup-item";
        const selectionStateKey = this.getMenuSelectionStateKey(item);
        const selectionInput = this.getQuestionMenuSelectionInput(item);
        if (this.isPickupSelectionInputFocused(selectionInput)) {
          itemContainer.classList.add("nh3d-pickup-item-active");
        }

        // Checkbox
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `pickup-${selectionStateKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        checkbox.className = "nh3d-pickup-checkbox";

        // Key label
        const keyPart = document.createElement("span");
        keyPart.className = "nh3d-pickup-key";
        keyPart.textContent = `${item.accelerator})`;

        // Item text
        const textPart = document.createElement("span");
        textPart.className = "nh3d-pickup-text";
        textPart.textContent = item.text;

        const applySelectionState = (
          isSelected: boolean,
          shouldSendInput: boolean,
        ) => {
          checkbox.checked = isSelected;
          if (isSelected) {
            this.activePickupSelections.add(selectionStateKey);
            itemContainer.classList.add("nh3d-pickup-item-selected");
          } else {
            this.activePickupSelections.delete(selectionStateKey);
            itemContainer.classList.remove("nh3d-pickup-item-selected");
          }
          if (shouldSendInput) {
            // Send the key to NetHack to keep game state in sync
            this.sendInput(selectionInput);
          }
          this.updatePickupFocusVisualState();
        };

        applySelectionState(
          this.activePickupSelections.has(selectionStateKey),
          false,
        );

        // Toggle function
        const toggleItem = () => {
          applySelectionState(!checkbox.checked, true);
        };

        // Click handlers
        itemContainer.onclick = (e) => {
          e.preventDefault();
          this.setActivePickupFocusBySelectionInput(selectionInput);
          this.updatePickupFocusVisualState();
          toggleItem();
        };

        checkbox.onclick = (e) => {
          // Prevent checkbox clicks from triggering the row click handler.
          e.stopPropagation();
        };

        checkbox.onchange = (e) => {
          e.stopPropagation();
          // Checkbox state is already updated by the browser click action.
          this.setActivePickupFocusBySelectionInput(selectionInput);
          this.updatePickupFocusVisualState();
          applySelectionState(checkbox.checked, true);
        };

        // Store toggle function for keyboard access
        (itemContainer as any).toggleItem = toggleItem;
        (itemContainer as any).accelerator = item.accelerator;
        (itemContainer as any).selectionInput = selectionInput;

        itemContainer.appendChild(checkbox);
        itemContainer.appendChild(keyPart);
        itemContainer.appendChild(textPart);
        questionDialog.appendChild(itemContainer);
      }
    });

    if (selectableItemCount > 1) {
      const actions = document.createElement("div");
      actions.className = "nh3d-pickup-actions";

      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className =
        "nh3d-pickup-action-button nh3d-pickup-action-confirm";
      confirmButton.setAttribute("data-question-action", "confirm");
      confirmButton.textContent = "Confirm";
      confirmButton.onclick = () => this.confirmPickupChoices();

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className =
        "nh3d-pickup-action-button nh3d-pickup-action-cancel";
      cancelButton.setAttribute("data-question-action", "cancel");
      cancelButton.textContent = "Cancel";
      cancelButton.onclick = () => this.cancelActivePrompt();

      actions.appendChild(confirmButton);
      actions.appendChild(cancelButton);
      questionDialog.appendChild(actions);
    }

    // Store that this is a pickup dialog for keyboard handling
    (questionDialog as any).isPickupDialog = true;
    (questionDialog as any).menuItems = menuItems;
  }

  private createStandardMenu(
    questionDialog: HTMLElement,
    menuItems: any[],
  ): void {
    menuItems.forEach((item) => {
      if (
        item.isCategory ||
        !item.accelerator ||
        item.accelerator.trim() === ""
      ) {
        // Category header
        const categoryHeader = document.createElement("div");
        categoryHeader.className = "nh3d-menu-category";
        categoryHeader.textContent = item.text;
        questionDialog.appendChild(categoryHeader);
      } else {
        // Standard single-selection button
        const menuButton = document.createElement("button");
        menuButton.className = "nh3d-menu-button";
        const selectionInput = this.getQuestionMenuSelectionInput(item);
        if (this.isQuestionMenuSelectionInputFocused(selectionInput)) {
          menuButton.classList.add("nh3d-menu-button-active");
        }

        // Format the button text with key and description
        const keyPart = document.createElement("span");
        keyPart.className = "nh3d-menu-button-key";
        keyPart.textContent = `${item.accelerator}) `;

        const textPart = document.createElement("span");
        textPart.textContent = item.text;

        menuButton.appendChild(keyPart);
        menuButton.appendChild(textPart);

        menuButton.onclick = () => {
          this.setActiveQuestionMenuFocusBySelectionInput(selectionInput);
          this.sendInput(selectionInput);
          this.hideQuestion();
        };
        (menuButton as any).selectionInput = selectionInput;
        questionDialog.appendChild(menuButton);
      }
    });
  }

  private decodeMenuSelectionIndexFromInput(input: string): number | null {
    if (
      typeof input !== "string" ||
      !input.startsWith(this.menuSelectionInputPrefix)
    ) {
      return null;
    }
    const raw = input.slice(this.menuSelectionInputPrefix.length).trim();
    if (!/^-?\d+$/.test(raw)) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private getMenuSelectionInput(item: any, fallbackInput = ""): string {
    if (item && Number.isInteger(item.menuIndex)) {
      return `${this.menuSelectionInputPrefix}${item.menuIndex}`;
    }
    if (item && typeof item.accelerator === "string" && item.accelerator) {
      return item.accelerator;
    }
    return fallbackInput;
  }

  private getMenuSelectionStateKey(item: any): string {
    if (item && Number.isInteger(item.menuIndex)) {
      return `menu-index:${item.menuIndex}`;
    }
    const originalAccelerator =
      item && typeof item.originalAccelerator === "string"
        ? item.originalAccelerator
        : "";
    const accelerator =
      item && typeof item.accelerator === "string" ? item.accelerator : "";
    const stableAccelerator = originalAccelerator || accelerator;
    return `accelerator:${stableAccelerator}`;
  }

  private findActiveMenuItemBySelectionInput(input: string): any | null {
    const menuIndex = this.decodeMenuSelectionIndexFromInput(input);
    if (Number.isInteger(menuIndex)) {
      const indexed = this.activeQuestionMenuItems.find(
        (item) =>
          item &&
          !item.isCategory &&
          Number.isInteger(item.menuIndex) &&
          item.menuIndex === menuIndex,
      );
      if (indexed) {
        return indexed;
      }
    }
    return this.findActiveMenuItemByAccelerator(input);
  }

  private findActiveMenuItemByAccelerator(input: string): any | null {
    if (typeof input !== "string" || input.length === 0) {
      return null;
    }

    const exact = this.activeQuestionMenuItems.find(
      (item) => item && !item.isCategory && item.accelerator === input,
    );
    if (exact) {
      return exact;
    }

    const lower = input.toLowerCase();
    return (
      this.activeQuestionMenuItems.find((item) => {
        if (!item || item.isCategory || typeof item.accelerator !== "string") {
          return false;
        }
        return item.accelerator.toLowerCase() === lower;
      }) ?? null
    );
  }

  private togglePickupSelection(
    selectionInput: string,
    shouldSendInput: boolean,
  ): void {
    const menuItem = this.findActiveMenuItemBySelectionInput(selectionInput);
    if (!menuItem) {
      return;
    }

    const selectionKey = this.getMenuSelectionStateKey(menuItem);
    const canonicalSelectionInput =
      this.getQuestionMenuSelectionInput(menuItem);
    this.setActivePickupFocusBySelectionInput(canonicalSelectionInput);

    if (this.activePickupSelections.has(selectionKey)) {
      this.activePickupSelections.delete(selectionKey);
    } else {
      this.activePickupSelections.add(selectionKey);
    }

    if (shouldSendInput) {
      this.sendInput(canonicalSelectionInput);
    }
    this.updatePickupFocusVisualState();
  }

  public chooseDirection(directionKey: string): void {
    if (!this.isInDirectionQuestion || !directionKey) {
      return;
    }
    this.sendInput(directionKey);
    this.hideDirectionQuestion();
  }

  public chooseQuestionChoice(choice: string): void {
    if (!this.isInQuestion || !choice) {
      return;
    }
    const resolvedChoice = this.resolveQuestionSelectionInput(choice);
    this.updateNumberPadModeFromChoice(resolvedChoice);

    if (this.activeQuestionIsPickupDialog) {
      this.togglePickupSelection(resolvedChoice, true);
      return;
    }

    const selectedItem =
      this.findActiveMenuItemBySelectionInput(resolvedChoice);
    if (selectedItem) {
      const selectionInput = this.getQuestionMenuSelectionInput(selectedItem);
      this.setActiveQuestionMenuFocusBySelectionInput(selectionInput);
      this.sendInput(selectionInput);
      this.hideQuestion();
      return;
    }

    if (this.activeQuestionMenuItems.length > 0) {
      return;
    }

    this.sendInput(resolvedChoice);
    this.hideQuestion();
  }

  public confirmQuestionMenuChoice(): void {
    this.confirmActiveQuestionMenuChoice();
  }

  public togglePickupChoice(accelerator: string): void {
    if (!this.isInQuestion || !this.activeQuestionIsPickupDialog) {
      return;
    }
    const resolvedInput = this.resolveQuestionSelectionInput(accelerator);
    const menuItem = this.findActiveMenuItemBySelectionInput(resolvedInput);
    if (!menuItem) {
      return;
    }
    this.togglePickupSelection(
      this.getQuestionMenuSelectionInput(menuItem),
      true,
    );
  }

  public confirmPickupChoices(): void {
    if (!this.isInQuestion || !this.activeQuestionIsPickupDialog) {
      return;
    }
    this.sendInput("Enter");
    this.hideQuestion();
  }

  public submitTextInput(text: string): void {
    if (!this.session) {
      this.hideTextInputRequest();
      return;
    }
    const normalized = typeof text === "string" ? text : String(text ?? "");
    this.sendInput(`${this.textInputPrefix}${normalized}`);
    this.hideTextInputRequest();
  }

  public cancelActivePrompt(): void {
    if (this.isTextInputActive) {
      this.submitTextInput("");
      return;
    }
    if (this.isInQuestion || this.isInDirectionQuestion) {
      this.sendInput("Escape");
    }
    this.hideQuestion();
    this.hideDirectionQuestion();
  }

  public toggleInventoryDialog(): void {
    this.toggleInventoryDialogState();
  }

  public runQuickAction(actionId: string): void {
    const normalizedActionId = String(actionId || "")
      .trim()
      .toLowerCase();
    if (!normalizedActionId || !this.session) {
      return;
    }

    if (
      this.metaCommandModeActive ||
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.positionInputModeActive
    ) {
      return;
    }

    this.hideInfoMenuDialog();
    if (this.isInventoryDialogOpen()) {
      this.hideInventoryDialog();
    }

    switch (normalizedActionId) {
      case "wait":
        this.sendInput(".");
        return;
      case "search":
        this.sendInput("s");
        return;
      case "pickup":
        this.sendInput(",");
        return;
      case "look":
        this.sendInput("/");
        return;
      case "loot":
        this.sendInput("l");
        return;
      case "open":
        this.sendInput("o");
        return;
      case "close":
        this.sendInput("c");
        return;
      case "extended":
        this.sendInput("#");
        return;
      default:
        console.log(`Unknown quick action requested: ${actionId}`);
        return;
    }
  }

  public runExtendedCommand(commandText: string): void {
    const normalizedCommandText = String(commandText || "")
      .trim()
      .toLowerCase();
    if (!normalizedCommandText || !this.session) {
      return;
    }

    if (
      this.metaCommandModeActive ||
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.positionInputModeActive
    ) {
      return;
    }

    this.hideInfoMenuDialog();
    if (this.isInventoryDialogOpen()) {
      this.hideInventoryDialog();
    }

    const sequence = ["#", ...normalizedCommandText.split(""), "Enter"];
    this.sendInputSequence(sequence);
  }

  public closeInventoryDialog(): void {
    this.hideInventoryDialog();
  }

  public closeInfoMenuDialog(): void {
    this.hideInfoMenuDialog();
  }

  private isLikelyNameInputForDebug(input: string): boolean {
    const trimmed = String(input || "").trim();
    if (trimmed.length < 2 || trimmed.length > 30) {
      return false;
    }
    if (trimmed.startsWith("__") || trimmed.includes(":")) {
      return false;
    }
    if (!/^[A-Za-z][A-Za-z0-9 _'-]*$/.test(trimmed)) {
      return false;
    }
    const nonNameTokens = new Set([
      "Enter",
      "Escape",
      "Space",
      "Spacebar",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Backspace",
      "Tab",
    ]);
    return !nonNameTokens.has(trimmed);
  }

  private logNameInputTrace(input: string): void {
    if (!this.isLikelyNameInputForDebug(input)) {
      return;
    }

    const stackPreview = (new Error().stack || "")
      .split("\n")
      .slice(2, 7)
      .map((line) => line.trim());
    console.log("[NAME_DEBUG] Engine sendInput(name-like)", {
      input,
      isInQuestion: this.isInQuestion,
      isInDirectionQuestion: this.isInDirectionQuestion,
      positionInputModeActive: this.positionInputModeActive,
      metaCommandModeActive: this.metaCommandModeActive,
      hasSession: Boolean(this.session),
      stackPreview,
    });
  }

  private sendInput(input: string): void {
    this.logNameInputTrace(input);

    if (
      !this.hasPlayerMovedOnce &&
      !this.isInQuestion &&
      !this.isInDirectionQuestion &&
      this.isMovementInput(input)
    ) {
      this.lastMovementInputAtMs = Date.now();
    }

    this.updateDirectionalAttackContext(input);

    if (this.session) {
      this.session.sendInput(input);
    }
  }

  private sendInputSequence(inputs: string[]): void {
    if (!this.session || inputs.length === 0) {
      return;
    }
    this.session.sendInputSequence(inputs);
  }

  private sendMouseInput(x: number, y: number, button: number): void {
    if (!this.session) {
      return;
    }
    this.session.sendMouseInput(x, y, button);
  }

  private canStartMetaCommandMode(): boolean {
    return (
      !this.metaCommandModeActive &&
      !this.isInQuestion &&
      !this.isInDirectionQuestion &&
      !this.positionInputModeActive &&
      !this.isInventoryDialogVisible &&
      !this.isInfoDialogVisible
    );
  }

  private startMetaCommandMode(): void {
    if (!this.canStartMetaCommandMode()) {
      return;
    }
    this.metaCommandModeActive = true;
    this.metaCommandBuffer = "";
    this.updateMetaCommandModal();
  }

  private exitMetaCommandMode(): void {
    if (!this.metaCommandModeActive) {
      return;
    }
    this.metaCommandModeActive = false;
    this.metaCommandBuffer = "";
    this.updateMetaCommandModal();
  }

  private confirmMetaCommandMode(): void {
    if (!this.metaCommandModeActive) {
      return;
    }
    const sequence = ["#", ...this.metaCommandBuffer.split(""), "Enter"];
    this.sendInputSequence(sequence);
    this.exitMetaCommandMode();
  }

  private isMetaCommandLetter(event: KeyboardEvent): boolean {
    return event.key.length === 1 && /^[A-Za-z]$/.test(event.key);
  }

  private handleMetaCommandKeyDown(event: KeyboardEvent): boolean {
    if (!this.metaCommandModeActive) {
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.exitMetaCommandMode();
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.confirmMetaCommandMode();
      return true;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      this.metaCommandBuffer = this.metaCommandBuffer.slice(0, -1);
      this.updateMetaCommandModal();
      return true;
    }

    if (this.isMetaCommandLetter(event)) {
      event.preventDefault();
      this.metaCommandBuffer += event.key.toLowerCase();
      this.updateMetaCommandModal();
      return true;
    }

    event.preventDefault();
    return true;
  }

  private isMovementInput(input: string): boolean {
    if (input.length === 1) {
      switch (input) {
        case "h":
        case "j":
        case "k":
        case "l":
        case "y":
        case "u":
        case "b":
        case "n":
        case "H":
        case "J":
        case "K":
        case "L":
        case "Y":
        case "U":
        case "B":
        case "N":
          return true;
        case "1":
        case "2":
        case "3":
        case "4":
        case "6":
        case "7":
        case "8":
        case "9":
          return this.numberPadModeEnabled;
        default:
          return false;
      }
    }

    switch (input) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End":
      case "PageUp":
      case "PageDown":
      case "Numpad1":
      case "Numpad2":
      case "Numpad3":
      case "Numpad4":
      case "Numpad5":
      case "Numpad6":
      case "Numpad7":
      case "Numpad8":
      case "Numpad9":
        return true;
      default:
        return false;
    }
  }

  private isInventoryDialogOpen(): boolean {
    if (this.isInventoryDialogVisible) {
      return true;
    }

    const inventoryDialog = document.getElementById("inventory-dialog");
    return Boolean(
      inventoryDialog && inventoryDialog.classList.contains("is-visible"),
    );
  }

  private isInfoDialogOpen(): boolean {
    if (this.isInfoDialogVisible) {
      return true;
    }

    const infoDialog = document.getElementById("info-menu-dialog");
    return Boolean(infoDialog && infoDialog.classList.contains("is-visible"));
  }

  private isSpaceDismissKey(event: KeyboardEvent): boolean {
    return (
      event.key === " " ||
      event.key === "Spacebar" ||
      event.key === "Space" ||
      event.code === "Space"
    );
  }

  private getModifiedInput(event: KeyboardEvent): string | null {
    // NetHack meta commands are represented as ESC + key in the runtime bridge.
    const hasMetaModifier = event.altKey || event.metaKey || this.altOrMetaHeld;
    if (!hasMetaModifier) {
      return null;
    }
    if (
      event.key === "Alt" ||
      event.key === "Meta" ||
      event.key === "Control" ||
      event.key === "Shift"
    ) {
      return null;
    }
    const normalizedKey = this.getMetaPrimaryKey(event);
    if (!normalizedKey) {
      return null;
    }
    return `${this.metaInputPrefix}${normalizedKey}`;
  }

  private getMetaPrimaryKey(event: KeyboardEvent): string | null {
    if (event.code.startsWith("Key") && event.code.length === 4) {
      return event.code.slice(3).toLowerCase();
    }
    if (event.code.startsWith("Digit") && event.code.length === 6) {
      return event.code.slice(5);
    }
    if (event.key.length === 1) {
      return event.key.toLowerCase();
    }
    return null;
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (event.key === "Alt" || event.key === "Meta") {
      this.altOrMetaHeld = false;
    }
  }

  private handleWindowBlur(): void {
    this.altOrMetaHeld = false;
    this.exitMetaCommandMode();
  }

  private normalizeWaitKey(event: KeyboardEvent): string | null {
    if (event.key === ">") {
      return null;
    }
    if (
      event.key === "." ||
      event.key === " " ||
      event.key === "Spacebar" ||
      event.key === "Space" ||
      event.key === "Decimal" ||
      event.key === "NumpadDecimal" ||
      event.code === "NumpadDecimal" ||
      event.code === "Space"
    ) {
      return ".";
    }
    return null;
  }

  private mapArrowKeyToDirectionKey(key: string): string | null {
    switch (key) {
      case "ArrowUp":
        return this.numberPadModeEnabled ? "8" : "k";
      case "ArrowDown":
        return this.numberPadModeEnabled ? "2" : "j";
      case "ArrowLeft":
        return this.numberPadModeEnabled ? "4" : "h";
      case "ArrowRight":
        return this.numberPadModeEnabled ? "6" : "l";
      default:
        return null;
    }
  }

  private mapNavigationKeyToDirectionKey(key: string): string | null {
    switch (key) {
      case "Home":
        return this.numberPadModeEnabled ? "7" : "y";
      case "PageUp":
        return this.numberPadModeEnabled ? "9" : "u";
      case "End":
        return this.numberPadModeEnabled ? "1" : "b";
      case "PageDown":
        return this.numberPadModeEnabled ? "3" : "n";
      default:
        return null;
    }
  }

  private mapNumpadDigitToDirectionKey(digit: string): string | null {
    if (!/^[1-9]$/.test(digit)) {
      return null;
    }
    if (this.numberPadModeEnabled) {
      return digit;
    }
    switch (digit) {
      case "1":
        return "b";
      case "2":
        return "j";
      case "3":
        return "n";
      case "4":
        return "h";
      case "5":
        return ".";
      case "6":
        return "l";
      case "7":
        return "y";
      case "8":
        return "k";
      case "9":
        return "u";
      default:
        return null;
    }
  }

  private mapDirectionalKeyFromNavigationInput(key: string): string | null {
    return (
      this.mapArrowKeyToDirectionKey(key) ||
      this.mapNavigationKeyToDirectionKey(key)
    );
  }

  private getModalNavigationDirection(
    event: KeyboardEvent,
  ): "up" | "down" | "left" | "right" | null {
    switch (event.key) {
      case "ArrowUp":
        return "up";
      case "ArrowDown":
        return "down";
      case "ArrowLeft":
        return "left";
      case "ArrowRight":
        return "right";
      case "h":
      case "H":
        return this.numberPadModeEnabled ? null : "left";
      case "l":
      case "L":
        return this.numberPadModeEnabled ? null : "right";
      case "k":
      case "K":
      case "y":
      case "Y":
      case "u":
      case "U":
        return this.numberPadModeEnabled ? null : "up";
      case "j":
      case "J":
      case "b":
      case "B":
      case "n":
      case "N":
        return this.numberPadModeEnabled ? null : "down";
      default:
        break;
    }

    if (!event.code.startsWith("Numpad")) {
      return null;
    }

    switch (event.code) {
      case "Numpad8":
      case "Numpad7":
      case "Numpad9":
        return "up";
      case "Numpad2":
      case "Numpad1":
      case "Numpad3":
        return "down";
      case "Numpad4":
        return "left";
      case "Numpad6":
        return "right";
      default:
        return null;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.isTextInputActive) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
    }

    if (this.handleMetaCommandKeyDown(event)) {
      return;
    }

    if (event.key === "Alt" || event.key === "Meta") {
      this.altOrMetaHeld = true;
      event.preventDefault();
      return;
    }

    if (event.key === "#" && this.canStartMetaCommandMode()) {
      event.preventDefault();
      this.startMetaCommandMode();
      return;
    }

    // Handle escape key to close dialogs
    if (event.key === "Escape") {
      if (this.isTextInputActive) {
        this.submitTextInput("");
        return;
      }
      if (this.isInventoryDialogVisible) {
        this.hideInventoryDialog();
        return;
      }

      if (this.isInfoDialogVisible) {
        this.hideInfoMenuDialog();
        return;
      }

      const inventoryDialog = document.getElementById("inventory-dialog");
      if (inventoryDialog && inventoryDialog.classList.contains("is-visible")) {
        this.hideInventoryDialog();
        return;
      }

      const infoDialog = document.getElementById("info-menu-dialog");
      if (infoDialog && infoDialog.classList.contains("is-visible")) {
        this.hideInfoMenuDialog();
        return;
      }

      // If we're in a prompt/position mode, send Escape to NetHack so the
      // runtime can cancel the active flow (question, direction, far-look, etc.).
      if (
        this.isInQuestion ||
        this.isInDirectionQuestion ||
        this.positionInputModeActive
      ) {
        console.log("🔄 Sending Escape to NetHack to cancel active prompt");
        this.sendInput("Escape");
      }

      // Clear UI dialogs and states
      this.hideQuestion();
      this.hideDirectionQuestion();
      const posDialog = document.getElementById("position-dialog");
      if (posDialog) {
        posDialog.classList.remove("is-visible");
      }
      if (this.uiAdapter) {
        this.uiAdapter.setPositionRequest(null);
      }
      // Clear question states when escape is pressed
      this.isInQuestion = false;
      this.isInDirectionQuestion = false;
      this.setPositionInputMode(false);
      return;
    }

    if (event.key === "Enter") {
      if (this.isInventoryDialogVisible) {
        this.hideInventoryDialog();
        return;
      }

      if (this.isInfoDialogVisible) {
        this.hideInfoMenuDialog();
        return;
      }

      const inventoryDialog = document.getElementById("inventory-dialog");
      if (inventoryDialog && inventoryDialog.classList.contains("is-visible")) {
        this.hideInventoryDialog();
        return;
      }

      const infoDialog = document.getElementById("info-menu-dialog");
      if (infoDialog && infoDialog.classList.contains("is-visible")) {
        this.hideInfoMenuDialog();
        return;
      }

      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !this.isAnyModalVisible() &&
        !this.isInQuestion &&
        !this.isInDirectionQuestion &&
        !this.positionInputModeActive &&
        !this.metaCommandModeActive
      ) {
        event.preventDefault();
        this.sendMouseInput(this.playerPos.x, this.playerPos.y, 0);
        return;
      }
    }

    if (this.isTextInputActive) {
      return;
    }

    if (this.isInfoDialogOpen()) {
      if (this.isSpaceDismissKey(event)) {
        event.preventDefault();
        this.hideInfoMenuDialog();
        return;
      }

      if (this.isMovementInput(event.key) || this.isMovementInput(event.code)) {
        event.preventDefault();
        return;
      }
    }

    const modifiedInput = this.getModifiedInput(event);
    if (modifiedInput) {
      event.preventDefault();
      this.sendInput(modifiedInput);
      return;
    }

    // Handle tile refresh shortcuts (Ctrl + key combinations)
    if (event.ctrlKey) {
      switch (event.key.toLowerCase()) {
        case "r":
          if (event.shiftKey) {
            // Ctrl+Shift+R: Refresh larger area around player
            event.preventDefault();
            console.log("🔄 Manual refresh requested for large player area");
            this.requestPlayerAreaUpdate(10);
            this.addGameMessage("Refreshing large area around player...");
            return;
          } else {
            // Ctrl+R: Refresh area around player
            event.preventDefault();
            console.log("🔄 Manual refresh requested for player area");
            this.requestPlayerAreaUpdate(5);
            this.addGameMessage("Refreshing area around player...");
            return;
          }

        case "t":
          // Ctrl+T: Refresh tile at player position
          event.preventDefault();
          console.log("🔄 Manual refresh requested for player tile");
          this.requestTileUpdate(this.playerPos.x, this.playerPos.y);
          this.addGameMessage(
            `Refreshing tile at (${this.playerPos.x}, ${this.playerPos.y})...`,
          );
          return;

        case "m":
          event.preventDefault();
          this.toggleInfoMenuDialog();
          return;
      }
    }

    // Handle inventory display only during normal gameplay.
    // Question dialogs must take precedence over global inventory hotkey behavior.
    if (
      (event.key === "i" || event.key === "I") &&
      !this.isInQuestion &&
      !this.isInDirectionQuestion
    ) {
      event.preventDefault();
      this.toggleInventoryDialogState();
      return;
    }

    // Keep gameplay movement frozen while inventory is open.
    // Close controls (Esc/Enter/i) are handled above.
    if (
      this.isInventoryDialogOpen() &&
      (this.isMovementInput(event.key) || this.isMovementInput(event.code))
    ) {
      event.preventDefault();
      return;
    }

    // Filter out modifier keys that shouldn't be sent to NetHack
    // Note: Home, End, PageUp, PageDown are NOT filtered as they can be used for diagonal movement
    const modifierKeys = [
      "Shift",
      "Control",
      "Alt",
      "Meta",
      "CapsLock",
      "NumLock",
      "ScrollLock",
      "Tab",
      "Insert",
      "Delete",
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F11",
      "F12",
    ];

    if (modifierKeys.indexOf(event.key) !== -1) {
      console.log(`🚫 Filtering out modifier key: ${event.key}`);
      return;
    }

    const normalizedWaitKey = this.normalizeWaitKey(event);
    if (
      normalizedWaitKey &&
      !this.isInQuestion &&
      !this.isInDirectionQuestion
    ) {
      event.preventDefault();
      this.sendInput(normalizedWaitKey);
      return;
    }

    // Preserve numpad intent in the runtime so movement digits are not
    // conflated with top-row numeric count prefixes.
    if (
      !this.isInQuestion &&
      !this.isInDirectionQuestion &&
      event.code.startsWith("Numpad") &&
      /^[1-9]$/.test(event.key)
    ) {
      event.preventDefault();
      if (this.numberPadModeEnabled) {
        this.sendInput(`Numpad${event.key}`);
      } else {
        const mappedKey = this.mapNumpadDigitToDirectionKey(event.key);
        if (mappedKey) {
          this.sendInput(mappedKey);
        }
      }
      return;
    }

    // Handle diagonal movement keys during regular gameplay
    // Map navigation keys to direction equivalents for NetHack
    if (!this.isInQuestion && !this.isInDirectionQuestion) {
      const mappedKey = this.mapDirectionalKeyFromNavigationInput(event.key);
      if (mappedKey) {
        this.sendInput(mappedKey);
        return;
      }
    }

    // If we're in any question, handle input specially and don't allow normal movement
    if (this.isInQuestion || this.isInDirectionQuestion) {
      // If it's a direction question, handle direction input
      if (this.isInDirectionQuestion) {
        // With number_pad:1 option, we can pass numpad keys and arrow keys directly
        let keyToSend = null;

        const mappedNav = this.mapDirectionalKeyFromNavigationInput(event.key);
        if (mappedNav) {
          keyToSend = mappedNav;
        }

        if (
          !keyToSend &&
          event.code.startsWith("Numpad") &&
          /^[1-9]$/.test(event.key)
        ) {
          keyToSend = this.mapNumpadDigitToDirectionKey(event.key);
        }

        if (!keyToSend) {
          if (this.numberPadModeEnabled && /^[1-9]$/.test(event.key)) {
            keyToSend = event.key;
          } else if (!this.numberPadModeEnabled) {
            const lowerKey = event.key.toLowerCase();
            if ("hjklyubn".includes(lowerKey)) {
              keyToSend = lowerKey;
            }
          }
        }

        if (!keyToSend) {
          switch (event.key) {
            case "<":
            case ",":
              keyToSend = "<";
              break;
            case ">":
              keyToSend = ">";
              break;
            case "s":
            case "S":
              keyToSend = "s";
              break;
            case " ":
            case "Spacebar":
            case "Space":
            case ".":
            case "Decimal":
            case "NumpadDecimal":
              keyToSend = ".";
              break;
          }
        }

        if (keyToSend) {
          this.sendInput(keyToSend);
          this.hideDirectionQuestion();
        }
        return; // Don't send other keys when in direction question mode
      }

      const isPickupDialog = this.uiAdapter
        ? this.activeQuestionIsPickupDialog
        : Boolean(
            (document.getElementById("question-dialog") as any)?.isPickupDialog,
          );
      const isMenuQuestion = this.activeQuestionMenuItems.length > 0;
      const modalDirection = this.getModalNavigationDirection(event);

      if (isMenuQuestion && this.activeQuestionMenuPageCount > 1) {
        if (event.key === "<") {
          event.preventDefault();
          this.goToPreviousQuestionMenuPage();
          return;
        }
        if (event.key === ">") {
          event.preventDefault();
          this.goToNextQuestionMenuPage();
          return;
        }
      }

      // For other questions, handle pickup dialogs specially
      if (isPickupDialog) {
        if (modalDirection) {
          event.preventDefault();
          const isActionFocused = this.isQuestionActionFocused();
          let effectiveDirection = modalDirection;
          if (!isActionFocused) {
            if (modalDirection === "left") {
              effectiveDirection = "up";
            } else if (modalDirection === "right") {
              effectiveDirection = "down";
            }
          }
          const selectableItems = this.getVisiblePickupSelectableMenuItems();
          if (isActionFocused) {
            if (effectiveDirection === "up") {
              this.clearQuestionActionFocus();
              if (selectableItems.length > 0) {
                this.activePickupFocusIndex = selectableItems.length - 1;
              }
              this.updatePickupFocusVisualState();
              return;
            }
            if (effectiveDirection === "left") {
              if (this.activeQuestionActionFocusIndex <= 0) {
                this.clearQuestionActionFocus();
                if (selectableItems.length > 0) {
                  this.activePickupFocusIndex = selectableItems.length - 1;
                }
                this.updatePickupFocusVisualState();
                return;
              }
              this.moveQuestionActionFocus(-1);
              return;
            }
            if (
              effectiveDirection === "right" ||
              effectiveDirection === "down"
            ) {
              this.moveQuestionActionFocus(1);
              return;
            }
          } else {
            if (effectiveDirection === "down") {
              this.normalizeActivePickupFocusIndex();
              const atBottom =
                selectableItems.length > 0 &&
                this.activePickupFocusIndex >= selectableItems.length - 1;
              if (atBottom && this.focusQuestionActionsStart()) {
                return;
              }
              this.movePickupFocus(1);
              return;
            }
            if (effectiveDirection === "up" || effectiveDirection === "left") {
              this.movePickupFocus(-1);
              return;
            }
            if (effectiveDirection === "right") {
              this.movePickupFocus(1);
              return;
            }
          }
          return;
        }

        if (
          event.key === " " ||
          event.key === "Space" ||
          event.key === "Spacebar"
        ) {
          event.preventDefault();
          if (this.activateFocusedQuestionAction()) {
            return;
          }
          this.toggleActivePickupFocusSelection();
          return;
        }

        // This is a pickup dialog - handle multi-selection
        if (event.key === "Enter") {
          event.preventDefault();
          if (this.activateFocusedQuestionAction()) {
            return;
          }
          this.confirmPickupChoices();
          return;
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.cancelActivePrompt();
          return;
        } else {
          const resolvedSelectionInput = isMenuQuestion
            ? this.resolveQuestionSelectionInputForKeyPress(event.key)
            : this.resolveQuestionSelectionInput(event.key);
          const matchingItem = resolvedSelectionInput
            ? this.findActiveMenuItemBySelectionInput(resolvedSelectionInput)
            : null;

          if (matchingItem && resolvedSelectionInput) {
            event.preventDefault();
            if (this.uiAdapter) {
              this.togglePickupChoice(resolvedSelectionInput);
            } else {
              const questionDialog = document.getElementById("question-dialog");
              if (questionDialog) {
                const containers =
                  questionDialog.querySelectorAll(".nh3d-pickup-item");
                containers.forEach((container: Element) => {
                  if (
                    (container as any).selectionInput ===
                      resolvedSelectionInput &&
                    (container as any).toggleItem
                  ) {
                    (container as any).toggleItem();
                  }
                });
              }
            }
          } else if (!isMenuQuestion) {
            // Send the key anyway in case it's a valid NetHack command
            this.updateNumberPadModeFromChoice(event.key);
            this.sendInput(event.key);
          }
        }
      } else {
        if (isMenuQuestion) {
          if (modalDirection) {
            event.preventDefault();
            const isActionFocused = this.isQuestionActionFocused();
            let effectiveDirection = modalDirection;
            if (!isActionFocused) {
              if (modalDirection === "left") {
                effectiveDirection = "up";
              } else if (modalDirection === "right") {
                effectiveDirection = "down";
              }
            }
            const selectableItems = this.getVisiblePickupSelectableMenuItems();
            if (isActionFocused) {
              if (effectiveDirection === "up") {
                this.clearQuestionActionFocus();
                if (selectableItems.length > 0) {
                  this.activeQuestionMenuFocusIndex =
                    selectableItems.length - 1;
                }
                this.updateQuestionMenuFocusVisualState();
                return;
              }
              if (effectiveDirection === "left") {
                if (this.activeQuestionActionFocusIndex <= 0) {
                  this.clearQuestionActionFocus();
                  if (selectableItems.length > 0) {
                    this.activeQuestionMenuFocusIndex =
                      selectableItems.length - 1;
                  }
                  this.updateQuestionMenuFocusVisualState();
                  return;
                }
                this.moveQuestionActionFocus(-1);
                return;
              }
              if (effectiveDirection === "left") {
                this.moveQuestionActionFocus(-1);
                return;
              }
              if (
                effectiveDirection === "right" ||
                effectiveDirection === "down"
              ) {
                this.moveQuestionActionFocus(1);
                return;
              }
            } else {
              if (effectiveDirection === "down") {
                this.normalizeActiveQuestionMenuFocusIndex();
                const atBottom =
                  selectableItems.length > 0 &&
                  this.activeQuestionMenuFocusIndex >=
                    selectableItems.length - 1;
                if (atBottom && this.focusQuestionActionsStart()) {
                  return;
                }
                this.moveQuestionMenuFocus(1);
                return;
              }
              if (
                effectiveDirection === "up" ||
                effectiveDirection === "left"
              ) {
                this.moveQuestionMenuFocus(-1);
                return;
              }
              if (effectiveDirection === "right") {
                this.moveQuestionMenuFocus(1);
                return;
              }
            }
          }

          if (
            event.key === " " ||
            event.key === "Space" ||
            event.key === "Spacebar" ||
            event.key === "Enter"
          ) {
            event.preventDefault();
            if (this.activateFocusedQuestionAction()) {
              return;
            }
            this.confirmQuestionMenuChoice();
            return;
          }
        }

        // Standard single-selection dialog - send key and close
        const resolvedSelectionInput = isMenuQuestion
          ? this.resolveQuestionSelectionInputForKeyPress(event.key)
          : this.resolveQuestionSelectionInput(event.key);
        const selectedItem = resolvedSelectionInput
          ? this.findActiveMenuItemBySelectionInput(resolvedSelectionInput)
          : null;
        if (selectedItem && resolvedSelectionInput) {
          event.preventDefault();
          const selectionInput =
            this.getQuestionMenuSelectionInput(selectedItem);
          this.setActiveQuestionMenuFocusBySelectionInput(selectionInput);
          this.sendInput(selectionInput);
          this.hideQuestion();
        } else if (!isMenuQuestion) {
          this.updateNumberPadModeFromChoice(event.key);
          this.sendInput(event.key);
          this.hideQuestion();
        } else {
          return;
        }
      }
      return; // Don't allow normal movement during questions
    }

    // Send input to local runtime for normal gameplay
    this.sendInput(event.key);
  }

  private updateCamera(deltaSeconds: number): void {
    const { x, y } = this.playerPos;
    const targetX = x * TILE_SIZE + this.cameraPanX;
    const targetY = -y * TILE_SIZE + this.cameraPanY;
    this.cameraFollowTarget.set(targetX, targetY, 0);

    if (!this.cameraFollowInitialized) {
      this.cameraFollowCurrent.copy(this.cameraFollowTarget);
      this.cameraFollowInitialized = true;
    } else {
      // Exponential smoothing for camera follow: immediate movement with natural fade-out.
      const alpha =
        1 -
        Math.exp(
          (-Math.LN2 * deltaSeconds * 1000) / this.cameraFollowHalfLifeMs,
        );
      this.cameraFollowCurrent.lerp(this.cameraFollowTarget, alpha);
    }

    const followX = this.cameraFollowCurrent.x;
    const followY = this.cameraFollowCurrent.y;

    // Use spherical coordinates for camera positioning
    const cosPitch = Math.cos(this.cameraPitch);
    const sinPitch = Math.sin(this.cameraPitch);
    const sinYaw = Math.sin(this.cameraYaw);
    const cosYaw = Math.cos(this.cameraYaw);

    const offsetX = this.cameraDistance * cosPitch * sinYaw;
    const offsetY = this.cameraDistance * cosPitch * cosYaw;
    const offsetZ = this.cameraDistance * sinPitch;

    // Position camera relative to player (with panning offset)
    this.camera.position.x = followX + offsetX;
    this.camera.position.y = followY + offsetY;
    this.camera.position.z = offsetZ;

    // Always look at the target position (player + pan offset)
    this.camera.lookAt(followX, followY, 0);
  }

  private wrapAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    angle = ((angle % twoPi) + twoPi) % twoPi;
    return angle > Math.PI ? angle - twoPi : angle;
  }

  private isAnyModalVisible(): boolean {
    if (this.metaCommandModal?.classList.contains("is-visible")) {
      return true;
    }

    if (document.querySelector(".nh3d-dialog.is-visible")) {
      return true;
    }
    if (document.querySelector(".nh3d-mobile-actions-sheet")) {
      return true;
    }
    const mobileLog = document.querySelector(".nh3d-mobile-log");
    if (mobileLog && !mobileLog.classList.contains("nh3d-mobile-log-hidden")) {
      return true;
    }
    const positionDialog = document.getElementById("position-dialog");
    if (positionDialog?.classList.contains("is-visible")) {
      return true;
    }
    return false;
  }

  private handleMouseWheel(event: WheelEvent): void {
    // Disable camera zoom while any modal/dialog is visible.
    if (this.isAnyModalVisible()) {
      return;
    }

    // Check if the mouse is over the game log element
    const gameLog = document.getElementById("game-log");
    if (gameLog) {
      const rect = gameLog.getBoundingClientRect();
      const mouseX = event.clientX;
      const mouseY = event.clientY;

      // If mouse is over the game log, allow normal scrolling and don't zoom camera
      if (
        mouseX >= rect.left &&
        mouseX <= rect.right &&
        mouseY >= rect.top &&
        mouseY <= rect.bottom
      ) {
        // Don't prevent default - allow the log to scroll naturally
        return;
      }
    }

    // If not over game log, handle camera zooming
    event.preventDefault();
    const zoomSpeed = 1.0;
    const delta = event.deltaY > 0 ? zoomSpeed : -zoomSpeed;
    this.cameraDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.cameraDistance + delta),
    );
  }

  private canUseMapMouseInput(event: MouseEvent): boolean {
    if (!this.session) {
      return false;
    }
    if (event.button !== 0 && event.button !== 2) {
      return false;
    }
    if (event.target !== this.renderer.domElement) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (this.isAnyModalVisible()) {
      return false;
    }
    if (this.isInQuestion || this.isInDirectionQuestion) {
      return false;
    }
    if (this.metaCommandModeActive) {
      return false;
    }
    return true;
  }

  private isTouchEventOnGameCanvas(event: TouchEvent): boolean {
    if (event.target === this.renderer.domElement) {
      return true;
    }
    if (typeof event.composedPath === "function") {
      return event.composedPath().includes(this.renderer.domElement);
    }
    return false;
  }

  private canUseMapTouchInput(event: TouchEvent): boolean {
    if (!this.session) {
      return false;
    }
    if (!this.isTouchEventOnGameCanvas(event)) {
      return false;
    }
    if (this.isAnyModalVisible()) {
      return false;
    }
    if (this.isInQuestion || this.isInDirectionQuestion) {
      return false;
    }
    if (this.metaCommandModeActive || this.positionInputModeActive) {
      return false;
    }
    return true;
  }

  private resolveDirectionKeyFromDelta(
    dx: number,
    dy: number,
    deadzone: number,
  ): string | null {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < deadzone && absY < deadzone) {
      return null;
    }

    const axisBiasRatio = 0.55;
    if (absX <= absY * axisBiasRatio) {
      if (dy < 0) {
        return this.numberPadModeEnabled ? "8" : "k";
      }
      return this.numberPadModeEnabled ? "2" : "j";
    }
    if (absY <= absX * axisBiasRatio) {
      if (dx < 0) {
        return this.numberPadModeEnabled ? "4" : "h";
      }
      return this.numberPadModeEnabled ? "6" : "l";
    }

    if (dx < 0 && dy < 0) {
      return this.numberPadModeEnabled ? "7" : "y";
    }
    if (dx > 0 && dy < 0) {
      return this.numberPadModeEnabled ? "9" : "u";
    }
    if (dx < 0 && dy > 0) {
      return this.numberPadModeEnabled ? "1" : "b";
    }
    return this.numberPadModeEnabled ? "3" : "n";
  }

  private resolveSwipeDirectionInput(dx: number, dy: number): string | null {
    return this.resolveDirectionKeyFromDelta(dx, dy, 1);
  }

  private resolveDirectionFromDelta(dx: number, dy: number): string | null {
    return this.resolveDirectionKeyFromDelta(dx, dy, 0.25);
  }

  private getTilePositionFromClientCoordinates(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const tiles = Array.from(this.tileMap.values());
    if (tiles.length === 0) {
      return null;
    }

    const intersections = raycaster.intersectObjects(tiles, false);
    if (intersections.length === 0) {
      return null;
    }

    const hit = intersections[0].object;
    if (!(hit instanceof THREE.Mesh)) {
      return null;
    }

    const x = Math.round(hit.position.x / TILE_SIZE);
    const y = Math.round(-hit.position.y / TILE_SIZE);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  private getGridPositionFromClientCoordinates(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(this.groundPlane, intersection);
    if (!hit) {
      return null;
    }

    return {
      x: intersection.x / TILE_SIZE,
      y: -intersection.y / TILE_SIZE,
    };
  }

  private getClickedTilePosition(
    event: MouseEvent,
  ): { x: number; y: number } | null {
    return this.getTilePositionFromClientCoordinates(
      event.clientX,
      event.clientY,
    );
  }

  private handleMapMouseInput(event: MouseEvent): boolean {
    if (!this.canUseMapMouseInput(event)) {
      return false;
    }

    const target = this.getClickedTilePosition(event);
    if (!target && event.button === 0) {
      const gridTarget = this.getGridPositionFromClientCoordinates(
        event.clientX,
        event.clientY,
      );
      if (gridTarget) {
        const dx = gridTarget.x - this.playerPos.x;
        const dy = gridTarget.y - this.playerPos.y;
        const direction = this.resolveDirectionFromDelta(dx, dy);
        if (direction) {
          this.sendInputSequence(["5", direction]);
          return true;
        }
      }
      return false;
    }
    if (!target) {
      return false;
    }

    if (event.button === 0 && !this.hasPlayerMovedOnce) {
      this.lastMovementInputAtMs = Date.now();
    }

    if (event.button === 0) {
      const targetMesh = this.tileMap.get(`${target.x},${target.y}`);
      if (targetMesh?.userData?.isUndiscovered) {
        const dx = target.x - this.playerPos.x;
        const dy = target.y - this.playerPos.y;
        const direction = this.resolveDirectionFromDelta(dx, dy);
        if (direction) {
          this.sendInputSequence(["5", direction]);
          return true;
        }
      }
    }

    this.sendMouseInput(target.x, target.y, event.button);
    return true;
  }

  private handleMouseDown(event: MouseEvent): void {
    if (this.handleMapMouseInput(event)) {
      event.preventDefault();
      return;
    }

    if (event.button === 1) {
      // Middle mouse button - rotation
      event.preventDefault();
      this.isMiddleMouseDown = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else if (event.button === 2) {
      // Right mouse button - panning
      event.preventDefault();
      this.isRightMouseDown = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }

  private handleTouchStart(event: TouchEvent): void {
    if (!this.canUseMapTouchInput(event)) {
      this.touchSwipeStart = null;
      return;
    }
    if (event.touches.length !== 1) {
      this.touchSwipeStart = null;
      return;
    }

    const touch = event.touches[0];
    this.touchSwipeStart = {
      x: touch.clientX,
      y: touch.clientY,
      startedAtMs: Date.now(),
    };
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this.touchSwipeStart || !this.canUseMapTouchInput(event)) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  private handleTouchEnd(event: TouchEvent): void {
    const start = this.touchSwipeStart;
    this.touchSwipeStart = null;
    if (!start || !this.canUseMapTouchInput(event)) {
      return;
    }
    if (!event.changedTouches || event.changedTouches.length === 0) {
      return;
    }

    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const distance = Math.hypot(dx, dy);
    const durationMs = Date.now() - start.startedAtMs;
    if (
      distance < this.touchSwipeMinDistancePx ||
      durationMs > this.touchSwipeMaxDurationMs
    ) {
      const target = this.getTilePositionFromClientCoordinates(
        touch.clientX,
        touch.clientY,
      );
      if (!target) {
        const gridTarget = this.getGridPositionFromClientCoordinates(
          touch.clientX,
          touch.clientY,
        );
        if (!gridTarget) {
          return;
        }
        const dx = gridTarget.x - this.playerPos.x;
        const dy = gridTarget.y - this.playerPos.y;
        const direction = this.resolveDirectionFromDelta(dx, dy);
        if (direction) {
          if (event.cancelable) {
            event.preventDefault();
          }
          this.sendInputSequence(["5", direction]);
        }
        return;
      }
      if (!this.hasPlayerMovedOnce) {
        this.lastMovementInputAtMs = Date.now();
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const targetMesh = this.tileMap.get(`${target.x},${target.y}`);
      if (targetMesh?.userData?.isUndiscovered) {
        const dx = target.x - this.playerPos.x;
        const dy = target.y - this.playerPos.y;
        const direction = this.resolveDirectionFromDelta(dx, dy);
        if (direction) {
          this.sendInputSequence(["5", direction]);
          return;
        }
      }

      this.sendMouseInput(target.x, target.y, 0);
      return;
    }

    const swipeInput = this.resolveSwipeDirectionInput(dx, dy);
    if (!swipeInput) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    this.sendInput(swipeInput);
  }

  private handleTouchCancel(): void {
    this.touchSwipeStart = null;
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.isMiddleMouseDown) {
      // Middle mouse - rotate camera
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;

      this.cameraYaw = this.wrapAngle(
        this.cameraYaw - deltaX * this.rotationSpeed,
      );
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch - deltaY * this.rotationSpeed,
        this.minCameraPitch,
        this.maxCameraPitch,
      );

      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else if (this.isRightMouseDown) {
      // Right mouse - pan camera
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;

      const panSpeed = 0.05;
      this.cameraPanX += deltaX * panSpeed;
      this.cameraPanY -= deltaY * panSpeed; // Invert Y for intuitive panning

      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 1) {
      // Middle mouse button
      this.isMiddleMouseDown = false;
    } else if (event.button === 2) {
      // Right mouse button
      this.isRightMouseDown = false;
    }
  }

  private updateRendererResolution(): void {
    const pixelRatio = THREE.MathUtils.clamp(
      window.devicePixelRatio || 1,
      1,
      this.maxRendererPixelRatio,
    );
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.updateRendererResolution();
  }

  private getMeshOverlayMaterial(
    mesh: THREE.Mesh,
  ): THREE.MeshBasicMaterial | null {
    const material = mesh.material;
    if (Array.isArray(material)) {
      const top = material[4];
      return top instanceof THREE.MeshBasicMaterial ? top : null;
    }
    return material instanceof THREE.MeshBasicMaterial ? material : null;
  }

  private updateEffectAnimations(timeMs: number): void {
    const phaseBase = timeMs / 240;
    this.tileMap.forEach((mesh) => {
      const effectKind = mesh.userData.effectKind as
        | TileEffectKind
        | null
        | undefined;
      const overlayMaterial = this.getMeshOverlayMaterial(mesh);
      if (!overlayMaterial) {
        return;
      }

      if (!effectKind) {
        overlayMaterial.color.set("#ffffff");
        return;
      }

      const wave =
        0.72 +
        0.28 *
          Math.sin(phaseBase + mesh.position.x * 0.2 + mesh.position.y * 0.2);
      const pulse = this.effectColors[effectKind]
        .clone()
        .multiplyScalar(THREE.MathUtils.clamp(wave, 0.4, 1.2));
      overlayMaterial.color.copy(pulse);
    });
  }

  private animate(timeMs: number = performance.now()): void {
    requestAnimationFrame(this.animate.bind(this));
    const rawDeltaMs =
      this.lastFrameTimeMs === null ? 1000 / 60 : timeMs - this.lastFrameTimeMs;
    this.lastFrameTimeMs = timeMs;
    const deltaSeconds = Math.max(0, Math.min(rawDeltaMs, 250)) / 1000;

    this.updateCamera(deltaSeconds);
    this.updateMetaCommandModalPosition();
    this.updateLightingOverlay();
    this.updateTileRevealFades(deltaSeconds);
    this.updateEffectAnimations(timeMs);
    this.updateDamageEffects(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  }
}

export default Nethack3DEngine;
