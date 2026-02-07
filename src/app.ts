/*
 * Main entry point for the NetHack 3D client.
 * This module runs NetHack WASM locally in-browser and renders the game in 3D using Three.js.
 */

import * as THREE from "three";
import LocalNetHackSession from "./local-nethack-session";

// --- TYPE DEFINITIONS ---

// A map to store meshes for each tile, keyed by "x,y" coordinates
type TileMap = Map<string, THREE.Mesh>;

interface GlyphOverlay {
  texture: THREE.CanvasTexture | null;
  material: THREE.MeshBasicMaterial;
  baseColorHex: string;
  textureKey: string;
}

type GlyphOverlayMap = Map<string, GlyphOverlay>;
type TerrainSnapshot = { glyph: number; char?: string; color?: number };

// --- CONSTANTS ---
const TILE_SIZE = 1; // The size of each tile in 3D space
const WALL_HEIGHT = 1; // How tall wall blocks are

/**
 * The main game engine class. It encapsulates all the logic for the 3D client.
 */
class Nethack3DEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private tileMap: TileMap = new Map();
  private glyphOverlayMap: GlyphOverlayMap = new Map();
  private tileStateCache: Map<string, string> = new Map();
  private lastKnownTerrain: Map<string, TerrainSnapshot> = new Map();
  private pendingTileUpdates: Map<string, any> = new Map();
  private tileFlushScheduled: boolean = false;
  private playerPos = { x: 0, y: 0 };
  private gameMessages: string[] = [];
  private statusDebugHistory: any[] = [];
  private currentInventory: any[] = []; // Store current inventory items
  private pendingInventoryDialog: boolean = false; // Flag to show inventory dialog after update
  private lastInfoMenu: { title: string; lines: string[] } | null = null;

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

  private session: any | null = null;
  private readonly metaInputPrefix = "__META__:";
  private altOrMetaHeld: boolean = false;

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
  private minDistance: number = 5;
  private maxDistance: number = 50;

  // Direction question handling
  private isInDirectionQuestion: boolean = false;

  // General question handling (pauses all movement)
  private isInQuestion: boolean = false;

  // Camera panning
  private cameraPanX: number = 0;
  private cameraPanY: number = 0;

  // Pre-create geometries and materials
  private floorGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  private wallGeometry = new THREE.BoxGeometry(
    TILE_SIZE,
    TILE_SIZE,
    WALL_HEIGHT
  );

  // Materials for different glyph types
  private materials = {
    floor: new THREE.MeshLambertMaterial({ color: 0x8b4513 }), // Brown floor
    wall: new THREE.MeshLambertMaterial({ color: 0x666666 }), // Gray wall
    door: new THREE.MeshLambertMaterial({ color: 0x8b4513 }), // Brown door
    dark: new THREE.MeshLambertMaterial({ color: 0x000055 }), // Dark blue for unseen areas
    fountain: new THREE.MeshLambertMaterial({ color: 0x0088ff }), // Light blue for water fountains
    player: new THREE.MeshLambertMaterial({
      color: 0x00ff00,
      emissive: 0x004400,
    }), // Green glowing player
    monster: new THREE.MeshLambertMaterial({
      color: 0xff0000,
      emissive: 0x440000,
    }), // Red glowing monster
    item: new THREE.MeshLambertMaterial({
      color: 0x0080ff,
      emissive: 0x001144,
    }), // Blue glowing item
    default: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };

  constructor() {
    this.initThreeJS();
    this.initUI();
    this.connectToRuntime();

    // Set initial camera position looking straight down with a slight tilt
    this.cameraDistance = 15;
    this.cameraPitch = THREE.MathUtils.clamp(
      Math.PI / 2 - 0.2,
      this.minCameraPitch,
      this.maxCameraPitch
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
      1000
    );
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000011); // Dark blue background
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(this.renderer.domElement);

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
      false
    );
    window.addEventListener(
      "mousemove",
      this.handleMouseMove.bind(this),
      false
    );
    window.addEventListener("mouseup", this.handleMouseUp.bind(this), false);
    window.addEventListener("contextmenu", (e) => e.preventDefault(), false); // Prevent right-click menu

    // Start render loop
    this.animate();
  }

  private initUI(): void {
    // Use existing game log and status elements from HTML instead of creating new ones
    const statusElement = document.getElementById("game-status");
    if (statusElement) {
      statusElement.innerHTML = "Starting local NetHack runtime...";
    }

    // Create connection status (smaller, top-right corner)
    const connStatus = document.createElement("div");
    connStatus.id = "connection-status";
    connStatus.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(255, 0, 0, 0.8);
      color: white;
      padding: 5px 10px;
      border-radius: 3px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      z-index: 1000;
    `;
    connStatus.innerHTML = "Disconnected";
    document.body.appendChild(connStatus);
  }

  private async connectToRuntime(): Promise<void> {
    console.log("Starting local NetHack runtime");
    this.updateConnectionStatus("Starting", "#4444aa");

    this.session = new LocalNetHackSession((payload: any) => {
      this.handleServerMessage(payload);
    });

    try {
      await this.session.start();
      this.updateConnectionStatus("Running", "#00aa00");
      this.updateStatus("Local NetHack runtime started");
      this.addGameMessage("Local NetHack runtime started");

      const loading = document.getElementById("loading");
      if (loading) {
        loading.style.display = "none";
      }
    } catch (error) {
      console.error("Failed to start local NetHack runtime:", error);
      this.updateConnectionStatus("Error", "#aa0000");
      this.updateStatus("Failed to start local NetHack runtime");
      this.addGameMessage("Failed to start local NetHack runtime");
    }
  }

  private handleServerMessage(data: any): void {
    switch (data.type) {
      case "map_glyph":
        this.enqueueTileUpdate(data);
        break;

      case "map_glyph_batch":
        if (Array.isArray(data.tiles)) {
          for (const tile of data.tiles) {
            this.enqueueTileUpdate(tile);
          }
        }
        break;

      case "player_position":
        console.log(
          `🎯 Received player position update: (${data.x}, ${data.y})`
        );
        const oldPos = { ...this.playerPos };
        this.playerPos = { x: data.x, y: data.y };
        console.log(
          `🎯 Player position changed from (${oldPos.x}, ${oldPos.y}) to (${data.x}, ${data.y})`
        );
        this.updateStatus(`Player at (${data.x}, ${data.y}) - NetHack 3D`);
        break;

      case "force_player_redraw":
        // Force update player visual position when NetHack doesn't send map updates
        console.log(
          `🎯 Force redraw player from (${data.oldPosition.x}, ${data.oldPosition.y}) to (${data.newPosition.x}, ${data.newPosition.y})`
        );

        // Update the player position first
        this.playerPos = { x: data.newPosition.x, y: data.newPosition.y };

        // Clear the old player visual position by redrawing it as floor
        const oldKey = `${data.oldPosition.x},${data.oldPosition.y}`;
        const oldOverlay = this.glyphOverlayMap.get(oldKey);
        if (oldOverlay) {
          console.log(
            `🎯 Clearing old player overlay at (${data.oldPosition.x}, ${data.oldPosition.y})`
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
            oldTerrain.color
          );
        } else {
          this.updateTile(data.oldPosition.x, data.oldPosition.y, 2396, ".", 0);
        }

        // Create a fake player glyph at the new position to ensure visual update
        // Use a typical player glyph number (around 331-360 range)
        this.updateTile(data.newPosition.x, data.newPosition.y, 331, "@", 0);
        console.log(
          `🎯 Player visual updated to position (${data.newPosition.x}, ${data.newPosition.y})`
        );
        break;

      case "text":
        this.addGameMessage(data.text);
        break;

      case "raw_print":
        this.addGameMessage(data.text);
        break;

      // case "menu_item":
      //   this.addGameMessage(`Menu: ${data.text} (${data.accelerator})`);
      //   break;

      case "direction_question":
        // Special handling for direction questions - show UI and pause movement
        this.isInQuestion = true;
        this.showDirectionQuestion(data.text);
        break;

      case "question":
        // Auto-handle character creation questions to avoid user interaction
        if (
          data.text &&
          (data.text.includes("character") ||
            data.text.includes("class") ||
            data.text.includes("race") ||
            data.text.includes("gender") ||
            data.text.includes("alignment"))
        ) {
          console.log("Auto-handling character creation:", data.text);
          // Send default character choices
          if (data.menuItems && data.menuItems.length > 0) {
            // Pick the first available option
            this.sendInput(data.menuItems[0].accelerator);
          } else if (data.default) {
            this.sendInput(data.default);
          } else {
            this.sendInput("a"); // Default to 'a' (often Archeologist)
          }
          return; // Don't show the dialog
        }

        // For non-character creation questions, show normal dialog and pause movement
        this.isInQuestion = true;
        this.showQuestion(
          data.text,
          data.choices,
          data.default,
          data.menuItems
        );
        break;

      case "inventory_update":
        // Handle inventory updates without showing dialog
        const itemCount = data.items ? data.items.length : 0;
        const actualItems = data.items
          ? data.items.filter((item: any) => !item.isCategory)
          : [];
        console.log(
          `📦 Received inventory update with ${itemCount} total items (${actualItems.length} actual items)`
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

        // Add a message to the log about inventory update (optional)
        if (actualItems.length > 0) {
          this.addGameMessage(`Inventory: ${actualItems.length} items`);
        }
        break;

      case "info_menu":
        this.lastInfoMenu = {
          title: String(data.title || "NetHack Information"),
          lines: Array.isArray(data.lines) ? data.lines : [],
        };
        this.showInfoMenuDialog(this.lastInfoMenu.title, this.lastInfoMenu.lines);
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
        // Auto-provide a default name to avoid user interaction
        console.log("Auto-providing default name for:", data.text);
        this.sendInput("Player");
        break;

      case "area_refresh_complete":
        console.log(
          `🔄 Area refresh completed: ${data.tilesRefreshed} tiles refreshed around (${data.centerX}, ${data.centerY})`
        );
        this.addGameMessage(
          `Refreshed ${data.tilesRefreshed} tiles around (${data.centerX}, ${data.centerY})`
        );
        break;

      case "tile_not_found":
        console.log(
          `⚠️ Tile not found at (${data.x}, ${data.y}): ${data.message}`
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
        console.log(`Status update: ${data.fieldName || data.field} = "${data.value}" (type=${data.valueType || "unknown"})`);
        this.updatePlayerStats(data.field, data.value, data);
        break;

      default:
        console.log("Unknown message type:", data.type, data);
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
      const signature = `${tile.glyph}|${tile.char ?? ""}|${tile.color ?? ""}`;
      if (this.tileStateCache.get(key) === signature) {
        continue;
      }

      this.tileStateCache.set(key, signature);
      this.updateTile(tile.x, tile.y, tile.glyph, tile.char, tile.color);
    }
  }

  /**
   * Request a view update for a specific tile from the server
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
    radius: number = 3
  ): void {
    if (this.session) {
      console.log(
        `Requesting area update centered at (${centerX}, ${centerY}) with radius ${radius}`
      );
      this.session.requestAreaUpdate(centerX, centerY, radius);
    } else {
      console.log("Cannot request area update - runtime not started");
    }
  }
  public requestPlayerAreaUpdate(radius: number = 5): void {
    this.requestAreaUpdate(this.playerPos.x, this.playerPos.y, radius);
  }

  private disposeGlyphOverlay(overlay: GlyphOverlay): void {
    if (overlay.texture) {
      overlay.texture.dispose();
      overlay.texture = null;
    }
    overlay.material.dispose();
  }

  private toneColor(hex: string, factor: number): string {
    const color = new THREE.Color(`#${hex}`);
    color.multiplyScalar(THREE.MathUtils.clamp(factor, 0, 1));
    return color.getHexString();
  }

  private ensureGlyphOverlay(
    key: string,
    baseMaterial: THREE.MeshLambertMaterial
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
    size: number = 256
  ): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;

    const tonedBackground = this.toneColor(baseColorHex, 0.8);
    context.fillStyle = `#${tonedBackground}`;
    context.fillRect(0, 0, size, size);

    const trimmed = glyphChar.trim();
    if (trimmed.length > 0) {
      const fontSize = Math.floor(size * 0.6);
      context.font = `bold ${fontSize}px monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";

      context.fillStyle = textColor;
      context.fillText(trimmed, size / 2, size / 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy()
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;

    return texture;
  }

  private applyGlyphMaterial(
    key: string,
    mesh: THREE.Mesh,
    baseMaterial: THREE.MeshLambertMaterial,
    glyphChar: string,
    textColor: string,
    isWall: boolean,
    darkenFactor: number = 1
  ): void {
    const overlay = this.ensureGlyphOverlay(key, baseMaterial);
    const baseColorHex = baseMaterial.color.getHexString();
    const textureKey = `${baseColorHex}|${glyphChar}|${textColor}`;

    if (overlay.textureKey !== textureKey) {
      if (overlay.texture) {
        overlay.texture.dispose();
      }

      overlay.baseColorHex = baseColorHex;
      overlay.material.color.set("#ffffff");
      overlay.texture = this.createGlyphTexture(
        baseColorHex,
        glyphChar,
        textColor
      );
      overlay.material.map = overlay.texture;
      overlay.material.needsUpdate = true;
      overlay.textureKey = textureKey;
    }

    // Dynamic tile darkening modifier (keeps base texture/material identity).
    const clampedDarken = THREE.MathUtils.clamp(darkenFactor, 0, 1);
    overlay.material.color.setScalar(clampedDarken);

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

  private glyphToChar(glyph: number): string {
    // Convert NetHack glyph numbers to ASCII characters
    // This is a fallback for when the server doesn't provide the proper character
    // Based on NetHack's glyph system

    // Floor glyphs (2395-2397)
    if (glyph >= 2395 && glyph <= 2397) return ".";

    // Wall glyphs (2378-2394)
    if (glyph >= 2378 && glyph <= 2394) {
      switch (glyph) {
        case 2378:
          return "|"; // vertical wall
        case 2379:
          return "-"; // horizontal wall
        case 2380:
          return "-"; // top-left corner
        case 2381:
          return "-"; // top-right corner
        case 2382:
          return "-"; // bottom-left corner
        case 2383:
          return "-"; // bottom-right corner
        case 2389:
          return "+"; // closed door
        case 2390:
          return "-"; // open horizontal door
        case 2391:
          return "|"; // open vertical door
        case 2392:
          return "+"; // closed vertical door
        default:
          return "#"; // generic wall
      }
    }
    if (glyph === 2409) return "|"; // vertical open door
    if (glyph === 2410) return "-"; // horizontal open door
    if (glyph === 2411 || glyph === 2412) return "+"; // closed doors

    // Player character (broad range to cover all classes/races/genders)
    // NetHack player glyphs are typically in the range 331-360+
    if (glyph >= 331 && glyph <= 360) return "@";

    // Monster glyphs (approximate ranges)
    if (glyph >= 400 && glyph <= 500) {
      // Common monsters
      if (glyph >= 400 && glyph <= 410) return "d"; // dogs
      if (glyph >= 411 && glyph <= 420) return "k"; // kobolds
      if (glyph >= 421 && glyph <= 430) return "o"; // orcs
      return "M"; // generic monster
    }

    // Item glyphs
    if (glyph >= 1900 && glyph <= 2400) {
      if (glyph >= 1920 && glyph <= 1930) return ")"; // weapons
      if (glyph >= 2000 && glyph <= 2100) return "["; // armor
      if (glyph >= 2180 && glyph <= 2220) return "%"; // food
      if (glyph >= 2220 && glyph <= 2260) return "("; // tools
      return "*"; // generic item
    }

    // Special terrain
    if (glyph === 237) return "<"; // stairs up
    if (glyph === 238) return ">"; // stairs down
    if (glyph === 2334) return "#"; // solid rock
    if (glyph === 2223) return "\\"; // throne

    // Fallback: For unknown glyphs, show a generic character instead of the number
    return "?";
  }

  private isOpenDoorGlyph(glyph: number): boolean {
    return glyph === 2390 || glyph === 2391 || glyph === 2409 || glyph === 2410;
  }

  private isClosedDoorGlyph(glyph: number): boolean {
    return glyph === 2389 || glyph === 2392 || glyph === 2411 || glyph === 2412;
  }

  private isStructuralWallGlyph(glyph: number): boolean {
    return glyph >= 2378 && glyph <= 2394;
  }

  private isDarkOverlayGlyph(glyph: number): boolean {
    // Dark-memory/occluded glyphs in room and hallway contexts.
    return glyph === 2397 || glyph === 2398 || glyph === 2377;
  }

  private getDoorState(glyph: number, char?: string): "open" | "closed" | null {
    if (this.isOpenDoorGlyph(glyph)) return "open";
    if (this.isClosedDoorGlyph(glyph)) return "closed";
    if (char === "+") return "closed";
    return null;
  }

  private clearScene(): void {
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
    this.tileStateCache.clear();
    this.lastKnownTerrain.clear();
    this.pendingTileUpdates.clear();
    this.tileFlushScheduled = false;

    console.log("🧹 Scene cleared - ready for new level");
  }

  private updateTile(
    x: number,
    y: number,
    glyph: number,
    char?: string,
    color?: number
  ): void {
    const key = `${x},${y}`;
    let mesh = this.tileMap.get(key);

    const isPlayerGlyph = glyph >= 331 && glyph <= 360 && (char === "@" || !char);
    const isDarkOverlay = this.isDarkOverlayGlyph(glyph);
    if (!isPlayerGlyph) {
      this.lastKnownTerrain.set(key, { glyph, char, color });
    }
    if (isPlayerGlyph) {
      this.playerPos = { x, y };
      this.updateStatus(`Player at (${x}, ${y}) - NetHack 3D`);
    }

    let material = this.materials.default;
    let geometry = this.floorGeometry;
    let isWall = false;
    let darkenFactor = 1;

    let effectiveGlyph = glyph;
    let effectiveChar = char;
    let effectiveColor = color;
    if (isDarkOverlay) {
      const priorTerrain = this.lastKnownTerrain.get(key);
      if (priorTerrain) {
        effectiveGlyph = priorTerrain.glyph;
        effectiveChar = priorTerrain.char;
        effectiveColor = priorTerrain.color;
      }
      darkenFactor = glyph === 2398 ? 0.45 : 0.6;
    }

    const doorState = this.getDoorState(effectiveGlyph, effectiveChar);

    // Trust explicit floor chars from NetHack for pass-through wall openings.
    if (effectiveChar === ".") {
      material = this.materials.floor;
      geometry = this.floorGeometry;
    } else if (doorState === "closed") {
      material = this.materials.door;
      geometry = this.wallGeometry;
      isWall = true;
    } else if (doorState === "open") {
      material = this.materials.door;
      geometry = this.floorGeometry;
    } else if (effectiveChar) {
      if (effectiveChar === " ") {
        if (isDarkOverlay && glyph === 2397) {
          material = this.materials.floor;
          geometry = this.floorGeometry;
        } else {
          material = this.materials.wall;
          geometry = this.wallGeometry;
          isWall = true;
        }
      } else if (effectiveChar === "#") {
        // Generic '#' terrain (e.g., corridor/sink map chars) is walkable floor.
        material =
          isDarkOverlay && glyph === 2398 ? this.materials.dark : this.materials.floor;
        geometry = this.floorGeometry;
      } else if (effectiveChar === "|" || effectiveChar === "-") {
        if (this.isStructuralWallGlyph(effectiveGlyph)) {
          material = this.materials.wall;
          geometry = this.wallGeometry;
          isWall = true;
        } else {
          // Some walkable terrain (e.g., headstones) uses '|' but is not a wall block.
          material = this.materials.floor;
          geometry = this.floorGeometry;
        }
      } else if (isPlayerGlyph) {
        material = this.materials.player;
        geometry = this.floorGeometry;
      } else if (effectiveChar === "@") {
        material = this.materials.monster;
        geometry = this.floorGeometry;
      } else if (effectiveChar === "{") {
        material = this.materials.fountain;
        geometry = this.floorGeometry;
      } else if (/[a-zA-Z:;&'"]/.test(effectiveChar)) {
        material = this.materials.monster;
        geometry = this.floorGeometry;
      } else if (/[)(\[%*$?!=/\\<>]/.test(effectiveChar)) {
        material = this.materials.item;
        geometry = this.floorGeometry;
      } else {
        material = this.materials.floor;
        geometry = this.floorGeometry;
      }
    } else {
      if (effectiveGlyph >= 2378 && effectiveGlyph <= 2394) {
        material = this.materials.wall;
        geometry = this.wallGeometry;
        isWall = true;
      } else if (effectiveGlyph >= 2395 && effectiveGlyph <= 2397) {
        material = this.materials.floor;
        geometry = this.floorGeometry;
      } else if (isPlayerGlyph) {
        material = this.materials.player;
        geometry = this.floorGeometry;
      } else if (effectiveGlyph >= 400 && effectiveGlyph <= 500) {
        material = this.materials.monster;
        geometry = this.floorGeometry;
      } else if (effectiveGlyph >= 1900 && effectiveGlyph <= 2400) {
        material = this.materials.item;
        geometry = this.floorGeometry;
      } else {
        material = this.materials.floor;
        geometry = this.floorGeometry;
      }
    }

    const targetZ = isWall ? WALL_HEIGHT / 2 : 0;

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

    mesh.userData.isWall = isWall;

    const glyphChar = isDarkOverlay
      ? char || this.glyphToChar(glyph)
      : effectiveChar || this.glyphToChar(effectiveGlyph);
    this.applyGlyphMaterial(
      key,
      mesh,
      material,
      glyphChar,
      "#f4f4f4",
      isWall,
      darkenFactor
    );
  }
  private addGameMessage(message: string): void {
    if (!message || message.trim() === "") return;

    this.gameMessages.unshift(message);
    if (this.gameMessages.length > 100) {
      this.gameMessages.pop();
    }

    const logElement = document.getElementById("game-log");
    if (logElement) {
      logElement.innerHTML = this.gameMessages.join("<br>");
      logElement.scrollTop = 0; // Keep newest messages at top
    }
  }

  private updateStatus(status: string): void {
    const statusElement = document.getElementById("game-status");
    if (statusElement) {
      statusElement.innerHTML = status;
    }
  }

  private updateConnectionStatus(status: string, color: string): void {
    const connElement = document.getElementById("connection-status");
    if (connElement) {
      connElement.innerHTML = status;
      connElement.style.backgroundColor = color;
    }
  }

  private updatePlayerStats(
    field: number,
    value: string | number | null,
    data: any
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

    const rawFieldName = typeof data?.fieldName === "string" ? data.fieldName : null;
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
        `Skipping status update: field=${field}, fieldName=${rawFieldName}, value=${value}`
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
        const match = clean.match(/^-?\d+/);
        if (!match) {
          console.log(`Could not parse numeric status ${mappedField} from "${value}"`);
          return;
        }
        parsedValue = parseInt(match[0], 10);
      }
    } else {
      parsedValue = String(value).trim();
    }

    console.log(`Updating status ${mappedField}: ${parsedValue}`);

    if (mappedField === "maxhp") {
      this.playerStats.maxHp = parsedValue;
    } else if (mappedField === "maxpower") {
      this.playerStats.maxPower = parsedValue;
    } else if (mappedField === "dlevel") {
      this.playerStats.dlevel = parsedValue;
    } else {
      (this.playerStats as any)[mappedField] = parsedValue;
    }

    this.updateStatsDisplay();
  }

  private updateStatsDisplay(): void {
    // Update or create the stats bar
    let statsBar = document.getElementById("stats-bar");
    if (!statsBar) {
      // Create the stats bar at the top of the screen
      statsBar = document.createElement("div");
      statsBar.id = "stats-bar";
      statsBar.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.7) 100%);
        color: white;
        padding: 8px 15px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        z-index: 1500;
        border-bottom: 2px solid #00ff00;
        display: flex;
        align-items: center;
        gap: 20px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      `;
      document.body.appendChild(statsBar);

      // Adjust the game log position to accommodate the stats bar
      const gameLogContainer = document.querySelector(
        ".top-left-ui"
      ) as HTMLElement;
      if (gameLogContainer) {
        gameLogContainer.style.top = "65px"; // Move down below stats bar
      }
    }

    // Create HP bar component
    const hpPercentage =
      this.playerStats.maxHp > 0
        ? (this.playerStats.hp / this.playerStats.maxHp) * 100
        : 0;
    const hpColor =
      hpPercentage > 60 ? "#00ff00" : hpPercentage > 30 ? "#ffaa00" : "#ff0000";

    const hpBar = `
      <div style="display: flex; flex-direction: column; min-width: 120px;">
        <div style="font-weight: bold; color: #ff6666; margin-bottom: 2px;">
          HP: ${this.playerStats.hp}/${this.playerStats.maxHp}
        </div>
        <div style="background: #333; height: 8px; border-radius: 4px; border: 1px solid #666;">
          <div style="
            background: ${hpColor}; 
            height: 100%; 
            width: ${hpPercentage}%; 
            border-radius: 3px;
            transition: width 0.3s ease;
          "></div>
        </div>
      </div>
    `;

    // Create Power bar component (if the player has magical power)
    let powerBar = "";
    if (this.playerStats.maxPower > 0) {
      const powerPercentage =
        (this.playerStats.power / this.playerStats.maxPower) * 100;
      powerBar = `
        <div style="display: flex; flex-direction: column; min-width: 120px;">
          <div style="font-weight: bold; color: #6666ff; margin-bottom: 2px;">
            Pw: ${this.playerStats.power}/${this.playerStats.maxPower}
          </div>
          <div style="background: #333; height: 8px; border-radius: 4px; border: 1px solid #666;">
            <div style="
              background: #6666ff; 
              height: 100%; 
              width: ${powerPercentage}%; 
              border-radius: 3px;
              transition: width 0.3s ease;
            "></div>
          </div>
        </div>
      `;
    }

    // Build the complete stats display
    statsBar.innerHTML = `
      <!-- Player Name and Level -->
      <div style="font-weight: bold; color: #00ff00; min-width: 150px;">
        ${this.playerStats.name} (Lvl ${this.playerStats.level})
      </div>
      
      <!-- HP Bar -->
      ${hpBar}
      
      <!-- Power Bar (if applicable) -->
      ${powerBar}
      
      <!-- Core Stats -->
      <div style="display: flex; gap: 15px; font-size: 11px;">
        <div style="color: #ffaa00;">St:${this.playerStats.strength}</div>
        <div style="color: #ffaa00;">Dx:${this.playerStats.dexterity}</div>
        <div style="color: #ffaa00;">Co:${this.playerStats.constitution}</div>
        <div style="color: #ffaa00;">In:${this.playerStats.intelligence}</div>
        <div style="color: #ffaa00;">Wi:${this.playerStats.wisdom}</div>
        <div style="color: #ffaa00;">Ch:${this.playerStats.charisma}</div>
      </div>
      
      <!-- Secondary Stats -->
      <div style="display: flex; gap: 15px; font-size: 11px;">
        <div style="color: #aaaaff;">AC:${this.playerStats.armor}</div>
        <div style="color: #ffff66;">$:${this.playerStats.gold}</div>
        <div style="color: #66ffff;">T:${this.playerStats.time}</div>
      </div>
      
      <!-- Location and Status -->
      <div style="display: flex; flex-direction: column; gap: 2px; font-size: 11px; flex: 1; text-align: right;">
        <div style="color: #cccccc;">${this.playerStats.dungeon} ${
      this.playerStats.dlevel
    }</div>
        <div style="color: #ffaaff;">${this.playerStats.hunger}${
      this.playerStats.encumbrance ? " " + this.playerStats.encumbrance : ""
    }</div>
      </div>
    `;
  }

  private updateInventoryDisplay(items: any[]): void {
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

  private showQuestion(
    question: string,
    choices: string,
    defaultChoice: string,
    menuItems: any[]
  ): void {
    // Temporarily disable automatic "?" expansion to debug menu issues
    // TODO: Re-enable with better logic later
    const needsExpansion = false;

    if (needsExpansion) {
      console.log(
        "🔍 Question includes '?' option, automatically expanding options..."
      );
      // Send "?" to get detailed menu items
      this.sendInput("?");
      // Don't show the dialog yet - wait for expanded menu items
      return;
    }

    // Create or get question dialog
    let questionDialog = document.getElementById("question-dialog");
    if (!questionDialog) {
      questionDialog = document.createElement("div");
      questionDialog.id = "question-dialog";
      questionDialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px;
        border: 2px solid #00ff00;
        border-radius: 10px;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        text-align: center;
        min-width: 300px;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
      `;
      document.body.appendChild(questionDialog);
    }

    // Clear previous content
    questionDialog.innerHTML = "";

    // Add question text
    const questionText = document.createElement("div");
    questionText.style.cssText = `
      font-size: 16px;
      margin-bottom: 15px;
      line-height: 1.4;
    `;
    questionText.textContent = question;
    questionDialog.appendChild(questionText);

    // Add menu items if available
    if (menuItems && menuItems.length > 0) {
      // Check if this is a multi-pickup dialog
      const isPickupDialog =
        question &&
        (question.toLowerCase().includes("pick up what") ||
          question.toLowerCase().includes("pick up") ||
          question.toLowerCase().includes("what do you want to pick up"));

      if (isPickupDialog) {
        // Create multi-selection pickup dialog
        this.createPickupDialog(questionDialog, menuItems, question);
      } else {
        // Create standard single-selection menu
        this.createStandardMenu(questionDialog, menuItems);
      }
    } else {
      // Add choice buttons for simple y/n questions
      const choiceContainer = document.createElement("div");
      choiceContainer.style.cssText = `
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-top: 15px;
      `;

      if (choices && choices.length > 0) {
        for (const choice of choices) {
          const button = document.createElement("button");
          button.style.cssText = `
            padding: 8px 16px;
            background: ${choice === defaultChoice ? "#00aa00" : "#333"};
            color: white;
            border: 1px solid #666;
            border-radius: 3px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
          `;
          button.textContent = choice.toUpperCase();
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
    escapeText.style.cssText = `
      font-size: 12px;
      color: #aaa;
      margin-top: 15px;
    `;
    escapeText.textContent = "Press ESC to cancel";
    questionDialog.appendChild(escapeText);

    // Show the dialog
    questionDialog.style.display = "block";
  }

  private showDirectionQuestion(question: string): void {
    // Set direction question state to pause movement
    this.isInDirectionQuestion = true;

    // Create or get direction dialog
    let directionDialog = document.getElementById("direction-dialog");
    if (!directionDialog) {
      directionDialog = document.createElement("div");
      directionDialog.id = "direction-dialog";
      directionDialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: #ffff00;
        padding: 20px;
        border: 2px solid #ffff00;
        border-radius: 10px;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        text-align: center;
        min-width: 350px;
      `;
      document.body.appendChild(directionDialog);
    }

    // Clear previous content
    directionDialog.innerHTML = "";

    // Add question text
    const questionText = document.createElement("div");
    questionText.style.cssText = `
      font-size: 16px;
      margin-bottom: 20px;
      line-height: 1.4;
      color: #ffff00;
    `;
    questionText.textContent = question;
    directionDialog.appendChild(questionText);

    // Add direction buttons
    const directionsContainer = document.createElement("div");
    directionsContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 80px);
      gap: 5px;
      justify-content: center;
      margin: 20px 0;
    `;

    const directions = [
      { key: "7", label: "↖", name: "NW" },
      { key: "8", label: "↑", name: "N" },
      { key: "9", label: "↗", name: "NE" },
      { key: "4", label: "←", name: "W" },
      { key: "5", label: "•", name: "Wait" },
      { key: "6", label: "→", name: "E" },
      { key: "1", label: "↙", name: "SW" },
      { key: "2", label: "↓", name: "S" },
      { key: "3", label: "↘", name: "SE" },
    ];

    directions.forEach((dir) => {
      const button = document.createElement("button");
      button.style.cssText = `
        width: 80px;
        height: 80px;
        background: #444;
        color: #ffff00;
        border: 2px solid #666;
        border-radius: 5px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        font-size: 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
        line-height: 1.2;
      `;

      button.innerHTML = `<div style="font-size: 24px; margin-bottom: 2px;">${dir.label}</div><div style="font-size: 14px;">${dir.key}</div>`;

      button.onmouseover = () => {
        button.style.backgroundColor = "#666";
      };

      button.onmouseout = () => {
        button.style.backgroundColor = "#444";
      };

      button.onclick = () => {
        this.sendInput(dir.key);
        this.hideDirectionQuestion();
      };

      directionsContainer.appendChild(button);
    });

    directionDialog.appendChild(directionsContainer);

    // Add escape instruction
    const escapeText = document.createElement("div");
    escapeText.style.cssText = `
      font-size: 12px;
      color: #aaa;
      margin-top: 15px;
    `;
    escapeText.textContent =
      "Use numpad (1-9), arrow keys, or click a direction. Press ESC to cancel";
    directionDialog.appendChild(escapeText);

    // Show the dialog
    directionDialog.style.display = "block";
  }

  private hideDirectionQuestion(): void {
    this.isInDirectionQuestion = false;
    this.isInQuestion = false; // Clear general question state
    const directionDialog = document.getElementById("direction-dialog");
    if (directionDialog) {
      directionDialog.style.display = "none";
    }
  }

  private showInfoMenuDialog(title: string, lines: string[]): void {
    let infoDialog = document.getElementById("info-menu-dialog");
    if (!infoDialog) {
      infoDialog = document.createElement("div");
      infoDialog.id = "info-menu-dialog";
      infoDialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.95);
        color: white;
        padding: 20px;
        border: 2px solid #66ccff;
        border-radius: 10px;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        min-width: 450px;
        max-width: 680px;
        max-height: 90vh;
        overflow-y: auto;
      `;
      document.body.appendChild(infoDialog);
    }

    infoDialog.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      color: #66ccff;
      margin-bottom: 12px;
      text-align: center;
      border-bottom: 2px solid #66ccff;
      padding-bottom: 8px;
    `;
    titleEl.textContent = title || "NetHack Information";
    infoDialog.appendChild(titleEl);

    const body = document.createElement("div");
    body.style.cssText = `
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      padding: 6px 2px;
    `;
    body.textContent = lines && lines.length > 0 ? lines.join("\n") : "(No details)";
    infoDialog.appendChild(body);

    const hint = document.createElement("div");
    hint.style.cssText = `
      font-size: 12px;
      color: #aaa;
      text-align: center;
      margin-top: 12px;
      border-top: 1px solid #444;
      padding-top: 10px;
    `;
    hint.textContent = "Press ESC to close. Press Ctrl+M to reopen.";
    infoDialog.appendChild(hint);

    infoDialog.style.display = "block";
  }

  private hideInfoMenuDialog(): void {
    const infoDialog = document.getElementById("info-menu-dialog");
    if (infoDialog) {
      infoDialog.style.display = "none";
    }
  }

  private toggleInfoMenuDialog(): void {
    const infoDialog = document.getElementById("info-menu-dialog");
    if (infoDialog && infoDialog.style.display !== "none") {
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
    // Create or get inventory dialog
    let inventoryDialog = document.getElementById("inventory-dialog");
    if (!inventoryDialog) {
      inventoryDialog = document.createElement("div");
      inventoryDialog.id = "inventory-dialog";
      inventoryDialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.95);
        color: white;
        padding: 20px;
        border: 2px solid #00ff00;
        border-radius: 10px;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        min-width: 450px;
        max-width: 600px;
        max-height: 95vh;
        overflow-y: auto;
      `;
      document.body.appendChild(inventoryDialog);
    }

    // Clear previous content
    inventoryDialog.innerHTML = "";

    // Add title
    const title = document.createElement("div");
    title.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      color: #00ff00;
      margin-bottom: 15px;
      text-align: center;
      border-bottom: 2px solid #00ff00;
      padding-bottom: 8px;
    `;
    title.textContent = "📦 INVENTORY";
    inventoryDialog.appendChild(title);

    // Add inventory items
    const itemsContainer = document.createElement("div");
    itemsContainer.style.cssText = `
      margin-bottom: 20px;
      max-height: 70vh;
      overflow-y: auto;
    `;

    if (this.currentInventory.length === 0) {
      const emptyMessage = document.createElement("div");
      emptyMessage.style.cssText = `
        text-align: center;
        color: #aaa;
        font-style: italic;
        padding: 20px;
      `;
      emptyMessage.textContent = "Your inventory is empty.";
      itemsContainer.appendChild(emptyMessage);
    } else {
      // Display both categories and items (don't filter out categories)
      this.currentInventory.forEach((item: any, index: number) => {
        if (item.isCategory) {
          // This is a category header
          const categoryHeader = document.createElement("div");
          categoryHeader.style.cssText = `
            font-size: 14px;
            font-weight: bold;
            color: #ffff00;
            margin: ${index === 0 ? "10px" : "15px"} 0 8px 0;
            text-align: left;
            border-bottom: 1px solid #666;
            padding-bottom: 4px;
            text-transform: uppercase;
          `;
          categoryHeader.textContent = item.text;
          itemsContainer.appendChild(categoryHeader);
        } else {
          // This is an actual item
          const itemDiv = document.createElement("div");
          itemDiv.style.cssText = `
            padding: 4px 10px;
            margin: 1px 0;
            background: rgba(255, 255, 255, 0.03);
            border-left: 2px solid #00ff00;
            line-height: 1.3;
            display: flex;
            align-items: center;
            margin-left: 10px;
          `;

          const keySpan = document.createElement("span");
          keySpan.style.cssText = `
            color: #00ff00;
            font-weight: bold;
            margin-right: 8px;
            min-width: 20px;
            font-size: 13px;
          `;
          keySpan.textContent = `${item.accelerator || "?"})`;

          const textSpan = document.createElement("span");
          textSpan.style.cssText = `
            color: #ffffff;
            flex: 1;
            font-size: 13px;
          `;
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
    keybindsTitle.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      color: #ffff00;
      margin-bottom: 8px;
      border-top: 1px solid #444;
      padding-top: 12px;
    `;
    keybindsTitle.textContent = "🎮 ITEM COMMANDS";
    inventoryDialog.appendChild(keybindsTitle);

    // Create commands container
    const keybindsContainer = document.createElement("div");
    keybindsContainer.style.cssText = `
      font-size: 11px;
      line-height: 1.2;
      margin-bottom: 10px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 4px;
      border: 1px solid #333;
    `;

    // Create highlighted command list with color-coded keys
    const commandText = `<span style="color: #88ff88;">a</span>)pply <span style="color: #88ff88;">d</span>)rop <span style="color: #88ff88;">e</span>)at <span style="color: #88ff88;">q</span>)uaff <span style="color: #88ff88;">r</span>)ead <span style="color: #88ff88;">t</span>)hrow <span style="color: #88ff88;">w</span>)ield <span style="color: #88ff88;">W</span>)ear <span style="color: #88ff88;">T</span>)ake-off <span style="color: #88ff88;">P</span>)ut-on <span style="color: #88ff88;">R</span>)emove <span style="color: #88ff88;">z</span>)ap <span style="color: #88ff88;">Z</span>)cast
    Special: <span style="color: #88ff88;">"</span>)weapons <span style="color: #88ff88;">[</span>)armor <span style="color: #88ff88;">=</span>)rings <span style="color: #88ff88;">"</span>)amulets <span style="color: #88ff88;">(</span>)tools`;

    keybindsContainer.innerHTML = `<div style="color: #cccccc; white-space: pre-line;">${commandText}</div>`;
    inventoryDialog.appendChild(keybindsContainer);

    // Add close instructions
    const closeText = document.createElement("div");
    closeText.style.cssText = `
      font-size: 12px;
      color: #aaa;
      text-align: center;
      margin-top: 10px;
      border-top: 1px solid #444;
      padding-top: 10px;
    `;
    closeText.textContent = "Press ESC or 'i' to close";
    inventoryDialog.appendChild(closeText);

    // Show the dialog
    inventoryDialog.style.display = "block";
  }

  private hideInventoryDialog(): void {
    const inventoryDialog = document.getElementById("inventory-dialog");
    if (inventoryDialog) {
      inventoryDialog.style.display = "none";
    }
    // Clear any pending inventory dialog flag
    this.pendingInventoryDialog = false;
  }

  private showPositionRequest(text: string): void {
    // Create or get position dialog
    let posDialog = document.getElementById("position-dialog");
    if (!posDialog) {
      posDialog = document.createElement("div");
      posDialog.id = "position-dialog";
      posDialog.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: #ffff00;
        padding: 10px 20px;
        border: 1px solid #ffff00;
        border-radius: 5px;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        text-align: center;
      `;
      document.body.appendChild(posDialog);
    }

    posDialog.textContent = text;
    posDialog.style.display = "block";

    // Auto-hide after 3 seconds
    setTimeout(() => {
      if (posDialog) {
        posDialog.style.display = "none";
      }
    }, 3000);
  }

  private showNameRequest(text: string, maxLength: number): void {
    // Create or get name dialog
    let nameDialog = document.getElementById("name-dialog");
    if (!nameDialog) {
      nameDialog = document.createElement("div");
      nameDialog.id = "name-dialog";
      nameDialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px;
        border: 2px solid #00ff00;
        border-radius: 10px;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        text-align: center;
        min-width: 300px;
      `;
      document.body.appendChild(nameDialog);
    }

    // Clear previous content
    nameDialog.innerHTML = "";

    // Add question text
    const questionText = document.createElement("div");
    questionText.style.cssText = `
      font-size: 16px;
      margin-bottom: 15px;
    `;
    questionText.textContent = text;
    nameDialog.appendChild(questionText);

    // Add input field
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = maxLength;
    nameInput.placeholder = "Enter your name";
    nameInput.style.cssText = `
      width: 200px;
      padding: 8px;
      background: #333;
      color: white;
      border: 1px solid #666;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      margin-bottom: 15px;
    `;
    nameDialog.appendChild(nameInput);

    // Add submit button
    const submitButton = document.createElement("button");
    submitButton.textContent = "OK";
    submitButton.style.cssText = `
      padding: 8px 20px;
      background: #00aa00;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-family: 'Courier New', monospace;
      margin-left: 10px;
    `;

    const submitName = () => {
      const name = nameInput.value.trim() || "Adventurer";
      this.sendInput(name);
      nameDialog.style.display = "none";
    };

    submitButton.onclick = submitName;
    nameInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        submitName();
      }
    };

    nameDialog.appendChild(submitButton);

    // Show dialog and focus input
    nameDialog.style.display = "block";
    nameInput.focus();
  }

  private hideQuestion(): void {
    this.isInQuestion = false; // Clear general question state
    const questionDialog = document.getElementById("question-dialog");
    if (questionDialog) {
      questionDialog.style.display = "none";
      questionDialog.innerHTML = ""; // Clear content to prevent retention
      // Clear pickup dialog flags
      (questionDialog as any).isPickupDialog = false;
      (questionDialog as any).menuItems = null;
    }
  }

  private createPickupDialog(
    questionDialog: HTMLElement,
    menuItems: any[],
    question: string
  ): void {
    // Track selected items for multi-pickup
    const selectedItems = new Set<string>();

    menuItems.forEach((item) => {
      if (
        item.isCategory ||
        !item.accelerator ||
        item.accelerator.trim() === ""
      ) {
        // Category header
        const categoryHeader = document.createElement("div");
        categoryHeader.style.cssText = `
          font-size: 14px;
          font-weight: bold;
          color: #ffff00;
          margin: 15px 0 5px 0;
          text-align: left;
          border-bottom: 1px solid #444;
          padding-bottom: 3px;
        `;
        categoryHeader.textContent = item.text;
        questionDialog.appendChild(categoryHeader);
      } else {
        // Selectable item with checkbox
        const itemContainer = document.createElement("div");
        itemContainer.style.cssText = `
          display: flex;
          align-items: center;
          margin: 3px 0;
          padding: 8px;
          background: #333;
          border: 1px solid #666;
          border-radius: 3px;
          cursor: pointer;
          font-family: 'Courier New', monospace;
          line-height: 1.3;
        `;

        // Checkbox
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `pickup-${item.accelerator}`;
        checkbox.style.cssText = `
          margin-right: 8px;
          transform: scale(1.2);
        `;

        // Key label
        const keyPart = document.createElement("span");
        keyPart.style.cssText = `
          color: #00ff00;
          font-weight: bold;
          margin-right: 8px;
          min-width: 30px;
        `;
        keyPart.textContent = `${item.accelerator})`;

        // Item text
        const textPart = document.createElement("span");
        textPart.style.cssText = `
          color: white;
          flex: 1;
        `;
        textPart.textContent = item.text;

        // Toggle function
        const toggleItem = () => {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            selectedItems.add(item.accelerator);
            itemContainer.style.backgroundColor = "#444";
          } else {
            selectedItems.delete(item.accelerator);
            itemContainer.style.backgroundColor = "#333";
          }
          // Send the key to NetHack to keep game state in sync
          this.sendInput(item.accelerator);
        };

        // Click handlers
        itemContainer.onclick = (e) => {
          e.preventDefault();
          toggleItem();
        };

        checkbox.onchange = (e) => {
          e.stopPropagation();
          // Checkbox state already changed, just update selection tracking
          if (checkbox.checked) {
            selectedItems.add(item.accelerator);
            itemContainer.style.backgroundColor = "#444";
          } else {
            selectedItems.delete(item.accelerator);
            itemContainer.style.backgroundColor = "#333";
          }
          // Send the key to NetHack to keep game state in sync
          this.sendInput(item.accelerator);
        };

        // Store toggle function for keyboard access
        (itemContainer as any).toggleItem = toggleItem;
        (itemContainer as any).accelerator = item.accelerator;

        itemContainer.appendChild(checkbox);
        itemContainer.appendChild(keyPart);
        itemContainer.appendChild(textPart);
        questionDialog.appendChild(itemContainer);
      }
    });

    // Add confirmation instruction
    const confirmInstruction = document.createElement("div");
    confirmInstruction.style.cssText = `
      margin-top: 15px;
      padding: 10px;
      background: rgba(0, 255, 0, 0.1);
      border: 1px solid #00ff00;
      border-radius: 3px;
      text-align: center;
      color: #00ff00;
      font-weight: bold;
    `;
    confirmInstruction.textContent =
      "Press ENTER to confirm pickup, or ESC to cancel";
    questionDialog.appendChild(confirmInstruction);

    // Store that this is a pickup dialog for keyboard handling
    (questionDialog as any).isPickupDialog = true;
    (questionDialog as any).menuItems = menuItems;
  }

  private createStandardMenu(
    questionDialog: HTMLElement,
    menuItems: any[]
  ): void {
    menuItems.forEach((item) => {
      if (
        item.isCategory ||
        !item.accelerator ||
        item.accelerator.trim() === ""
      ) {
        // Category header
        const categoryHeader = document.createElement("div");
        categoryHeader.style.cssText = `
          font-size: 14px;
          font-weight: bold;
          color: #ffff00;
          margin: 15px 0 5px 0;
          text-align: left;
          border-bottom: 1px solid #444;
          padding-bottom: 3px;
        `;
        categoryHeader.textContent = item.text;
        questionDialog.appendChild(categoryHeader);
      } else {
        // Standard single-selection button
        const menuButton = document.createElement("button");
        menuButton.style.cssText = `
          display: block;
          width: 100%;
          margin: 3px 0;
          padding: 8px;
          background: #333;
          color: white;
          border: 1px solid #666;
          border-radius: 3px;
          cursor: pointer;
          font-family: 'Courier New', monospace;
          text-align: left;
          line-height: 1.3;
        `;

        // Format the button text with key and description
        const keyPart = document.createElement("span");
        keyPart.style.cssText = `
          color: #00ff00;
          font-weight: bold;
        `;
        keyPart.textContent = `${item.accelerator}) `;

        const textPart = document.createElement("span");
        textPart.textContent = item.text;

        menuButton.appendChild(keyPart);
        menuButton.appendChild(textPart);

        menuButton.onclick = () => {
          this.sendInput(item.accelerator);
          this.hideQuestion();
        };
        questionDialog.appendChild(menuButton);
      }
    });
  }

  private sendInput(input: string): void {
    if (this.session) {
      this.session.sendInput(input);
    }
  }
  private getModifiedInput(event: KeyboardEvent): string | null {
    // NetHack meta commands are represented as ESC + key on the server side.
    const hasMetaModifier = event.altKey || event.metaKey || this.altOrMetaHeld;
    if (event.ctrlKey || !hasMetaModifier) {
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

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Alt" || event.key === "Meta") {
      this.altOrMetaHeld = true;
      event.preventDefault();
      return;
    }

    // Handle escape key to close dialogs
    if (event.key === "Escape") {
      // Check if inventory dialog is open and close it
      const inventoryDialog = document.getElementById("inventory-dialog");
      if (inventoryDialog && inventoryDialog.style.display !== "none") {
        this.hideInventoryDialog();
        return;
      }

      // Check if info dialog is open and close it
      const infoDialog = document.getElementById("info-menu-dialog");
      if (infoDialog && infoDialog.style.display !== "none") {
        this.hideInfoMenuDialog();
        return;
      }

      // If we're in a question, send escape to NetHack to cancel the question
      if (this.isInQuestion || this.isInDirectionQuestion) {
        console.log("🔄 Sending Escape to NetHack to cancel question");
        this.sendInput("Escape");
      }

      // Clear UI dialogs and states
      this.hideQuestion();
      this.hideDirectionQuestion();
      const posDialog = document.getElementById("position-dialog");
      if (posDialog) {
        posDialog.style.display = "none";
      }
      // Clear question states when escape is pressed
      this.isInQuestion = false;
      this.isInDirectionQuestion = false;
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
            `Refreshing tile at (${this.playerPos.x}, ${this.playerPos.y})...`
          );
          return;

        case "m":
          event.preventDefault();
          this.toggleInfoMenuDialog();
          return;
      }
    }

    const modifiedInput = this.getModifiedInput(event);
    if (modifiedInput) {
      event.preventDefault();
      this.sendInput(modifiedInput);
      return;
    }

    // Handle inventory display (before other key processing)
    if (event.key === "i" || event.key === "I") {
      event.preventDefault();
      this.hideInfoMenuDialog();

      // Check if inventory dialog is already open
      const inventoryDialog = document.getElementById("inventory-dialog");
      if (inventoryDialog && inventoryDialog.style.display !== "none") {
        console.log("📦 Closing inventory dialog");
        this.hideInventoryDialog();
      } else {
        // If we already have inventory data, show it immediately
        if (this.currentInventory && this.currentInventory.length > 0) {
          console.log("📦 Showing inventory dialog with existing data");
          this.showInventoryDialog();
        } else {
          console.log("📦 Requesting current inventory from NetHack...");
          // First send "i" to NetHack to fetch current inventory
          this.sendInput("i");
          // Set a flag to show dialog when inventory update arrives
          this.pendingInventoryDialog = true;
        }
      }
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
    if (normalizedWaitKey) {
      event.preventDefault();
      if (this.isInDirectionQuestion) {
        this.sendInput(normalizedWaitKey);
        this.hideDirectionQuestion();
      } else {
        this.sendInput(normalizedWaitKey);
      }
      return;
    }

    // Handle diagonal movement keys during regular gameplay
    // Map navigation keys to numpad equivalents for NetHack
    if (!this.isInQuestion && !this.isInDirectionQuestion) {
      let mappedKey = null;

      switch (event.key) {
        case "Home":
          mappedKey = "7"; // Northwest
          console.log("🔄 Mapping Home to numpad 7 (Northwest)");
          break;
        case "PageUp":
          mappedKey = "9"; // Northeast
          console.log("🔄 Mapping PageUp to numpad 9 (Northeast)");
          break;
        case "End":
          mappedKey = "1"; // Southwest
          console.log("🔄 Mapping End to numpad 1 (Southwest)");
          break;
        case "PageDown":
          mappedKey = "3"; // Southeast
          console.log("🔄 Mapping PageDown to numpad 3 (Southeast)");
          break;
      }

      if (mappedKey) {
        // Send the mapped key instead of the original
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

        switch (event.key) {
          // Arrow keys - map to numpad equivalents
          case "ArrowUp":
            keyToSend = "8";
            break;
          case "ArrowDown":
            keyToSend = "2";
            break;
          case "ArrowLeft":
            keyToSend = "4";
            break;
          case "ArrowRight":
            keyToSend = "6";
            break;

          // Diagonal movement with Home/End/PageUp/PageDown
          case "Home":
            keyToSend = "7"; // Northwest
            break;
          case "PageUp":
            keyToSend = "9"; // Northeast
            break;
          case "End":
            keyToSend = "1"; // Southwest
            break;
          case "PageDown":
            keyToSend = "3"; // Southeast
            break;

          // Numpad keys - pass through directly (includes diagonals)
          case "1": // Southwest
          case "2": // South
          case "3": // Southeast
          case "4": // West
          case "5": // Wait/rest
          case "6": // East
          case "7": // Northwest
          case "8": // North
          case "9": // Northeast
            keyToSend = event.key;
            break;

          // Vertical directions and self-direction for target prompts
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

          // Space or period for self/wait direction
          case " ":
          case "Spacebar":
          case "Space":
          case ".":
          case "Decimal":
          case "NumpadDecimal":
            keyToSend = ".";
            break;
        }

        if (keyToSend) {
          this.sendInput(keyToSend);
          this.hideDirectionQuestion();
        }
        return; // Don't send other keys when in direction question mode
      }

      // For other questions, handle pickup dialogs specially
      const questionDialog = document.getElementById("question-dialog");
      if (questionDialog && (questionDialog as any).isPickupDialog) {
        // This is a pickup dialog - handle multi-selection
        if (event.key === "Enter") {
          // Confirm pickup and close dialog
          this.sendInput("Enter");
          this.hideQuestion();
        } else if (event.key === "Escape") {
          // Cancel pickup
          this.sendInput("Escape");
          this.hideQuestion();
        } else {
          // Toggle item selection - find matching item and toggle it
          const menuItems = (questionDialog as any).menuItems || [];
          const matchingItem = menuItems.find(
            (item: any) => item.accelerator === event.key && !item.isCategory
          );

          if (matchingItem) {
            // Find the corresponding item container and toggle it
            const containers = questionDialog.querySelectorAll(
              'div[style*="display: flex"]'
            );
            containers.forEach((container: Element) => {
              if (
                (container as any).accelerator === event.key &&
                (container as any).toggleItem
              ) {
                (container as any).toggleItem();
              }
            });
          } else {
            // Send the key anyway in case it's a valid NetHack command
            this.sendInput(event.key);
          }
        }
      } else {
        // Standard single-selection dialog - send key and close
        this.sendInput(event.key);
        this.hideQuestion();
      }
      return; // Don't allow normal movement during questions
    }

    // Send input to server for normal gameplay
    this.sendInput(event.key);
  }

  private updateCamera(): void {
    const { x, y } = this.playerPos;
    const targetX = x * TILE_SIZE + this.cameraPanX;
    const targetY = -y * TILE_SIZE + this.cameraPanY;

    // Use spherical coordinates for camera positioning
    const cosPitch = Math.cos(this.cameraPitch);
    const sinPitch = Math.sin(this.cameraPitch);
    const sinYaw = Math.sin(this.cameraYaw);
    const cosYaw = Math.cos(this.cameraYaw);

    const offsetX = this.cameraDistance * cosPitch * sinYaw;
    const offsetY = this.cameraDistance * cosPitch * cosYaw;
    const offsetZ = this.cameraDistance * sinPitch;

    // Position camera relative to player (with panning offset)
    this.camera.position.x = targetX + offsetX;
    this.camera.position.y = targetY + offsetY;
    this.camera.position.z = offsetZ;

    // Always look at the target position (player + pan offset)
    this.camera.lookAt(targetX, targetY, 0);
  }

  private wrapAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    angle = ((angle % twoPi) + twoPi) % twoPi;
    return angle > Math.PI ? angle - twoPi : angle;
  }

  private handleMouseWheel(event: WheelEvent): void {
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
      Math.min(this.maxDistance, this.cameraDistance + delta)
    );
  }

  private handleMouseDown(event: MouseEvent): void {
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

  private handleMouseMove(event: MouseEvent): void {
    if (this.isMiddleMouseDown) {
      // Middle mouse - rotate camera
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;

      this.cameraYaw = this.wrapAngle(
        this.cameraYaw - deltaX * this.rotationSpeed
      );
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch - deltaY * this.rotationSpeed,
        this.minCameraPitch,
        this.maxCameraPitch
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

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

// --- APPLICATION ENTRY POINT ---
const game = new Nethack3DEngine();

// Make game instance available globally for debugging
(window as any).nethackGame = game;

// Add some debugging helpers to the window object
(window as any).refreshTile = (x: number, y: number) => {
  game.requestTileUpdate(x, y);
};

(window as any).refreshArea = (
  centerX: number,
  centerY: number,
  radius: number = 3
) => {
  game.requestAreaUpdate(centerX, centerY, radius);
};

(window as any).refreshPlayerArea = (radius: number = 5) => {
  game.requestPlayerAreaUpdate(radius);
};

(window as any).dumpStatusDebug = () => {
  return (game as any).statusDebugHistory;
};

(window as any).toggleInfoMenu = () => {
  (game as any).toggleInfoMenuDialog();
};

console.log("🎮 NetHack 3D debugging helpers available:");
console.log("  refreshTile(x, y) - Refresh a specific tile");
console.log("  refreshArea(x, y, radius) - Refresh an area");
console.log("  refreshPlayerArea(radius) - Refresh around player");
console.log("  dumpStatusDebug() - Get recent status_update payloads");
console.log("  Ctrl+T - Refresh player tile");
console.log("  Ctrl+R - Refresh player area (radius 5)");
console.log("  Ctrl+Shift+R - Refresh large player area (radius 10)");
console.log("🕹️ Movement controls:");
console.log("  Arrow keys - Cardinal directions (N/S/E/W)");
console.log("  Numpad 1-9 - All directions including diagonals");
console.log("  Home/PgUp/End/PgDn - Diagonal movement (NW/NE/SW/SE)");
console.log("  Numpad 5 or Space - Wait/rest");
console.log("📦 Interface controls:");
console.log("  'i' - Open/close inventory dialog");
console.log("  ESC - Close dialogs or cancel actions");
console.log("  Ctrl+M - Toggle latest information panel");

export default game;



