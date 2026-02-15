/*
 * Main entry point for the NetHack 3D client.
 * This module runs NetHack WASM locally in-browser and renders the game in 3D using Three.js.
 */

import * as THREE from "three";
import { WorkerRuntimeBridge } from "../runtime";
import type { RuntimeBridge, RuntimeEvent } from "../runtime";
import {
  isLoggingEnabled,
  logWithOriginal,
  setLoggingEnabled,
  toggleLoggingEnabled,
} from "../logging";
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
  FpsContextAction,
  FpsCrosshairContextState,
  Nh3dClientOptions,
  Nethack3DEngineController,
  Nethack3DEngineOptions,
  Nethack3DEngineUIAdapter,
  NethackConnectionState,
  PlayMode,
  PlayerStatsSnapshot,
  QuestionDialogState,
} from "./ui-types";
import { normalizeNh3dClientOptions } from "./ui-types";

type LightingGrid = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  knownMask: Uint8Array;
  wallMask: Uint8Array;
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
  fpsFloating: boolean;
  fpsLateralOffset: number;
  fpsBaseHeightOffset: number;
};

type CharacterCreationQuestionPayload = {
  text: string;
  choices: string;
  defaultChoice: string;
  menuItems: any[];
};

const MINIMAP_WIDTH_TILES = 79;
const MINIMAP_HEIGHT_TILES = 21;

type MinimapViewportRect = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

type AimDirection = {
  dx: number;
  dy: number;
  input: string;
};

type FpsCrosshairTargetHint =
  | "monster"
  | "loot"
  | "door"
  | "stairs_up"
  | "stairs_down"
  | "wall"
  | "water"
  | "trap"
  | "feature"
  | "floor"
  | "unknown";

type FpsCrosshairGlanceCacheEntry = {
  hint: FpsCrosshairTargetHint;
  sourceText: string;
  updatedAtMs: number;
};

type FpsCrosshairGlancePending = {
  requestId: number;
  tileKey: string;
  tileX: number;
  tileY: number;
  startedAtMs: number;
  sawPositionInput: boolean;
  positionResolvedAtMs: number | null;
};

