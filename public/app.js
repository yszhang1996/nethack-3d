// src/game/Nethack3DEngine.ts
import * as THREE from "./three.module.js";

// src/runtime/LocalNetHackRuntime.ts
var process = typeof globalThis !== "undefined" && globalThis.process ? globalThis.process : { env: {} };

// src/runtime/WorkerRuntimeBridge.ts
var WorkerRuntimeBridge = class {
  constructor(onEvent) {
    this.startPromise = null;
    this.startResolve = null;
    this.startReject = null;
    this.onEvent = onEvent;
    this.worker = new Worker("runtime-worker.js");
    this.worker.onmessage = (message) => {
      this.handleWorkerMessage(message.data);
    };
    this.worker.onerror = (error) => {
      if (this.startReject) {
        this.startReject(error);
      }
      console.error("Runtime worker error:", error);
    };
  }
  start() {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.postCommand({ type: "start" });
    });
    return this.startPromise;
  }
  sendInput(input) {
    this.postCommand({ type: "send_input", input });
  }
  requestTileUpdate(x, y) {
    this.postCommand({ type: "request_tile_update", x, y });
  }
  requestAreaUpdate(centerX, centerY, radius) {
    this.postCommand({
      type: "request_area_update",
      centerX,
      centerY,
      radius
    });
  }
  postCommand(command) {
    this.worker.postMessage(command);
  }
  handleWorkerMessage(message) {
    switch (message.type) {
      case "runtime_ready":
        if (this.startResolve) {
          this.startResolve();
          this.startResolve = null;
          this.startReject = null;
        }
        break;
      case "runtime_error":
        if (this.startReject) {
          this.startReject(new Error(message.error));
          this.startResolve = null;
          this.startReject = null;
        } else {
          console.error("Runtime error:", message.error);
        }
        break;
      case "runtime_event":
        this.onEvent(message.event);
        break;
      default:
        break;
    }
  }
};

// src/game/constants.ts
var TILE_SIZE = 1;
var WALL_HEIGHT = 1;

