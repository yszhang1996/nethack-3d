// src/game/Nethack3DEngine.ts
import * as THREE from "./three.module.js";

// src/runtime/factory-loader.ts
function getGlobal() {
  return globalThis;
}
async function loadNethackFactory() {
  const g = getGlobal();
  if (typeof g.__nethackFactory === "function") {
    return g.__nethackFactory;
  }
  if (typeof g.Module === "function") {
    g.__nethackFactory = g.Module;
    return g.__nethackFactory;
  }
  await new Promise((resolve, reject) => {
    const existing = document.querySelector(
      "script[data-nethack-factory='1']"
    );
    if (existing) {
      if (typeof g.Module === "function") {
        g.__nethackFactory = g.Module;
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        if (typeof g.Module === "function") {
          g.__nethackFactory = g.Module;
          resolve();
          return;
        }
        reject(
          new Error(
            "nethack.js loaded but factory was not found on globalThis.Module"
          )
        );
      });
      existing.addEventListener("error", () => {
        reject(new Error("Failed loading nethack.js"));
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "/nethack.js";
    script.async = true;
    script.dataset.nethackFactory = "1";
    script.addEventListener("load", () => {
      if (typeof g.Module === "function") {
        g.__nethackFactory = g.Module;
        resolve();
        return;
      }
      reject(
        new Error(
          "nethack.js loaded but factory was not found on globalThis.Module"
        )
      );
    });
    script.addEventListener("error", () => {
      reject(new Error("Failed loading nethack.js"));
    });
    document.head.appendChild(script);
  });
  if (typeof g.__nethackFactory !== "function") {
    throw new Error("NetHack factory is unavailable after script load");
  }
  return g.__nethackFactory;
}

// src/runtime/LocalNetHackRuntime.ts
var process = typeof globalThis !== "undefined" && globalThis.process ? globalThis.process : { env: {} };
var LocalNetHackRuntime = class {
  constructor(eventHandler) {
    this.eventHandler = eventHandler;
    this.isClosed = false;
    this.nethackInstance = null;
    this.gameMap = /* @__PURE__ */ new Map();
    this.playerPosition = { x: 0, y: 0 };
    this.gameMessages = [];
    this.latestInventoryItems = [];
    this.latestStatusUpdates = /* @__PURE__ */ new Map();
    this.currentMenuItems = [];
    this.currentWindow = null;
    this.hasShownCharacterSelection = false;
    this.lastQuestionText = null;
    this.menuSelections = /* @__PURE__ */ new Map();
    this.isInMultiPickup = false;
    this.waitingForMenuSelection = false;
    this.menuSelectionResolver = null;
    this.multiPickupReadyToConfirm = false;
    this.pendingMenuListPtrPtr = 0;
    this.autoPickupQueue = [];
    this.queuedInputs = [];
    this.queuedEventInputs = [];
    this.queuedRawKeyCodes = [];
    this.latestInput = null;
    this.waitingForInput = false;
    this.waitingForPosition = false;
    this.inputResolver = null;
    this.positionResolver = null;
    this.lastInputTime = 0;
    this.inputCooldown = 100;
    this.metaInputPrefix = "__META__:";
    this.pendingMapGlyphs = [];
    this.mapGlyphFlushTimer = null;
    this.mapGlyphBatchWindowMs = Number(process.env.NH_MAP_BATCH_MS || 16);
    this.ready = this.initializeNetHack();
  }
  sendReconnectSnapshot() {
    if (!this.eventHandler) {
      return;
    }
    this.emit({
      type: "clear_scene",
      message: "Reconnected - restoring game state"
    });
    const tiles = Array.from(this.gameMap.values());
    const chunkSize = 500;
    for (let i = 0; i < tiles.length; i += chunkSize) {
      this.emit({
        type: "map_glyph_batch",
        tiles: tiles.slice(i, i + chunkSize)
      });
    }
    this.emit({
      type: "player_position",
      x: this.playerPosition.x,
      y: this.playerPosition.y
    });
    for (const payload of this.latestStatusUpdates.values()) {
      this.emit(payload);
    }
    if (this.latestInventoryItems.length > 0) {
      this.emit({
        type: "inventory_update",
        items: this.latestInventoryItems,
        window: 4
      });
    }
    const recentMessages = this.gameMessages.slice(-30);
    for (const msg of recentMessages) {
      this.emit({
        type: "text",
        text: msg.text,
        window: msg.window,
        attr: msg.attr
      });
    }
  }
  async start() {
    await this.ready;
    this.sendReconnectSnapshot();
  }
  sendInput(input) {
    this.handleClientInput(input);
  }
  requestTileUpdate(x, y) {
    this.handleTileUpdateRequest(x, y);
  }
  requestAreaUpdate(centerX, centerY, radius) {
    this.handleAreaUpdateRequest(centerX, centerY, radius);
  }
  shutdown(reason = "session shutdown") {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    console.log(`Shutting down NetHack session: ${reason}`);
    if (this.mapGlyphFlushTimer) {
      clearTimeout(this.mapGlyphFlushTimer);
      this.mapGlyphFlushTimer = null;
    }
    this.pendingMapGlyphs = [];
    this.latestInput = null;
    this.autoPickupQueue = [];
    this.queuedEventInputs = [];
    this.queuedRawKeyCodes = [];
    this.menuSelections.clear();
    if (this.waitingForMenuSelection && this.menuSelectionResolver) {
      const resolver = this.menuSelectionResolver;
      this.waitingForMenuSelection = false;
      this.menuSelectionResolver = null;
      this.pendingMenuListPtrPtr = 0;
      try {
        resolver(0);
      } catch (error) {
        console.log("Menu selection resolver shutdown error:", error);
      }
    }
    if (this.waitingForInput && this.inputResolver) {
      const resolver = this.inputResolver;
      this.waitingForInput = false;
      this.inputResolver = null;
      try {
        resolver(27);
      } catch (error) {
        console.log("Input resolver shutdown error:", error);
      }
    }
    if (this.waitingForPosition && this.positionResolver) {
      const resolver = this.positionResolver;
      this.waitingForPosition = false;
      this.positionResolver = null;
      try {
        resolver(27);
      } catch (error) {
        console.log("Position resolver shutdown error:", error);
      }
    }
  }
  queueMapGlyphUpdate(tile) {
    if (this.isClosed || !tile || !this.eventHandler) {
      return;
    }
    this.pendingMapGlyphs.push(tile);
    if (this.mapGlyphFlushTimer) {
      return;
    }
    this.mapGlyphFlushTimer = setTimeout(() => {
      this.flushMapGlyphUpdates();
    }, this.mapGlyphBatchWindowMs);
  }
  flushMapGlyphUpdates() {
    if (this.mapGlyphFlushTimer) {
      clearTimeout(this.mapGlyphFlushTimer);
      this.mapGlyphFlushTimer = null;
    }
    if (this.isClosed || !this.pendingMapGlyphs.length || !this.eventHandler) {
      this.pendingMapGlyphs = [];
      return;
    }
    const batch = this.pendingMapGlyphs;
    this.pendingMapGlyphs = [];
    this.emit({
      type: "map_glyph_batch",
      tiles: batch
    });
  }
  // Handle incoming input from the client
  handleClientInput(input) {
    if (this.isClosed) {
      return;
    }
    console.log("\u{1F3AE} Received client input:", input);
    if (this.isMetaInput(input)) {
      const metaKey = input.slice(this.metaInputPrefix.length).charAt(0);
      if (!metaKey) {
        return;
      }
      const escCode = 27;
      const metaCharCode = metaKey.charCodeAt(0);
      this.lastInputTime = Date.now();
      this.latestInput = null;
      if (this.waitingForInput && this.inputResolver) {
        console.log("Meta input routed to event resolver");
        this.waitingForInput = false;
        const resolver = this.inputResolver;
        this.inputResolver = null;
        this.enqueueRawKeyCode(metaCharCode);
        resolver(escCode);
        return;
      }
      this.enqueueRawKeyCode(escCode);
      this.enqueueRawKeyCode(metaCharCode);
      if (this.waitingForPosition && this.positionResolver) {
        console.log("Meta input routed via position resolver with Escape");
        this.waitingForPosition = false;
        const resolver = this.positionResolver;
        this.positionResolver = null;
        resolver(this.queuedRawKeyCodes.shift());
      }
      return;
    }
    this.latestInput = input;
    this.lastInputTime = Date.now();
    if (!this.isInMultiPickup && this.waitingForInput && typeof input === "string" && input.length === 1 && Array.isArray(this.currentMenuItems) && this.currentMenuItems.length > 0) {
      const menuItem = this.currentMenuItems.find(
        (item) => item.accelerator === input && !item.isCategory
      );
      if (menuItem) {
        this.menuSelections.clear();
        this.menuSelections.set(input, {
          menuChar: input,
          originalAccelerator: menuItem.originalAccelerator,
          identifier: menuItem.identifier,
          menuIndex: menuItem.menuIndex,
          text: menuItem.text
        });
        console.log(
          `Recorded single menu selection: ${input} (${menuItem.text})`
        );
      }
    }
    if (this.isInMultiPickup && typeof input === "string" && input.length === 1 && input !== "\r" && input !== "\n") {
      const menuItem = this.currentMenuItems.find(
        (item) => item.accelerator === input && !item.isCategory
      );
      if (menuItem) {
        if (this.menuSelections.has(input)) {
          this.menuSelections.delete(input);
          console.log(
            `Deselected item: ${input} (${menuItem.text}). Current selections:`,
            Array.from(this.menuSelections.keys())
          );
        } else {
          this.menuSelections.set(input, {
            menuChar: input,
            originalAccelerator: menuItem.originalAccelerator,
            identifier: menuItem.identifier,
            menuIndex: menuItem.menuIndex,
            text: menuItem.text
          });
          console.log(
            `Selected item: ${input} (${menuItem.text}). Current selections:`,
            Array.from(this.menuSelections.keys())
          );
        }
      } else {
        console.log(`No menu item found for accelerator '${input}'`);
      }
      console.log("Multi-pickup item selection updated");
      return;
    } else if (this.isInMultiPickup && (input === "Enter" || input === "\r" || input === "\n")) {
      if (this.menuSelections.size > 1) {
        const ordered = Array.from(this.menuSelections.entries());
        const [firstKey, firstValue] = ordered[0];
        const queued = ordered.slice(1).map(([k, v]) => ({
          key: k,
          text: v.text,
          identifier: v.identifier
        }));
        this.menuSelections = /* @__PURE__ */ new Map([[firstKey, firstValue]]);
        this.autoPickupQueue = queued;
        console.log(
          `Sequential pickup mode: keeping '${firstKey}:${firstValue.text}', queued ${queued.length} more`
        );
      }
      const selectedItems = Array.from(this.menuSelections.values()).map(
        (item) => `${item.menuChar}:${item.text}`
      );
      console.log("Confirming multi-pickup with selections:", selectedItems);
      if (this.waitingForMenuSelection && this.menuSelectionResolver) {
        this.waitingForMenuSelection = false;
        const resolver = this.menuSelectionResolver;
        this.menuSelectionResolver = null;
        const menuListPtrPtr = this.pendingMenuListPtrPtr || 0;
        this.pendingMenuListPtrPtr = 0;
        const selectionCount = this.menuSelections.size;
        this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
        this.isInMultiPickup = false;
        resolver(selectionCount);
        return;
      }
      this.multiPickupReadyToConfirm = true;
      if (this.waitingForInput && this.inputResolver) {
        this.waitingForInput = false;
        const resolver = this.inputResolver;
        this.inputResolver = null;
        resolver(this.processKey("Enter"));
        return;
      }
      return;
    } else if (this.isInMultiPickup && input === "Escape") {
      this.menuSelections.clear();
      this.multiPickupReadyToConfirm = false;
      if (this.waitingForMenuSelection && this.menuSelectionResolver) {
        this.waitingForMenuSelection = false;
        const resolver = this.menuSelectionResolver;
        this.menuSelectionResolver = null;
        const menuListPtrPtr = this.pendingMenuListPtrPtr || 0;
        this.pendingMenuListPtrPtr = 0;
        this.writeMenuSelectionResult(menuListPtrPtr, 0);
        this.isInMultiPickup = false;
        resolver(0);
        return;
      }
      this.isInMultiPickup = false;
      return;
    }
    if (this.waitingForInput && this.inputResolver) {
      console.log("\u{1F3AE} Resolving waiting input promise with:", input);
      this.waitingForInput = false;
      const resolver = this.inputResolver;
      this.inputResolver = null;
      resolver(this.processKey(input));
      return;
    }
    if (this.waitingForPosition && this.positionResolver) {
      console.log("\u{1F3AE} Resolving waiting position promise with:", input);
      this.waitingForPosition = false;
      const resolver = this.positionResolver;
      this.positionResolver = null;
      resolver(this.processKey(input));
      return;
    }
    console.log("\u{1F3AE} Storing input for later use:", input);
  }
  // Handle request for tile update from client
  handleTileUpdateRequest(x, y) {
    if (this.isClosed) {
      return;
    }
    console.log(`\u{1F504} Client requested tile update for (${x}, ${y})`);
    const key = `${x},${y}`;
    const tileData = this.gameMap.get(key);
    if (tileData) {
      console.log(`\u{1F4E4} Resending tile data for (${x}, ${y}):`, tileData);
      if (this.eventHandler) {
        this.queueMapGlyphUpdate({
          type: "map_glyph",
          x: tileData.x,
          y: tileData.y,
          glyph: tileData.glyph,
          char: tileData.char,
          color: tileData.color,
          window: 2,
          // WIN_MAP
          isRefresh: true
          // Mark this as a refresh to distinguish from new data
        });
      }
    } else {
      console.log(
        `\u26A0\uFE0F No tile data found for (${x}, ${y}) - tile may not be explored yet`
      );
      if (this.eventHandler) {
        this.emit({
          type: "tile_not_found",
          x,
          y,
          message: "Tile data not available - may not be explored yet"
        });
      }
    }
  }
  // Handle request for area update from client
  handleAreaUpdateRequest(centerX, centerY, radius = 3) {
    if (this.isClosed) {
      return;
    }
    console.log(
      `\u{1F504} Client requested area update centered at (${centerX}, ${centerY}) with radius ${radius}`
    );
    let tilesRefreshed = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;
        const key = `${x},${y}`;
        const tileData = this.gameMap.get(key);
        if (tileData) {
          if (this.eventHandler) {
            this.queueMapGlyphUpdate({
              type: "map_glyph",
              x: tileData.x,
              y: tileData.y,
              glyph: tileData.glyph,
              char: tileData.char,
              color: tileData.color,
              window: 2,
              // WIN_MAP
              isRefresh: true,
              isAreaRefresh: true
            });
          }
          tilesRefreshed++;
        }
      }
    }
    console.log(
      `\u{1F4E4} Refreshed ${tilesRefreshed} tiles in area around (${centerX}, ${centerY})`
    );
    this.flushMapGlyphUpdates();
    if (this.eventHandler) {
      this.emit({
        type: "area_refresh_complete",
        centerX,
        centerY,
        radius,
        tilesRefreshed
      });
    }
  }
  // Helper method for key processing
  processKey(key) {
    if (typeof key === "string" && key.startsWith(this.metaInputPrefix) && key.length > this.metaInputPrefix.length) {
      const metaKey = key.slice(this.metaInputPrefix.length);
      const primaryKey = metaKey.charAt(0);
      if (!primaryKey) {
        return 0;
      }
      this.enqueueRawKeyCode(primaryKey.charCodeAt(0));
      return 27;
    }
    if (key === " " || key === "Space" || key === "Spacebar" || key === "." || key === "Period" || key === "Decimal" || key === "NumpadDecimal") {
      return ".".charCodeAt(0);
    }
    if (key === "ArrowLeft") return "4".charCodeAt(0);
    if (key === "ArrowRight") return "6".charCodeAt(0);
    if (key === "ArrowUp") return "8".charCodeAt(0);
    if (key === "ArrowDown") return "2".charCodeAt(0);
    if (key === "Enter") return 13;
    if (key === "Escape") return 27;
    if (key.length > 0) return key.charCodeAt(0);
    return 0;
  }
  isMetaInput(key) {
    return typeof key === "string" && key.startsWith(this.metaInputPrefix) && key.length > this.metaInputPrefix.length;
  }
  isPrintableAccelerator(code) {
    return typeof code === "number" && code > 32 && code < 127;
  }
  classifyInventoryWindowMenu(menuItems) {
    const items = Array.isArray(menuItems) ? menuItems : [];
    const nonCategoryItems = items.filter((item) => !item.isCategory);
    const hasCategoryHeaders = items.some((item) => item.isCategory);
    const hasSelectableEntries = nonCategoryItems.some(
      (item) => this.isPrintableAccelerator(item.originalAccelerator) || typeof item.identifier === "number" && item.identifier > 0
    );
    if (items.length === 0) {
      return { kind: "inventory", lines: [] };
    }
    if (hasCategoryHeaders || hasSelectableEntries) {
      return { kind: "inventory", lines: [] };
    }
    const lines = nonCategoryItems.map((item) => String(item.text || "").trim()).filter((text) => text.length > 0);
    return { kind: "info_menu", lines };
  }
  enqueueInput(input) {
    if (input === void 0 || input === null) {
      return;
    }
    this.queuedInputs.push(input);
    console.log(
      `Queued synthetic input: ${input} (queue size=${this.queuedInputs.length})`
    );
  }
  enqueueEventInput(input) {
    if (input === void 0 || input === null) {
      return;
    }
    this.queuedEventInputs.push(input);
    console.log(
      `Queued event-only input: ${input} (queue size=${this.queuedEventInputs.length})`
    );
  }
  enqueueRawKeyCode(code) {
    if (typeof code !== "number") {
      return;
    }
    this.queuedRawKeyCodes.push(code);
    console.log(
      `Queued raw keycode: ${code} (queue size=${this.queuedRawKeyCodes.length})`
    );
  }
  tryBuildAutoPickupSelection() {
    if (!Array.isArray(this.autoPickupQueue) || this.autoPickupQueue.length === 0) {
      return false;
    }
    const next = this.autoPickupQueue[0];
    const selectableItems = this.currentMenuItems.filter((item) => !item.isCategory);
    let matched = null;
    if (typeof next.identifier === "number") {
      matched = selectableItems.find((item) => item.identifier === next.identifier) || null;
    }
    if (!matched && typeof next.text === "string" && next.text.length > 0) {
      matched = selectableItems.find((item) => item.text === next.text) || null;
    }
    if (!matched && typeof next.key === "string" && next.key.length === 1) {
      matched = selectableItems.find((item) => item.accelerator === next.key) || null;
    }
    if (!matched) {
      console.log(
        `Sequential pickup: could not match queued item '${next.key}:${next.text}', dropping it`
      );
      this.autoPickupQueue.shift();
      return false;
    }
    const key = matched.accelerator;
    this.menuSelections.clear();
    this.menuSelections.set(key, {
      menuChar: key,
      originalAccelerator: matched.originalAccelerator,
      identifier: matched.identifier,
      menuIndex: matched.menuIndex,
      text: matched.text
    });
    this.multiPickupReadyToConfirm = true;
    this.autoPickupQueue.shift();
    console.log(
      `Sequential pickup: auto-selected '${key}:${matched.text}', remaining queued=${this.autoPickupQueue.length}`
    );
    return true;
  }
  getStatusFieldName(field) {
    const fallback = {
      0: "BL_TITLE",
      1: "BL_STR",
      2: "BL_DX",
      3: "BL_CO",
      4: "BL_IN",
      5: "BL_WI",
      6: "BL_CH",
      7: "BL_ALIGN",
      8: "BL_SCORE",
      9: "BL_HP",
      10: "BL_HPMAX",
      11: "BL_ENE",
      12: "BL_ENEMAX",
      13: "BL_AC",
      14: "BL_XP",
      15: "BL_EXP",
      16: "BL_TIME",
      17: "BL_HUNGER",
      18: "BL_CAP",
      19: "BL_DNUM",
      20: "BL_DLEVEL",
      21: "BL_GOLD",
      22: "BL_CONDITION",
      23: "BL_FLUSH",
      24: "BL_RESET",
      25: "BL_CHARACTERISTICS"
    };
    if (typeof field !== "number") return String(field);
    const constants = globalThis.nethackGlobal && globalThis.nethackGlobal.constants ? globalThis.nethackGlobal.constants : null;
    if (constants && constants.STATUS_FIELD && constants.STATUS_FIELD[field] !== void 0) {
      return String(constants.STATUS_FIELD[field]);
    }
    return fallback[field] || `FIELD_${field}`;
  }
  decodeShimArgValue(name, ptrToArg, type) {
    if (!this.nethackModule || typeof this.nethackModule.getValue !== "function" || !globalThis.nethackGlobal || !globalThis.nethackGlobal.helpers || typeof globalThis.nethackGlobal.helpers.getPointerValue !== "function") {
      return null;
    }
    const argPtr = this.nethackModule.getValue(ptrToArg, "*");
    return globalThis.nethackGlobal.helpers.getPointerValue(name, argPtr, type);
  }
  decodeStatusValue(fieldName, ptrToArg) {
    const rawPointerFields = /* @__PURE__ */ new Set([
      "BL_CONDITION",
      "BL_RESET",
      "BL_FLUSH",
      "BL_CHARACTERISTICS"
    ]);
    const primaryType = rawPointerFields.has(fieldName) ? "p" : "s";
    const fallbackType = primaryType === "s" ? "p" : "s";
    try {
      const primary = this.decodeShimArgValue(
        "shim_status_update",
        ptrToArg,
        primaryType
      );
      if (primary !== null && primary !== void 0) {
        return {
          value: primary,
          valueType: primaryType,
          usedFallback: false
        };
      }
    } catch (error) {
      console.log(
        `Status decode failed (${fieldName}, ${primaryType})`,
        error && error.message ? error.message : error
      );
    }
    try {
      const fallback = this.decodeShimArgValue(
        "shim_status_update",
        ptrToArg,
        fallbackType
      );
      if (fallback !== null && fallback !== void 0) {
        return {
          value: fallback,
          valueType: fallbackType,
          usedFallback: true
        };
      }
    } catch (error) {
      console.log(
        `Status decode fallback failed (${fieldName}, ${fallbackType})`,
        error && error.message ? error.message : error
      );
    }
    return { value: null, valueType: "unknown", usedFallback: false };
  }
  writeMenuSelectionResult(menuListPtrPtr, selectionCount) {
    if (!this.nethackModule || !menuListPtrPtr) {
      return;
    }
    try {
      const selectedItems = Array.from(this.menuSelections.values());
      const bytesPerMenuItem = Number(process.env.NH_MENU_ITEM_STRIDE || 16);
      const countOffsetPrimary = Number(process.env.NH_MENU_COUNT_OFFSET || 8);
      const countOffsetSecondary = 4;
      if (selectionCount <= 0) {
        this.nethackModule.setValue(menuListPtrPtr, 0, "*");
        console.log(
          `Menu selection write: cleared output pointer at menuListPtrPtr=${menuListPtrPtr}`
        );
        return;
      }
      const priorOutPtr = this.nethackModule.getValue(menuListPtrPtr, "*");
      const outPtr = this.nethackModule._malloc(selectionCount * bytesPerMenuItem);
      this.nethackModule.setValue(menuListPtrPtr, outPtr, "*");
      const confirmOutPtr = this.nethackModule.getValue(menuListPtrPtr, "*");
      console.log(
        `Writing ${selectionCount} selections at outPtr=${outPtr} (menuListPtrPtr=${menuListPtrPtr}, priorOutPtr=${priorOutPtr}, confirmOutPtr=${confirmOutPtr}, stride=${bytesPerMenuItem}, countOffset=${countOffsetPrimary})`
      );
      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const structOffset = outPtr + i * bytesPerMenuItem;
        const itemIdentifier = typeof item.identifier === "number" ? item.identifier : item.originalAccelerator;
        if (typeof itemIdentifier !== "number") {
          console.log(
            `Skipping item ${i} because identifier is not numeric:`,
            itemIdentifier
          );
          continue;
        }
        this.nethackModule.setValue(structOffset, itemIdentifier, "i32");
        const countValue = process.env.NH_MENU_COUNT_MODE === "all" ? -1 : 1;
        this.nethackModule.setValue(
          structOffset + countOffsetPrimary,
          countValue,
          "i32"
        );
        if (countOffsetSecondary !== countOffsetPrimary) {
          this.nethackModule.setValue(
            structOffset + countOffsetSecondary,
            countValue,
            "i32"
          );
        }
        const debugItem = this.nethackModule.getValue(structOffset, "i32");
        const debugCountPrimary = this.nethackModule.getValue(
          structOffset + countOffsetPrimary,
          "i32"
        );
        const debugCountSecondary = this.nethackModule.getValue(
          structOffset + countOffsetSecondary,
          "i32"
        );
        console.log(
          `Wrote menu_item[${i}] => item=${debugItem}, countPrimary=${debugCountPrimary}, countSecondary=${debugCountSecondary}, countMode=${process.env.NH_MENU_COUNT_MODE || "one"}`
        );
      }
      const dumpBytes = Math.min(selectionCount * bytesPerMenuItem, 64);
      const dump = [];
      for (let i = 0; i < dumpBytes; i++) {
        const b = this.nethackModule.getValue(outPtr + i, "i8") & 255;
        dump.push(b.toString(16).padStart(2, "0"));
      }
      console.log(`menu_item buffer dump (${dumpBytes} bytes): ${dump.join(" ")}`);
    } catch (error) {
      console.log("Error writing selections to NetHack memory:", error);
    }
  }
  async initializeNetHack() {
    try {
      console.log("Starting local NetHack session...");
      const factory = await loadNethackFactory();
      globalThis.nethackCallback = (name, ...args) => {
        return this.handleUICallback(name, args);
      };
      if (!globalThis.nethackGlobal) {
        globalThis.nethackGlobal = {
          constants: {
            WIN_TYPE: {
              1: "WIN_MESSAGE",
              2: "WIN_MAP",
              3: "WIN_STATUS",
              4: "WIN_INVEN"
            },
            STATUS_FIELD: {},
            MENU_SELECT: { PICK_NONE: 0, PICK_ONE: 1, PICK_ANY: 2 }
          },
          helpers: {
            getPointerValue: (name, ptr, type) => {
              if (!this.nethackModule) {
                return ptr;
              }
              switch (type) {
                case "s":
                  return this.nethackModule.UTF8ToString(ptr);
                case "p":
                  if (!ptr) return 0;
                  return this.nethackModule.getValue(ptr, "*");
                case "c":
                  return String.fromCharCode(this.nethackModule.getValue(ptr, "i8"));
                case "0":
                  return this.nethackModule.getValue(ptr, "i8");
                case "1":
                  return this.nethackModule.getValue(ptr, "i16");
                case "2":
                case "i":
                case "n":
                  return this.nethackModule.getValue(ptr, "i32");
                case "f":
                  return this.nethackModule.getValue(ptr, "float");
                case "d":
                  return this.nethackModule.getValue(ptr, "double");
                case "o":
                  return ptr;
                default:
                  return ptr;
              }
            },
            setPointerValue: (name, ptr, type, value = 0) => {
              if (!this.nethackModule) {
                return;
              }
              switch (type) {
                case "s":
                  this.nethackModule.stringToUTF8(String(value), ptr, 1024);
                  break;
                case "i":
                  this.nethackModule.setValue(ptr, value, "i32");
                  break;
                case "c":
                  this.nethackModule.setValue(ptr, value, "i8");
                  break;
                case "f":
                  this.nethackModule.setValue(ptr, value, "float");
                  break;
                case "d":
                  this.nethackModule.setValue(ptr, value, "double");
                  break;
                case "v":
                  break;
                default:
                  break;
              }
            }
          },
          globals: { WIN_MAP: 2, WIN_INVEN: 4, WIN_STATUS: 3, WIN_MESSAGE: 1 }
        };
      }
      let moduleConfig = null;
      moduleConfig = {
        locateFile: (assetPath) => {
          if (assetPath.endsWith(".wasm")) {
            return "/nethack.wasm";
          }
          return assetPath;
        },
        preRun: [
          () => {
            if (!moduleConfig.ENV) {
              moduleConfig.ENV = {};
            }
            moduleConfig.ENV.NETHACKOPTIONS = "pickup_types:$,number_pad:1";
          }
        ],
        onRuntimeInitialized: async () => {
          this.nethackModule = moduleConfig;
          try {
            await moduleConfig.ccall(
              "shim_graphics_set_callback",
              null,
              ["string"],
              ["nethackCallback"],
              { async: true }
            );
            if (moduleConfig.js_helpers_init) {
              moduleConfig.js_helpers_init();
            }
          } catch (error) {
            console.error("Error setting up local NetHack runtime:", error);
          }
        }
      };
      this.nethackInstance = await factory(moduleConfig);
    } catch (error) {
      console.error("Error initializing local NetHack:", error);
      throw error;
    }
  }
  handleUICallback(name, args) {
    if (this.isClosed) {
      return 0;
    }
    console.log(`\u{1F3AE} UI Callback: ${name}`, args);
    const processKey = (key) => {
      return this.processKey(key);
    };
    switch (name) {
      case "shim_get_nh_event":
        if (this.queuedRawKeyCodes.length > 0) {
          const rawCode = this.queuedRawKeyCodes.shift();
          console.log(`Using queued raw keycode for event: ${rawCode}`);
          return rawCode;
        }
        if (this.queuedEventInputs.length > 0) {
          const queuedEvent = this.queuedEventInputs.shift();
          console.log(`Using queued event-only input: ${queuedEvent}`);
          return processKey(queuedEvent);
        }
        if (this.queuedInputs.length > 0) {
          const queued = this.queuedInputs.shift();
          console.log(`Using queued input for event: ${queued}`);
          return processKey(queued);
        }
        const timeSinceInput = Date.now() - this.lastInputTime;
        if (this.latestInput && timeSinceInput < this.inputCooldown) {
          const input = this.latestInput;
          this.latestInput = null;
          console.log(
            `\u{1F3AE} Reusing recent input for event: ${input} (${timeSinceInput}ms ago)`
          );
          return processKey(input);
        }
        console.log("\u{1F3AE} Waiting for player input (async)...");
        return new Promise((resolve) => {
          this.inputResolver = resolve;
          this.waitingForInput = true;
        });
      case "shim_yn_function":
        const [question, choices, defaultChoice] = args;
        console.log(
          `\u{1F914} Y/N Question: "${question}" choices: "${choices}" default: ${defaultChoice}`
        );
        this.lastQuestionText = question;
        if (question && question.toLowerCase().includes("direction")) {
          console.log(
            "\u{1F9ED} Direction question detected - waiting for user input"
          );
          if (this.eventHandler) {
            this.emit({
              type: "direction_question",
              text: question,
              choices,
              default: defaultChoice
            });
          }
          console.log("\u{1F9ED} Waiting for direction input (async)...");
          return new Promise((resolve) => {
            this.inputResolver = resolve;
            this.waitingForInput = true;
          });
        }
        if (this.eventHandler) {
          this.emit({
            type: "question",
            text: question,
            choices,
            default: defaultChoice,
            // Only include menuItems if this is actually a menu question, not a simple Y/N
            menuItems: []
          });
        }
        console.log("\u{1F914} Y/N Question - waiting for user input (async)...");
        return new Promise((resolve) => {
          this.inputResolver = resolve;
          this.waitingForInput = true;
        });
      case "shim_nh_poskey":
        const [xPtr, yPtr, modPtr] = args;
        console.log("\u{1F3AE} NetHack requesting position key");
        if (this.queuedRawKeyCodes.length > 0) {
          const rawCode = this.queuedRawKeyCodes.shift();
          console.log(`Using queued raw keycode for position: ${rawCode}`);
          return rawCode;
        }
        if (this.queuedInputs.length > 0) {
          const queued = this.queuedInputs.shift();
          console.log(`Using queued input for position: ${queued}`);
          return processKey(queued);
        }
        const timeSincePositionInput = Date.now() - this.lastInputTime;
        if (this.latestInput && !this.isMetaInput(this.latestInput) && timeSincePositionInput < this.inputCooldown) {
          const input = this.latestInput;
          console.log(
            `\u{1F3AE} Using recent input for position: ${input} (${timeSincePositionInput}ms ago)`
          );
          return processKey(input);
        }
        console.log("\u{1F3AE} Waiting for position input (async)...");
        return new Promise((resolve) => {
          this.positionResolver = resolve;
          this.waitingForPosition = true;
        });
      case "shim_init_nhwindows":
        console.log("Initializing NetHack windows");
        if (this.eventHandler) {
          this.emit({
            type: "name_request",
            text: "What is your name, adventurer?",
            maxLength: 30
          });
        }
        return 1;
      case "shim_create_nhwindow":
        const [windowType] = args;
        console.log(
          `Creating window [ ${windowType} ] returning ${windowType}`
        );
        return windowType;
      case "shim_status_init":
        console.log("Initializing status display");
        return 0;
      case "shim_start_menu":
        const [menuWinId, menuOptions] = args;
        console.log("NetHack starting menu:", args);
        this.currentMenuItems = [];
        this.currentWindow = menuWinId;
        this.lastQuestionText = null;
        this.menuSelections.clear();
        this.isInMultiPickup = false;
        this.multiPickupReadyToConfirm = false;
        if (this.waitingForMenuSelection && this.menuSelectionResolver) {
          console.log("\u{1F4CB} Clearing previous menu selection resolver");
          this.waitingForMenuSelection = false;
          this.menuSelectionResolver = null;
        }
        const windowTypes = {
          1: "WIN_MESSAGE",
          2: "WIN_MAP",
          3: "WIN_STATUS",
          4: "WIN_INVEN"
        };
        console.log(
          `\u{1F4CB} Starting menu for window ${menuWinId} (${windowTypes[menuWinId] || "UNKNOWN"})`
        );
        return 0;
      case "shim_end_menu":
        const [endMenuWinid, menuQuestion] = args;
        console.log("NetHack ending menu:", args);
        const isInventoryWindow = endMenuWinid === 4;
        const hasMenuQuestion = menuQuestion && menuQuestion.trim();
        console.log(
          `\u{1F4CB} Menu ending - Window: ${endMenuWinid}, Question: "${menuQuestion}", Items: ${this.currentMenuItems.length}`
        );
        if (isInventoryWindow && !hasMenuQuestion) {
          const classification = this.classifyInventoryWindowMenu(
            this.currentMenuItems
          );
          const actualItems = this.currentMenuItems.filter(
            (item) => !item.isCategory
          );
          const categoryHeaders = this.currentMenuItems.filter(
            (item) => item.isCategory
          );
          console.log(
            `WIN_INVEN no-question menu classified as ${classification.kind} (${actualItems.length} items, ${categoryHeaders.length} categories)`
          );
          if (this.eventHandler) {
            if (classification.kind === "inventory") {
              this.latestInventoryItems = [...this.currentMenuItems];
              this.emit({
                type: "inventory_update",
                items: this.currentMenuItems,
                window: endMenuWinid
              });
            } else {
              const infoLines = classification.lines;
              const infoTitle = infoLines.length > 0 ? infoLines[0] : "NetHack Information";
              const infoBody = infoLines.length > 1 ? infoLines.slice(1) : infoLines;
              this.emit({
                type: "info_menu",
                title: infoTitle,
                lines: infoBody,
                window: endMenuWinid
              });
            }
          }
          return 0;
        }
        if (isInventoryWindow && hasMenuQuestion) {
          console.log(
            `\u{1F4CB} Inventory action question detected: "${menuQuestion}" with ${this.currentMenuItems.length} items`
          );
          if (menuQuestion && (menuQuestion.toLowerCase().includes("pick up what") || menuQuestion.toLowerCase().includes("pick up") || menuQuestion.toLowerCase().includes("what do you want to pick up"))) {
            console.log("\u{1F4CB} Multi-pickup dialog detected");
            this.isInMultiPickup = true;
            if (this.tryBuildAutoPickupSelection()) {
              console.log(`Sequential pickup: auto-confirming queued selection for this menu`);
              return this.processKey("Enter");
            }
          }
          if (this.eventHandler) {
            this.emit({
              type: "question",
              text: menuQuestion,
              choices: "",
              default: "",
              menuItems: this.currentMenuItems
            });
          }
          console.log("\u{1F4CB} Waiting for inventory action selection (async)...");
          return new Promise((resolve) => {
            this.inputResolver = resolve;
            this.waitingForInput = true;
          });
        }
        if (hasMenuQuestion && this.currentMenuItems.length > 0) {
          console.log(
            `\u{1F4CB} Menu question detected: "${menuQuestion}" with ${this.currentMenuItems.length} items`
          );
          if (this.eventHandler) {
            this.emit({
              type: "question",
              text: menuQuestion,
              choices: "",
              default: "",
              menuItems: this.currentMenuItems
            });
          }
          console.log("\u{1F4CB} Waiting for menu selection (async)...");
          return new Promise((resolve) => {
            this.inputResolver = resolve;
            this.waitingForInput = true;
          });
        }
        if (this.currentMenuItems.length > 0 && !hasMenuQuestion && !isInventoryWindow) {
          console.log(
            `\u{1F4CB} Menu expansion detected with ${this.currentMenuItems.length} items (window ${endMenuWinid})`
          );
          let contextualQuestion = "Please select an option:";
          const selectableItems = this.currentMenuItems.filter(
            (item) => !item.isCategory
          );
          console.log(
            `\u{1F4CB} Found ${selectableItems.length} selectable items out of ${this.currentMenuItems.length} total`
          );
          if (selectableItems.some(
            (item) => item.text && typeof item.text === "string" && (item.text.includes("gold pieces") || item.text.includes("corpse") || item.text.includes("here"))
          )) {
            contextualQuestion = "What would you like to pick up?";
          } else if (selectableItems.some(
            (item) => item.text && typeof item.text === "string" && (item.text.includes("spell") || item.text.includes("magic"))
          )) {
            contextualQuestion = "Which spell would you like to cast?";
          } else if (selectableItems.some(
            (item) => item.text && typeof item.text === "string" && (item.text.includes("wear") || item.text.includes("wield") || item.text.includes("armor"))
          )) {
            contextualQuestion = "What would you like to use?";
          }
          if (selectableItems.length > 0) {
            if (this.eventHandler) {
              this.emit({
                type: "question",
                text: contextualQuestion,
                choices: "",
                default: "",
                menuItems: this.currentMenuItems
              });
            }
            console.log("\u{1F4CB} Waiting for expanded menu selection (async)...");
            return new Promise((resolve) => {
              this.inputResolver = resolve;
              this.waitingForInput = true;
            });
          } else {
            console.log(
              "\u{1F4CB} Menu has no selectable items - treating as informational"
            );
          }
        }
        return 0;
      case "shim_display_nhwindow":
        const [winid, blocking] = args;
        console.log(`\u{1F5A5}\uFE0F DISPLAY WINDOW [Win ${winid}], blocking: ${blocking}`);
        return 0;
      case "shim_add_menu":
        const [
          menuWinid,
          menuGlyph,
          identifier,
          accelerator,
          groupacc,
          menuAttr,
          menuStr,
          preselected
        ] = args;
        const menuText = String(args[6] || "");
        const isCategory = menuAttr === 7;
        let menuChar = "";
        let glyphChar = "";
        if (menuGlyph && globalThis.nethackGlobal && globalThis.nethackGlobal.helpers && globalThis.nethackGlobal.helpers.mapglyphHelper) {
          try {
            const glyphInfo = globalThis.nethackGlobal.helpers.mapglyphHelper(
              menuGlyph,
              0,
              0,
              0
              // x, y, and other params not needed for menu items
            );
            if (glyphInfo && glyphInfo.ch !== void 0) {
              glyphChar = String.fromCharCode(glyphInfo.ch);
            }
          } catch (error) {
            console.log(
              `\u26A0\uFE0F Error getting glyph info for menu glyph ${menuGlyph}:`,
              error
            );
          }
        }
        if (!isCategory) {
          if (typeof accelerator === "number" && accelerator > 32 && accelerator < 127) {
            menuChar = String.fromCharCode(accelerator);
          } else {
            const existingItems = this.currentMenuItems.filter(
              (item) => !item.isCategory
            );
            const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            if (existingItems.length < alphabet.length) {
              menuChar = alphabet[existingItems.length];
            } else {
              menuChar = "?";
            }
          }
          console.log(
            `\u{1F4CB} MENU ITEM: "${menuText}" (key: ${menuChar}) glyph: ${menuGlyph} -> "${glyphChar}" - accelerator code: ${accelerator}`
          );
        } else {
          console.log(
            `\u{1F4CB} CATEGORY HEADER: "${menuText}" - accelerator code: ${accelerator}`
          );
        }
        if (this.currentWindow === menuWinid && menuText) {
          this.currentMenuItems.push({
            text: menuText,
            accelerator: menuChar,
            originalAccelerator: accelerator,
            // Store the original accelerator code
            identifier,
            // NetHack menu identifier used by shim_select_menu
            window: menuWinid,
            glyph: menuGlyph,
            glyphChar,
            // Add the visual character representation
            isCategory,
            menuIndex: this.currentMenuItems.length
            // Store the menu item index
          });
        }
        if (this.eventHandler) {
          this.emit({
            type: "menu_item",
            text: menuText,
            accelerator: menuChar,
            window: menuWinid,
            glyph: menuGlyph,
            glyphChar,
            // Include glyph character in client message
            isCategory,
            menuItems: this.currentMenuItems
          });
        }
        return 0;
      case "shim_putstr":
        const [win, textAttr, textStr] = args;
        console.log(`\u{1F4AC} TEXT [Win ${win}]: "${textStr}"`);
        this.gameMessages.push({
          text: textStr,
          window: win,
          timestamp: Date.now(),
          attr: textAttr
        });
        if (this.gameMessages.length > 100) {
          this.gameMessages.shift();
        }
        if (this.eventHandler) {
          this.emit({
            type: "text",
            text: textStr,
            window: win,
            attr: textAttr
          });
        }
        return 0;
      case "shim_print_glyph":
        const [printWin, x, y, printGlyph] = args;
        console.log(`\u{1F3A8} GLYPH [Win ${printWin}] at (${x},${y}): ${printGlyph}`);
        if (printWin === 3) {
          const key = `${x},${y}`;
          let glyphChar2 = null;
          let glyphColor = null;
          if (globalThis.nethackGlobal && globalThis.nethackGlobal.helpers && globalThis.nethackGlobal.helpers.mapglyphHelper) {
            try {
              const glyphInfo = globalThis.nethackGlobal.helpers.mapglyphHelper(
                printGlyph,
                x,
                y,
                0
              );
              console.log(
                `\u{1F50D} Raw glyphInfo for glyph ${printGlyph}:`,
                glyphInfo
              );
              if (glyphInfo && glyphInfo.ch !== void 0) {
                glyphChar2 = String.fromCharCode(glyphInfo.ch);
                glyphColor = glyphInfo.color;
                console.log(
                  `\u{1F524} Glyph ${printGlyph} -> "${glyphChar2}" (ASCII ${glyphInfo.ch}) color ${glyphColor}`
                );
              } else {
                console.log(
                  `\u26A0\uFE0F No character info for glyph ${printGlyph}, glyphInfo:`,
                  glyphInfo
                );
              }
            } catch (error) {
              console.log(
                `\u26A0\uFE0F Error getting glyph info for ${printGlyph}:`,
                error
              );
            }
          } else {
            console.log(`\u26A0\uFE0F mapglyphHelper not available`);
          }
          this.gameMap.set(key, {
            x,
            y,
            glyph: printGlyph,
            char: glyphChar2,
            color: glyphColor,
            timestamp: Date.now()
          });
          if (this.eventHandler) {
            this.queueMapGlyphUpdate({
              type: "map_glyph",
              x,
              y,
              glyph: printGlyph,
              char: glyphChar2,
              color: glyphColor,
              window: printWin
            });
          }
        }
        return 0;
      case "shim_player_selection":
        console.log("NetHack player selection started");
      // Comment out character selection UI for automatic play        return 0;
      case "shim_raw_print":
        const [rawText] = args;
        console.log(`\u{1F4E2} RAW PRINT: "${rawText}"`);
        if (this.eventHandler && rawText && rawText.trim()) {
          this.emit({
            type: "raw_print",
            text: rawText.trim()
          });
        }
        return 0;
      case "shim_wait_synch":
        console.log("NetHack waiting for synchronization");
        return 0;
      case "shim_select_menu":
        const [menuSelectWinid, menuSelectHow, menuPtrArg] = args;
        let ptrArgValue = 0;
        let ptrDerefValue = 0;
        if (this.nethackModule && typeof this.nethackModule.getValue === "function") {
          ptrArgValue = menuPtrArg;
          try {
            ptrDerefValue = this.nethackModule.getValue(menuPtrArg, "*");
          } catch (error) {
            console.log("Pointer decode error in shim_select_menu:", error);
          }
        }
        const ptrMode = ptrDerefValue > 0 ? "deref" : "arg";
        const menuListPtrPtr = ptrMode === "deref" ? ptrDerefValue : ptrArgValue;
        console.log(
          `\u{1F4CB} Menu selection request for window ${menuSelectWinid}, how: ${menuSelectHow}, argPtr: ${menuPtrArg}, ptrArgValue=${ptrArgValue}, ptrDerefValue=${ptrDerefValue}, ptrMode=${ptrMode}, menuListPtrPtr=${menuListPtrPtr}`
        );
        if (menuSelectHow === 2 && this.isInMultiPickup) {
          if (this.multiPickupReadyToConfirm) {
            console.log(
              "\u{1F4CB} Multi-pickup already confirmed - returning selection count immediately"
            );
            const selectionCount = this.menuSelections.size;
            this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
            this.menuSelections.clear();
            this.isInMultiPickup = false;
            this.multiPickupReadyToConfirm = false;
            return selectionCount;
          }
          console.log(
            "\u{1F4CB} Multi-pickup menu - waiting for completion (async)..."
          );
          this.pendingMenuListPtrPtr = menuListPtrPtr;
          return new Promise((resolve) => {
            this.menuSelectionResolver = resolve;
            this.waitingForMenuSelection = true;
          });
        }
        if (menuSelectHow === 1 && this.menuSelections.size === 1) {
          const selectedItem = Array.from(this.menuSelections.values())[0];
          console.log(
            `?? Returning single selection: ${selectedItem.menuChar} (${selectedItem.text})`
          );
          this.menuSelections.clear();
          this.isInMultiPickup = false;
          return selectedItem.identifier || selectedItem.originalAccelerator || selectedItem.menuChar.charCodeAt(0);
        }
        if (menuSelectHow === 2 && this.menuSelections.size > 0) {
          const selectedItems = Array.from(this.menuSelections.values());
          console.log(
            `?? Returning ${this.menuSelections.size} selected items:`,
            selectedItems.map((item) => `${item.menuChar}:${item.text}`)
          );
          const selectionCount = this.menuSelections.size;
          this.menuSelections.clear();
          this.isInMultiPickup = false;
          return selectionCount;
        }
        console.log("\u{1F4CB} Returning 0 (no selection)");
        return 0;
      case "shim_askname":
        console.log("NetHack is asking for player name, args:", args);
        if (this.eventHandler) {
          this.emit({
            type: "name_request",
            text: "What is your name?",
            maxLength: 30
          });
        }
        if (this.latestInput) {
          const name2 = this.latestInput;
          this.latestInput = null;
          console.log(`Using player name from input: ${name2}`);
          return name2;
        }
        console.log("No name provided, using default");
        return "Player";
      case "shim_mark_synch":
        console.log("NetHack marking synchronization");
        return 0;
      case "shim_cliparound":
        const [clipX, clipY] = args;
        console.log(
          `\u{1F3AF} Cliparound request for position (${clipX}, ${clipY}) - updating player position`
        );
        const oldPlayerPos = { ...this.playerPosition };
        this.playerPosition = { x: clipX, y: clipY };
        if (this.eventHandler) {
          this.emit({
            type: "player_position",
            x: clipX,
            y: clipY
          });
          this.emit({
            type: "force_player_redraw",
            oldPosition: oldPlayerPos,
            newPosition: { x: clipX, y: clipY }
          });
        }
        return 0;
      case "shim_clear_nhwindow":
        const [clearWinId] = args;
        console.log(`\u{1F5D1}\uFE0F Clearing window ${clearWinId}`);
        if (clearWinId === 2 || clearWinId === 3) {
          console.log("Map window cleared - clearing 3D scene");
          this.emit({
            type: "clear_scene",
            message: "Level transition - clearing display"
          });
        }
        return 0;
      case "shim_getmsghistory":
        const [init] = args;
        console.log(`Getting message history, init: ${init}`);
        return "";
      case "shim_putmsghistory":
        const [msg, is_restoring] = args;
        console.log(
          `Putting message history: "${msg}", restoring: ${is_restoring}`
        );
        return 0;
      case "shim_exit_nhwindows":
        console.log("Exiting NetHack windows");
        return 0;
      case "shim_destroy_nhwindow":
        const [destroyWinId] = args;
        console.log(`\u{1F5D1}\uFE0F Destroying window ${destroyWinId}`);
        if (destroyWinId === 4 && this.autoPickupQueue.length > 0) {
          console.log(`Sequential pickup: scheduling next pickup cycle (remaining=${this.autoPickupQueue.length})`);
          this.enqueueInput(",");
        }
        return 0;
      case "shim_curs":
        const [cursWin, cursX, cursY] = args;
        console.log(
          `\u{1F5B1}\uFE0F Setting cursor for window ${cursWin} to (${cursX}, ${cursY})`
        );
        return 0;
      case "shim_status_update":
        const [field, ptrToArg, chg, percent, color, colormask] = args;
        const fieldName = this.getStatusFieldName(field);
        const decoded = this.decodeStatusValue(fieldName, ptrToArg);
        const statusPayload = {
          type: "status_update",
          field,
          fieldName,
          value: decoded.value,
          valueType: decoded.valueType,
          ptrToArg,
          usedFallback: decoded.usedFallback,
          chg,
          percent,
          color,
          colormask
        };
        this.latestStatusUpdates.set(field, statusPayload);
        console.log(
          `Status update ${fieldName} (${field}) => ${decoded.value} [type=${decoded.valueType}, fallback=${decoded.usedFallback}]`
        );
        if (this.eventHandler) {
          this.emit(statusPayload);
        }
        return 0;
      default:
        console.log(`Unknown callback: ${name}`, args);
        return 0;
    }
  }
  emit(payload) {
    if (typeof this.eventHandler === "function") {
      this.eventHandler(payload);
    }
  }
};
var LocalNetHackRuntime_default = LocalNetHackRuntime;

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
    this.session = new LocalNetHackRuntime_default((payload) => {
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
        if (actualItems.length > 0) {
          this.addGameMessage(`Inventory: ${actualItems.length} items`);
        }
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
  createGlyphTexture(baseColorHex, glyphChar, textColor, size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
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
  applyGlyphMaterial(key, mesh, baseMaterial, glyphChar, textColor, isWall, darkenFactor = 1) {
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
    const clampedDarken = THREE.MathUtils.clamp(darkenFactor, 0, 1);
    overlay.material.color.setScalar(clampedDarken);
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