type FpsTouchGestureState = {
  touchId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAtMs: number;
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
  private readonly inventoryContextSelectionPrefix = "__INVCTX_SELECT__:";
  private isTextInputActive: boolean = false;
  private characterCreationConfig: CharacterCreationConfig = {
    mode: "create",
    playMode: "normal",
  };
  private clientOptions: Nh3dClientOptions = normalizeNh3dClientOptions();
  private playMode: PlayMode = "normal";
  private characterCreationMode: "random" | "create" = "create";
  private readonly questionMenuPageAccelerators: string[] =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  private altOrMetaHeld: boolean = false;
  private metaCommandModeActive: boolean = false;
  private metaCommandBuffer: string = "";
  private metaCommandModal: HTMLDivElement | null = null;
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly pointerRaycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly pointerIntersection = new THREE.Vector3();
  private readonly tileVisualScaleFps = 1;
  private readonly fpsCameraFov = 62;
  private readonly firstPersonEyeHeight = WALL_HEIGHT * 0.62;
  private readonly firstPersonPitchMin = -1.18;
  private readonly firstPersonPitchMax = 1.18;
  private readonly firstPersonMouseSensitivity = 0.0026;
  private fpsPointerLockActive: boolean = false;
  private fpsPointerLockRestorePending: boolean = false;
  private fpsCurrentAimDirection: AimDirection | null = null;
  private fpsForwardHighlight: THREE.Mesh | null = null;
  private fpsForwardHighlightMaterial: THREE.MeshBasicMaterial | null = null;
  private fpsForwardHighlightTexture: THREE.CanvasTexture | null = null;
  private fpsAimLinePulseUntilMs: number = 0;
  private fpsFireSuppressionUntilMs: number = 0;
  private readonly fpsFireSuppressionDurationMs: number = 1500;
  private fpsCrosshairContextMenuOpen: boolean = false;
  private fpsCrosshairContextSignature: string = "";
  private fpsCrosshairGlanceCache: Map<string, FpsCrosshairGlanceCacheEntry> =
    new Map();
  private fpsCrosshairGlancePending: FpsCrosshairGlancePending | null = null;
  private fpsCrosshairGlanceRequestSequence: number = 0;
  private readonly fpsCrosshairGlanceCacheTtlMs: number = 4500;
  private readonly fpsCrosshairGlanceTimeoutMs: number = 2600;
  private readonly fpsCrosshairGlancePostResolveGraceMs: number = 420;
  private fpsWallChamferGeometryCache: Map<number, THREE.ExtrudeGeometry> =
    new Map();
  private fpsWallChamferFloorGeometryCache: Map<number, THREE.ShapeGeometry> =
    new Map();
  private fpsWallChamferFloorMeshes: Map<string, THREE.Mesh> = new Map();
  private fpsWallChamferFaceMaterialCache: Map<
    TileMaterialKind,
    THREE.MeshBasicMaterial
  > = new Map();
  private fpsWallChamferFloorMaterialCache: Map<
    TileMaterialKind,
    { material: THREE.MeshBasicMaterial; texture: THREE.CanvasTexture }
  > = new Map();
  private readonly fpsWallChamferInset = TILE_SIZE * 0.25;
  private readonly fpsWallChamferFloorZ = 0.001;
  private readonly elevatedMonsterZ = WALL_HEIGHT * 0.58;
  private readonly elevatedLootZ = WALL_HEIGHT * 0.42;
  private entityBlobShadows: Map<string, THREE.Mesh> = new Map();
  private entityBlobShadowTexture: THREE.CanvasTexture | null = null;
  private monsterBillboards: Map<string, THREE.Sprite> = new Map();
  private monsterBillboardTextures: Map<
    string,
    { texture: THREE.CanvasTexture; refCount: number }
  > = new Map();
  private fpsStepCameraActive: boolean = false;
  private fpsStepCameraStartMs: number = 0;
  private readonly fpsStepCameraBaseDurationMs: number = 92;
  private fpsStepCameraDurationMs: number = this.fpsStepCameraBaseDurationMs;
  private readonly fpsAutoMoveDetectionWindowMs: number = 120;
  private lastManualDirectionalInputAtMs: number = 0;
  private fpsAutoMoveDirection: { dx: number; dy: number } | null = null;
  private fpsAutoTurnTargetYaw: number | null = null;
  private readonly fpsAutoTurnSpeedRadPerSec: number = 8.8;
  private fpsStepCameraFrom = new THREE.Vector3();
  private fpsStepCameraTo = new THREE.Vector3();

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
  private fpsTouchMoveGesture: FpsTouchGestureState | null = null;
  private fpsTouchLookGesture: FpsTouchGestureState | null = null;
  private readonly fpsTouchLookSensitivity: number = 0.0038;
  private readonly fpsTouchLookMoveThresholdPx: number = 8;
  private readonly fpsTouchTapMaxDurationMs: number = 280;
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
  private cameraPanTargetX: number = 0;
  private cameraPanTargetY: number = 0;
  private isCameraCenteredOnPlayer: boolean = true;
  private readonly cameraPanHalfLifeMs: number = 135;
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
  private readonly playerDamageNumberForwardOffset: number = TILE_SIZE * 0.42;
  private readonly playerDamageNumberFpsLateralSpread: number = TILE_SIZE * 0.14;
  private readonly playerDamageNumberFpsRiseDistance: number = 0.34;
  private readonly playerDamageNumberFpsScaleFactor: number = 0.33;
  private readonly playerDamageNumberForwardLift: number = 0.07;
  private readonly playerDamageNumberForwardDirection = new THREE.Vector3();
  private readonly playerDamageNumberRightDirection = new THREE.Vector3();
  private readonly damageParticleFloorZ: number = 0.02;
  private readonly damageParticleWallBounce: number = 0.24;
  private minimapContainer: HTMLDivElement | null = null;
  private minimapCanvasContext: CanvasRenderingContext2D | null = null;
  private minimapViewportContext: CanvasRenderingContext2D | null = null;
  private minimapCells: Uint8Array = new Uint8Array(
    MINIMAP_WIDTH_TILES * MINIMAP_HEIGHT_TILES,
  );
  private pendingMinimapCellUpdates: Map<number, number> = new Map();
  private minimapFlushScheduled: boolean = false;
  private minimapViewportRect: MinimapViewportRect | null = null;
  private minimapDragPointerId: number | null = null;
  private readonly minimapPalette: string[] = [
    "rgba(10, 16, 28, 0.82)",
    "rgba(20, 29, 46, 0.9)",
    "#3f4b5d",
    "#687384",
    "#7d614a",
    "#2b78ab",
    "#8f76c7",
    "#886137",
    "#b59037",
    "#954647",
    "#4f9a6f",
    "#5d89ba",
    "#4df79e",
  ];

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
  private readonly effectPulseColor = new THREE.Color(0xffffff);
  private readonly activeEffectTileKeys: Set<string> = new Set();
  private readonly animateFrameCallback = (timeMs: number): void => {
    this.animate(timeMs);
  };
  private lightingOverlayMesh: THREE.Mesh | null = null;
  private lightingOverlayTexture: THREE.CanvasTexture | null = null;
  private lightingOverlayCanvas: HTMLCanvasElement | null = null;
  private lightingOverlayContext: CanvasRenderingContext2D | null = null;
  private lightingWallOverlayMesh: THREE.Mesh | null = null;
  private lightingWallOverlayTexture: THREE.CanvasTexture | null = null;
  private lightingWallOverlayCanvas: HTMLCanvasElement | null = null;
  private lightingWallOverlayContext: CanvasRenderingContext2D | null = null;
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
  private readonly lightingFloorOverlayZ: number = 0.03;
  private readonly lightingWallOverlayZ: number = WALL_HEIGHT + 0;
  private readonly lightingCenterHalfLifeMs: number = 95;
  private readonly lightingCenterEpsilonTiles: number = 0.001;
  private lightingCenterCurrent = new THREE.Vector2();
  private lightingCenterTarget = new THREE.Vector2();
  private lightingCenterInitialized: boolean = false;
  private ambientLight: THREE.AmbientLight | null = null;
  private directionalLight: THREE.DirectionalLight | null = null;
  private fpsPlayerLight: THREE.PointLight | null = null;

  private isPersistentTerrainKind(kind: string): boolean {
    switch (kind) {
      case "cmap":
      case "obj":
      case "body":
      case "statue":
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

  private buildLightingGrid(): LightingGrid | null {
    if (this.tileMap.size === 0) {
      return null;
    }

    const minX = 0;
    const minY = 0;
    const width = MINIMAP_WIDTH_TILES;
    const height = MINIMAP_HEIGHT_TILES;
    const maxX = minX + width - 1;
    const maxY = minY + height - 1;
    const knownMask = new Uint8Array(width * height);
    const wallMask = new Uint8Array(width * height);

    for (const mesh of this.tileMap.values()) {
      const tileX = Number(mesh.userData?.tileX);
      const tileY = Number(mesh.userData?.tileY);
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        continue;
      }

      const cellX = tileX - minX;
      const cellY = tileY - minY;
      if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) {
        continue;
      }
      const cellIndex = cellY * width + cellX;
      knownMask[cellIndex] = 1;
      if (mesh.userData?.isWall) {
        wallMask[cellIndex] = 1;
      }
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      knownMask,
      wallMask,
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

  private updateLightingCenter(deltaSeconds: number): void {
    if (this.isFpsMode()) {
      return;
    }

    this.lightingCenterTarget.set(this.playerPos.x, this.playerPos.y);
    if (!this.lightingCenterInitialized) {
      this.lightingCenterCurrent.copy(this.lightingCenterTarget);
      this.lightingCenterInitialized = true;
      return;
    }

    const deltaMs = Math.max(0, deltaSeconds * 1000);
    if (deltaMs <= 0) {
      return;
    }
    const lerpAlpha =
      1 - Math.exp((-Math.LN2 * deltaMs) / this.lightingCenterHalfLifeMs);
    this.lightingCenterCurrent.lerp(this.lightingCenterTarget, lerpAlpha);

    if (
      this.lightingCenterCurrent.distanceToSquared(this.lightingCenterTarget) >
      this.lightingCenterEpsilonTiles * this.lightingCenterEpsilonTiles
    ) {
      this.markLightingDirty();
    } else {
      this.lightingCenterCurrent.copy(this.lightingCenterTarget);
    }
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
    if (this.lightingWallOverlayMesh) {
      this.scene.remove(this.lightingWallOverlayMesh);
      this.lightingWallOverlayMesh.geometry.dispose();
      const material = this.lightingWallOverlayMesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
      this.lightingWallOverlayMesh = null;
    }

    if (this.lightingOverlayTexture) {
      this.lightingOverlayTexture.dispose();
      this.lightingOverlayTexture = null;
    }
    if (this.lightingWallOverlayTexture) {
      this.lightingWallOverlayTexture.dispose();
      this.lightingWallOverlayTexture = null;
    }

    this.lightingOverlayCanvas = null;
    this.lightingOverlayContext = null;
    this.lightingWallOverlayCanvas = null;
    this.lightingWallOverlayContext = null;
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
      !this.lightingWallOverlayMesh ||
      !this.lightingWallOverlayTexture ||
      !this.lightingWallOverlayCanvas ||
      !this.lightingWallOverlayContext ||
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
      const wallCanvas = document.createElement("canvas");
      wallCanvas.width = widthPixels;
      wallCanvas.height = heightPixels;
      const wallContext = wallCanvas.getContext("2d");
      if (!wallContext) {
        return false;
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.generateMipmaps = false;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      const wallTexture = new THREE.CanvasTexture(wallCanvas);
      wallTexture.generateMipmaps = false;
      wallTexture.magFilter = THREE.NearestFilter;
      wallTexture.minFilter = THREE.NearestFilter;
      wallTexture.wrapS = THREE.ClampToEdgeWrapping;
      wallTexture.wrapT = THREE.ClampToEdgeWrapping;
      wallTexture.needsUpdate = true;

      const geometry = new THREE.PlaneGeometry(
        grid.width * TILE_SIZE,
        grid.height * TILE_SIZE,
      );
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        ((grid.minX + grid.maxX) * TILE_SIZE) / 2,
        ((-grid.minY - grid.maxY) * TILE_SIZE) / 2,
        this.lightingFloorOverlayZ,
      );
      mesh.renderOrder = 850;
      const wallMaterial = new THREE.MeshBasicMaterial({
        map: wallTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const wallMesh = new THREE.Mesh(geometry.clone(), wallMaterial);
      wallMesh.position.set(
        ((grid.minX + grid.maxX) * TILE_SIZE) / 2,
        ((-grid.minY - grid.maxY) * TILE_SIZE) / 2,
        this.lightingWallOverlayZ,
      );
      wallMesh.renderOrder = 900;
      this.scene.add(mesh);
      this.scene.add(wallMesh);

      this.lightingOverlayMesh = mesh;
      this.lightingOverlayTexture = texture;
      this.lightingOverlayCanvas = canvas;
      this.lightingOverlayContext = context;
      this.lightingWallOverlayMesh = wallMesh;
      this.lightingWallOverlayTexture = wallTexture;
      this.lightingWallOverlayCanvas = wallCanvas;
      this.lightingWallOverlayContext = wallContext;
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
      this.lightingOverlayContext &&
      this.lightingWallOverlayTexture &&
      this.lightingWallOverlayCanvas &&
      this.lightingWallOverlayContext,
    );
  }

  private renderLightingOverlay(grid: LightingGrid): void {
    if (
      !this.lightingOverlayTexture ||
      !this.lightingOverlayCanvas ||
      !this.lightingOverlayContext ||
      !this.lightingWallOverlayTexture ||
      !this.lightingWallOverlayCanvas ||
      !this.lightingWallOverlayContext
    ) {
      return;
    }

    const playerPixel = this.worldToLightingPixel(
      grid,
      this.lightingCenterCurrent.x,
      this.lightingCenterCurrent.y,
    );
    const radiusPixels = this.lightingRadiusTiles * this.lightingTilePixels;
    const tilePixels = this.lightingTilePixels;
    const renderLayer = (
      context: CanvasRenderingContext2D,
      canvas: HTMLCanvasElement,
      coverageMask: Uint8Array,
    ): void => {
      const widthPixels = canvas.width;
      const heightPixels = canvas.height;
      context.clearRect(0, 0, widthPixels, heightPixels);

      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgba(0, 0, 0, ${this.lightingMaxDarkAlpha})`;
      context.fillRect(0, 0, widthPixels, heightPixels);

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
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = radial;
      context.beginPath();
      context.arc(playerPixel.x, playerPixel.y, radiusPixels, 0, Math.PI * 2);
      context.fill();

      context.globalCompositeOperation = "source-over";
      for (let cellY = 0; cellY < grid.height; cellY++) {
        const pixelY = cellY * tilePixels;
        for (let cellX = 0; cellX < grid.width; cellX++) {
          const cellIndex = cellY * grid.width + cellX;
          if (coverageMask[cellIndex]) {
            continue;
          }
          context.clearRect(cellX * tilePixels, pixelY, tilePixels, tilePixels);
        }
      }
      context.globalCompositeOperation = "source-over";
    };

    // Floor layer: cover known cells only (anti-mask is non-level floor cells).
    renderLayer(
      this.lightingOverlayContext,
      this.lightingOverlayCanvas,
      grid.knownMask,
    );
    // Wall-top layer: cover wall cells only.
    renderLayer(
      this.lightingWallOverlayContext,
      this.lightingWallOverlayCanvas,
      grid.wallMask,
    );

    this.lightingOverlayTexture.needsUpdate = true;
    this.lightingWallOverlayTexture.needsUpdate = true;
  }

  private updateLightingOverlay(): void {
    if (this.isFpsMode()) {
      this.disposeLightingOverlay();
      return;
    }

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

  private configureBaseLightingForPlayMode(): void {
    if (!this.ambientLight || !this.directionalLight) {
      return;
    }

    if (this.isFpsMode()) {
      this.ambientLight.intensity = 0.72;
      this.directionalLight.intensity = 1.25;
      if (!this.fpsPlayerLight) {
        this.fpsPlayerLight = new THREE.PointLight(0xfff4d8, 2.8, 14, 1.35);
        this.fpsPlayerLight.castShadow = false;
        this.scene.add(this.fpsPlayerLight);
      }
      this.fpsPlayerLight.intensity = 2.8;
      this.fpsPlayerLight.distance = 14;
      this.fpsPlayerLight.decay = 1.35;
      this.fpsPlayerLight.visible = true;
      this.updateFpsPlayerLightPosition();
      return;
    }

    this.ambientLight.intensity = 0.4;
    this.directionalLight.intensity = 0.8;
    if (this.fpsPlayerLight) {
      this.fpsPlayerLight.visible = false;
    }
  }

  private updateFpsPlayerLightPosition(): void {
    if (!this.fpsPlayerLight || !this.isFpsMode()) {
      return;
    }
    this.fpsPlayerLight.position.copy(this.camera.position);
    this.fpsPlayerLight.position.z = this.camera.position.z + 0.04;
  }

  constructor(options: Nethack3DEngineOptions = {}) {
    this.mountElement = options.mountElement ?? null;
    this.uiAdapter = options.uiAdapter ?? null;
    this.characterCreationConfig = options.characterCreationConfig ?? {
      mode: "create",
      playMode: "normal",
    };
    this.clientOptions = normalizeNh3dClientOptions(options.clientOptions);
    const explicitFpsMode = options.clientOptions?.fpsMode;
    const initialFpsMode =
      typeof explicitFpsMode === "boolean"
        ? explicitFpsMode
        : this.characterCreationConfig.playMode === "fps";
    this.playMode = initialFpsMode ? "fps" : "normal";
    this.clientOptions.fpsMode = this.playMode === "fps";
    if (typeof options.loggingEnabled === "boolean") {
      setLoggingEnabled(options.loggingEnabled);
    }
    this.characterCreationMode = this.characterCreationConfig.mode;
    this.initThreeJS();
    this.initUI();
    this.connectToRuntime();
    if (this.uiAdapter) {
      this.uiAdapter.setNumberPadModeEnabled(this.numberPadModeEnabled);
    }

    if (this.playMode === "fps") {
      this.camera.fov = this.fpsCameraFov;
      this.camera.updateProjectionMatrix();
      this.cameraDistance = 0;
      this.cameraPitch = 0;
      this.cameraYaw = Math.PI;
      this.cameraFollowInitialized = true;
    } else {
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
    this.updateMinimapVisibility();
    this.applyClientOptions(this.clientOptions);
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
    this.ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(10, 10, 5);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(this.directionalLight);
    this.configureBaseLightingForPlayMode();

    // --- Event Listeners ---
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    window.addEventListener("keydown", this.handleKeyDown.bind(this), false);
    window.addEventListener("keyup", this.handleKeyUp.bind(this), false);
    window.addEventListener("blur", this.handleWindowBlur.bind(this), false);
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange.bind(this),
      false,
    );

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

  private ensureMinimapOverlay(): void {
    if (this.minimapContainer && this.minimapCanvasContext) {
      return;
    }

    const container = document.createElement("div");
    container.className = "nh3d-minimap";
    container.setAttribute("aria-label", "Dungeon minimap");

    const mapCanvas = document.createElement("canvas");
    mapCanvas.className = "nh3d-minimap-canvas";
    mapCanvas.width = MINIMAP_WIDTH_TILES;
    mapCanvas.height = MINIMAP_HEIGHT_TILES;
    const mapContext = mapCanvas.getContext("2d");
    if (!mapContext) {
      return;
    }
    mapContext.imageSmoothingEnabled = false;
    container.appendChild(mapCanvas);

    const viewportCanvas = document.createElement("canvas");
    viewportCanvas.className = "nh3d-minimap-viewport";
    viewportCanvas.width = MINIMAP_WIDTH_TILES;
    viewportCanvas.height = MINIMAP_HEIGHT_TILES;
    const viewportContext = viewportCanvas.getContext("2d");
    if (!viewportContext) {
      return;
    }
    viewportContext.imageSmoothingEnabled = false;
    container.appendChild(viewportCanvas);

    container.addEventListener(
      "pointerdown",
      this.handleMinimapPointerDown.bind(this),
      false,
    );
    container.addEventListener(
      "pointermove",
      this.handleMinimapPointerMove.bind(this),
      false,
    );
    container.addEventListener(
      "pointerup",
      this.handleMinimapPointerUp.bind(this),
      false,
    );
    container.addEventListener(
      "pointercancel",
      this.handleMinimapPointerUp.bind(this),
      false,
    );
    container.addEventListener(
      "lostpointercapture",
      this.handleMinimapPointerUp.bind(this),
      false,
    );
    document.body.appendChild(container);

    this.minimapContainer = container;
    this.minimapCanvasContext = mapContext;
    this.minimapViewportContext = viewportContext;
    this.resetMinimap();
    this.renderMinimapViewportOverlay();
  }

  private resetMinimap(): void {
    this.pendingMinimapCellUpdates.clear();
    this.minimapFlushScheduled = false;
    this.minimapViewportRect = null;
    this.minimapCells.fill(0);
    this.stopMinimapDrag();

    if (this.minimapCanvasContext) {
      this.minimapCanvasContext.clearRect(
        0,
        0,
        MINIMAP_WIDTH_TILES,
        MINIMAP_HEIGHT_TILES,
      );
      this.minimapCanvasContext.fillStyle = this.minimapPalette[0];
      this.minimapCanvasContext.fillRect(
        0,
        0,
        MINIMAP_WIDTH_TILES,
        MINIMAP_HEIGHT_TILES,
      );
    }
    if (this.minimapViewportContext) {
      this.minimapViewportContext.clearRect(
        0,
        0,
        MINIMAP_WIDTH_TILES,
        MINIMAP_HEIGHT_TILES,
      );
    }
  }

  private updateMinimapVisibility(): void {
    if (!this.minimapContainer) {
      return;
    }

    const visible = this.clientOptions.minimap;
    this.minimapContainer.style.display = visible ? "" : "none";
    this.minimapContainer.style.pointerEvents = visible ? "auto" : "none";
    this.minimapContainer.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      this.stopMinimapDrag();
      return;
    }
    this.renderMinimapViewportOverlay();
  }

  private parseTileStateSignature(signature: string): {
    glyph: number;
    char?: string;
    color?: number;
  } | null {
    const parts = String(signature || "").split("|");
    if (parts.length < 2) {
      return null;
    }

    const glyphToken = parts.shift();
    const colorToken = parts.pop();
    if (!glyphToken || colorToken === undefined) {
      return null;
    }

    const glyph = Number.parseInt(glyphToken, 10);
    if (!Number.isFinite(glyph)) {
      return null;
    }

    const joinedChar = parts.join("|");
    const normalizedChar = joinedChar.length > 0 ? joinedChar : undefined;
    const color =
      colorToken.trim().length > 0 ? Number.parseInt(colorToken, 10) : NaN;
    return {
      glyph,
      char: normalizedChar,
      color: Number.isFinite(color) ? color : undefined,
    };
  }

  private refreshTilesFromStateCache(): void {
    const snapshots: Array<{
      x: number;
      y: number;
      glyph: number;
      char?: string;
      color?: number;
    }> = [];
    for (const [key, signature] of this.tileStateCache.entries()) {
      const [rawX, rawY] = key.split(",");
      const x = Number.parseInt(rawX, 10);
      const y = Number.parseInt(rawY, 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      const parsed = this.parseTileStateSignature(signature);
      if (!parsed) {
        continue;
      }
      snapshots.push({
        x,
        y,
        glyph: parsed.glyph,
        char: parsed.char,
        color: parsed.color,
      });
    }

    for (const snapshot of snapshots) {
      this.updateTile(
        snapshot.x,
        snapshot.y,
        snapshot.glyph,
        snapshot.char,
        snapshot.color,
      );
    }
  }

  private applyPlayMode(nextPlayMode: PlayMode): void {
    const resolvedPlayMode: PlayMode = nextPlayMode === "fps" ? "fps" : "normal";
    if (this.playMode === resolvedPlayMode) {
      this.configureBaseLightingForPlayMode();
      this.markLightingDirty();
      return;
    }

    this.playMode = resolvedPlayMode;
    this.clientOptions.fpsMode = this.playMode === "fps";
    this.characterCreationConfig.playMode = this.playMode;
    this.clearFpsTouchGestures();
    this.isMiddleMouseDown = false;
    this.isRightMouseDown = false;
    this.fpsAutoMoveDirection = null;
    this.fpsAutoTurnTargetYaw = null;
    this.fpsStepCameraActive = false;

    if (this.playMode === "fps") {
      const eyeX = this.playerPos.x * TILE_SIZE;
      const eyeY = -this.playerPos.y * TILE_SIZE;
      const currentYaw = Number.isFinite(this.cameraYaw)
        ? this.cameraYaw
        : Math.PI;
      this.camera.fov = this.fpsCameraFov;
      this.camera.updateProjectionMatrix();
      this.cameraDistance = 0;
      this.cameraPitch = 0;
      this.cameraYaw = this.wrapAngle(currentYaw);
      this.cameraFollowInitialized = true;
      this.fpsStepCameraFrom.set(eyeX, eyeY, this.firstPersonEyeHeight);
      this.fpsStepCameraTo.set(eyeX, eyeY, this.firstPersonEyeHeight);
    } else {
      this.closeFpsCrosshairContextMenu(false);
      if (this.fpsForwardHighlight) {
        this.fpsForwardHighlight.visible = false;
      }
      this.fpsCurrentAimDirection = null;
      this.fpsFireSuppressionUntilMs = 0;
      this.fpsCrosshairGlancePending = null;
      this.fpsCrosshairContextSignature = "";
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock?.();
      }
      this.fpsPointerLockActive = false;
      this.fpsPointerLockRestorePending = false;
      this.camera.fov = 75;
      this.camera.updateProjectionMatrix();
      this.cameraDistance = 15;
      this.cameraYaw = Math.PI;
      this.cameraPitch = THREE.MathUtils.clamp(
        Math.PI / 2 - 0.2,
        this.minCameraPitch,
        this.maxCameraPitch,
      );
      this.cameraFollowInitialized = false;
      this.requestTileUpdate(this.playerPos.x, this.playerPos.y);
    }

    this.configureBaseLightingForPlayMode();
    this.refreshTilesFromStateCache();
    this.syncFpsPointerLockForUiState(false);
    this.markLightingDirty();
  }

  private applyClientOptions(nextOptions: Nh3dClientOptions): void {
    const normalized = normalizeNh3dClientOptions(nextOptions);
    const previous = this.clientOptions;
    const playModeChanged = previous.fpsMode !== normalized.fpsMode;
    const minimapChanged = previous.minimap !== normalized.minimap;
    const damageNumbersChanged =
      previous.damageNumbers !== normalized.damageNumbers;
    const tileShakeChanged =
      previous.tileShakeOnHit !== normalized.tileShakeOnHit;
    const bloodChanged = previous.blood !== normalized.blood;

    this.clientOptions = normalized;

    if (playModeChanged) {
      this.applyPlayMode(normalized.fpsMode ? "fps" : "normal");
    }
    if (minimapChanged) {
      this.updateMinimapVisibility();
    }
    if (damageNumbersChanged && !normalized.damageNumbers) {
      this.clearPlayerDamageNumberParticles();
    }
    if (tileShakeChanged && !normalized.tileShakeOnHit) {
      this.clearGlyphDamageShakes();
    }
    if (bloodChanged && !normalized.blood) {
      this.clearBloodMistParticles();
    }
  }

  private isValidMinimapCoordinate(x: number, y: number): boolean {
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      x < MINIMAP_WIDTH_TILES &&
      y >= 0 &&
      y < MINIMAP_HEIGHT_TILES
    );
  }

  private getMinimapCellIndex(x: number, y: number): number {
    return y * MINIMAP_WIDTH_TILES + x;
  }

  private resolveMinimapPaletteIndex(
    behavior: TileBehaviorResult,
    isUndiscovered: boolean,
  ): number {
    if (behavior.isPlayerGlyph || behavior.materialKind === "player") {
      return 12;
    }
    if (isUndiscovered) {
      return 1;
    }

    switch (behavior.materialKind) {
      case "wall":
      case "dark_wall":
        return 3;
      case "door":
        return 4;
      case "water":
      case "fountain":
        return 5;
      case "stairs_up":
      case "stairs_down":
        return 6;
      case "trap":
      case "feature":
      case "effect_warning":
      case "effect_zap":
      case "effect_explode":
      case "effect_swallow":
        return 7;
      case "item":
        return 8;
      case "monster_hostile":
        return 9;
      case "monster_friendly":
        return 10;
      case "monster_neutral":
        return 11;
      case "floor":
      case "dark":
      case "default":
      default:
        return 2;
    }
  }

  private queueMinimapTileUpdate(
    x: number,
    y: number,
    behavior: TileBehaviorResult,
    isUndiscovered: boolean,
  ): void {
    const tileX = Math.trunc(x);
    const tileY = Math.trunc(y);
    if (!this.isValidMinimapCoordinate(tileX, tileY)) {
      return;
    }

    const index = this.getMinimapCellIndex(tileX, tileY);
    const paletteIndex = this.resolveMinimapPaletteIndex(
      behavior,
      isUndiscovered,
    );
    const pending = this.pendingMinimapCellUpdates.get(index);
    if (pending === paletteIndex) {
      return;
    }
    if (
      !this.pendingMinimapCellUpdates.has(index) &&
      this.minimapCells[index] === paletteIndex
    ) {
      return;
    }

    this.pendingMinimapCellUpdates.set(index, paletteIndex);
    this.scheduleMinimapTileFlush();
  }

  private scheduleMinimapTileFlush(): void {
    if (this.minimapFlushScheduled) {
      return;
    }
    this.minimapFlushScheduled = true;
    requestAnimationFrame(() => {
      this.minimapFlushScheduled = false;
      this.flushPendingMinimapTileUpdates();
    });
  }

  private flushPendingMinimapTileUpdates(): void {
    if (!this.minimapCanvasContext || !this.pendingMinimapCellUpdates.size) {
      return;
    }

    for (const [
      index,
      paletteIndex,
    ] of this.pendingMinimapCellUpdates.entries()) {
      this.minimapCells[index] = paletteIndex;
      const x = index % MINIMAP_WIDTH_TILES;
      const y = Math.floor(index / MINIMAP_WIDTH_TILES);
      this.minimapCanvasContext.fillStyle =
        this.minimapPalette[paletteIndex] ?? this.minimapPalette[0];
      this.minimapCanvasContext.fillRect(x, y, 1, 1);
    }
    this.pendingMinimapCellUpdates.clear();
  }

  private computeMinimapViewportRect(): MinimapViewportRect {
    const centerWorldX = this.cameraFollowInitialized
      ? this.cameraFollowCurrent.x
      : this.playerPos.x * TILE_SIZE + this.cameraPanTargetX;
    const centerWorldY = this.cameraFollowInitialized
      ? this.cameraFollowCurrent.y
      : -this.playerPos.y * TILE_SIZE + this.cameraPanTargetY;
    const centerTileX = centerWorldX / TILE_SIZE;
    const centerTileY = -centerWorldY / TILE_SIZE;

    const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    const baseViewHeightWorld =
      2 * Math.tan(fovRadians / 2) * Math.max(1, this.cameraDistance);
    const baseViewWidthWorld =
      baseViewHeightWorld * Math.max(1, this.camera.aspect);
    const pitchScale = 1 / Math.max(0.45, Math.sin(this.cameraPitch));

    const viewWidthTiles = THREE.MathUtils.clamp(
      (baseViewWidthWorld * pitchScale) / TILE_SIZE,
      4,
      MINIMAP_WIDTH_TILES,
    );
    const viewHeightTiles = THREE.MathUtils.clamp(
      (baseViewHeightWorld * pitchScale) / TILE_SIZE,
      3,
      MINIMAP_HEIGHT_TILES,
    );

    return {
      minX: centerTileX - viewWidthTiles / 2,
      minY: centerTileY - viewHeightTiles / 2,
      width: viewWidthTiles,
      height: viewHeightTiles,
    };
  }

  private renderMinimapViewportOverlay(): void {
    if (!this.minimapViewportContext) {
      return;
    }

    const viewport = this.computeMinimapViewportRect();
    this.minimapViewportRect = viewport;

    const context = this.minimapViewportContext;
    context.clearRect(0, 0, MINIMAP_WIDTH_TILES, MINIMAP_HEIGHT_TILES);

    const drawMinX = THREE.MathUtils.clamp(
      viewport.minX,
      0,
      MINIMAP_WIDTH_TILES,
    );
    const drawMinY = THREE.MathUtils.clamp(
      viewport.minY,
      0,
      MINIMAP_HEIGHT_TILES,
    );
    const drawMaxX = THREE.MathUtils.clamp(
      viewport.minX + viewport.width,
      0,
      MINIMAP_WIDTH_TILES,
    );
    const drawMaxY = THREE.MathUtils.clamp(
      viewport.minY + viewport.height,
      0,
      MINIMAP_HEIGHT_TILES,
    );
    const drawWidth = Math.max(0, drawMaxX - drawMinX);
    const drawHeight = Math.max(0, drawMaxY - drawMinY);

    if (drawWidth > 0 && drawHeight > 0) {
      context.fillStyle = "rgba(214, 233, 255, 0.08)";
      context.fillRect(drawMinX, drawMinY, drawWidth, drawHeight);

      context.strokeStyle = "rgba(214, 233, 255, 0.62)";
      context.lineWidth = 0.65;
      context.strokeRect(
        drawMinX + 0.325,
        drawMinY + 0.325,
        drawWidth,
        drawHeight,
      );
    }

    if (this.isValidMinimapCoordinate(this.playerPos.x, this.playerPos.y)) {
      context.fillStyle = this.minimapPalette[12];
      context.fillRect(
        this.playerPos.x - 0.4,
        this.playerPos.y - 0.4,
        0.8,
        0.8,
      );
    }
  }

  private getMinimapPointerTile(
    event: PointerEvent,
  ): { x: number; y: number } | null {
    if (!this.minimapContainer) {
      return null;
    }
    const rect = this.minimapContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const relativeX = (event.clientX - rect.left) / rect.width;
    const relativeY = (event.clientY - rect.top) / rect.height;
    if (
      !Number.isFinite(relativeX) ||
      !Number.isFinite(relativeY) ||
      relativeX < 0 ||
      relativeX > 1 ||
      relativeY < 0 ||
      relativeY > 1
    ) {
      return null;
    }

    return {
      x: relativeX * MINIMAP_WIDTH_TILES,
      y: relativeY * MINIMAP_HEIGHT_TILES,
    };
  }

  private centerCameraOnMinimapTile(tileX: number, tileY: number): void {
    const clampedTileX = THREE.MathUtils.clamp(
      tileX,
      0,
      MINIMAP_WIDTH_TILES - 1,
    );
    const clampedTileY = THREE.MathUtils.clamp(
      tileY,
      0,
      MINIMAP_HEIGHT_TILES - 1,
    );

    const targetWorldX = clampedTileX * TILE_SIZE;
    const targetWorldY = -clampedTileY * TILE_SIZE;
    this.cameraPanTargetX = targetWorldX - this.playerPos.x * TILE_SIZE;
    this.cameraPanTargetY = targetWorldY + this.playerPos.y * TILE_SIZE;
    this.cameraPanX = this.cameraPanTargetX;
    this.cameraPanY = this.cameraPanTargetY;
    this.isCameraCenteredOnPlayer = false;
  }

  private recenterCameraOnPlayerIfNeeded(): void {
    if (this.isCameraCenteredOnPlayer) {
      return;
    }
    this.cameraPanX = 0;
    this.cameraPanY = 0;
    this.cameraPanTargetX = 0;
    this.cameraPanTargetY = 0;
    this.isCameraCenteredOnPlayer = true;
  }

  private handleMinimapPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (
      this.isAnyModalVisible() ||
      this.isInQuestion ||
      this.isInDirectionQuestion
    ) {
      return;
    }

    const pointerTile = this.getMinimapPointerTile(event);
    if (!pointerTile) {
      return;
    }
    this.minimapDragPointerId = event.pointerId;
    this.centerCameraOnMinimapTile(pointerTile.x, pointerTile.y);
    if (this.minimapContainer) {
      this.minimapContainer.setPointerCapture(event.pointerId);
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
  }

  private handleMinimapPointerMove(event: PointerEvent): void {
    if (this.minimapDragPointerId !== event.pointerId) {
      return;
    }

    const pointerTile = this.getMinimapPointerTile(event);
    if (!pointerTile) {
      return;
    }
    this.centerCameraOnMinimapTile(pointerTile.x, pointerTile.y);

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
  }

  private handleMinimapPointerUp(event: PointerEvent): void {
    if (
      this.minimapDragPointerId !== null &&
      this.minimapDragPointerId !== event.pointerId
    ) {
      return;
    }
    this.stopMinimapDrag();
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
  }

  private stopMinimapDrag(): void {
    if (
      this.minimapContainer &&
      this.minimapDragPointerId !== null &&
      this.minimapContainer.hasPointerCapture(this.minimapDragPointerId)
    ) {
      this.minimapContainer.releasePointerCapture(this.minimapDragPointerId);
    }
    this.minimapDragPointerId = null;
  }

  private updateCameraPanInertia(deltaSeconds: number): void {
    if (this.isCameraCenteredOnPlayer) {
      return;
    }
    const panDeltaX = this.cameraPanTargetX - this.cameraPanX;
    const panDeltaY = this.cameraPanTargetY - this.cameraPanY;
    if (Math.abs(panDeltaX) < 0.0001 && Math.abs(panDeltaY) < 0.0001) {
      return;
    }
    const alpha =
      1 -
      Math.exp((-Math.LN2 * deltaSeconds * 1000) / this.cameraPanHalfLifeMs);
    this.cameraPanX = THREE.MathUtils.lerp(
      this.cameraPanX,
      this.cameraPanTargetX,
      alpha,
    );
    this.cameraPanY = THREE.MathUtils.lerp(
      this.cameraPanY,
      this.cameraPanTargetY,
      alpha,
    );
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
    this.ensureMinimapOverlay();

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
        loggingEnabled: isLoggingEnabled(),
      },
    );

    try {
      await this.session.start();
      this.session.setLoggingEnabled(isLoggingEnabled());
      this.updateConnectionStatus("Running", "running");
      this.updateStatus("Local NetHack runtime started");
      // this.addGameMessage("Local NetHack runtime started");
      if (this.isFpsMode()) {
        this.addGameMessage(
          "FPS mode active: WASD move, F search, left-click fire, right-click mouselook.",
        );
      }
      this.setLoadingVisible(false);
    } catch (error) {
      console.error("Failed to start local NetHack runtime:", error);
      this.updateConnectionStatus("Error", "error");
      this.updateStatus("Failed to start local NetHack runtime");
      this.addGameMessage("Failed to start local NetHack runtime");
      this.setLoadingVisible(true);
    }
  }

  private handleRuntimeEvent(event: RuntimeEvent): void {
    const data = event as RuntimeEvent & Record<string, any>;
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

        if (this.isFpsMode()) {
          const newKey = `${data.newPosition.x},${data.newPosition.y}`;
          const newTerrain = this.lastKnownTerrain.get(newKey);
          if (newTerrain) {
            this.updateTile(
              data.newPosition.x,
              data.newPosition.y,
              newTerrain.glyph,
              newTerrain.char,
              newTerrain.color,
            );
          } else {
            this.requestTileUpdate(data.newPosition.x, data.newPosition.y);
          }
        } else {
          // Create a fake player glyph at the new position to ensure visual update
          // Use a typical player glyph number (runtime commonly reports 330 for @).
          this.updateTile(data.newPosition.x, data.newPosition.y, 330, "@", 0);
        }
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
        this.captureFpsCrosshairGlanceMessage(data.text);
        this.captureMonsterDefeatFromMessage(data.text);
        this.captureDamageFromMessage(data.text);
        this.addGameMessage(data.text);
        break;

      case "raw_print":
        this.captureFpsCrosshairGlanceMessage(data.text);
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
          lines: this.normalizeInfoMenuLines(data.lines),
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

  private normalizeInfoMenuLines(rawLines: unknown): string[] {
    if (!Array.isArray(rawLines)) {
      return [];
    }
    return rawLines.map((line) =>
      String(line ?? "")
        .replace(/\r/g, "")
        .trimEnd(),
    );
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

  private isLootLikeBehavior(behavior: TileBehaviorResult): boolean {
    if (behavior.isPlayerGlyph) {
      return false;
    }

    switch (behavior.effective.kind) {
      case "obj":
      case "body":
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

  private updateDirectionalAttackContextFromTarget(
    targetX: number,
    targetY: number,
  ): void {
    const dx = targetX - this.playerPos.x;
    const dy = targetY - this.playerPos.y;
    const direction = this.resolveDirectionFromDelta(dx, dy);
    if (!direction) {
      return;
    }
    this.updateDirectionalAttackContext(direction);
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

  private getLatestDirectionalAttackContext(): DirectionalAttackContext | null {
    const context = this.lastDirectionalAttackContext;
    return context ? { ...context } : null;
  }

  private findDirectionalMonsterTarget(
    context: DirectionalAttackContext,
  ): { x: number; y: number } | null {
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
      return null;
    }
    return { x: targetX, y: targetY };
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
    this.tryTriggerDirectionalMonsterDefeatSpray();
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

    const target = this.findDirectionalMonsterTarget(context);
    if (!target) {
      return false;
    }

    this.triggerDamageEffectsAtTile(target.x, target.y, amount, "hit");
    return true;
  }

  private tryTriggerDirectionalMonsterDefeatSpray(): boolean {
    const context = this.getLatestDirectionalAttackContext();
    if (!context) {
      return false;
    }

    const target = this.findDirectionalMonsterTarget(context);
    if (target) {
      this.triggerDamageEffectsAtTile(target.x, target.y, 1, "defeat");
      return true;
    }

    const fallbackX = context.originX + context.dx;
    const fallbackY = context.originY + context.dy;
    this.triggerDamageEffectsAtTile(fallbackX, fallbackY, 1, "defeat");
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

    if (this.tryTriggerDirectionalMonsterHitSpray(amount)) {
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
    if (
      isPlayerTarget &&
      variant === "hit" &&
      this.clientOptions.damageNumbers
    ) {
      this.spawnPlayerDamageNumberParticle(x, y, damage);
    }
    if (this.clientOptions.tileShakeOnHit) {
      this.startGlyphDamageShake(x, y, variant);
    }
    if (this.clientOptions.blood) {
      this.spawnBloodMistParticles(x, y, damage, variant);
    }
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
      const behavior = this.classifyTilePayload(tile);
      if (
        this.isFpsMode() &&
        this.fpsStepCameraActive &&
        behavior &&
        !behavior.isPlayerGlyph &&
        (this.isMonsterLikeBehavior(behavior) || this.isLootLikeBehavior(behavior))
      ) {
        this.pendingTileUpdates.set(key, tile);
        continue;
      }

      const signature = `${tile.glyph}|${tile.char ?? ""}|${tile.color ?? ""}`;
      if (this.tileStateCache.get(key) === signature) {
        continue;
      }

      this.tileStateCache.set(key, signature);
      this.updateTile(tile.x, tile.y, tile.glyph, tile.char, tile.color);
    }
    // Flush minimap cells once per tile batch to keep runtime bursts lightweight.
    this.flushPendingMinimapTileUpdates();

    if (this.pendingTileUpdates.size > 0 && !this.tileFlushScheduled) {
      this.tileFlushScheduled = true;
      requestAnimationFrame(() => this.flushPendingTileUpdates());
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

  public isLoggingEnabled(): boolean {
    return isLoggingEnabled();
  }

  public setLoggingEnabled(enabled: boolean): boolean {
    const next = setLoggingEnabled(enabled);
    if (this.session) {
      this.session.setLoggingEnabled(next);
    }
    logWithOriginal(`[NetHack 3D] Logging ${next ? "enabled" : "disabled"}`);
    return next;
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
    drawFloorGrid: boolean = false,
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
      drawFloorGrid,
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
    drawFloorGrid: boolean = false,
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

    if (drawFloorGrid) {
      const gridLineWidth = Math.max(2, Math.floor(size * 0.02));
      const inset = gridLineWidth * 0.5;
      context.lineWidth = gridLineWidth;
      context.strokeStyle = "rgba(8, 12, 16, 0.26)";
      context.strokeRect(inset, inset, size - gridLineWidth, size - gridLineWidth);
    }

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
    const sprite = this.monsterBillboards.get(key);
    if (sprite) {
      const spriteZ =
        typeof sprite.userData?.elevatedZ === "number"
          ? sprite.userData.elevatedZ
          : this.elevatedMonsterZ;
      sprite.position.set(
        state.tileX * TILE_SIZE,
        -state.tileY * TILE_SIZE,
        spriteZ,
      );
    }
    const shadow = this.entityBlobShadows.get(key);
    if (shadow) {
      const shadowZ = mesh?.userData?.isWall ? WALL_HEIGHT + 0.03 : 0.028;
      shadow.position.set(
        state.tileX * TILE_SIZE,
        -state.tileY * TILE_SIZE,
        shadowZ,
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
      const sprite = this.monsterBillboards.get(key);
      if (sprite) {
        const spriteZ =
          typeof sprite.userData?.elevatedZ === "number"
            ? sprite.userData.elevatedZ
            : this.elevatedMonsterZ;
        sprite.position.set(
          state.tileX * TILE_SIZE + offsetX,
          -state.tileY * TILE_SIZE + offsetY,
          spriteZ,
        );
      }
      const shadow = this.entityBlobShadows.get(key);
      if (shadow) {
        const shadowZ = mesh.userData?.isWall ? WALL_HEIGHT + 0.03 : 0.028;
        shadow.position.set(
          state.tileX * TILE_SIZE + offsetX * 0.4,
          -state.tileY * TILE_SIZE + offsetY * 0.4,
          shadowZ,
        );
      }

      if (progress >= 1) {
        this.stopGlyphDamageShake(key);
      }
    }
  }

  private clearGlyphDamageShakes(): void {
    const shakeKeys = Array.from(this.glyphDamageShakes.keys());
    for (const key of shakeKeys) {
      this.stopGlyphDamageShake(key);
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
    context.font = `600 ${Math.floor(size * 0.52)}px "Roboto Condensed", "Segoe UI", "Segoe UI Variable", sans-serif`;
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
    const scaleMultiplier = 1.1;
    const useFpsFloating = this.isFpsMode();
    const fpsScaleFactor = useFpsFloating
      ? this.playerDamageNumberFpsScaleFactor
      : 1;
    const scaleY = 0.42 * scaleMultiplier * fpsScaleFactor;
    const scaleX = Math.max(
      0.26 * scaleMultiplier * fpsScaleFactor,
      scaleY * aspectRatio,
    );
    const baseScale = new THREE.Vector2(scaleX, scaleY);
    const fpsLateralOffset = useFpsFloating
      ? (Math.random() - 0.5) * this.playerDamageNumberFpsLateralSpread
      : 0;
    const fpsBaseHeightOffset = 0.28;
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    sprite.position.set(
      tileX * TILE_SIZE,
      -tileY * TILE_SIZE,
      this.damageParticleFloorZ + fpsBaseHeightOffset,
    );
    this.applyFpsForwardOffsetToPlayerNumberPosition(
      sprite.position,
      useFpsFloating,
      fpsLateralOffset,
    );
    this.alignPlayerDamageNumberToCamera(sprite);
    sprite.renderOrder = 940;
    this.scene.add(sprite);

    let velocity = new THREE.Vector3(0, 0, 0);
    if (!useFpsFloating) {
      const launchSpeed = (1.95 + Math.random() * 0.45) * 5;
      const launchAngleRad = THREE.MathUtils.degToRad(10);
      const launchAzimuthRad = Math.random() * Math.PI * 2;
      const horizontalSpeed = launchSpeed * Math.sin(launchAngleRad);
      const verticalSpeed = launchSpeed * Math.cos(launchAngleRad);
      velocity = new THREE.Vector3(
        Math.cos(launchAzimuthRad) * horizontalSpeed,
        Math.sin(launchAzimuthRad) * horizontalSpeed,
        verticalSpeed,
      );
    }

    this.playerDamageNumberParticles.push({
      kind: "damage",
      sprite,
      velocity,
      ageMs: 0,
      lifetimeMs: this.playerDamageNumberLifetimeMs,
      radius: 0.055,
      baseScale,
      fpsFloating: useFpsFloating,
      fpsLateralOffset,
      fpsBaseHeightOffset,
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
    const scaleMultiplier = 1.0;
    const useFpsFloating = this.isFpsMode();
    const fpsScaleFactor = useFpsFloating
      ? this.playerDamageNumberFpsScaleFactor
      : 1;
    const scaleY = 0.42 * scaleMultiplier * fpsScaleFactor;
    const scaleX = Math.max(
      0.26 * scaleMultiplier * fpsScaleFactor,
      scaleY * aspectRatio,
    );
    const baseScale = new THREE.Vector2(scaleX, scaleY);
    const fpsLateralOffset = useFpsFloating
      ? (Math.random() - 0.5) * this.playerDamageNumberFpsLateralSpread
      : 0;
    const fpsBaseHeightOffset = 0.24;
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    sprite.position.set(
      tileX * TILE_SIZE,
      -tileY * TILE_SIZE,
      this.damageParticleFloorZ + fpsBaseHeightOffset,
    );
    this.applyFpsForwardOffsetToPlayerNumberPosition(
      sprite.position,
      useFpsFloating,
      fpsLateralOffset,
    );
    this.alignPlayerDamageNumberToCamera(sprite);
    sprite.renderOrder = 940;
    this.scene.add(sprite);

    const verticalSpeed = useFpsFloating ? 0 : 3.2 + Math.random() * 0.8;
    this.playerDamageNumberParticles.push({
      kind: "heal",
      sprite,
      velocity: new THREE.Vector3(0, 0, verticalSpeed),
      ageMs: 0,
      lifetimeMs: this.playerHealNumberLifetimeMs,
      radius: 0.055,
      baseScale,
      fpsFloating: useFpsFloating,
      fpsLateralOffset,
      fpsBaseHeightOffset,
    });
  }

  private applyFpsForwardOffsetToPlayerNumberPosition(
    position: THREE.Vector3,
    applyVerticalLift: boolean,
    lateralOffset: number = 0,
  ): void {
    if (!this.isFpsMode()) {
      return;
    }

    this.camera.getWorldDirection(this.playerDamageNumberForwardDirection);
    this.playerDamageNumberForwardDirection.z = 0;
    const lengthSq = this.playerDamageNumberForwardDirection.lengthSq();
    if (lengthSq > 1e-8) {
      this.playerDamageNumberForwardDirection.multiplyScalar(1 / Math.sqrt(lengthSq));
    } else {
      this.playerDamageNumberForwardDirection.set(
        -Math.sin(this.cameraYaw),
        -Math.cos(this.cameraYaw),
        0,
      );
    }
    this.playerDamageNumberRightDirection.set(
      this.playerDamageNumberForwardDirection.y,
      -this.playerDamageNumberForwardDirection.x,
      0,
    );

    position.x +=
      this.playerDamageNumberForwardDirection.x *
      this.playerDamageNumberForwardOffset;
    position.y +=
      this.playerDamageNumberForwardDirection.y *
      this.playerDamageNumberForwardOffset;
    if (lateralOffset !== 0) {
      position.x += this.playerDamageNumberRightDirection.x * lateralOffset;
      position.y += this.playerDamageNumberRightDirection.y * lateralOffset;
    }
    if (applyVerticalLift) {
      position.z += this.playerDamageNumberForwardLift;
    }
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

  private clearBloodMistParticles(): void {
    for (let i = this.damageParticles.length - 1; i >= 0; i -= 1) {
      this.disposeDamageParticle(i);
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
      const lifeT = THREE.MathUtils.clamp(
        particle.ageMs / particle.lifetimeMs,
        0,
        1,
      );

      if (this.isFpsMode() && particle.fpsFloating) {
        particle.sprite.position.set(
          this.playerPos.x * TILE_SIZE,
          -this.playerPos.y * TILE_SIZE,
          this.damageParticleFloorZ +
            particle.fpsBaseHeightOffset +
            this.playerDamageNumberFpsRiseDistance * lifeT,
        );
        this.applyFpsForwardOffsetToPlayerNumberPosition(
          particle.sprite.position,
          false,
          particle.fpsLateralOffset,
        );
        this.alignPlayerDamageNumberToCamera(particle.sprite);

        const material = particle.sprite.material;
        if (!(material instanceof THREE.SpriteMaterial)) {
          this.disposePlayerDamageNumberParticle(i);
          continue;
        }

        const fadeStart = 0.42;
        const fadeT = THREE.MathUtils.clamp(
          (lifeT - fadeStart) / (1 - fadeStart),
          0,
          1,
        );
        material.opacity = Math.max(0, 1 - Math.pow(fadeT, 1.7));
        const scaleBoost = 1 + lifeT * 0.06;
        particle.sprite.scale.set(
          particle.baseScale.x * scaleBoost,
          particle.baseScale.y * scaleBoost,
          1,
        );

        if (lifeT >= 1 || material.opacity <= 0.01) {
          this.disposePlayerDamageNumberParticle(i);
        }
        continue;
      }

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
        this.applyFpsForwardOffsetToPlayerNumberPosition(
          particle.sprite.position,
          false,
        );
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

  private clearPlayerDamageNumberParticles(): void {
    for (let i = this.playerDamageNumberParticles.length - 1; i >= 0; i -= 1) {
      this.disposePlayerDamageNumberParticle(i);
    }
  }

  private updateDamageEffects(deltaSeconds: number): void {
    this.updateGlyphDamageFlashes(deltaSeconds);
    this.updateGlyphDamageShakes(deltaSeconds);
    this.updateDamageParticles(deltaSeconds);
    this.updatePlayerDamageNumberParticles(deltaSeconds);
    const now = Date.now();
    this.prunePendingCharacterDamage(now);
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
    drawFloorGrid: boolean = false,
  ): void {
    const overlay = this.ensureGlyphOverlay(key, baseMaterial);
    const baseColorHex = baseMaterial.color.getHexString();
    const clampedDarken = THREE.MathUtils.clamp(darkenFactor, 0, 1);
    const textureKey = `${baseColorHex}|${glyphChar}|${textColor}|${clampedDarken.toFixed(3)}|${drawFloorGrid ? 1 : 0}`;

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
          256,
          drawFloorGrid,
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

    overlay.material.opacity = 1;

    const fpsWallChamferMask = Number(mesh.userData?.fpsWallChamferMask ?? 0);
    if (isWall && fpsWallChamferMask > 0) {
      // Chamfered FPS wall geometry uses groups: cap (0), straight walls (1), cut corners (2).
      // Tint cut corners with nearby floor-like material to expose a readable diagonal passage.
      const chamferKind =
        typeof mesh.userData?.fpsWallChamferMaterialKind === "string"
          ? (mesh.userData.fpsWallChamferMaterialKind as TileMaterialKind)
          : null;
      const chamferMaterial = chamferKind
        ? this.getMaterialByKind(chamferKind)
        : baseMaterial;
      mesh.material = [overlay.material, baseMaterial, chamferMaterial];
    } else if (isWall) {
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

  private isPassableTileForFpsDiagonal(tileX: number, tileY: number): boolean {
    const mesh = this.tileMap.get(`${tileX},${tileY}`);
    if (!mesh) {
      return false;
    }
    return !Boolean(mesh.userData?.isWall);
  }

  private shouldChamferFpsWallCorner(
    tileX: number,
    tileY: number,
    cornerDx: -1 | 1,
    cornerDy: -1 | 1,
  ): boolean {
    return (
      this.isPassableTileForFpsDiagonal(tileX + cornerDx, tileY) &&
      this.isPassableTileForFpsDiagonal(tileX, tileY + cornerDy) &&
      this.isPassableTileForFpsDiagonal(tileX + cornerDx, tileY + cornerDy)
    );
  }

  private computeFpsWallChamferMask(tileX: number, tileY: number): number {
    let mask = 0;
    // Bit layout: 1 = NW, 2 = NE, 4 = SE, 8 = SW.
    if (this.shouldChamferFpsWallCorner(tileX, tileY, -1, -1)) {
      mask |= 1;
    }
    if (this.shouldChamferFpsWallCorner(tileX, tileY, 1, -1)) {
      mask |= 2;
    }
    if (this.shouldChamferFpsWallCorner(tileX, tileY, 1, 1)) {
      mask |= 4;
    }
    if (this.shouldChamferFpsWallCorner(tileX, tileY, -1, 1)) {
      mask |= 8;
    }
    return mask;
  }

  private getFpsChamferMaterialKindForWall(
    wallMaterialKind: TileMaterialKind,
  ): TileMaterialKind {
    return wallMaterialKind === "dark_wall" ? "dark" : "floor";
  }

  private getFpsWallChamferDisplayBaseHex(materialKind: TileMaterialKind): string {
    const baseColorHex = this.getMaterialByKind(materialKind).color.getHexString();
    const tonedBackground = this.toneColor(baseColorHex, 0.8);
    return this.ensureTextContrast(tonedBackground, "#F4F4F4");
  }

  private getFpsWallChamferFaceMaterial(
    materialKind: TileMaterialKind,
  ): THREE.MeshBasicMaterial {
    const cached = this.fpsWallChamferFaceMaterialCache.get(materialKind);
    if (cached) {
      return cached;
    }

    const displayHex = this.getFpsWallChamferDisplayBaseHex(materialKind);
    const material = new THREE.MeshBasicMaterial({
      color: Number.parseInt(displayHex, 16),
    });
    this.fpsWallChamferFaceMaterialCache.set(materialKind, material);
    return material;
  }

  private getFpsWallChamferFloorMaterial(
    materialKind: TileMaterialKind,
  ): THREE.MeshBasicMaterial {
    const cached = this.fpsWallChamferFloorMaterialCache.get(materialKind);
    if (cached) {
      return cached.material;
    }

    const baseColorHex = this.getMaterialByKind(materialKind).color.getHexString();
    const texture = this.createGlyphTexture(
      baseColorHex,
      " ",
      "#F4F4F4",
      1,
      256,
      true,
    );
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
    });
    this.fpsWallChamferFloorMaterialCache.set(materialKind, { material, texture });
    return material;
  }

  private clearFpsWallChamferMaterialCaches(): void {
    this.fpsWallChamferFaceMaterialCache.forEach((material) => material.dispose());
    this.fpsWallChamferFaceMaterialCache.clear();
    this.fpsWallChamferFloorMaterialCache.forEach(({ material, texture }) => {
      material.dispose();
      texture.dispose();
    });
    this.fpsWallChamferFloorMaterialCache.clear();
  }

  private splitFpsChamferGeometryGroups(
    geometry: THREE.ExtrudeGeometry,
  ): THREE.ExtrudeGeometry {
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    if (!index || !(position instanceof THREE.BufferAttribute)) {
      return geometry;
    }

    const capIndices: number[] = [];
    const wallIndices: number[] = [];
    const chamferIndices: number[] = [];

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i);
      const ib = index.getX(i + 1);
      const ic = index.getX(i + 2);
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac).normalize();

      const absX = Math.abs(normal.x);
      const absY = Math.abs(normal.y);
      const absZ = Math.abs(normal.z);
      const target =
        absZ >= 0.9
          ? capIndices
          : absX > 0.2 && absY > 0.2
            ? chamferIndices
            : wallIndices;
      target.push(ia, ib, ic);
    }

    const ordered = [...capIndices, ...wallIndices, ...chamferIndices];
    geometry.setIndex(ordered);
    geometry.clearGroups();
    let start = 0;
    if (capIndices.length > 0) {
      geometry.addGroup(start, capIndices.length, 0);
      start += capIndices.length;
    }
    if (wallIndices.length > 0) {
      geometry.addGroup(start, wallIndices.length, 1);
      start += wallIndices.length;
    }
    if (chamferIndices.length > 0) {
      geometry.addGroup(start, chamferIndices.length, 2);
    }

    return geometry;
  }

  private createFpsChamferedWallGeometry(mask: number): THREE.ExtrudeGeometry {
    const half = TILE_SIZE / 2;
    const inset = Math.min(this.fpsWallChamferInset, half - 0.01);
    const cutNorthWest = (mask & 1) !== 0;
    const cutNorthEast = (mask & 2) !== 0;
    const cutSouthEast = (mask & 4) !== 0;
    const cutSouthWest = (mask & 8) !== 0;
    const points: THREE.Vector2[] = [];

    if (cutSouthWest) {
      points.push(new THREE.Vector2(-half, -half + inset));
      points.push(new THREE.Vector2(-half + inset, -half));
    } else {
      points.push(new THREE.Vector2(-half, -half));
    }

    if (cutSouthEast) {
      points.push(new THREE.Vector2(half - inset, -half));
      points.push(new THREE.Vector2(half, -half + inset));
    } else {
      points.push(new THREE.Vector2(half, -half));
    }

    if (cutNorthEast) {
      points.push(new THREE.Vector2(half, half - inset));
      points.push(new THREE.Vector2(half - inset, half));
    } else {
      points.push(new THREE.Vector2(half, half));
    }

    if (cutNorthWest) {
      points.push(new THREE.Vector2(-half + inset, half));
      points.push(new THREE.Vector2(-half, half - inset));
    } else {
      points.push(new THREE.Vector2(-half, half));
    }

    const shape = new THREE.Shape(points);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: WALL_HEIGHT,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    });
    this.splitFpsChamferGeometryGroups(geometry);
    // Align with box geometry, which is centered around z=0.
    geometry.translate(0, 0, -WALL_HEIGHT / 2);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private getFpsWallGeometry(mask: number): THREE.BufferGeometry {
    if (mask === 0) {
      return this.wallGeometry;
    }
    const cached = this.fpsWallChamferGeometryCache.get(mask);
    if (cached) {
      return cached;
    }
    const geometry = this.createFpsChamferedWallGeometry(mask);
    this.fpsWallChamferGeometryCache.set(mask, geometry);
    return geometry;
  }

  private getFpsWallChamferFloorGeometry(mask: number): THREE.ShapeGeometry | null {
    if (mask === 0) {
      return null;
    }
    const cached = this.fpsWallChamferFloorGeometryCache.get(mask);
    if (cached) {
      return cached;
    }

    const half = TILE_SIZE / 2;
    const inset = Math.min(this.fpsWallChamferInset, half - 0.01);
    const shapes: THREE.Shape[] = [];
    const addTriangle = (
      p1: THREE.Vector2,
      p2: THREE.Vector2,
      p3: THREE.Vector2,
    ): void => {
      const shape = new THREE.Shape([p1, p2, p3]);
      shape.autoClose = true;
      shapes.push(shape);
    };

    // Bit layout: 1 = NW, 2 = NE, 4 = SE, 8 = SW.
    if (mask & 1) {
      addTriangle(
        new THREE.Vector2(-half, half),
        new THREE.Vector2(-half + inset, half),
        new THREE.Vector2(-half, half - inset),
      );
    }
    if (mask & 2) {
      addTriangle(
        new THREE.Vector2(half, half),
        new THREE.Vector2(half - inset, half),
        new THREE.Vector2(half, half - inset),
      );
    }
    if (mask & 4) {
      addTriangle(
        new THREE.Vector2(half, -half),
        new THREE.Vector2(half - inset, -half),
        new THREE.Vector2(half, -half + inset),
      );
    }
    if (mask & 8) {
      addTriangle(
        new THREE.Vector2(-half, -half),
        new THREE.Vector2(-half + inset, -half),
        new THREE.Vector2(-half, -half + inset),
      );
    }

    const geometry = new THREE.ShapeGeometry(shapes);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.fpsWallChamferFloorGeometryCache.set(mask, geometry);
    return geometry;
  }

  private removeFpsWallChamferFloorMesh(key: string): void {
    const mesh = this.fpsWallChamferFloorMeshes.get(key);
    if (!mesh) {
      return;
    }
    this.scene.remove(mesh);
    this.fpsWallChamferFloorMeshes.delete(key);
  }

  private upsertFpsWallChamferFloorMesh(
    tileX: number,
    tileY: number,
    mask: number,
    materialKind: TileMaterialKind | null,
  ): void {
    const key = `${tileX},${tileY}`;
    if (mask === 0 || !materialKind) {
      this.removeFpsWallChamferFloorMesh(key);
      return;
    }

    const geometry = this.getFpsWallChamferFloorGeometry(mask);
    if (!geometry) {
      this.removeFpsWallChamferFloorMesh(key);
      return;
    }

    let mesh = this.fpsWallChamferFloorMeshes.get(key);
    const material = this.getFpsWallChamferFloorMaterial(materialKind);
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        tileX * TILE_SIZE,
        -tileY * TILE_SIZE,
        this.fpsWallChamferFloorZ,
      );
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 108;
      this.scene.add(mesh);
      this.fpsWallChamferFloorMeshes.set(key, mesh);
      return;
    }

    if (mesh.geometry !== geometry) {
      mesh.geometry = geometry;
    }
    if (mesh.material !== material) {
      mesh.material = material;
    }
    mesh.position.set(
      tileX * TILE_SIZE,
      -tileY * TILE_SIZE,
      this.fpsWallChamferFloorZ,
    );
  }

  private refreshFpsWallChamferGeometryAt(tileX: number, tileY: number): void {
    if (!this.isFpsMode()) {
      return;
    }
    const key = `${tileX},${tileY}`;
    const mesh = this.tileMap.get(key);
    if (!mesh || !mesh.userData?.isWall) {
      this.removeFpsWallChamferFloorMesh(key);
      return;
    }
    const materialKind =
      typeof mesh.userData?.materialKind === "string"
        ? (mesh.userData.materialKind as TileMaterialKind)
        : null;
    if (!materialKind || materialKind === "door") {
      this.removeFpsWallChamferFloorMesh(key);
      return;
    }

    const nextMask = this.computeFpsWallChamferMask(tileX, tileY);
    const nextChamferKind =
      nextMask > 0
        ? this.getFpsChamferMaterialKindForWall(materialKind)
        : null;
    const previousMask = Number(mesh.userData?.fpsWallChamferMask ?? 0);
    const previousChamferKind =
      typeof mesh.userData?.fpsWallChamferMaterialKind === "string"
        ? (mesh.userData.fpsWallChamferMaterialKind as TileMaterialKind)
        : null;
    const nextGeometry = this.getFpsWallGeometry(nextMask);
    const geometryChanged = mesh.geometry !== nextGeometry;
    if (geometryChanged) {
      mesh.geometry = nextGeometry;
    }
    mesh.userData.fpsWallChamferMask = nextMask;
    mesh.userData.fpsWallChamferMaterialKind = nextChamferKind;
    this.upsertFpsWallChamferFloorMesh(
      tileX,
      tileY,
      nextMask,
      nextChamferKind,
    );
    const chamferKindChanged = previousChamferKind !== nextChamferKind;
    if (!geometryChanged && previousMask === nextMask && !chamferKindChanged) {
      return;
    }

    const baseMaterial = this.getMaterialByKind(materialKind);
    const glyphChar =
      typeof mesh.userData?.glyphChar === "string" ? mesh.userData.glyphChar : " ";
    const textColor =
      typeof mesh.userData?.glyphTextColor === "string"
        ? mesh.userData.glyphTextColor
        : "#F4F4F4";
    const darkenFactor =
      typeof mesh.userData?.glyphDarkenFactor === "number"
        ? mesh.userData.glyphDarkenFactor
        : 1;
    this.applyGlyphMaterial(
      key,
      mesh,
      baseMaterial,
      glyphChar,
      textColor,
      true,
      darkenFactor,
      true,
    );
  }

  private refreshFpsWallChamferGeometryNear(tileX: number, tileY: number): void {
    if (!this.isFpsMode()) {
      return;
    }
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        this.refreshFpsWallChamferGeometryAt(tileX + dx, tileY + dy);
      }
    }
  }

  private clearScene(): void {
    this.clearDamageEffects();
    this.lastKnownPlayerHp = null;
    this.lightingCenterInitialized = false;
    this.positionInputModeActive = false;
    this.hasRuntimePositionCursor = false;
    this.clearPositionCursor();
    console.log("🧹 Clearing all tiles and glyph overlays from 3D scene");

    // Clear all tile meshes
    this.tileMap.forEach((mesh, key) => {
      this.scene.remove(mesh);
    });
    this.tileMap.clear();
    this.fpsWallChamferFloorMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
    });
    this.fpsWallChamferFloorMeshes.clear();
    this.clearFpsWallChamferMaterialCaches();

    for (const key of Array.from(this.monsterBillboards.keys())) {
      this.removeMonsterBillboard(key);
    }
    for (const entry of this.monsterBillboardTextures.values()) {
      entry.texture.dispose();
    }
    this.monsterBillboardTextures.clear();
    if (this.entityBlobShadowTexture) {
      this.entityBlobShadowTexture.dispose();
      this.entityBlobShadowTexture = null;
    }
    this.entityBlobShadows.clear();

    if (this.fpsForwardHighlight) {
      this.scene.remove(this.fpsForwardHighlight);
      this.fpsForwardHighlight.geometry.dispose();
      this.fpsForwardHighlightMaterial?.dispose();
      this.fpsForwardHighlight = null;
      this.fpsForwardHighlightMaterial = null;
    }
    if (this.fpsForwardHighlightTexture) {
      this.fpsForwardHighlightTexture.dispose();
      this.fpsForwardHighlightTexture = null;
    }
    this.fpsCurrentAimDirection = null;
    this.fpsAimLinePulseUntilMs = 0;
    this.fpsFireSuppressionUntilMs = 0;
    this.fpsStepCameraActive = false;
    this.fpsStepCameraDurationMs = this.fpsStepCameraBaseDurationMs;
    this.lastManualDirectionalInputAtMs = 0;
    this.fpsAutoMoveDirection = null;
    this.fpsAutoTurnTargetYaw = null;
    this.fpsPointerLockRestorePending = false;
    this.fpsCrosshairContextMenuOpen = false;
    this.fpsCrosshairContextSignature = "";
    this.fpsCrosshairGlanceCache.clear();
    this.fpsCrosshairGlancePending = null;
    this.uiAdapter?.setFpsCrosshairContext(null);

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
    this.activeEffectTileKeys.clear();
    this.pendingTileUpdates.clear();
    this.tileFlushScheduled = false;
    this.resetMinimap();
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
      if (this.fpsCrosshairGlancePending?.sawPositionInput) {
        this.fpsCrosshairGlancePending.positionResolvedAtMs = Date.now();
      }
      this.positionInputModeActive = false;
      this.hasRuntimePositionCursor = false;
      this.clearPositionCursor();
      this.syncFpsPointerLockForUiState(true);
      return;
    }

    if (this.positionInputModeActive === active) {
      return;
    }

    this.positionInputModeActive = true;
    if (this.fpsCrosshairGlancePending) {
      this.fpsCrosshairGlancePending.sawPositionInput = true;
    }
    this.syncFpsPointerLockForUiState(false);

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

  private createMonsterBillboardTexture(
    glyphChar: string,
    textColor: string,
  ): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create monster billboard texture context");
    }

    context.clearRect(0, 0, size, size);
    const symbol = String(glyphChar || "?").trim() || "?";
    context.font = `700 ${Math.floor(size * 0.62)}px "Roboto Condensed", "Segoe UI", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = Math.max(10, Math.floor(size * 0.11));
    context.strokeStyle = "rgba(0, 0, 0, 0.9)";
    context.fillStyle = textColor || "#ffffff";
    context.strokeText(symbol, size / 2, size / 2);
    context.fillText(symbol, size / 2, size / 2);

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

  private ensureEntityBlobShadowTexture(): THREE.CanvasTexture {
    if (this.entityBlobShadowTexture) {
      return this.entityBlobShadowTexture;
    }

    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create entity blob shadow texture context");
    }

    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.08,
      size / 2,
      size / 2,
      size * 0.48,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    gradient.addColorStop(0.72, "rgba(0, 0, 0, 0.16)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.entityBlobShadowTexture = texture;
    return texture;
  }

  private acquireMonsterBillboardTexture(
    key: string,
    factory: () => THREE.CanvasTexture,
  ): THREE.CanvasTexture {
    const cached = this.monsterBillboardTextures.get(key);
    if (cached) {
      cached.refCount += 1;
      return cached.texture;
    }
    const texture = factory();
    this.monsterBillboardTextures.set(key, { texture, refCount: 1 });
    return texture;
  }

  private releaseMonsterBillboardTexture(key: string): void {
    if (!key) {
      return;
    }
    const cached = this.monsterBillboardTextures.get(key);
    if (!cached) {
      return;
    }
    cached.refCount -= 1;
    if (cached.refCount <= 0) {
      cached.texture.dispose();
      this.monsterBillboardTextures.delete(key);
    }
  }

  private removeEntityBlobShadow(key: string): void {
    const shadow = this.entityBlobShadows.get(key);
    if (!shadow) {
      return;
    }
    this.scene.remove(shadow);
    const material = shadow.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.dispose();
    }
    shadow.geometry.dispose();
    this.entityBlobShadows.delete(key);
  }

  private removeMonsterBillboard(key: string): void {
    this.removeEntityBlobShadow(key);
    const sprite = this.monsterBillboards.get(key);
    if (!sprite) {
      return;
    }
    const material = sprite.material;
    if (material instanceof THREE.SpriteMaterial) {
      const textureKey =
        typeof sprite.userData?.textureKey === "string"
          ? sprite.userData.textureKey
          : "";
      if (textureKey) {
        this.releaseMonsterBillboardTexture(textureKey);
      } else if (material.map) {
        material.map.dispose();
      }
      material.dispose();
    }
    this.scene.remove(sprite);
    this.monsterBillboards.delete(key);
  }

  private ensureEntityBlobShadow(
    key: string,
    x: number,
    y: number,
    scaleBase: number,
    isWall: boolean,
  ): void {
    let shadow = this.entityBlobShadows.get(key);
    if (!shadow) {
      const geometry = new THREE.PlaneGeometry(TILE_SIZE * 0.8, TILE_SIZE * 0.8);
      const material = new THREE.MeshBasicMaterial({
        map: this.ensureEntityBlobShadowTexture(),
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      shadow = new THREE.Mesh(geometry, material);
      shadow.renderOrder = 905;
      this.entityBlobShadows.set(key, shadow);
      this.scene.add(shadow);
    }

    shadow.position.set(
      x * TILE_SIZE,
      -y * TILE_SIZE,
      isWall ? WALL_HEIGHT + 0.03 : 0.028,
    );
    shadow.scale.set(scaleBase, scaleBase * 0.82, 1);
  }

  private ensureMonsterBillboard(
    key: string,
    x: number,
    y: number,
    glyphChar: string,
    textColor: string,
    entityType: "monster" | "loot" = "monster",
    isWall: boolean = false,
  ): void {
    const textureKey = `${glyphChar}|${textColor}`;
    const spriteKey = key;
    let sprite = this.monsterBillboards.get(spriteKey);
    if (!sprite) {
      const texture = this.acquireMonsterBillboardTexture(textureKey, () =>
        this.createMonsterBillboardTexture(glyphChar, textColor),
      );
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      sprite = new THREE.Sprite(material);
      sprite.renderOrder = 910;
      sprite.userData.textureKey = textureKey;
      this.monsterBillboards.set(spriteKey, sprite);
      this.scene.add(sprite);
    } else {
      const existingTextureKey =
        typeof sprite.userData?.textureKey === "string"
          ? sprite.userData.textureKey
          : "";
      if (existingTextureKey !== textureKey) {
        const material = sprite.material;
        if (material instanceof THREE.SpriteMaterial) {
          if (existingTextureKey) {
            this.releaseMonsterBillboardTexture(existingTextureKey);
          } else if (material.map) {
            material.map.dispose();
          }
          material.map = this.acquireMonsterBillboardTexture(textureKey, () =>
            this.createMonsterBillboardTexture(glyphChar, textColor),
          );
          material.needsUpdate = true;
          sprite.userData.textureKey = textureKey;
        }
      }
    }

    const elevatedZ =
      entityType === "loot" ? this.elevatedLootZ : this.elevatedMonsterZ;
    sprite.userData.elevatedZ = elevatedZ;
    sprite.position.set(x * TILE_SIZE, -y * TILE_SIZE, elevatedZ);
    const scaleBase = this.isFpsMode()
      ? entityType === "loot"
        ? 0.82
        : 1.08
      : 0.9;
    sprite.scale.set(scaleBase, scaleBase, 1);
    const shadowScale = entityType === "loot" ? 0.58 : 0.76;
    this.ensureEntityBlobShadow(key, x, y, shadowScale, isWall);
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
    const behavior = classifyTileBehavior({
      glyph,
      runtimeChar: char ?? null,
      runtimeColor: typeof color === "number" ? color : null,
      priorTerrain: this.lastKnownTerrain.get(key) ?? null,
    });
    const isMonsterLikeCharacter = this.isMonsterLikeBehavior(behavior);
    const isLootLikeCharacter = this.isLootLikeBehavior(behavior);
    const shouldElevateEntityInFps =
      this.isFpsMode() && (isMonsterLikeCharacter || isLootLikeCharacter);
    const isUndiscovered = this.isUndiscoveredKind(behavior.effective.kind);

    if (isUndiscovered) {
      if (mesh) {
        this.scene.remove(mesh);
        this.tileMap.delete(key);
      }
      this.removeMonsterBillboard(key);
      this.activeEffectTileKeys.delete(key);
      const overlay = this.glyphOverlayMap.get(key);
      if (overlay) {
        this.disposeGlyphOverlay(overlay);
        this.glyphOverlayMap.delete(key);
      }
      this.queueMinimapTileUpdate(x, y, behavior, true);
      this.refreshFpsWallChamferGeometryNear(x, y);
      this.markLightingDirty();
      return;
    }

    if (behavior.isPlayerGlyph && this.isFpsMode()) {
      const oldPos = { ...this.playerPos };
      this.recordPlayerMovement(oldPos.x, oldPos.y, x, y);
      this.playerPos = { x, y };
      this.updateStatus(`Player at (${x}, ${y}) - NetHack 3D`);
      for (const [tileKey, tileMesh] of this.tileMap.entries()) {
        if (!tileMesh.userData?.isPlayerGlyph) {
          continue;
        }
        this.scene.remove(tileMesh);
        this.tileMap.delete(tileKey);
        this.tileStateCache.delete(tileKey);
        const staleOverlay = this.glyphOverlayMap.get(tileKey);
        if (staleOverlay) {
          this.disposeGlyphOverlay(staleOverlay);
          this.glyphOverlayMap.delete(tileKey);
        }
      }
      this.removeMonsterBillboard(key);
      if (mesh && mesh.userData?.isPlayerGlyph) {
        this.scene.remove(mesh);
        this.tileMap.delete(key);
        this.tileStateCache.delete(key);
      }
      const overlay = this.glyphOverlayMap.get(key);
      if (overlay) {
        this.disposeGlyphOverlay(overlay);
        this.glyphOverlayMap.delete(key);
      }
      if (!this.lastKnownTerrain.has(key)) {
        this.requestTileUpdate(x, y);
      }
      this.markLightingDirty();
      return;
    }

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

    let renderBehavior = behavior;
    let tileGlyphChar = behavior.glyphChar;
    let tileTextColor = behavior.textColor;
    if (shouldElevateEntityInFps) {
      const floorSnapshot = this.lastKnownTerrain.get(key);
      if (floorSnapshot) {
        renderBehavior = classifyTileBehavior({
          glyph: floorSnapshot.glyph,
          runtimeChar: floorSnapshot.char ?? null,
          runtimeColor:
            typeof floorSnapshot.color === "number" ? floorSnapshot.color : null,
          priorTerrain: floorSnapshot,
        });
      } else {
        renderBehavior = classifyTileBehavior({
          glyph: 2396,
          runtimeChar: ".",
          runtimeColor: null,
          priorTerrain: null,
        });
      }
      tileGlyphChar = " ";
      tileTextColor = renderBehavior.textColor;
    }

    const material = this.getMaterialByKind(renderBehavior.materialKind);
    const wallChamferMask =
      this.isFpsMode() &&
      renderBehavior.geometryKind === "wall" &&
      renderBehavior.materialKind !== "door"
        ? this.computeFpsWallChamferMask(x, y)
        : 0;
    const wallChamferMaterialKind =
      wallChamferMask > 0
        ? this.getFpsChamferMaterialKindForWall(renderBehavior.materialKind)
        : null;
    const geometry =
      renderBehavior.geometryKind === "wall"
        ? this.getFpsWallGeometry(wallChamferMask)
        : this.floorGeometry;
    const targetZ = renderBehavior.isWall ? WALL_HEIGHT / 2 : 0;

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

    mesh.userData.tileX = x;
    mesh.userData.tileY = y;
    mesh.userData.isWall = renderBehavior.isWall;
    mesh.userData.materialKind = renderBehavior.materialKind;
    mesh.userData.effectKind = behavior.effectKind;
    mesh.userData.disposition = behavior.disposition;
    mesh.userData.isPlayerGlyph = behavior.isPlayerGlyph;
    mesh.userData.isMonsterLikeCharacter = isMonsterLikeCharacter;
    mesh.userData.isLootLikeCharacter = isLootLikeCharacter;
    mesh.userData.isDamageFlashableCharacter =
      this.isDamageFlashableBehavior(behavior);
    mesh.userData.glyphChar = behavior.glyphChar;
    mesh.userData.glyphTextColor = behavior.textColor;
    mesh.userData.glyphDarkenFactor = behavior.darkenFactor;
    mesh.userData.glyphBaseColorHex = material.color.getHexString();
    mesh.userData.fpsWallChamferMask = wallChamferMask;
    mesh.userData.fpsWallChamferMaterialKind = wallChamferMaterialKind;
    const visualScale = this.isFpsMode() ? this.tileVisualScaleFps : 1;
    mesh.scale.set(visualScale, visualScale, visualScale);
    const drawFpsFloorGrid = this.isFpsMode();

    this.applyGlyphMaterial(
      key,
      mesh,
      material,
      tileGlyphChar,
      tileTextColor,
      renderBehavior.isWall,
      renderBehavior.darkenFactor,
      drawFpsFloorGrid,
    );
    if (this.isFpsMode() && isMonsterLikeCharacter) {
      this.ensureMonsterBillboard(
        key,
        x,
        y,
        behavior.glyphChar,
        behavior.textColor,
        "monster",
        renderBehavior.isWall,
      );
    } else if (this.isFpsMode() && isLootLikeCharacter) {
      this.ensureMonsterBillboard(
        key,
        x,
        y,
        behavior.glyphChar,
        behavior.textColor,
        "loot",
        renderBehavior.isWall,
      );
    } else {
      this.removeMonsterBillboard(key);
    }
    if (behavior.effectKind) {
      this.activeEffectTileKeys.add(key);
    } else {
      const hadAnimatedEffect = this.activeEffectTileKeys.delete(key);
      if (hadAnimatedEffect) {
        const overlayMaterial = this.getMeshOverlayMaterial(mesh);
        if (overlayMaterial) {
          overlayMaterial.color.set("#ffffff");
        }
      }
    }
    this.queueMinimapTileUpdate(x, y, behavior, false);
    this.refreshFpsWallChamferGeometryNear(x, y);
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

    if (moved) {
      if (this.isFpsMode()) {
        const nowMs = Date.now();
        const autoMoveLikely =
          nowMs - this.lastManualDirectionalInputAtMs >
          this.fpsAutoMoveDetectionWindowMs;
        const moveDx = Math.sign(toX - fromX);
        const moveDy = Math.sign(toY - fromY);
        this.updateFpsCameraAutoTurnFromMovement(
          moveDx,
          moveDy,
          autoMoveLikely,
        );
        this.beginFpsStepCameraTransition(
          fromX,
          fromY,
          toX,
          toY,
        );
      } else {
        this.recenterCameraOnPlayerIfNeeded();
      }
    }

    const hasRecentMovementInput =
      Date.now() - this.lastMovementInputAtMs <= this.movementUnlockWindowMs;

    if (!this.hasPlayerMovedOnce && moved && hasRecentMovementInput) {
      this.hasPlayerMovedOnce = true;
    }
  }

  private updateFpsCameraAutoTurnFromMovement(
    moveDx: number,
    moveDy: number,
    autoMoveLikely: boolean,
  ): void {
    if (!this.isFpsMode()) {
      return;
    }
    if (!autoMoveLikely) {
      this.fpsAutoMoveDirection = null;
      this.fpsAutoTurnTargetYaw = null;
      return;
    }
    if (moveDx === 0 && moveDy === 0) {
      return;
    }

    if (
      this.fpsAutoMoveDirection &&
      this.fpsAutoMoveDirection.dx === moveDx &&
      this.fpsAutoMoveDirection.dy === moveDy
    ) {
      return;
    }

    // Map movement deltas to the yaw convention used by FPS controls.
    const targetYaw = this.wrapAngle(Math.atan2(-moveDx, moveDy));
    this.fpsAutoTurnTargetYaw = targetYaw;
    this.fpsAutoMoveDirection = { dx: moveDx, dy: moveDy };
  }

  private updateFpsAutoTurnYaw(deltaSeconds: number): void {
    if (!this.isFpsMode() || this.fpsAutoTurnTargetYaw === null) {
      return;
    }

    const delta = this.wrapAngle(this.fpsAutoTurnTargetYaw - this.cameraYaw);
    const maxStep = this.fpsAutoTurnSpeedRadPerSec * Math.max(0, deltaSeconds);
    if (Math.abs(delta) <= maxStep) {
      this.cameraYaw = this.fpsAutoTurnTargetYaw;
      this.fpsAutoTurnTargetYaw = null;
      return;
    }

    this.cameraYaw = this.wrapAngle(
      this.cameraYaw + Math.sign(delta) * maxStep,
    );
  }

  private beginFpsStepCameraTransition(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void {
    if (!this.isFpsMode()) {
      return;
    }

    const fromEyeX = fromX * TILE_SIZE;
    const fromEyeY = -fromY * TILE_SIZE;
    const toEyeX = toX * TILE_SIZE;
    const toEyeY = -toY * TILE_SIZE;

    if (!this.fpsStepCameraActive) {
      this.fpsStepCameraFrom.set(fromEyeX, fromEyeY, this.firstPersonEyeHeight);
    } else {
      const now = performance.now();
      const progress = THREE.MathUtils.clamp(
        (now - this.fpsStepCameraStartMs) / this.fpsStepCameraDurationMs,
        0,
        1,
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      this.fpsStepCameraFrom.lerp(this.fpsStepCameraTo, eased);
    }

    this.fpsStepCameraDurationMs = this.fpsStepCameraBaseDurationMs;

    this.fpsStepCameraTo.set(toEyeX, toEyeY, this.firstPersonEyeHeight);
    this.fpsStepCameraStartMs = performance.now();
    this.fpsStepCameraActive = true;
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
        if (this.clientOptions.damageNumbers) {
          this.spawnPlayerHealNumberParticle(
            this.playerPos.x,
            this.playerPos.y,
            playerHealingGained,
          );
        }
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
    const locationStatusText = [
      this.playerStats.hunger,
      this.playerStats.encumbrance,
    ]
      .filter((value) => Boolean(value))
      .join(" ");

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

      <div class="nh3d-stats-group nh3d-stats-group-core">
        <div class="nh3d-stats-core">St:${this.playerStats.strength}</div>
        <div class="nh3d-stats-core">Dx:${this.playerStats.dexterity}</div>
        <div class="nh3d-stats-core">Co:${this.playerStats.constitution}</div>
        <div class="nh3d-stats-core">In:${this.playerStats.intelligence}</div>
        <div class="nh3d-stats-core">Wi:${this.playerStats.wisdom}</div>
        <div class="nh3d-stats-core">Ch:${this.playerStats.charisma}</div>
        <div class="nh3d-stats-secondary-ac nh3d-stats-mobile-inline-secondary">AC:${this.playerStats.armor}</div>
        <div class="nh3d-stats-secondary-exp nh3d-stats-mobile-inline-secondary">Exp:${this.playerStats.experience}</div>
        <div class="nh3d-stats-secondary-time nh3d-stats-mobile-inline-secondary">T:${this.playerStats.time}</div>
        <div class="nh3d-stats-secondary-gold nh3d-stats-mobile-inline-secondary">$:${this.playerStats.gold}</div>
      </div>

      <div class="nh3d-stats-group nh3d-stats-group-secondary">
        <div class="nh3d-stats-secondary-ac nh3d-stats-desktop-secondary">AC:${this.playerStats.armor}</div>
        <div class="nh3d-stats-secondary-exp nh3d-stats-desktop-secondary">Exp:${this.playerStats.experience}</div>
        <div class="nh3d-stats-secondary-gold nh3d-stats-desktop-secondary">$:${this.playerStats.gold}</div>
        <div class="nh3d-stats-secondary-time nh3d-stats-desktop-secondary">T:${this.playerStats.time}</div>
        <div class="nh3d-stats-hunger nh3d-stats-desktop-secondary">${this.playerStats.hunger}${
          this.playerStats.encumbrance ? " " + this.playerStats.encumbrance : ""
        }</div>
      </div>

      <div class="nh3d-stats-location">
        <div class="nh3d-stats-dungeon">${this.playerStats.dungeon} ${
          this.playerStats.dlevel
        }${
          locationStatusText
            ? `<span class="nh3d-stats-mobile-location-status">${locationStatusText}</span>`
            : ""
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
    this.syncFpsPointerLockForUiState(false);

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
    this.syncFpsPointerLockForUiState(this.isFpsMode());

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
    directionDialog.classList.remove("nh3d-dialog-direction-fps");

    // Add question text
    const questionText = document.createElement("div");
    questionText.className = "nh3d-direction-text";
    questionText.textContent = question;
    directionDialog.appendChild(questionText);

    if (this.isFpsMode()) {
      const hintText = document.createElement("div");
      hintText.className = "nh3d-direction-fps-hint";
      hintText.textContent =
        "Look to aim. Left-click or W confirms. S targets self. A/D or right-click cancels.";
      directionDialog.appendChild(hintText);
      directionDialog.classList.add("nh3d-dialog-direction-fps");
      directionDialog.classList.add("is-visible");
      return;
    }

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
        if (typeof dir.key === "string" && dir.key.length > 0) {
          this.sendInput(dir.key);
        }
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
    this.clearFpsFireSuppression();
    if (this.uiAdapter) {
      this.uiAdapter.setDirectionQuestion(null);
      this.syncFpsPointerLockForUiState(true);
      return;
    }

    const directionDialog = document.getElementById("direction-dialog");
    if (directionDialog) {
      directionDialog.classList.remove("is-visible");
    }
    this.syncFpsPointerLockForUiState(true);
  }

  private showInfoMenuDialog(title: string, lines: string[]): void {
    this.isInfoDialogVisible = true;
    this.syncFpsPointerLockForUiState(false);
    const normalizedLines = this.normalizeInfoMenuLines(lines);
    if (this.uiAdapter) {
      this.uiAdapter.setInfoMenu({
        title: title || "NetHack Information",
        lines: normalizedLines,
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
      normalizedLines.length > 0 ? normalizedLines.join("\n") : "(No details)";
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
      this.syncFpsPointerLockForUiState(true);
      return;
    }

    const infoDialog = document.getElementById("info-menu-dialog");
    if (infoDialog) {
      infoDialog.classList.remove("is-visible");
    }
    this.syncFpsPointerLockForUiState(true);
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
    this.syncFpsPointerLockForUiState(false);
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
      this.syncFpsPointerLockForUiState(true);
      return;
    }

    const inventoryDialog = document.getElementById("inventory-dialog");
    if (inventoryDialog) {
      inventoryDialog.classList.remove("is-visible");
    }
    // Clear any pending inventory dialog flag
    this.pendingInventoryDialog = false;
    this.syncFpsPointerLockForUiState(true);
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
      this.syncFpsPointerLockForUiState(false);
      this.uiAdapter.setPositionRequest(text);
      this.positionHideTimerId = window.setTimeout(() => {
        this.uiAdapter?.setPositionRequest(null);
        this.syncFpsPointerLockForUiState(true);
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
    this.syncFpsPointerLockForUiState(false);

    // Auto-hide after 3 seconds
    this.positionHideTimerId = window.setTimeout(() => {
      if (posDialog) {
        posDialog.classList.remove("is-visible");
      }
      this.syncFpsPointerLockForUiState(true);
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
    this.syncFpsPointerLockForUiState(false);

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
    this.syncFpsPointerLockForUiState(true);
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
      this.syncFpsPointerLockForUiState(true);
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
    this.syncFpsPointerLockForUiState(true);
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

  public runInventoryItemAction(
    actionId: string,
    itemAccelerator: string,
  ): void {
    const normalizedActionId = String(actionId || "")
      .trim()
      .toLowerCase();
    const accelerator = String(itemAccelerator || "").trim();
    if (!this.session || !normalizedActionId || accelerator.length !== 1) {
      return;
    }

    const commandMap: Record<string, string> = {
      apply: "a",
      drop: "d",
      eat: "e",
      quaff: "q",
      read: "r",
      throw: "t",
      wield: "w",
      wear: "W",
      "take-off": "T",
      "put-on": "P",
      remove: "R",
      zap: "z",
      cast: "Z",
    };

    const commandKey = commandMap[normalizedActionId];
    if (!commandKey) {
      return;
    }

    this.hideInfoMenuDialog();
    this.hideInventoryDialog();
    this.sendInputSequence([
      `${this.inventoryContextSelectionPrefix}${accelerator}`,
      commandKey,
    ]);
  }

  public dismissFpsCrosshairContextMenu(): void {
    this.closeFpsCrosshairContextMenu(true);
  }

  public runQuickAction(actionId: string): void {
    const normalizedActionId = String(actionId || "")
      .trim()
      .toLowerCase();
    if (!normalizedActionId || !this.session) {
      return;
    }

    this.closeFpsCrosshairContextMenu(true);

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
        this.armFpsFireSuppression();
        this.sendInput("o");
        return;
      case "close":
        this.armFpsFireSuppression();
        this.sendInput("c");
        return;
      case "ascend":
        this.sendInput("<");
        return;
      case "descend":
        this.sendInput(">");
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

    this.closeFpsCrosshairContextMenu(true);

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

    if (normalizedCommandText === "kick") {
      this.armFpsFireSuppression();
    }

    const sequence = ["#", ...normalizedCommandText.split(""), "Enter"];
    this.sendInputSequence(sequence);
  }

  public setClientOptions(options: Nh3dClientOptions): void {
    this.applyClientOptions(options);
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

    if (this.isMovementInput(input)) {
      this.lastManualDirectionalInputAtMs = Date.now();
      this.fpsAutoMoveDirection = null;
      this.fpsAutoTurnTargetYaw = null;
    }

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

    const nowMs = Date.now();
    for (const input of inputs) {
      if (this.isMovementInput(input)) {
        this.lastManualDirectionalInputAtMs = nowMs;
        this.fpsAutoMoveDirection = null;
        this.fpsAutoTurnTargetYaw = null;
        break;
      }
    }

    this.session.sendInputSequence(inputs);
  }

  private sendForcedDirectionalInput(direction: string): void {
    if (!direction) {
      return;
    }
    this.updateDirectionalAttackContext(direction);
    this.sendInputSequence(["5", direction]);
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
    this.clearFpsTouchGestures();
    this.exitMetaCommandMode();
    this.closeFpsCrosshairContextMenu(false);
    this.stopMinimapDrag();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    this.fpsPointerLockActive = false;
    this.fpsPointerLockRestorePending = false;
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

  private isFpsMode(): boolean {
    return this.playMode === "fps";
  }

  private getDirectionInputFromMapDelta(dx: number, dy: number): string | null {
    if (dx === 0 && dy === 0) {
      return null;
    }
    if (this.numberPadModeEnabled) {
      if (dx === 0 && dy < 0) return "8";
      if (dx === 0 && dy > 0) return "2";
      if (dx < 0 && dy === 0) return "4";
      if (dx > 0 && dy === 0) return "6";
      if (dx < 0 && dy < 0) return "7";
      if (dx > 0 && dy < 0) return "9";
      if (dx < 0 && dy > 0) return "1";
      if (dx > 0 && dy > 0) return "3";
      return null;
    }

    if (dx === 0 && dy < 0) return "k";
    if (dx === 0 && dy > 0) return "j";
    if (dx < 0 && dy === 0) return "h";
    if (dx > 0 && dy === 0) return "l";
    if (dx < 0 && dy < 0) return "y";
    if (dx > 0 && dy < 0) return "u";
    if (dx < 0 && dy > 0) return "b";
    if (dx > 0 && dy > 0) return "n";
    return null;
  }

  private getFpsAimDirectionFromCamera(): AimDirection | null {
    // FPS movement/fire should follow yaw, even when pitch is looking up/down.
    const worldX = -Math.sin(this.cameraYaw);
    const worldY = -Math.cos(this.cameraYaw);
    let mapDx = Math.round(worldX);
    let mapDy = Math.round(-worldY);
    if (mapDx === 0 && mapDy === 0) {
      if (Math.abs(worldX) >= Math.abs(worldY)) {
        mapDx = worldX >= 0 ? 1 : -1;
      } else {
        mapDy = -worldY >= 0 ? 1 : -1;
      }
    }
    const input = this.getDirectionInputFromMapDelta(mapDx, mapDy);
    if (!input) {
      return null;
    }
    return {
      dx: mapDx,
      dy: mapDy,
      input,
    };
  }

  private rotateAimDirectionLeft(aim: AimDirection): AimDirection {
    const dx = aim.dy;
    const dy = -aim.dx;
    return {
      dx,
      dy,
      input: this.getDirectionInputFromMapDelta(dx, dy) ?? aim.input,
    };
  }

  private rotateAimDirectionRight(aim: AimDirection): AimDirection {
    const dx = -aim.dy;
    const dy = aim.dx;
    return {
      dx,
      dy,
      input: this.getDirectionInputFromMapDelta(dx, dy) ?? aim.input,
    };
  }

  private tryResolveFpsMovementInput(key: string): string | null {
    const lower = key.toLowerCase();
    const aim = this.getFpsAimDirectionFromCamera();
    if (!aim) {
      return null;
    }

    switch (lower) {
      case "w":
        return aim.input;
      case "s": {
        const backward = this.getDirectionInputFromMapDelta(-aim.dx, -aim.dy);
        return backward;
      }
      case "a":
        return this.rotateAimDirectionLeft(aim).input;
      case "d":
        return this.rotateAimDirectionRight(aim).input;
      default:
        return null;
    }
  }

  private fireInCurrentAimDirection(): void {
    this.armFpsFireSuppression();
    this.fpsAimLinePulseUntilMs = Date.now() + 220;
    // In FPS mode, fire should first ask for direction; the direction prompt
    // confirmation path (left-click/W/etc.) supplies the actual direction input.
    this.sendInput("f");
  }

  private armFpsFireSuppression(): void {
    if (!this.isFpsMode()) {
      return;
    }
    this.fpsFireSuppressionUntilMs =
      Date.now() + this.fpsFireSuppressionDurationMs;
  }

  private clearFpsFireSuppression(): void {
    this.fpsFireSuppressionUntilMs = 0;
  }

  private isFpsFireSuppressed(): boolean {
    return this.isFpsMode() && Date.now() < this.fpsFireSuppressionUntilMs;
  }

  private getFpsDirectionQuestionInputFromAim(): string | null {
    const aim = this.getFpsAimDirectionFromCamera();
    return aim?.input ?? null;
  }

  private tryResolveFpsDirectionQuestionInput(event: KeyboardEvent): string | null {
    const lowerKey = event.key.toLowerCase();
    if (lowerKey === "a" || lowerKey === "d") {
      return "Escape";
    }
    if (lowerKey === "s") {
      return "s";
    }
    if (lowerKey === "w") {
      return this.getFpsDirectionQuestionInputFromAim();
    }
    if (event.key === "<" || event.key === ",") {
      return "<";
    }
    if (event.key === ">") {
      return ">";
    }
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "Spacebar" ||
      event.key === "Space"
    ) {
      return this.getFpsDirectionQuestionInputFromAim();
    }
    return null;
  }

  private handlePointerLockChange(): void {
    this.fpsPointerLockActive =
      document.pointerLockElement === this.renderer.domElement;
    if (this.fpsPointerLockActive) {
      this.fpsPointerLockRestorePending = false;
    }
    this.syncFpsPointerLockForUiState(false);
  }

  private isFpsPointerLockBlockedByUi(): boolean {
    const allowDirectionLook = this.isFpsMode() && this.isInDirectionQuestion;
    const modalBlocksPointerLock =
      this.isAnyModalVisible() &&
      !(allowDirectionLook && this.isOnlyDirectionDialogVisible());
    return (
      (this.isInQuestion && !allowDirectionLook) ||
      (this.isInDirectionQuestion && !allowDirectionLook) ||
      this.isTextInputActive ||
      this.positionInputModeActive ||
      this.metaCommandModeActive ||
      this.fpsCrosshairContextMenuOpen ||
      this.isInventoryDialogOpen() ||
      this.isInfoDialogOpen() ||
      modalBlocksPointerLock
    );
  }

  private isOnlyDirectionDialogVisible(): boolean {
    const visibleDialogs = Array.from(
      document.querySelectorAll(".nh3d-dialog.is-visible"),
    );
    if (visibleDialogs.length === 0) {
      return false;
    }
    return visibleDialogs.every(
      (dialog) => (dialog as HTMLElement).id === "direction-dialog",
    );
  }

  private syncFpsPointerLockForUiState(tryAcquire: boolean): void {
    if (!this.isFpsMode()) {
      return;
    }

    const isRendererLocked =
      document.pointerLockElement === this.renderer.domElement;
    if (this.isFpsPointerLockBlockedByUi()) {
      if (isRendererLocked || this.fpsPointerLockActive) {
        this.fpsPointerLockRestorePending = true;
      }
      if (isRendererLocked) {
        document.exitPointerLock?.();
      }
      this.fpsPointerLockActive = false;
      return;
    }

    if (
      (tryAcquire || this.fpsPointerLockRestorePending) &&
      !isRendererLocked &&
      !this.fpsPointerLockActive
    ) {
      this.fpsPointerLockRestorePending = false;
      this.renderer.domElement.requestPointerLock?.();
    }
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
        !this.isFpsMode() &&
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

        case "l":
          if (event.shiftKey) {
            event.preventDefault();
            const next = toggleLoggingEnabled();
            if (this.session) {
              this.session.setLoggingEnabled(next);
            }
            logWithOriginal(
              `[NetHack 3D] Logging ${next ? "enabled" : "disabled"}`,
            );
            return;
          }
          break;
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

    if (
      this.isFpsMode() &&
      !this.isInQuestion &&
      !this.isInDirectionQuestion &&
      !this.positionInputModeActive &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const fpsMoveInput = this.tryResolveFpsMovementInput(event.key);
      if (fpsMoveInput) {
        event.preventDefault();
        if (event.shiftKey) {
          if (event.repeat) {
            return;
          }
          this.sendForcedDirectionalInput(fpsMoveInput);
          return;
        }
        this.sendInput(fpsMoveInput);
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        this.sendInput("s");
        return;
      }
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
        if (this.isFpsMode()) {
          const keyToSend = this.tryResolveFpsDirectionQuestionInput(event);
          if (keyToSend) {
            event.preventDefault();
            this.sendInput(keyToSend);
            this.hideDirectionQuestion();
          }
          return;
        }

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
    if (this.isFpsMode()) {
      const targetEyeX = this.playerPos.x * TILE_SIZE;
      const targetEyeY = -this.playerPos.y * TILE_SIZE;
      let eyeX = targetEyeX;
      let eyeY = targetEyeY;
      const eyeZ = this.firstPersonEyeHeight;

      this.updateFpsAutoTurnYaw(deltaSeconds);

      if (this.fpsStepCameraActive) {
        const progress = THREE.MathUtils.clamp(
          (performance.now() - this.fpsStepCameraStartMs) /
            this.fpsStepCameraDurationMs,
          0,
          1,
        );
        const eased = 1 - Math.pow(1 - progress, 3);
        eyeX = THREE.MathUtils.lerp(
          this.fpsStepCameraFrom.x,
          this.fpsStepCameraTo.x,
          eased,
        );
        eyeY = THREE.MathUtils.lerp(
          this.fpsStepCameraFrom.y,
          this.fpsStepCameraTo.y,
          eased,
        );
        if (progress >= 1) {
          this.fpsStepCameraActive = false;
          this.fpsStepCameraFrom.set(targetEyeX, targetEyeY, eyeZ);
          this.fpsStepCameraTo.set(targetEyeX, targetEyeY, eyeZ);
          if (this.pendingTileUpdates.size > 0 && !this.tileFlushScheduled) {
            this.tileFlushScheduled = true;
            requestAnimationFrame(() => this.flushPendingTileUpdates());
          }
        }
      }

      const forwardX = -Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch);
      const forwardY = -Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch);
      const forwardZ = Math.sin(this.cameraPitch);

      this.camera.position.set(eyeX, eyeY, eyeZ);
      this.camera.lookAt(
        eyeX + forwardX,
        eyeY + forwardY,
        eyeZ + forwardZ,
      );
      return;
    }

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

  private ensureFpsForwardHighlightTexture(): THREE.CanvasTexture {
    if (this.fpsForwardHighlightTexture) {
      return this.fpsForwardHighlightTexture;
    }

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create FPS forward highlight texture context");
    }

    context.clearRect(0, 0, size, size);
    const imageData = context.createImageData(size, size);
    const data = imageData.data;
    const center = size * 0.5;
    const smoothstep = (edge0: number, edge1: number, x: number): number => {
      const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    };

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const edgeDistance = Math.min(px, py, size - px, size - py);
        const edgeNorm = edgeDistance / center;

        const outerFeather = smoothstep(0.0, 0.2, edgeNorm);
        const inwardFade = 1 - smoothstep(0.16, 0.84, edgeNorm);
        // Slightly lower intensity than previous square profile.
        const alpha = THREE.MathUtils.clamp(
          outerFeather * inwardFade * 0.58,
          0,
          1,
        );

        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 238;
        data[i + 2] = 118;
        data[i + 3] = Math.round(alpha * 255);
      }
    }

    context.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.fpsForwardHighlightTexture = texture;
    return texture;
  }

  private ensureFpsAimVisuals(): void {
    if (this.fpsForwardHighlight) {
      return;
    }

    if (!this.fpsForwardHighlight) {
      const geometry = new THREE.PlaneGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9);
      const material = new THREE.MeshBasicMaterial({
        map: this.ensureFpsForwardHighlightTexture(),
        color: 0xfff6a8,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 980;
      this.scene.add(mesh);
      this.fpsForwardHighlight = mesh;
      this.fpsForwardHighlightMaterial = material;
    }
  }

  private updateFpsAimVisuals(timeMs: number): void {
    if (!this.isFpsMode()) {
      if (this.fpsForwardHighlight) {
        this.fpsForwardHighlight.visible = false;
      }
      this.fpsCurrentAimDirection = null;
      return;
    }

    if (this.isAnyModalVisible() || this.isInQuestion || this.isInDirectionQuestion) {
      if (this.fpsForwardHighlight) {
        this.fpsForwardHighlight.visible = false;
      }
      return;
    }

    const aim = this.getFpsAimDirectionFromCamera();
    if (!aim) {
      return;
    }
    this.fpsCurrentAimDirection = aim;
    this.ensureFpsAimVisuals();

    const targetX = this.playerPos.x + aim.dx;
    const targetY = this.playerPos.y + aim.dy;
    const targetKey = `${targetX},${targetY}`;
    const targetTile = this.tileMap.get(targetKey);
    const targetZ = targetTile?.userData?.isWall ? WALL_HEIGHT + 0.02 : 0.03;

    if (this.fpsForwardHighlight) {
      this.fpsForwardHighlight.position.set(
        targetX * TILE_SIZE,
        -targetY * TILE_SIZE,
        targetZ,
      );
      this.fpsForwardHighlight.visible = true;
      if (this.fpsForwardHighlightMaterial) {
        const pulse = timeMs <= this.fpsAimLinePulseUntilMs ? 1 : 0.45;
        this.fpsForwardHighlightMaterial.opacity = 0.2 + pulse * 0.32;
      }
    }

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

  private clearFpsCrosshairContextMenu(): void {
    if (!this.uiAdapter) {
      this.fpsCrosshairContextSignature = "";
      return;
    }
    if (!this.fpsCrosshairContextSignature) {
      return;
    }
    this.fpsCrosshairContextSignature = "";
    this.uiAdapter.setFpsCrosshairContext(null);
  }

  private openFpsCrosshairContextMenu(): void {
    if (!this.isFpsMode()) {
      return;
    }
    this.fpsCrosshairGlanceCache.clear();
    this.fpsCrosshairGlancePending = null;
    this.fpsCrosshairContextMenuOpen = true;
    this.syncFpsPointerLockForUiState(false);
    this.updateFpsCrosshairContextMenu();
  }

  private closeFpsCrosshairContextMenu(restorePointerLock: boolean): void {
    if (!this.fpsCrosshairContextMenuOpen && !this.fpsCrosshairContextSignature) {
      return;
    }
    this.fpsCrosshairContextMenuOpen = false;
    this.fpsCrosshairGlancePending = null;
    this.clearFpsCrosshairContextMenu();
    if (restorePointerLock) {
      this.syncFpsPointerLockForUiState(true);
    }
  }

  private getTileUnderFpsCrosshair(): {
    key: string;
    x: number;
    y: number;
    mesh: THREE.Mesh;
  } | null {
    const tiles = Array.from(this.tileMap.values());
    if (tiles.length === 0) {
      return null;
    }

    this.pointerNdc.set(0, 0);
    this.pointerRaycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersections = this.pointerRaycaster.intersectObjects(tiles, false);
    if (intersections.length === 0) {
      return null;
    }

    const hit = intersections[0]?.object;
    if (!(hit instanceof THREE.Mesh)) {
      return null;
    }

    const x = Math.round(hit.position.x / TILE_SIZE);
    const y = Math.round(-hit.position.y / TILE_SIZE);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      key: `${x},${y}`,
      x,
      y,
      mesh: hit,
    };
  }

  private sanitizeFpsCrosshairGlanceText(rawText: string): string {
    return String(rawText || "")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private shouldIgnoreFpsCrosshairGlanceText(text: string): boolean {
    const normalized = text.toLowerCase();
    if (!normalized) {
      return true;
    }
    if (
      normalized.startsWith("pick ") &&
      normalized.includes("monster, object or location")
    ) {
      return true;
    }
    if (normalized.startsWith("please move the cursor")) {
      return true;
    }
    if (normalized.includes("what do you want to look at")) {
      return true;
    }
    return false;
  }

  private inferFpsCrosshairTargetHintFromGlanceText(
    text: string,
  ): FpsCrosshairTargetHint {
    const normalized = text.toLowerCase();

    if (
      /(?:staircase|stairs|stairway|ladder).*\bup\b/.test(normalized) ||
      /\bup\b.*(?:staircase|stairs|stairway|ladder)/.test(normalized)
    ) {
      return "stairs_up";
    }
    if (
      /(?:staircase|stairs|stairway|ladder).*\bdown\b/.test(normalized) ||
      /\bdown\b.*(?:staircase|stairs|stairway|ladder)/.test(normalized)
    ) {
      return "stairs_down";
    }
    if (/\bdoor\b/.test(normalized)) {
      return "door";
    }
    if (/\btrap\b/.test(normalized)) {
      return "trap";
    }
    if (/\b(fountain|sink|pool|water|moat|lava)\b/.test(normalized)) {
      return "water";
    }
    if (/\b(altar|throne|grave|headstone|tree|bars|boulder|statue)\b/.test(normalized)) {
      return "feature";
    }
    if (/\b(wall|rock)\b/.test(normalized)) {
      return "wall";
    }
    if (
      /\b(you see here|there is|lying here|on the floor)\b/.test(normalized) ||
      /\b(gold|coin|corpse|potion|scroll|ring|wand|spellbook|weapon|armor|amulet|gem|food)\b/.test(
        normalized,
      )
    ) {
      return "loot";
    }
    if (
      /\b(peaceful|hostile|tame|asleep|sleeping|fleeing)\b/.test(normalized) ||
      /\bis here\b/.test(normalized)
    ) {
      return "monster";
    }
    if (/\b(floor|room|corridor|passage)\b/.test(normalized)) {
      return "floor";
    }
    if (normalized.includes("never heard")) {
      return "unknown";
    }
    return "unknown";
  }

  private captureFpsCrosshairGlanceMessage(messageLike: unknown): void {
    if (!this.fpsCrosshairGlancePending || typeof messageLike !== "string") {
      return;
    }

    const text = this.sanitizeFpsCrosshairGlanceText(messageLike);
    if (!text || this.shouldIgnoreFpsCrosshairGlanceText(text)) {
      return;
    }

    const pending = this.fpsCrosshairGlancePending;
    const hint = this.inferFpsCrosshairTargetHintFromGlanceText(text);
    this.fpsCrosshairGlanceCache.set(pending.tileKey, {
      hint,
      sourceText: text,
      updatedAtMs: Date.now(),
    });
    this.fpsCrosshairGlancePending = null;
    this.fpsCrosshairContextSignature = "";
  }

  private expireFpsCrosshairGlanceState(nowMs: number): void {
    const staleCacheKeys: string[] = [];
    for (const [key, entry] of this.fpsCrosshairGlanceCache.entries()) {
      if (nowMs - entry.updatedAtMs > this.fpsCrosshairGlanceCacheTtlMs * 2) {
        staleCacheKeys.push(key);
      }
    }
    for (const key of staleCacheKeys) {
      this.fpsCrosshairGlanceCache.delete(key);
    }

    const pending = this.fpsCrosshairGlancePending;
    if (!pending) {
      return;
    }

    const ageMs = nowMs - pending.startedAtMs;
    const postResolveAgeMs =
      pending.positionResolvedAtMs === null
        ? 0
        : nowMs - pending.positionResolvedAtMs;
    const shouldExpireByTimeout = ageMs > this.fpsCrosshairGlanceTimeoutMs;
    const shouldExpireAfterResolve =
      pending.positionResolvedAtMs !== null &&
      postResolveAgeMs > this.fpsCrosshairGlancePostResolveGraceMs;
    if (!shouldExpireByTimeout && !shouldExpireAfterResolve) {
      return;
    }

    if (!this.fpsCrosshairGlanceCache.has(pending.tileKey)) {
      this.fpsCrosshairGlanceCache.set(pending.tileKey, {
        hint: "unknown",
        sourceText: "",
        updatedAtMs: nowMs,
      });
    }
    this.fpsCrosshairGlancePending = null;
    this.fpsCrosshairContextSignature = "";
  }

  private getCachedFpsCrosshairTargetHint(
    tileKey: string,
    nowMs: number,
  ): FpsCrosshairTargetHint | null {
    const cached = this.fpsCrosshairGlanceCache.get(tileKey);
    if (!cached) {
      return null;
    }
    if (nowMs - cached.updatedAtMs > this.fpsCrosshairGlanceCacheTtlMs) {
      this.fpsCrosshairGlanceCache.delete(tileKey);
      return null;
    }
    return cached.hint;
  }

  private startFpsCrosshairGlanceProbe(
    target: { key: string; x: number; y: number },
    nowMs: number,
  ): void {
    if (!this.session || !this.isFpsMode() || !this.fpsCrosshairContextMenuOpen) {
      return;
    }
    if (
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.isTextInputActive ||
      this.metaCommandModeActive ||
      this.isInventoryDialogOpen() ||
      this.isInfoDialogOpen()
    ) {
      return;
    }

    const cached = this.getCachedFpsCrosshairTargetHint(target.key, nowMs);
    if (cached !== null) {
      return;
    }

    if (this.fpsCrosshairGlancePending) {
      const pendingAgeMs = nowMs - this.fpsCrosshairGlancePending.startedAtMs;
      if (this.fpsCrosshairGlancePending.tileKey === target.key) {
        return;
      }
      if (pendingAgeMs <= this.fpsCrosshairGlanceTimeoutMs) {
        return;
      }
      this.fpsCrosshairGlancePending = null;
    }

    this.fpsCrosshairGlancePending = {
      requestId: ++this.fpsCrosshairGlanceRequestSequence,
      tileKey: target.key,
      tileX: target.x,
      tileY: target.y,
      startedAtMs: nowMs,
      sawPositionInput: false,
      positionResolvedAtMs: null,
    };

    this.sendInputSequence(["#", "g", "l", "a", "n", "c", "e", "Enter"]);
    this.sendMouseInput(target.x, target.y, 0);
  }

  private getFpsCrosshairHintFromTile(
    key: string,
    mesh: THREE.Mesh,
  ): FpsCrosshairTargetHint {
    if (
      Boolean(mesh.userData?.isMonsterLikeCharacter) ||
      this.monsterBillboards.has(key)
    ) {
      return "monster";
    }
    if (Boolean(mesh.userData?.isLootLikeCharacter)) {
      return "loot";
    }
    const materialKind =
      typeof mesh.userData?.materialKind === "string"
        ? mesh.userData.materialKind
        : "";
    if (materialKind === "door") {
      return "door";
    }
    if (materialKind === "stairs_up") {
      return "stairs_up";
    }
    if (materialKind === "stairs_down") {
      return "stairs_down";
    }
    if (materialKind === "water" || materialKind === "fountain") {
      return "water";
    }
    if (materialKind === "trap") {
      return "trap";
    }
    if (materialKind === "feature") {
      return "feature";
    }
    if (Boolean(mesh.userData?.isWall)) {
      return "wall";
    }
    return "floor";
  }

  private getFpsCrosshairActionsForTile(
    key: string,
    mesh: THREE.Mesh,
    glanceHint: FpsCrosshairTargetHint | null = null,
  ): FpsContextAction[] {
    const actions: FpsContextAction[] = [];
    const addQuickAction = (id: string, label: string, value: string = id) => {
      if (actions.some((action) => action.id === id && action.kind === "quick")) {
        return;
      }
      actions.push({
        id,
        label,
        kind: "quick",
        value,
      });
    };
    const addExtendedAction = (
      id: string,
      label: string,
      value: string = id,
    ) => {
      if (
        actions.some((action) => action.id === id && action.kind === "extended")
      ) {
        return;
      }
      actions.push({
        id,
        label,
        kind: "extended",
        value,
      });
    };

    let isMonster =
      Boolean(mesh.userData?.isMonsterLikeCharacter) ||
      this.monsterBillboards.has(key);
    let isLoot = Boolean(mesh.userData?.isLootLikeCharacter);
    let isWall = Boolean(mesh.userData?.isWall);
    let materialKind =
      typeof mesh.userData?.materialKind === "string"
        ? mesh.userData.materialKind
        : "";
    if (glanceHint) {
      switch (glanceHint) {
        case "monster":
          isMonster = true;
          isLoot = false;
          break;
        case "loot":
          isLoot = true;
          break;
        case "door":
          materialKind = "door";
          isWall = false;
          break;
        case "stairs_up":
          materialKind = "stairs_up";
          isWall = false;
          break;
        case "stairs_down":
          materialKind = "stairs_down";
          isWall = false;
          break;
        case "water":
          materialKind = "water";
          isWall = false;
          break;
        case "trap":
          materialKind = "trap";
          isWall = false;
          break;
        case "feature":
          materialKind = "feature";
          isWall = false;
          break;
        case "wall":
          isWall = true;
          break;
        case "floor":
          isWall = false;
          break;
        default:
          break;
      }
    }
    const isStairsUp = materialKind === "stairs_up";
    const isStairsDown = materialKind === "stairs_down";

    if (isStairsUp) {
      addQuickAction("ascend", "Ascend (<)");
    }
    if (isStairsDown) {
      addQuickAction("descend", "Descend (>)");
    }

    if (isMonster) {
      addQuickAction("look", "Look");
      addQuickAction("search", "Search");
      return actions;
    }

    if (isLoot) {
      addQuickAction("pickup", "Pick Up");
      addQuickAction("loot", "Loot");
      addQuickAction("look", "Look");
      return actions;
    }

    if (materialKind === "door") {
      addQuickAction("open", "Open");
      addQuickAction("close", "Close");
      addExtendedAction("kick", "Kick");
      addQuickAction("search", "Search");
      addQuickAction("look", "Look");
      return actions;
    }

    if (isStairsUp || isStairsDown) {
      addQuickAction("look", "Look");
      addQuickAction("search", "Search");
      addQuickAction("pickup", "Pick Up");
      return actions;
    }

    if (
      materialKind === "water" ||
      materialKind === "fountain" ||
      materialKind === "trap" ||
      materialKind === "feature"
    ) {
      addQuickAction("look", "Look");
      addQuickAction("search", "Search");
      return actions;
    }

    if (isWall) {
      addQuickAction("search", "Search");
      addQuickAction("open", "Open");
      addQuickAction("look", "Look");
      return actions;
    }

    addQuickAction("search", "Search");
    addQuickAction("pickup", "Pick Up");
    addQuickAction("loot", "Loot");
    addQuickAction("look", "Look");
    return actions;
  }

  private getFpsCrosshairTitle(
    key: string,
    mesh: THREE.Mesh,
    glanceHint: FpsCrosshairTargetHint | null = null,
  ): string {
    const hint = glanceHint ?? this.getFpsCrosshairHintFromTile(key, mesh);
    switch (hint) {
      case "monster":
        return "Target: monster";
      case "loot":
        return "Target: loot";
      case "door":
        return "Target: door";
      case "stairs_up":
        return "Target: stairs up";
      case "stairs_down":
        return "Target: stairs down";
      case "wall":
        return "Target: wall";
      case "water":
        return "Target: water";
      case "trap":
        return "Target: trap";
      case "feature":
        return "Target: feature";
      default:
        return "Target: tile";
    }
  }

  private updateFpsCrosshairContextMenu(): void {
    if (!this.uiAdapter) {
      return;
    }
    if (!this.isFpsMode() || !this.fpsCrosshairContextMenuOpen) {
      this.clearFpsCrosshairContextMenu();
      return;
    }

    const nowMs = Date.now();
    this.expireFpsCrosshairGlanceState(nowMs);
    const glanceProbePositionInputActive =
      this.positionInputModeActive && this.fpsCrosshairGlancePending !== null;

    if (
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.isTextInputActive ||
      (this.positionInputModeActive && !glanceProbePositionInputActive) ||
      this.metaCommandModeActive ||
      this.isInventoryDialogOpen() ||
      this.isInfoDialogOpen() ||
      this.isAnyModalVisible()
    ) {
      this.clearFpsCrosshairContextMenu();
      return;
    }

    const target = this.getTileUnderFpsCrosshair();
    if (!target) {
      this.clearFpsCrosshairContextMenu();
      return;
    }

    this.startFpsCrosshairGlanceProbe(target, nowMs);
    const glanceHint = this.getCachedFpsCrosshairTargetHint(target.key, nowMs);
    const actions = this.getFpsCrosshairActionsForTile(
      target.key,
      target.mesh,
      glanceHint,
    );
    if (actions.length === 0) {
      this.clearFpsCrosshairContextMenu();
      return;
    }

    let title = this.getFpsCrosshairTitle(target.key, target.mesh, glanceHint);
    if (
      glanceHint === null &&
      this.fpsCrosshairGlancePending &&
      this.fpsCrosshairGlancePending.tileKey === target.key
    ) {
      title = `${title} (scanning...)`;
    }
    const signature = `${target.x},${target.y}|${title}|${actions
      .map((action) => `${action.kind}:${action.id}:${action.value}`)
      .join(",")}`;
    if (signature === this.fpsCrosshairContextSignature) {
      return;
    }

    this.fpsCrosshairContextSignature = signature;
    const state: FpsCrosshairContextState = {
      title,
      tileX: target.x,
      tileY: target.y,
      actions,
    };
    this.uiAdapter.setFpsCrosshairContext(state);
  }

  private handleMouseWheel(event: WheelEvent): void {
    if (this.isFpsMode()) {
      event.preventDefault();
      return;
    }

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
    if (this.isFpsMode() && !this.positionInputModeActive) {
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
    if (this.isFpsMode()) {
      return false;
    }
    return true;
  }

  private canUseFpsTouchInput(event: TouchEvent): boolean {
    if (!this.session || !this.isFpsMode()) {
      return false;
    }
    if (!this.isTouchEventOnGameCanvas(event)) {
      return false;
    }
    if (this.isAnyModalVisible()) {
      return false;
    }
    if (
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.metaCommandModeActive ||
      this.positionInputModeActive
    ) {
      return false;
    }
    return true;
  }

  private clearFpsTouchGestures(): void {
    this.fpsTouchMoveGesture = null;
    this.fpsTouchLookGesture = null;
  }

  private findTouchById(list: TouchList, touchId: number): Touch | null {
    for (let i = 0; i < list.length; i += 1) {
      const touch = list.item(i);
      if (touch && touch.identifier === touchId) {
        return touch;
      }
    }
    return null;
  }

  private resolveFpsMovementInputFromSwipe(dx: number, dy: number): string | null {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < this.touchSwipeMinDistancePx && absY < this.touchSwipeMinDistancePx) {
      return null;
    }

    const axisBiasRatio = 0.62;
    let key: string;
    if (absX <= absY * axisBiasRatio) {
      key = dy < 0 ? "w" : "s";
    } else if (absY <= absX * axisBiasRatio) {
      key = dx < 0 ? "a" : "d";
    } else {
      key = absY >= absX ? (dy < 0 ? "w" : "s") : dx < 0 ? "a" : "d";
    }
    return this.tryResolveFpsMovementInput(key);
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

    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerRaycaster.setFromCamera(this.pointerNdc, this.camera);

    const tiles = Array.from(this.tileMap.values());
    if (tiles.length === 0) {
      return null;
    }

    const intersections = this.pointerRaycaster.intersectObjects(tiles, false);
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

    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerRaycaster.setFromCamera(this.pointerNdc, this.camera);

    const hit = this.pointerRaycaster.ray.intersectPlane(
      this.groundPlane,
      this.pointerIntersection,
    );
    if (!hit) {
      return null;
    }

    return {
      x: this.pointerIntersection.x / TILE_SIZE,
      y: -this.pointerIntersection.y / TILE_SIZE,
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

  private canUseFpsGameplayMouseInput(event: MouseEvent): boolean {
    if (!this.session || !this.isFpsMode()) {
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
    if (
      this.isInQuestion ||
      this.isInDirectionQuestion ||
      this.metaCommandModeActive ||
      this.positionInputModeActive
    ) {
      return false;
    }
    return true;
  }

  private canUseFpsDirectionPromptMouseInput(event: MouseEvent): boolean {
    if (!this.session || !this.isFpsMode() || !this.isInDirectionQuestion) {
      return false;
    }
    if (event.target !== this.renderer.domElement) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (
      this.isTextInputActive ||
      this.positionInputModeActive ||
      this.metaCommandModeActive ||
      this.fpsCrosshairContextMenuOpen ||
      this.isInventoryDialogOpen() ||
      this.isInfoDialogOpen()
    ) {
      return false;
    }
    return true;
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
          this.sendForcedDirectionalInput(direction);
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
      this.updateDirectionalAttackContextFromTarget(target.x, target.y);
    }
    this.sendMouseInput(target.x, target.y, event.button);
    return true;
  }

  private handleMouseDown(event: MouseEvent): void {
    if (
      this.isFpsMode() &&
      this.isInDirectionQuestion &&
      event.button === 0 &&
      this.canUseFpsDirectionPromptMouseInput(event)
    ) {
      event.preventDefault();
      if (document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock?.();
        return;
      }
      const lookDirectionInput = this.getFpsDirectionQuestionInputFromAim();
      if (!lookDirectionInput) {
        return;
      }
      this.sendInput(lookDirectionInput);
      this.hideDirectionQuestion();
      return;
    }

    if (
      this.isFpsMode() &&
      this.isInDirectionQuestion &&
      event.button === 2 &&
      this.canUseFpsDirectionPromptMouseInput(event)
    ) {
      event.preventDefault();
      this.sendInput("Escape");
      this.hideDirectionQuestion();
      return;
    }

    if (
      this.isFpsMode() &&
      event.button === 0 &&
      this.canUseFpsGameplayMouseInput(event)
    ) {
      event.preventDefault();
      if (this.isFpsFireSuppressed()) {
        if (document.pointerLockElement !== this.renderer.domElement) {
          this.renderer.domElement.requestPointerLock?.();
        }
        return;
      }
      if (this.fpsCrosshairContextMenuOpen) {
        this.closeFpsCrosshairContextMenu(true);
        return;
      }
      if (document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock?.();
        return;
      }
      this.fireInCurrentAimDirection();
      return;
    }

    if (
      this.isFpsMode() &&
      event.button === 2 &&
      this.canUseFpsGameplayMouseInput(event)
    ) {
      event.preventDefault();
      if (this.fpsCrosshairContextMenuOpen) {
        this.closeFpsCrosshairContextMenu(true);
      } else {
        this.openFpsCrosshairContextMenu();
      }
      this.isRightMouseDown = false;
      return;
    }

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
      this.isCameraCenteredOnPlayer = false;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }

  private handleTouchStart(event: TouchEvent): void {
    if (this.isFpsMode()) {
      if (!this.canUseFpsTouchInput(event)) {
        this.clearFpsTouchGestures();
        return;
      }

      const rect = this.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        this.clearFpsTouchGestures();
        return;
      }
      const splitX = rect.left + rect.width * 0.5;

      for (let i = 0; i < event.changedTouches.length; i += 1) {
        const touch = event.changedTouches.item(i);
        if (!touch) {
          continue;
        }
        const gesture: FpsTouchGestureState = {
          touchId: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          lastX: touch.clientX,
          lastY: touch.clientY,
          startedAtMs: Date.now(),
        };
        const isLeftSide = touch.clientX < splitX;
        if (isLeftSide) {
          if (!this.fpsTouchMoveGesture) {
            this.fpsTouchMoveGesture = gesture;
            if (this.fpsCrosshairContextMenuOpen) {
              this.closeFpsCrosshairContextMenu(false);
            }
          }
        } else if (!this.fpsTouchLookGesture) {
          this.fpsTouchLookGesture = gesture;
        }
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      return;
    }

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
    if (this.isFpsMode()) {
      if (!this.canUseFpsTouchInput(event)) {
        return;
      }

      let consumed = false;
      if (this.fpsTouchLookGesture) {
        const touch =
          this.findTouchById(event.changedTouches, this.fpsTouchLookGesture.touchId) ||
          this.findTouchById(event.touches, this.fpsTouchLookGesture.touchId);
        if (touch) {
          const deltaX = touch.clientX - this.fpsTouchLookGesture.lastX;
          const deltaY = touch.clientY - this.fpsTouchLookGesture.lastY;
          const traveled = Math.hypot(
            touch.clientX - this.fpsTouchLookGesture.startX,
            touch.clientY - this.fpsTouchLookGesture.startY,
          );
          if (
            traveled >= this.fpsTouchLookMoveThresholdPx &&
            this.fpsCrosshairContextMenuOpen
          ) {
            this.closeFpsCrosshairContextMenu(false);
          }
          this.cameraYaw = this.wrapAngle(
            this.cameraYaw + deltaX * this.fpsTouchLookSensitivity,
          );
          this.cameraPitch = THREE.MathUtils.clamp(
            this.cameraPitch - deltaY * this.fpsTouchLookSensitivity,
            this.firstPersonPitchMin,
            this.firstPersonPitchMax,
          );
          this.fpsTouchLookGesture.lastX = touch.clientX;
          this.fpsTouchLookGesture.lastY = touch.clientY;
          consumed = true;
        }
      }

      if (this.fpsTouchMoveGesture) {
        const touch =
          this.findTouchById(event.changedTouches, this.fpsTouchMoveGesture.touchId) ||
          this.findTouchById(event.touches, this.fpsTouchMoveGesture.touchId);
        if (touch) {
          this.fpsTouchMoveGesture.lastX = touch.clientX;
          this.fpsTouchMoveGesture.lastY = touch.clientY;
          if (this.fpsCrosshairContextMenuOpen) {
            const traveled = Math.hypot(
              touch.clientX - this.fpsTouchMoveGesture.startX,
              touch.clientY - this.fpsTouchMoveGesture.startY,
            );
            if (traveled >= this.touchSwipeMinDistancePx) {
              this.closeFpsCrosshairContextMenu(false);
            }
          }
          consumed = true;
        }
      }

      if (consumed && event.cancelable) {
        event.preventDefault();
      }
      return;
    }

    if (!this.touchSwipeStart || !this.canUseMapTouchInput(event)) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  private handleTouchEnd(event: TouchEvent): void {
    if (this.isFpsMode()) {
      if (!event.changedTouches || event.changedTouches.length === 0) {
        return;
      }

      let consumed = false;
      const nowMs = Date.now();
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        const touch = event.changedTouches.item(i);
        if (!touch) {
          continue;
        }

        if (
          this.fpsTouchLookGesture &&
          touch.identifier === this.fpsTouchLookGesture.touchId
        ) {
          const gesture = this.fpsTouchLookGesture;
          this.fpsTouchLookGesture = null;
          const dx = touch.clientX - gesture.startX;
          const dy = touch.clientY - gesture.startY;
          const distance = Math.hypot(dx, dy);
          const durationMs = nowMs - gesture.startedAtMs;
          const isTap =
            distance < this.fpsTouchLookMoveThresholdPx &&
            durationMs <= this.fpsTouchTapMaxDurationMs;
          if (isTap) {
            if (this.fpsCrosshairContextMenuOpen) {
              this.closeFpsCrosshairContextMenu(false);
            } else {
              this.openFpsCrosshairContextMenu();
            }
            consumed = true;
          }
        }

        if (
          this.fpsTouchMoveGesture &&
          touch.identifier === this.fpsTouchMoveGesture.touchId
        ) {
          const gesture = this.fpsTouchMoveGesture;
          this.fpsTouchMoveGesture = null;
          const dx = touch.clientX - gesture.startX;
          const dy = touch.clientY - gesture.startY;
          const durationMs = nowMs - gesture.startedAtMs;
          const fpsMoveInput =
            durationMs <= this.touchSwipeMaxDurationMs
              ? this.resolveFpsMovementInputFromSwipe(dx, dy)
              : null;
          if (fpsMoveInput) {
            if (this.fpsCrosshairContextMenuOpen) {
              this.closeFpsCrosshairContextMenu(false);
            }
            if (!this.hasPlayerMovedOnce) {
              this.lastMovementInputAtMs = nowMs;
            }
            this.sendInput(fpsMoveInput);
            consumed = true;
          }
        }
      }

      if (consumed && event.cancelable) {
        event.preventDefault();
      }
      return;
    }

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
          this.sendForcedDirectionalInput(direction);
        }
        return;
      }
      if (!this.hasPlayerMovedOnce) {
        this.lastMovementInputAtMs = Date.now();
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      this.updateDirectionalAttackContextFromTarget(target.x, target.y);
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
    if (this.isFpsMode()) {
      this.clearFpsTouchGestures();
      return;
    }
    this.touchSwipeStart = null;
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.isFpsMode() && this.fpsPointerLockActive) {
      const deltaX = event.movementX || 0;
      const deltaY = event.movementY || 0;
      this.cameraYaw = this.wrapAngle(
        this.cameraYaw + deltaX * this.firstPersonMouseSensitivity,
      );
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch - deltaY * this.firstPersonMouseSensitivity,
        this.firstPersonPitchMin,
        this.firstPersonPitchMax,
      );
      return;
    }

    if (this.isMiddleMouseDown) {
      // Middle mouse - rotate camera
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;

      this.cameraYaw = this.wrapAngle(
        this.cameraYaw + deltaX * this.rotationSpeed,
      );
      this.cameraPitch = this.isFpsMode()
        ? THREE.MathUtils.clamp(
            this.cameraPitch - deltaY * this.rotationSpeed,
            this.firstPersonPitchMin,
            this.firstPersonPitchMax,
          )
        : THREE.MathUtils.clamp(
            this.cameraPitch + deltaY * this.rotationSpeed,
            this.minCameraPitch,
            this.maxCameraPitch,
          );

      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else if (this.isFpsMode() && this.isRightMouseDown) {
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;
      this.cameraYaw = this.wrapAngle(
        this.cameraYaw + deltaX * this.rotationSpeed,
      );
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch - deltaY * this.rotationSpeed,
        this.firstPersonPitchMin,
        this.firstPersonPitchMax,
      );
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else if (this.isRightMouseDown) {
      // Right mouse - pan camera
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;

      const panSpeed = 0.05;
      this.cameraPanX -= deltaX * panSpeed;
      this.cameraPanY += deltaY * panSpeed;
      this.cameraPanTargetX = this.cameraPanX;
      this.cameraPanTargetY = this.cameraPanY;
      this.isCameraCenteredOnPlayer = false;

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
    if (this.activeEffectTileKeys.size === 0) {
      return;
    }

    const phaseBase = timeMs / 240;
    const staleKeys: string[] = [];
    for (const key of this.activeEffectTileKeys) {
      const mesh = this.tileMap.get(key);
      if (!mesh) {
        staleKeys.push(key);
        continue;
      }

      const effectKind = mesh.userData.effectKind as
        | TileEffectKind
        | null
        | undefined;
      const overlayMaterial = this.getMeshOverlayMaterial(mesh);
      if (!overlayMaterial) {
        staleKeys.push(key);
        continue;
      }

      if (!effectKind) {
        overlayMaterial.color.set("#ffffff");
        staleKeys.push(key);
        continue;
      }

      const wave =
        0.72 +
        0.28 *
          Math.sin(phaseBase + mesh.position.x * 0.2 + mesh.position.y * 0.2);
      this.effectPulseColor
        .copy(this.effectColors[effectKind])
        .multiplyScalar(THREE.MathUtils.clamp(wave, 0.4, 1.2));
      overlayMaterial.color.copy(this.effectPulseColor);
    }

    for (const key of staleKeys) {
      this.activeEffectTileKeys.delete(key);
    }
  }

  private animate(timeMs: number = performance.now()): void {
    requestAnimationFrame(this.animateFrameCallback);
    const rawDeltaMs =
      this.lastFrameTimeMs === null ? 1000 / 60 : timeMs - this.lastFrameTimeMs;
    this.lastFrameTimeMs = timeMs;
    const deltaSeconds = Math.max(0, Math.min(rawDeltaMs, 250)) / 1000;

    this.syncFpsPointerLockForUiState(false);
    this.updateCameraPanInertia(deltaSeconds);
    this.updateCamera(deltaSeconds);
    this.updateFpsPlayerLightPosition();
    this.updateFpsCrosshairContextMenu();
    this.updateFpsAimVisuals(timeMs);
    this.updateLightingCenter(deltaSeconds);
    if (this.clientOptions.minimap) {
      this.renderMinimapViewportOverlay();
    }
    this.updateMetaCommandModalPosition();
    this.updateLightingOverlay();
    this.updateEffectAnimations(timeMs);
    this.updateDamageEffects(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  }
}

export default Nethack3DEngine;