// src/game/Nethack3DEngine.ts
var Nethack3DEngine = class {
  constructor() {
    this.tileMap = /* @__PURE__ */ new Map();
    this.glyphOverlayMap = /* @__PURE__ */ new Map();
    this.tileStateCache = /* @__PURE__ */ new Map();
    this.lastKnownTerrain = /* @__PURE__ */ new Map();
    this.pendingTileUpdates = /* @__PURE__ */ new Map();
    this.tileFlushScheduled = false;
    this.playerPos = { x: 0, y: 0 };
    this.gameMessages = [];
    this.statusDebugHistory = [];
    this.currentInventory = [];
    // Store current inventory items
    this.pendingInventoryDialog = false;
    // Flag to show inventory dialog after update
    this.lastInfoMenu = null;
    // Player stats tracking
    this.playerStats = {
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
      score: 0
    };
    this.session = null;
    this.metaInputPrefix = "__META__:";
    this.altOrMetaHeld = false;
    // Camera controls
    this.cameraDistance = 20;
    this.cameraPitch = Math.PI / 2 - 0.3;
    // Elevation above the board (0 = horizon)
    this.cameraYaw = 0;
    // Azimuth around the board (0 = facing north)
    this.minCameraPitch = 0.2;
    this.maxCameraPitch = Math.PI / 2 - 0.01;
    this.rotationSpeed = 0.01;
    this.isMiddleMouseDown = false;
    this.isRightMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.minDistance = 5;
    this.maxDistance = 50;
    // Direction question handling
    this.isInDirectionQuestion = false;
    // General question handling (pauses all movement)
    this.isInQuestion = false;
    // Camera panning
    this.cameraPanX = 0;
    this.cameraPanY = 0;
    // Pre-create geometries and materials
    this.floorGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    this.wallGeometry = new THREE.BoxGeometry(
      TILE_SIZE,
      TILE_SIZE,
      WALL_HEIGHT
    );
    // Materials for different glyph types
    this.materials = {
      floor: new THREE.MeshLambertMaterial({ color: 9127187 }),
      // Brown floor
      wall: new THREE.MeshLambertMaterial({ color: 6710886 }),
      // Gray wall
      door: new THREE.MeshLambertMaterial({ color: 9127187 }),
      // Brown door
      dark: new THREE.MeshLambertMaterial({ color: 85 }),
      // Dark blue for unseen areas
      fountain: new THREE.MeshLambertMaterial({ color: 35071 }),
      // Light blue for water fountains
      player: new THREE.MeshLambertMaterial({
        color: 65280,
        emissive: 17408
      }),
      // Green glowing player
      monster: new THREE.MeshLambertMaterial({
        color: 16711680,
        emissive: 4456448
      }),
      // Red glowing monster
      item: new THREE.MeshLambertMaterial({
        color: 33023,
        emissive: 4420
      }),
      // Blue glowing item
      default: new THREE.MeshLambertMaterial({ color: 16777215 })
    };
    this.initThreeJS();
    this.initUI();
    this.connectToRuntime();
    this.cameraDistance = 15;
    this.cameraPitch = THREE.MathUtils.clamp(
      Math.PI / 2 - 0.2,
      this.minCameraPitch,
      this.maxCameraPitch
    );
    this.cameraYaw = Math.PI;
  }
  initThreeJS() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1e3
    );
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(17);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);
    const ambientLight = new THREE.AmbientLight(4210752, 0.4);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(16777215, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    window.addEventListener("keydown", this.handleKeyDown.bind(this), false);
    window.addEventListener("keyup", this.handleKeyUp.bind(this), false);
    window.addEventListener("blur", this.handleWindowBlur.bind(this), false);
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
    window.addEventListener("contextmenu", (e) => e.preventDefault(), false);
    this.animate();
  }
  initUI() {
    const statusElement = document.getElementById("game-status");
    if (statusElement) {
      statusElement.innerHTML = "Starting local NetHack runtime...";
    }
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
  async connectToRuntime() {
    console.log("Starting local NetHack runtime");
    this.updateConnectionStatus("Starting", "#4444aa");
    this.session = new WorkerRuntimeBridge((payload) => {
      this.handleRuntimeEvent(payload);
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
  handleRuntimeEvent(data) {
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
          `\u{1F3AF} Received player position update: (${data.x}, ${data.y})`
        );
        const oldPos = { ...this.playerPos };
        this.playerPos = { x: data.x, y: data.y };
        console.log(
          `\u{1F3AF} Player position changed from (${oldPos.x}, ${oldPos.y}) to (${data.x}, ${data.y})`
        );
        this.updateStatus(`Player at (${data.x}, ${data.y}) - NetHack 3D`);
        break;
      case "force_player_redraw":
        console.log(
          `\u{1F3AF} Force redraw player from (${data.oldPosition.x}, ${data.oldPosition.y}) to (${data.newPosition.x}, ${data.newPosition.y})`
        );
        this.playerPos = { x: data.newPosition.x, y: data.newPosition.y };
        const oldKey = `${data.oldPosition.x},${data.oldPosition.y}`;
        const oldOverlay = this.glyphOverlayMap.get(oldKey);
        if (oldOverlay) {
          console.log(
            `\u{1F3AF} Clearing old player overlay at (${data.oldPosition.x}, ${data.oldPosition.y})`
          );
          this.disposeGlyphOverlay(oldOverlay);
          this.glyphOverlayMap.delete(oldKey);
        }
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
        this.updateTile(data.newPosition.x, data.newPosition.y, 331, "@", 0);
        console.log(
          `\u{1F3AF} Player visual updated to position (${data.newPosition.x}, ${data.newPosition.y})`
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
        this.isInQuestion = true;
        this.showDirectionQuestion(data.text);
        break;
      case "question":
        if (data.text && (data.text.includes("character") || data.text.includes("class") || data.text.includes("race") || data.text.includes("gender") || data.text.includes("alignment"))) {
          console.log("Auto-handling character creation:", data.text);
          if (data.menuItems && data.menuItems.length > 0) {
            this.sendInput(data.menuItems[0].accelerator);
          } else if (data.default) {
            this.sendInput(data.default);
          } else {
            this.sendInput("a");
          }
          return;
        }
        this.isInQuestion = true;
        this.showQuestion(
          data.text,
          data.choices,
          data.default,
          data.menuItems
        );
        break;
      case "inventory_update":
        const itemCount = data.items ? data.items.length : 0;
        const actualItems = data.items ? data.items.filter((item) => !item.isCategory) : [];
        console.log(
          `\u{1F4E6} Received inventory update with ${itemCount} total items (${actualItems.length} actual items)`
        );
        this.currentInventory = data.items || [];
        if (this.pendingInventoryDialog) {
          console.log("\u{1F4E6} Showing inventory dialog with fresh data");
          this.pendingInventoryDialog = false;
          this.showInventoryDialog();
        }
        this.updateInventoryDisplay(data.items);
        break;
      case "info_menu":
        this.lastInfoMenu = {
          title: String(data.title || "NetHack Information"),
          lines: Array.isArray(data.lines) ? data.lines : []
        };
        this.showInfoMenuDialog(this.lastInfoMenu.title, this.lastInfoMenu.lines);
        break;
      case "position_request":
        if (data.text && data.text.trim() && !data.text.includes("cursor") && !data.text.includes("Select a position")) {
          this.showPositionRequest(data.text);
        }
        break;
      case "name_request":
        console.log("Auto-providing default name for:", data.text);
        this.sendInput("Player");
        break;
      case "area_refresh_complete":
        console.log(
          `\u{1F504} Area refresh completed: ${data.tilesRefreshed} tiles refreshed around (${data.centerX}, ${data.centerY})`
        );
        this.addGameMessage(
          `Refreshed ${data.tilesRefreshed} tiles around (${data.centerX}, ${data.centerY})`
        );
        break;
      case "tile_not_found":
        console.log(
          `\u26A0\uFE0F Tile not found at (${data.x}, ${data.y}): ${data.message}`
        );
        break;
      case "clear_scene":
        console.log("\u{1F9F9} Clearing 3D scene for level transition");
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
  enqueueTileUpdate(tile) {
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
  flushPendingTileUpdates() {
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
  requestTileUpdate(x, y) {
    if (this.session) {
      console.log(`Requesting tile update for (${x}, ${y})`);
      this.session.requestTileUpdate(x, y);
    } else {
      console.log("Cannot request tile update - runtime not started");
    }
  }
  requestAreaUpdate(centerX, centerY, radius = 3) {
    if (this.session) {
      console.log(
        `Requesting area update centered at (${centerX}, ${centerY}) with radius ${radius}`
      );
      this.session.requestAreaUpdate(centerX, centerY, radius);
    } else {
      console.log("Cannot request area update - runtime not started");
    }
  }
  requestPlayerAreaUpdate(radius = 5) {
    this.requestAreaUpdate(this.playerPos.x, this.playerPos.y, radius);
  }
  disposeGlyphOverlay(overlay) {
    if (overlay.texture) {
      overlay.texture.dispose();
      overlay.texture = null;
    }
    overlay.material.dispose();
  }
  toneColor(hex, factor) {
    const color = new THREE.Color(`#${hex}`);
    color.multiplyScalar(THREE.MathUtils.clamp(factor, 0, 1));
    return color.getHexString();
  }
  ensureGlyphOverlay(key, baseMaterial) {
    const baseColorHex = baseMaterial.color.getHexString();
    let overlay = this.glyphOverlayMap.get(key);
    const needsNewOverlay = !overlay || overlay.baseColorHex !== baseColorHex || overlay.material instanceof THREE.MeshLambertMaterial === true;
    if (needsNewOverlay) {
      if (overlay) {
        this.disposeGlyphOverlay(overlay);
      }
      const materialClone = new THREE.MeshBasicMaterial({
        color: 14540253
      });
      overlay = {
        texture: null,
        material: materialClone,
        baseColorHex,
        textureKey: ""
      };
      this.glyphOverlayMap.set(key, overlay);
    }
    return overlay;
  }
  createGlyphTexture(baseColorHex, glyphChar, textColor, darkenFactor = 1, size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const tonedBackground = this.toneColor(
      baseColorHex,
      0.8 * THREE.MathUtils.clamp(darkenFactor, 0, 1)
    );
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
  applyGlyphMaterial(key, mesh, baseMaterial, glyphChar, textColor, isWall, darkenFactor = 1) {
    const overlay = this.ensureGlyphOverlay(key, baseMaterial);
    const baseColorHex = baseMaterial.color.getHexString();
    const clampedDarken = THREE.MathUtils.clamp(darkenFactor, 0, 1);
    const textureKey = `${baseColorHex}|${glyphChar}|${textColor}|${clampedDarken.toFixed(3)}`;
    if (overlay.textureKey !== textureKey) {
      if (overlay.texture) {
        overlay.texture.dispose();
      }
      overlay.baseColorHex = baseColorHex;
      overlay.material.color.set("#ffffff");
      overlay.texture = this.createGlyphTexture(
        baseColorHex,
        glyphChar,
        textColor,
        clampedDarken
      );
      overlay.material.map = overlay.texture;
      overlay.material.needsUpdate = true;
      overlay.textureKey = textureKey;
    }
    overlay.material.color.set("#ffffff");
    if (isWall) {
      mesh.material = [
        baseMaterial,
        baseMaterial,
        baseMaterial,
        baseMaterial,
        overlay.material,
        baseMaterial
      ];
    } else {
      mesh.material = overlay.material;
    }
  }
  glyphToChar(glyph) {
    if (glyph >= 2395 && glyph <= 2397) return ".";
    if (glyph >= 2378 && glyph <= 2394) {
      switch (glyph) {
        case 2378:
          return "|";
        // vertical wall
        case 2379:
          return "-";
        // horizontal wall
        case 2380:
          return "-";
        // top-left corner
        case 2381:
          return "-";
        // top-right corner
        case 2382:
          return "-";
        // bottom-left corner
        case 2383:
          return "-";
        // bottom-right corner
        case 2389:
          return "+";
        // closed door
        case 2390:
          return "-";
        // open horizontal door
        case 2391:
          return "|";
        // open vertical door
        case 2392:
          return "+";
        // closed vertical door
        default:
          return "#";
      }
    }
    if (glyph === 2409) return "|";
    if (glyph === 2410) return "-";
    if (glyph === 2411 || glyph === 2412) return "+";
    if (glyph >= 331 && glyph <= 360) return "@";
    if (glyph >= 400 && glyph <= 500) {
      if (glyph >= 400 && glyph <= 410) return "d";
      if (glyph >= 411 && glyph <= 420) return "k";
      if (glyph >= 421 && glyph <= 430) return "o";
      return "M";
    }
    if (glyph >= 1900 && glyph <= 2400) {
      if (glyph >= 1920 && glyph <= 1930) return ")";
      if (glyph >= 2e3 && glyph <= 2100) return "[";
      if (glyph >= 2180 && glyph <= 2220) return "%";
      if (glyph >= 2220 && glyph <= 2260) return "(";
      return "*";
    }
    if (glyph === 237) return "<";
    if (glyph === 238) return ">";
    if (glyph === 2334) return "#";
    if (glyph === 2223) return "\\";
    return "?";
  }
  isOpenDoorGlyph(glyph) {
    return glyph === 2390 || glyph === 2391 || glyph === 2409 || glyph === 2410;
  }
  isClosedDoorGlyph(glyph) {
    return glyph === 2389 || glyph === 2392 || glyph === 2411 || glyph === 2412;
  }
  isStructuralWallGlyph(glyph) {
    return glyph >= 2378 && glyph <= 2394;
  }
  isDarkOverlayGlyph(glyph) {
    return glyph === 2397 || glyph === 2398 || glyph === 2377;
  }
  getDoorState(glyph, char) {
    if (this.isOpenDoorGlyph(glyph)) return "open";
    if (this.isClosedDoorGlyph(glyph)) return "closed";
    if (char === "+") return "closed";
    return null;
  }
  clearScene() {
    console.log("\u{1F9F9} Clearing all tiles and glyph overlays from 3D scene");
    this.tileMap.forEach((mesh, key) => {
      this.scene.remove(mesh);
    });
    this.tileMap.clear();
    this.glyphOverlayMap.forEach((overlay) => {
      this.disposeGlyphOverlay(overlay);
    });
    this.glyphOverlayMap.clear();
    this.tileStateCache.clear();
    this.lastKnownTerrain.clear();
    this.pendingTileUpdates.clear();
    this.tileFlushScheduled = false;
    console.log("\u{1F9F9} Scene cleared - ready for new level");
  }
  updateTile(x, y, glyph, char, color) {
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
        material = isDarkOverlay && glyph === 2398 ? this.materials.dark : this.materials.floor;
        geometry = this.floorGeometry;
      } else if (effectiveChar === "|" || effectiveChar === "-") {
        if (this.isStructuralWallGlyph(effectiveGlyph)) {
          material = this.materials.wall;
          geometry = this.wallGeometry;
          isWall = true;
        } else {
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
    const glyphChar = isDarkOverlay ? char || this.glyphToChar(glyph) : effectiveChar || this.glyphToChar(effectiveGlyph);
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
  addGameMessage(message) {
    if (!message || message.trim() === "") return;
    this.gameMessages.unshift(message);
    if (this.gameMessages.length > 100) {
      this.gameMessages.pop();
    }
    const logElement = document.getElementById("game-log");
    if (logElement) {
      logElement.innerHTML = this.gameMessages.join("<br>");
      logElement.scrollTop = 0;
    }
  }
  updateStatus(status) {
    const statusElement = document.getElementById("game-status");
    if (statusElement) {
      statusElement.innerHTML = status;
    }
  }
  updateConnectionStatus(status, color) {
    const connElement = document.getElementById("connection-status");
    if (connElement) {
      connElement.innerHTML = status;
      connElement.style.backgroundColor = color;
    }
  }
  updatePlayerStats(field, value, data) {
    const legacyByIndex = {
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
      21: "gold"
    };
    const byName = {
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
      BL_GOLD: "gold"
    };
    const rawFieldName = typeof data?.fieldName === "string" ? data.fieldName : null;
    const mappedField = rawFieldName && byName[rawFieldName] || legacyByIndex[field] || null;
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
      colormask: data?.colormask
    });
    if (this.statusDebugHistory.length > 200) {
      this.statusDebugHistory.pop();
    }
    if (!mappedField || value === null || value === void 0) {
      console.log(
        `Skipping status update: field=${field}, fieldName=${rawFieldName}, value=${value}`
      );
      return;
    }
    const numericFields = /* @__PURE__ */ new Set([
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
      "charisma"
    ]);
    let parsedValue = value;
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
      this.playerStats[mappedField] = parsedValue;
    }
    this.updateStatsDisplay();
  }
  updateStatsDisplay() {
    let statsBar = document.getElementById("stats-bar");
    if (!statsBar) {
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
      const gameLogContainer = document.querySelector(
        ".top-left-ui"
      );
      if (gameLogContainer) {
        gameLogContainer.style.top = "65px";
      }
    }
    const hpPercentage = this.playerStats.maxHp > 0 ? this.playerStats.hp / this.playerStats.maxHp * 100 : 0;
    const hpColor = hpPercentage > 60 ? "#00ff00" : hpPercentage > 30 ? "#ffaa00" : "#ff0000";
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
    let powerBar = "";
    if (this.playerStats.maxPower > 0) {
      const powerPercentage = this.playerStats.power / this.playerStats.maxPower * 100;
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
        <div style="color: #cccccc;">${this.playerStats.dungeon} ${this.playerStats.dlevel}</div>
        <div style="color: #ffaaff;">${this.playerStats.hunger}${this.playerStats.encumbrance ? " " + this.playerStats.encumbrance : ""}</div>
      </div>
    `;
  }
  updateInventoryDisplay(items) {
    if (!items || items.length === 0) {
      console.log("\u{1F4E6} Inventory is empty");
      return;
    }
    console.log("\u{1F4E6} Current inventory:");
    items.forEach((item, index) => {
      if (item.isCategory) {
        console.log(`  \u{1F4C1} ${item.text}`);
      } else {
        console.log(`  ${item.accelerator || "?"}) ${item.text}`);
      }
    });
  }
  showQuestion(question, choices, defaultChoice, menuItems) {
    const needsExpansion = false;
    if (needsExpansion) {
      console.log(
        "\u{1F50D} Question includes '?' option, automatically expanding options..."
      );
      this.sendInput("?");
      return;
    }
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
    questionDialog.innerHTML = "";
    const questionText = document.createElement("div");
    questionText.style.cssText = `
      font-size: 16px;
      margin-bottom: 15px;
      line-height: 1.4;
    `;
    questionText.textContent = question;
    questionDialog.appendChild(questionText);
    if (menuItems && menuItems.length > 0) {
      const isPickupDialog = question && (question.toLowerCase().includes("pick up what") || question.toLowerCase().includes("pick up") || question.toLowerCase().includes("what do you want to pick up"));
      if (isPickupDialog) {
        this.createPickupDialog(questionDialog, menuItems, question);
      } else {
        this.createStandardMenu(questionDialog, menuItems);
      }
    } else {
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
    const escapeText = document.createElement("div");
    escapeText.style.cssText = `
      font-size: 12px;
      color: #aaa;
      margin-top: 15px;
    `;
    escapeText.textContent = "Press ESC to cancel";
    questionDialog.appendChild(escapeText);
    questionDialog.style.display = "block";
  }
  showDirectionQuestion(question) {
    this.isInDirectionQuestion = true;
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
    directionDialog.innerHTML = "";
    const questionText = document.createElement("div");
    questionText.style.cssText = `
      font-size: 16px;
      margin-bottom: 20px;
      line-height: 1.4;
      color: #ffff00;
    `;
    questionText.textContent = question;
    directionDialog.appendChild(questionText);
    const directionsContainer = document.createElement("div");
    directionsContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 80px);
      gap: 5px;
      justify-content: center;
      margin: 20px 0;
    `;
    const directions = [
      { key: "7", label: "\u2196", name: "NW" },
      { key: "8", label: "\u2191", name: "N" },
      { key: "9", label: "\u2197", name: "NE" },
      { key: "4", label: "\u2190", name: "W" },
      { key: "5", label: "\u2022", name: "Wait" },
      { key: "6", label: "\u2192", name: "E" },
      { key: "1", label: "\u2199", name: "SW" },
      { key: "2", label: "\u2193", name: "S" },
      { key: "3", label: "\u2198", name: "SE" }
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
    const escapeText = document.createElement("div");
    escapeText.style.cssText = `
      font-size: 12px;
      color: #aaa;
      margin-top: 15px;
    `;
    escapeText.textContent = "Use numpad (1-9), arrow keys, or click a direction. Press ESC to cancel";
    directionDialog.appendChild(escapeText);
    directionDialog.style.display = "block";
  }
  hideDirectionQuestion() {
    this.isInDirectionQuestion = false;
    this.isInQuestion = false;
    const directionDialog = document.getElementById("direction-dialog");
    if (directionDialog) {
      directionDialog.style.display = "none";
    }
  }
  showInfoMenuDialog(title, lines) {
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
  hideInfoMenuDialog() {
    const infoDialog = document.getElementById("info-menu-dialog");
    if (infoDialog) {
      infoDialog.style.display = "none";
    }
  }
  toggleInfoMenuDialog() {
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
  showInventoryDialog() {
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
    inventoryDialog.innerHTML = "";
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
    title.textContent = "\u{1F4E6} INVENTORY";
    inventoryDialog.appendChild(title);
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
      this.currentInventory.forEach((item, index) => {
        if (item.isCategory) {
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
    const keybindsTitle = document.createElement("div");
    keybindsTitle.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      color: #ffff00;
      margin-bottom: 8px;
      border-top: 1px solid #444;
      padding-top: 12px;
    `;
    keybindsTitle.textContent = "\u{1F3AE} ITEM COMMANDS";
    inventoryDialog.appendChild(keybindsTitle);
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
    const commandText = `<span style="color: #88ff88;">a</span>)pply <span style="color: #88ff88;">d</span>)rop <span style="color: #88ff88;">e</span>)at <span style="color: #88ff88;">q</span>)uaff <span style="color: #88ff88;">r</span>)ead <span style="color: #88ff88;">t</span>)hrow <span style="color: #88ff88;">w</span>)ield <span style="color: #88ff88;">W</span>)ear <span style="color: #88ff88;">T</span>)ake-off <span style="color: #88ff88;">P</span>)ut-on <span style="color: #88ff88;">R</span>)emove <span style="color: #88ff88;">z</span>)ap <span style="color: #88ff88;">Z</span>)cast
    Special: <span style="color: #88ff88;">"</span>)weapons <span style="color: #88ff88;">[</span>)armor <span style="color: #88ff88;">=</span>)rings <span style="color: #88ff88;">"</span>)amulets <span style="color: #88ff88;">(</span>)tools`;
    keybindsContainer.innerHTML = `<div style="color: #cccccc; white-space: pre-line;">${commandText}</div>`;
    inventoryDialog.appendChild(keybindsContainer);
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
    inventoryDialog.style.display = "block";
  }
  hideInventoryDialog() {
    const inventoryDialog = document.getElementById("inventory-dialog");
    if (inventoryDialog) {
      inventoryDialog.style.display = "none";
    }
    this.pendingInventoryDialog = false;
  }
  showPositionRequest(text) {
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
    setTimeout(() => {
      if (posDialog) {
        posDialog.style.display = "none";
      }
    }, 3e3);
  }
  showNameRequest(text, maxLength) {
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
    nameDialog.innerHTML = "";
    const questionText = document.createElement("div");
    questionText.style.cssText = `
      font-size: 16px;
      margin-bottom: 15px;
    `;
    questionText.textContent = text;
    nameDialog.appendChild(questionText);
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
    nameDialog.style.display = "block";
    nameInput.focus();
  }
  hideQuestion() {
    this.isInQuestion = false;
    const questionDialog = document.getElementById("question-dialog");
    if (questionDialog) {
      questionDialog.style.display = "none";
      questionDialog.innerHTML = "";
      questionDialog.isPickupDialog = false;
      questionDialog.menuItems = null;
    }
  }
  createPickupDialog(questionDialog, menuItems, question) {
    const selectedItems = /* @__PURE__ */ new Set();
    menuItems.forEach((item) => {
      if (item.isCategory || !item.accelerator || item.accelerator.trim() === "") {
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
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `pickup-${item.accelerator}`;
        checkbox.style.cssText = `
          margin-right: 8px;
          transform: scale(1.2);
        `;
        const keyPart = document.createElement("span");
        keyPart.style.cssText = `
          color: #00ff00;
          font-weight: bold;
          margin-right: 8px;
          min-width: 30px;
        `;
        keyPart.textContent = `${item.accelerator})`;
        const textPart = document.createElement("span");
        textPart.style.cssText = `
          color: white;
          flex: 1;
        `;
        textPart.textContent = item.text;
        const toggleItem = () => {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            selectedItems.add(item.accelerator);
            itemContainer.style.backgroundColor = "#444";
          } else {
            selectedItems.delete(item.accelerator);
            itemContainer.style.backgroundColor = "#333";
          }
          this.sendInput(item.accelerator);
        };
        itemContainer.onclick = (e) => {
          e.preventDefault();
          toggleItem();
        };
        checkbox.onchange = (e) => {
          e.stopPropagation();
          if (checkbox.checked) {
            selectedItems.add(item.accelerator);
            itemContainer.style.backgroundColor = "#444";
          } else {
            selectedItems.delete(item.accelerator);
            itemContainer.style.backgroundColor = "#333";
          }
          this.sendInput(item.accelerator);
        };
        itemContainer.toggleItem = toggleItem;
        itemContainer.accelerator = item.accelerator;
        itemContainer.appendChild(checkbox);
        itemContainer.appendChild(keyPart);
        itemContainer.appendChild(textPart);
        questionDialog.appendChild(itemContainer);
      }
    });
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
    confirmInstruction.textContent = "Press ENTER to confirm pickup, or ESC to cancel";
    questionDialog.appendChild(confirmInstruction);
    questionDialog.isPickupDialog = true;
    questionDialog.menuItems = menuItems;
  }
  createStandardMenu(questionDialog, menuItems) {
    menuItems.forEach((item) => {
      if (item.isCategory || !item.accelerator || item.accelerator.trim() === "") {
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
  sendInput(input) {
    if (this.session) {
      this.session.sendInput(input);
    }
  }
  getModifiedInput(event) {
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
  getMetaPrimaryKey(event) {
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
  handleKeyUp(event) {
    if (event.key === "Alt" || event.key === "Meta") {
      this.altOrMetaHeld = false;
    }
  }
  handleWindowBlur() {
    this.altOrMetaHeld = false;
  }
  normalizeWaitKey(event) {
    if (event.key === ">") {
      return null;
    }
    if (event.key === "." || event.key === " " || event.key === "Spacebar" || event.key === "Space" || event.key === "Decimal" || event.key === "NumpadDecimal" || event.code === "NumpadDecimal" || event.code === "Space") {
      return ".";
    }
    return null;
  }
  handleKeyDown(event) {
    if (event.key === "Alt" || event.key === "Meta") {
      this.altOrMetaHeld = true;
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      const inventoryDialog = document.getElementById("inventory-dialog");
      if (inventoryDialog && inventoryDialog.style.display !== "none") {
        this.hideInventoryDialog();
        return;
      }
      const infoDialog = document.getElementById("info-menu-dialog");
      if (infoDialog && infoDialog.style.display !== "none") {
        this.hideInfoMenuDialog();
        return;
      }
      if (this.isInQuestion || this.isInDirectionQuestion) {
        console.log("\u{1F504} Sending Escape to NetHack to cancel question");
        this.sendInput("Escape");
      }
      this.hideQuestion();
      this.hideDirectionQuestion();
      const posDialog = document.getElementById("position-dialog");
      if (posDialog) {
        posDialog.style.display = "none";
      }
      this.isInQuestion = false;
      this.isInDirectionQuestion = false;
      return;
    }
    if (event.ctrlKey) {
      switch (event.key.toLowerCase()) {
        case "r":
          if (event.shiftKey) {
            event.preventDefault();
            console.log("\u{1F504} Manual refresh requested for large player area");
            this.requestPlayerAreaUpdate(10);
            this.addGameMessage("Refreshing large area around player...");
            return;
          } else {
            event.preventDefault();
            console.log("\u{1F504} Manual refresh requested for player area");
            this.requestPlayerAreaUpdate(5);
            this.addGameMessage("Refreshing area around player...");
            return;
          }
        case "t":
          event.preventDefault();
          console.log("\u{1F504} Manual refresh requested for player tile");
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
    if (event.key === "i" || event.key === "I") {
      event.preventDefault();
      this.hideInfoMenuDialog();
      const inventoryDialog = document.getElementById("inventory-dialog");
      if (inventoryDialog && inventoryDialog.style.display !== "none") {
        console.log("\u{1F4E6} Closing inventory dialog");
        this.hideInventoryDialog();
      } else {
        if (this.currentInventory && this.currentInventory.length > 0) {
          console.log("\u{1F4E6} Showing inventory dialog with existing data");
          this.showInventoryDialog();
        } else {
          console.log("\u{1F4E6} Requesting current inventory from NetHack...");
          this.sendInput("i");
          this.pendingInventoryDialog = true;
        }
      }
      return;
    }
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
      "F12"
    ];
    if (modifierKeys.indexOf(event.key) !== -1) {
      console.log(`\u{1F6AB} Filtering out modifier key: ${event.key}`);
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
    if (!this.isInQuestion && !this.isInDirectionQuestion) {
      let mappedKey = null;
      switch (event.key) {
        case "Home":
          mappedKey = "7";
          console.log("\u{1F504} Mapping Home to numpad 7 (Northwest)");
          break;
        case "PageUp":
          mappedKey = "9";
          console.log("\u{1F504} Mapping PageUp to numpad 9 (Northeast)");
          break;
        case "End":
          mappedKey = "1";
          console.log("\u{1F504} Mapping End to numpad 1 (Southwest)");
          break;
        case "PageDown":
          mappedKey = "3";
          console.log("\u{1F504} Mapping PageDown to numpad 3 (Southeast)");
          break;
      }
      if (mappedKey) {
        this.sendInput(mappedKey);
        return;
      }
    }
    if (this.isInQuestion || this.isInDirectionQuestion) {
      if (this.isInDirectionQuestion) {
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
            keyToSend = "7";
            break;
          case "PageUp":
            keyToSend = "9";
            break;
          case "End":
            keyToSend = "1";
            break;
          case "PageDown":
            keyToSend = "3";
            break;
          // Numpad keys - pass through directly (includes diagonals)
          case "1":
          // Southwest
          case "2":
          // South
          case "3":
          // Southeast
          case "4":
          // West
          case "5":
          // Wait/rest
          case "6":
          // East
          case "7":
          // Northwest
          case "8":
          // North
          case "9":
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
        return;
      }
      const questionDialog = document.getElementById("question-dialog");
      if (questionDialog && questionDialog.isPickupDialog) {
        if (event.key === "Enter") {
          this.sendInput("Enter");
          this.hideQuestion();
        } else if (event.key === "Escape") {
          this.sendInput("Escape");
          this.hideQuestion();
        } else {
          const menuItems = questionDialog.menuItems || [];
          const matchingItem = menuItems.find(
            (item) => item.accelerator === event.key && !item.isCategory
          );
          if (matchingItem) {
            const containers = questionDialog.querySelectorAll(
              'div[style*="display: flex"]'
            );
            containers.forEach((container) => {
              if (container.accelerator === event.key && container.toggleItem) {
                container.toggleItem();
              }
            });
          } else {
            this.sendInput(event.key);
          }
        }
      } else {
        this.sendInput(event.key);
        this.hideQuestion();
      }
      return;
    }
    this.sendInput(event.key);
  }
  updateCamera() {
    const { x, y } = this.playerPos;
    const targetX = x * TILE_SIZE + this.cameraPanX;
    const targetY = -y * TILE_SIZE + this.cameraPanY;
    const cosPitch = Math.cos(this.cameraPitch);
    const sinPitch = Math.sin(this.cameraPitch);
    const sinYaw = Math.sin(this.cameraYaw);
    const cosYaw = Math.cos(this.cameraYaw);
    const offsetX = this.cameraDistance * cosPitch * sinYaw;
    const offsetY = this.cameraDistance * cosPitch * cosYaw;
    const offsetZ = this.cameraDistance * sinPitch;
    this.camera.position.x = targetX + offsetX;
    this.camera.position.y = targetY + offsetY;
    this.camera.position.z = offsetZ;
    this.camera.lookAt(targetX, targetY, 0);
  }
  wrapAngle(angle) {
    const twoPi = Math.PI * 2;
    angle = (angle % twoPi + twoPi) % twoPi;
    return angle > Math.PI ? angle - twoPi : angle;
  }
  handleMouseWheel(event) {
    const gameLog = document.getElementById("game-log");
    if (gameLog) {
      const rect = gameLog.getBoundingClientRect();
      const mouseX = event.clientX;
      const mouseY = event.clientY;
      if (mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom) {
        return;
      }
    }
    event.preventDefault();
    const zoomSpeed = 1;
    const delta = event.deltaY > 0 ? zoomSpeed : -zoomSpeed;
    this.cameraDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.cameraDistance + delta)
    );
  }
  handleMouseDown(event) {
    if (event.button === 1) {
      event.preventDefault();
      this.isMiddleMouseDown = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else if (event.button === 2) {
      event.preventDefault();
      this.isRightMouseDown = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }
  handleMouseMove(event) {
    if (this.isMiddleMouseDown) {
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
      event.preventDefault();
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;
      const panSpeed = 0.05;
      this.cameraPanX += deltaX * panSpeed;
      this.cameraPanY -= deltaY * panSpeed;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }
  handleMouseUp(event) {
    if (event.button === 1) {
      this.isMiddleMouseDown = false;
    } else if (event.button === 2) {
      this.isRightMouseDown = false;
    }
  }
  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  animate() {
    requestAnimationFrame(this.animate.bind(this));
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
};
var Nethack3DEngine_default = Nethack3DEngine;

// src/app.ts
var game = new Nethack3DEngine_default();
window.nethackGame = game;
window.refreshTile = (x, y) => {
  game.requestTileUpdate(x, y);
};
window.refreshArea = (centerX, centerY, radius = 3) => {
  game.requestAreaUpdate(centerX, centerY, radius);
};
window.refreshPlayerArea = (radius = 5) => {
  game.requestPlayerAreaUpdate(radius);
};
window.dumpStatusDebug = () => {
  return game.statusDebugHistory;
};
window.toggleInfoMenu = () => {
  game.toggleInfoMenuDialog();
};
console.log("NetHack 3D debugging helpers available:");
console.log("  refreshTile(x, y) - Refresh a specific tile");
console.log("  refreshArea(x, y, radius) - Refresh an area");
console.log("  refreshPlayerArea(radius) - Refresh around player");
console.log("  dumpStatusDebug() - Get recent status_update payloads");
console.log("  Ctrl+T - Refresh player tile");
console.log("  Ctrl+R - Refresh player area (radius 5)");
console.log("  Ctrl+Shift+R - Refresh large player area (radius 10)");
console.log("Movement controls:");
console.log("  Arrow keys - Cardinal directions (N/S/E/W)");
console.log("  Numpad 1-9 - All directions including diagonals");
console.log("  Home/PgUp/End/PgDn - Diagonal movement (NW/NE/SW/SE)");
console.log("  Numpad 5 or Space - Wait/rest");
console.log("Interface controls:");
console.log("  'i' - Open/close inventory dialog");
console.log("  ESC - Close dialogs or cancel actions");
console.log("  Ctrl+M - Toggle latest information panel");
var app_default = game;
export {
  app_default as default
};
