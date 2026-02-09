// @ts-nocheck
import { loadNethackFactory } from "./factory-loader";
import RuntimeInputBroker from "./input/RuntimeInputBroker";
import { resolveRuntimeAssetUrl } from "./runtime-assets";

const process =
  typeof globalThis !== "undefined" && globalThis.process
    ? globalThis.process
    : { env: {} };

class LocalNetHackRuntime {
  constructor(eventHandler) {
    this.eventHandler = eventHandler;
    this.isClosed = false;
    this.nethackInstance = null;
    this.gameMap = new Map();
    this.playerPosition = { x: 0, y: 0 };
    this.gameMessages = [];
    this.latestInventoryItems = [];
    this.latestStatusUpdates = new Map();
    this.currentMenuItems = [];
    this.currentWindow = null;
    this.hasShownCharacterSelection = false;
    this.lastQuestionText = null; // Store the last question for menu expansion

    // Multi-pickup selection tracking
    this.menuSelections = new Map(); // Track selected items: key=menuChar, value={menuChar, originalAccelerator, menuIndex}
    this.isInMultiPickup = false;
    this.pendingMenuSelection = null;
    this.menuSelectionReadyCount = null;

    this.inputBroker = new RuntimeInputBroker();
    this.farLookMode = "none"; // none | armed | active
    this.pendingTextResponses = [];
    this.positionInputActive = false;
    this.positionCursor = null;
    this.activeInputRequest = null;
    this.awaitingQuestionInput = false;
    this.metaInputPrefix = "__META__:";
    this.menuSelectionInputPrefix = "__MENU_SELECT__:";
    this.extendedCommandEntries = null;
    this.statusPending = new Map();

    // Batch map glyph updates to reduce runtime event overhead during reveal bursts.
    this.pendingMapGlyphs = [];
    this.mapGlyphFlushTimer = null;
    this.mapGlyphBatchWindowMs = Number(process.env.NH_MAP_BATCH_MS || 16);

    this.ready = this.initializeNetHack();
  }

  sendReconnectSnapshot() {
    if (!this.eventHandler) {
      return;
    }

    // Start from a clean client scene before replaying cached state.
    this.emit({
      type: "clear_scene",
      message: "Reconnected - restoring game state",
    });

    const tiles = Array.from(this.gameMap.values());
    const chunkSize = 500;
    for (let i = 0; i < tiles.length; i += chunkSize) {
      this.emit({
        type: "map_glyph_batch",
        tiles: tiles.slice(i, i + chunkSize),
      });
    }

    this.emit({
      type: "player_position",
      x: this.playerPosition.x,
      y: this.playerPosition.y,
    });

    for (const payload of this.latestStatusUpdates.values()) {
      this.emit(payload);
    }

    if (this.latestInventoryItems.length > 0) {
      this.emit({
        type: "inventory_update",
        items: this.latestInventoryItems,
        window: 4,
      });
    }

    const recentMessages = this.gameMessages.slice(-30);
    for (const msg of recentMessages) {
      this.emit({
        type: "text",
        text: msg.text,
        window: msg.window,
        attr: msg.attr,
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

  sendInputSequence(inputs) {
    this.handleClientInputSequence(inputs);
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
    this.inputBroker.drain();
    this.pendingTextResponses = [];
    this.farLookMode = "none";
    this.setPositionInputActive(false);
    this.activeInputRequest = null;
    this.menuSelections.clear();
    this.awaitingQuestionInput = false;

    if (this.pendingMenuSelection && this.pendingMenuSelection.resolver) {
      const resolver = this.pendingMenuSelection.resolver;
      this.pendingMenuSelection = null;
      this.menuSelectionReadyCount = null;
      try {
        resolver(0);
      } catch (error) {
        console.log("Menu selection resolver shutdown error:", error);
      }
    }

    this.inputBroker.cancelAll(27);
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
      tiles: batch,
    });
  }

  handleClientInputSequence(inputs) {
    if (this.isClosed || !Array.isArray(inputs) || inputs.length === 0) {
      return;
    }

    const normalized = inputs.filter(
      (input) => typeof input === "string" && input.length > 0,
    );
    if (normalized.length === 0) {
      return;
    }

    console.log("Received client input sequence:", normalized);
    for (const input of normalized) {
      this.handleClientInput(input, "synthetic");
    }
  }

  // Handle incoming input from the client
  handleClientInput(input, source = "user") {
    if (this.isClosed) {
      return;
    }
    if (typeof input !== "string" || input.length === 0) {
      return;
    }

    console.log("Received client input:", input);

    if (this.isMetaInput(input)) {
      const metaKey = input.slice(this.metaInputPrefix.length).charAt(0);
      if (!metaKey) {
        return;
      }

      const mappedExtCommand =
        this.resolveMetaBoundExtendedCommandName(metaKey);
      if (mappedExtCommand) {
        console.log(
          `Meta input Alt+${metaKey.toLowerCase()} mapped to extended command "${mappedExtCommand}"`,
        );
        this.enqueueInputKeys(
          ["#", ...mappedExtCommand.split(""), "Enter"],
          "meta",
          ["event"],
        );
        return;
      }

      this.enqueueInputKeys(["Escape", metaKey], "meta", ["event"]);
      return;
    }

    const selectedMenuItem = this.resolveMenuItemFromSelectionInput(input);
    if (selectedMenuItem) {
      const selectionEntry =
        this.createSelectionEntryFromMenuItem(selectedMenuItem);
      if (!selectionEntry) {
        return;
      }
      const selectionKey = this.getMenuSelectionKey(selectionEntry);

      if (this.isInMultiPickup) {
        if (this.menuSelections.has(selectionKey)) {
          this.menuSelections.delete(selectionKey);
          console.log(
            `Deselected item: ${selectionEntry.menuChar} (${selectionEntry.text}). Current selections:`,
            Array.from(this.menuSelections.values()).map(
              (item) => `${item.menuChar}:${item.text}`,
            ),
          );
        } else {
          this.menuSelections.set(selectionKey, selectionEntry);
          console.log(
            `Selected item: ${selectionEntry.menuChar} (${selectionEntry.text}). Current selections:`,
            Array.from(this.menuSelections.values()).map(
              (item) => `${item.menuChar}:${item.text}`,
            ),
          );
        }
        return;
      }

      this.menuSelections.clear();
      this.menuSelections.set(selectionKey, selectionEntry);
      console.log(
        `Recorded single menu selection by index: ${selectionEntry.menuIndex} (${selectionEntry.menuChar} ${selectionEntry.text})`,
      );

      if (this.awaitingQuestionInput) {
        const wakeInput = this.getMenuSelectionWakeInput(selectedMenuItem);
        this.enqueueInputKeys([wakeInput], source, ["event"]);
      }
      return;
    }

    if (this.isLiteralTextInput(input)) {
      this.pendingTextResponses.push(input);
      console.log(`Queued text response input: "${input}"`);
      return;
    }

    const normalizedInput = this.normalizeInputKey(input);

    if (
      !this.isInMultiPickup &&
      this.awaitingQuestionInput &&
      typeof normalizedInput === "string" &&
      normalizedInput.length === 1 &&
      Array.isArray(this.currentMenuItems) &&
      this.currentMenuItems.length > 0
    ) {
      const menuItem = this.currentMenuItems.find(
        (item) => item.accelerator === normalizedInput && !item.isCategory,
      );
      if (menuItem) {
        this.menuSelections.clear();
        const selectionEntry = this.createSelectionEntryFromMenuItem(menuItem);
        if (!selectionEntry) {
          return;
        }
        const selectionKey = this.getMenuSelectionKey(selectionEntry);
        this.menuSelections.set(selectionKey, selectionEntry);
        console.log(
          `Recorded single menu selection: ${normalizedInput} (${menuItem.text})`,
        );
      }
    }

    if (
      this.isInMultiPickup &&
      typeof normalizedInput === "string" &&
      normalizedInput.length === 1 &&
      normalizedInput !== "\r" &&
      normalizedInput !== "\n" &&
      normalizedInput !== "Escape"
    ) {
      const menuItem = this.currentMenuItems.find(
        (item) => item.accelerator === normalizedInput && !item.isCategory,
      );
      if (menuItem) {
        const selectionEntry = this.createSelectionEntryFromMenuItem(menuItem);
        if (!selectionEntry) {
          return;
        }
        const selectionKey = this.getMenuSelectionKey(selectionEntry);
        if (this.menuSelections.has(selectionKey)) {
          this.menuSelections.delete(selectionKey);
          console.log(
            `Deselected item: ${normalizedInput} (${menuItem.text}). Current selections:`,
            Array.from(this.menuSelections.values()).map(
              (item) => `${item.menuChar}:${item.text}`,
            ),
          );
        } else {
          this.menuSelections.set(selectionKey, selectionEntry);
          console.log(
            `Selected item: ${normalizedInput} (${menuItem.text}). Current selections:`,
            Array.from(this.menuSelections.values()).map(
              (item) => `${item.menuChar}:${item.text}`,
            ),
          );
        }
      } else {
        console.log(`No menu item found for accelerator '${normalizedInput}'`);
      }
      console.log("Multi-pickup item selection updated");
      return;
    }

    if (
      this.isInMultiPickup &&
      (normalizedInput === "Enter" ||
        normalizedInput === "\r" ||
        normalizedInput === "\n")
    ) {
      const selectedItems = Array.from(this.menuSelections.values()).map(
        (item) => `${item.menuChar}:${item.text}`,
      );
      console.log("Confirming multi-pickup with selections:", selectedItems);
      this.resolveMenuSelection(this.menuSelections.size);
      if (this.inputBroker.hasPendingRequests("event")) {
        this.enqueueInputKeys(["Enter"], source, ["event"]);
      }
      return;
    }

    if (this.isInMultiPickup && normalizedInput === "Escape") {
      this.menuSelections.clear();
      this.resolveMenuSelection(0);
      if (this.inputBroker.hasPendingRequests("event")) {
        this.enqueueInputKeys(["Escape"], source, ["event"]);
      }
      return;
    }

    this.enqueueInputKeys([normalizedInput], source);
  }

  enqueueInputKeys(keys, source = "user", targetKinds = "any") {
    const now = Date.now();
    const tokens = [];
    for (const key of keys) {
      if (typeof key !== "string" || key.length === 0) {
        continue;
      }
      tokens.push({
        key,
        source,
        createdAt: now,
        targetKinds,
      });
    }
    if (tokens.length > 0) {
      this.inputBroker.enqueueTokens(tokens);
    }
  }

  normalizeInputKey(input) {
    if (input === "\r" || input === "\n") {
      return "Enter";
    }
    return input;
  }

  isLiteralTextInput(input) {
    if (typeof input !== "string" || input.length <= 1) {
      return false;
    }
    if (this.isMetaInput(input)) {
      return false;
    }

    const nonTextInputs = new Set([
      "Enter",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Numpad1",
      "Numpad2",
      "Numpad3",
      "Numpad4",
      "Numpad5",
      "Numpad6",
      "Numpad7",
      "Numpad8",
      "Numpad9",
      "NumpadDecimal",
      "Backspace",
      "Space",
      "Spacebar",
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
    ]);

    return !nonTextInputs.has(input);
  }

  resolveMenuSelection(selectionCount) {
    this.menuSelectionReadyCount = selectionCount;
    this.isInMultiPickup = false;

    if (
      this.pendingMenuSelection &&
      typeof this.pendingMenuSelection.resolver === "function"
    ) {
      const { resolver, menuListPtrPtr } = this.pendingMenuSelection;
      this.pendingMenuSelection = null;
      this.writeMenuSelectionResult(menuListPtrPtr || 0, selectionCount);
      if (selectionCount <= 0) {
        this.menuSelections.clear();
      }
      resolver(selectionCount);
      this.menuSelectionReadyCount = null;
      return;
    }

    if (selectionCount <= 0) {
      this.menuSelections.clear();
    }
  }

  consumeInputResult(result, requestKind) {
    if (!result || result.cancelled) {
      return typeof result?.cancelCode === "number" ? result.cancelCode : 27;
    }

    const token = result.token;
    const key = token && typeof token.key === "string" ? token.key : "";
    if (!key) {
      return 0;
    }

    if (
      requestKind === "event" &&
      token &&
      this.shouldRouteEventInputToPosition(key)
    ) {
      console.log(
        `Routing directional input "${key}" from event callback to position callback`,
      );
      this.inputBroker.prependToken({
        ...token,
        targetKinds: ["position"],
      });
      return 0;
    }

    if (requestKind === "event") {
      if (this.isPositionModeInitiatorInput(key)) {
        this.farLookMode = "armed";
      } else if (this.farLookMode === "armed") {
        this.farLookMode = "none";
      }
    }

    if (requestKind === "position" && this.farLookMode === "active") {
      if (this.isFarLookExitInput(key)) {
        this.farLookMode = "none";
        this.setPositionInputActive(false);
      }
    }

    return this.processKey(key);
  }

  requestInputCode(requestKind) {
    if (this.activeInputRequest && this.activeInputRequest.promise) {
      if (this.activeInputRequest.kind === requestKind) {
        return this.activeInputRequest.promise;
      }

      console.log(
        `Deferring ${requestKind} input request until pending ${this.activeInputRequest.kind} request completes`,
      );
      return this.activeInputRequest.promise.then(() =>
        this.requestInputCode(requestKind),
      );
    }

    const requested = this.inputBroker.requestNext(requestKind);
    if (requested && typeof requested.then === "function") {
      let pendingPromise = null;
      pendingPromise = requested
        .then((result) => this.consumeInputResult(result, requestKind))
        .finally(() => {
          if (
            this.activeInputRequest &&
            this.activeInputRequest.promise === pendingPromise
          ) {
            this.activeInputRequest = null;
          }
        });
      this.activeInputRequest = {
        kind: requestKind,
        promise: pendingPromise,
      };
      return pendingPromise;
    }
    return this.consumeInputResult(requested, requestKind);
  }
  // Handle request for tile update from client
  handleTileUpdateRequest(x, y) {
    if (this.isClosed) {
      return;
    }
    console.log(`🔄 Client requested tile update for (${x}, ${y})`);

    const key = `${x},${y}`;
    const tileData = this.gameMap.get(key);

    if (tileData) {
      console.log(`📤 Resending tile data for (${x}, ${y}):`, tileData);

      if (this.eventHandler) {
        this.queueMapGlyphUpdate({
          type: "map_glyph",
          x: tileData.x,
          y: tileData.y,
          glyph: tileData.glyph,
          char: tileData.char,
          color: tileData.color,
          window: 2, // WIN_MAP
          isRefresh: true, // Mark this as a refresh to distinguish from new data
        });
      }
    } else {
      console.log(
        `⚠️ No tile data found for (${x}, ${y}) - tile may not be explored yet`,
      );

      // Optionally, we could send a "blank" tile or request NetHack to redraw the area
      if (this.eventHandler) {
        this.emit({
          type: "tile_not_found",
          x: x,
          y: y,
          message: "Tile data not available - may not be explored yet",
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
      `🔄 Client requested area update centered at (${centerX}, ${centerY}) with radius ${radius}`,
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
              window: 2, // WIN_MAP
              isRefresh: true,
              isAreaRefresh: true,
            });
          }
          tilesRefreshed++;
        }
      }
    }

    console.log(
      `📤 Refreshed ${tilesRefreshed} tiles in area around (${centerX}, ${centerY})`,
    );

    // Ensure tile updates land before completion notification.
    this.flushMapGlyphUpdates();

    // Send completion message
    if (this.eventHandler) {
      this.emit({
        type: "area_refresh_complete",
        centerX: centerX,
        centerY: centerY,
        radius: radius,
        tilesRefreshed: tilesRefreshed,
      });
    }
  }

  // Helper method for key processing
  processKey(key) {
    if (
      key === " " ||
      key === "Space" ||
      key === "Spacebar" ||
      key === "." ||
      key === "Period" ||
      key === "Decimal" ||
      key === "NumpadDecimal"
    ) {
      return ".".charCodeAt(0);
    }

    // With number_pad:1 option, translate arrow keys to numpad equivalents
    if (key === "ArrowLeft") return "4".charCodeAt(0);
    if (key === "ArrowRight") return "6".charCodeAt(0);
    if (key === "ArrowUp") return "8".charCodeAt(0);
    if (key === "ArrowDown") return "2".charCodeAt(0);
    if (key === "Numpad1") return "1".charCodeAt(0);
    if (key === "Numpad2") return "2".charCodeAt(0);
    if (key === "Numpad3") return "3".charCodeAt(0);
    if (key === "Numpad4") return "4".charCodeAt(0);
    if (key === "Numpad5") return "5".charCodeAt(0);
    if (key === "Numpad6") return "6".charCodeAt(0);
    if (key === "Numpad7") return "7".charCodeAt(0);
    if (key === "Numpad8") return "8".charCodeAt(0);
    if (key === "Numpad9") return "9".charCodeAt(0);
    if (key === "Enter") return 13;
    if (key === "Escape") return 27;
    if (key.length > 0) return key.charCodeAt(0);
    return 0; // Default for empty/unknown input
  }

  isMetaInput(key) {
    return (
      typeof key === "string" &&
      key.startsWith(this.metaInputPrefix) &&
      key.length > this.metaInputPrefix.length
    );
  }

  setPositionInputActive(active) {
    const normalized = Boolean(active);
    if (this.positionInputActive === normalized) {
      return;
    }

    this.positionInputActive = normalized;
    if (!normalized) {
      this.positionCursor = null;
    }

    if (this.eventHandler) {
      this.emit({
        type: "position_input_state",
        active: normalized,
      });
    }
  }

  emitPositionCursor(windowId, x, y, source = "curs") {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    this.positionCursor = { x, y, window: windowId };
    if (this.eventHandler) {
      this.emit({
        type: "position_cursor",
        x: x,
        y: y,
        window: windowId,
        source: source,
      });
    }
  }

  isPositionModeInitiatorInput(input) {
    return input === ";";
  }

  isFarLookPositionRequest() {
    return this.farLookMode === "armed" || this.farLookMode === "active";
  }

  isDirectionalMovementInput(input) {
    if (typeof input !== "string" || input.length === 0) {
      return false;
    }

    if (input.length === 1) {
      return (
        input === "h" ||
        input === "j" ||
        input === "k" ||
        input === "l" ||
        input === "y" ||
        input === "u" ||
        input === "b" ||
        input === "n" ||
        input === "H" ||
        input === "J" ||
        input === "K" ||
        input === "L" ||
        input === "Y" ||
        input === "U" ||
        input === "B" ||
        input === "N"
      );
    }

    return (
      input === "ArrowLeft" ||
      input === "ArrowRight" ||
      input === "ArrowUp" ||
      input === "ArrowDown" ||
      input === "Home" ||
      input === "End" ||
      input === "PageUp" ||
      input === "PageDown" ||
      input === "Numpad1" ||
      input === "Numpad2" ||
      input === "Numpad3" ||
      input === "Numpad4" ||
      input === "Numpad6" ||
      input === "Numpad7" ||
      input === "Numpad8" ||
      input === "Numpad9"
    );
  }

  shouldRouteEventInputToPosition(input) {
    if (this.awaitingQuestionInput) {
      return false;
    }
    if (this.isInMultiPickup) {
      return false;
    }
    if (this.pendingMenuSelection) {
      return false;
    }
    return this.isDirectionalMovementInput(input);
  }

  isFarLookExitInput(input) {
    return (
      input === "Escape" ||
      input === "Enter" ||
      input === "\r" ||
      input === "\n"
    );
  }

  isPrintableAccelerator(code) {
    return typeof code === "number" && code > 32 && code < 127;
  }

  classifyInventoryWindowMenu(menuItems) {
    const items = Array.isArray(menuItems) ? menuItems : [];
    const nonCategoryItems = items.filter((item) => !item.isCategory);
    const hasCategoryHeaders = items.some((item) => item.isCategory);
    const hasSelectableEntries = nonCategoryItems.some(
      (item) =>
        this.isPrintableAccelerator(item.originalAccelerator) ||
        (typeof item.identifier === "number" && item.identifier > 0),
    );

    if (items.length === 0) {
      return { kind: "inventory", lines: [] };
    }

    if (hasCategoryHeaders || hasSelectableEntries) {
      return { kind: "inventory", lines: [] };
    }

    // WIN_INVEN is also used by NetHack for reports like self-knowledge.
    // If entries are non-selectable metadata rows, treat as informational.
    const lines = nonCategoryItems
      .map((item) => String(item.text || "").trim())
      .filter((text) => text.length > 0);
    return { kind: "info_menu", lines };
  }

  normalizeQuestionText(question) {
    if (typeof question !== "string") {
      return "";
    }
    return question.trim().toLowerCase();
  }

  isMenuSelectionInput(input) {
    return (
      typeof input === "string" &&
      input.startsWith(this.menuSelectionInputPrefix) &&
      input.length > this.menuSelectionInputPrefix.length
    );
  }

  decodeMenuSelectionIndex(input) {
    if (!this.isMenuSelectionInput(input)) {
      return null;
    }
    const raw = input.slice(this.menuSelectionInputPrefix.length).trim();
    if (!/^-?\d+$/.test(raw)) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  }

  getMenuSelectionKey(item) {
    const menuIndex = Number.isInteger(item?.menuIndex) ? item.menuIndex : -1;
    return `menu-index:${menuIndex}`;
  }

  createSelectionEntryFromMenuItem(menuItem) {
    if (!menuItem) {
      return null;
    }
    return {
      menuChar: menuItem.accelerator,
      originalAccelerator: menuItem.originalAccelerator,
      identifier: menuItem.identifier,
      menuIndex: menuItem.menuIndex,
      text: menuItem.text,
    };
  }

  getMenuSelectionWakeInput(menuItem) {
    if (
      menuItem &&
      typeof menuItem.accelerator === "string" &&
      menuItem.accelerator.length === 1
    ) {
      return menuItem.accelerator;
    }
    const original = menuItem?.originalAccelerator;
    if (typeof original === "number" && original > 32 && original < 127) {
      return String.fromCharCode(original);
    }
    return "Enter";
  }

  resolveMenuItemFromSelectionInput(input) {
    const menuIndex = this.decodeMenuSelectionIndex(input);
    if (!Number.isInteger(menuIndex)) {
      return null;
    }
    if (!Array.isArray(this.currentMenuItems) || this.currentMenuItems.length === 0) {
      return null;
    }
    return (
      this.currentMenuItems.find(
        (item) =>
          item &&
          !item.isCategory &&
          Number.isInteger(item.menuIndex) &&
          item.menuIndex === menuIndex,
      ) || null
    );
  }

  isContainerLootTypeQuestion(question) {
    const normalized = this.normalizeQuestionText(question);
    const asksObjectTypes =
      normalized.includes("what types of objects") ||
      normalized.includes("what type of objects");
    const isContainerTransferQuestion =
      normalized.includes("take out") || normalized.includes("put in");
    return asksObjectTypes && isContainerTransferQuestion;
  }

  isMultiSelectLootQuestion(question) {
    const normalized = this.normalizeQuestionText(question);
    return (
      normalized.includes("pick up what") ||
      normalized.includes("what do you want to pick up") ||
      normalized.includes("take out what") ||
      normalized.includes("put in what") ||
      normalized.includes("what do you want to put in") ||
      normalized.includes("put in, then take out what")
    );
  }

  consumeQueuedExtendedCommandInput() {
    let commandText = "";

    while (true) {
      const nextToken = this.inputBroker.dequeueToken("event");
      if (!nextToken) {
        break;
      }

      const nextInput = nextToken.key;
      if (nextInput === undefined || nextInput === null) {
        continue;
      }

      if (nextInput === "Escape") {
        return null;
      }
      if (nextInput === "Enter" || nextInput === "\r" || nextInput === "\n") {
        break;
      }
      if (nextInput === "Backspace") {
        commandText = commandText.slice(0, -1);
        continue;
      }

      let token = null;
      if (typeof nextInput === "string" && nextInput.length === 1) {
        token = nextInput;
      } else {
        // Preserve non-command input for the normal callback path.
        this.inputBroker.prependToken(nextToken);
        break;
      }

      if (!token || token === "#") {
        continue;
      }
      if (/^[A-Za-z0-9_?-]$/.test(token)) {
        commandText += token.toLowerCase();
        continue;
      }

      // Preserve unexpected input for regular processing.
      this.inputBroker.prependToken(nextToken);
      break;
    }

    return commandText;
  }

  resolveExtendedCommandIndex(commandText) {
    const normalized = String(commandText || "")
      .trim()
      .toLowerCase()
      .replace(/^#+/, "");
    if (!normalized) {
      return -1;
    }

    const entries = this.getExtendedCommandEntries();
    if (!entries.length) {
      return -1;
    }

    const exact = entries.find((entry) => entry.name === normalized);
    if (exact) {
      return exact.index;
    }

    const prefixMatches = entries.filter((entry) =>
      entry.name.startsWith(normalized),
    );
    if (prefixMatches.length === 1) {
      return prefixMatches[0].index;
    }

    return -1;
  }

  resolveMetaBoundExtendedCommandName(metaKey) {
    if (typeof metaKey !== "string" || metaKey.length === 0) {
      return null;
    }

    const normalized = metaKey.charAt(0).toLowerCase();
    if (!/^[a-z]$/.test(normalized)) {
      return null;
    }

    const metaKeyCode = normalized.charCodeAt(0) | 0x80;
    const entries = this.getExtendedCommandEntries().filter(
      (entry) => entry.keyCode === metaKeyCode,
    );
    if (entries.length === 0) {
      return null;
    }

    const preferred =
      entries.find((entry) => entry.name !== "#" && entry.name !== "?") ||
      entries[0];
    return preferred && typeof preferred.name === "string"
      ? preferred.name
      : null;
  }

  getExtendedCommandEntries() {
    if (
      Array.isArray(this.extendedCommandEntries) &&
      this.extendedCommandEntries.length > 0
    ) {
      return this.extendedCommandEntries;
    }

    const extracted = this.extractExtendedCommandEntriesFromMemory();
    if (extracted.length > 0) {
      this.extendedCommandEntries = extracted;
      return extracted;
    }

    this.extendedCommandEntries = this.getFallbackExtendedCommandEntries();
    return this.extendedCommandEntries;
  }

  extractExtendedCommandEntriesFromMemory() {
    if (
      !this.nethackModule ||
      !this.nethackModule.HEAPU8 ||
      !this.nethackModule.HEAP32
    ) {
      return [];
    }

    const heapU8 = this.nethackModule.HEAPU8;
    const candidateStrides = [24, 20];

    for (const stride of candidateStrides) {
      const flagsOffset = stride === 24 ? 16 : 12;
      const maxBase = heapU8.length - stride;
      for (let base = 0; base <= maxBase; base += 4) {
        if (heapU8[base] !== "#".charCodeAt(0)) {
          continue;
        }

        const textPtr = this.nethackModule.HEAP32[(base + 4) >> 2];
        if (this.readHeapCString(textPtr, 4) !== "#") {
          continue;
        }

        const descPtr = this.nethackModule.HEAP32[(base + 8) >> 2];
        if (
          this.readHeapCString(descPtr, 64) !== "perform an extended command"
        ) {
          continue;
        }

        const entries = this.readExtendedCommandEntriesFromBase(
          base,
          stride,
          flagsOffset,
        );
        if (
          entries.length >= 20 &&
          entries[0].name === "#" &&
          entries.some((entry) => entry.name === "pray") &&
          entries.some((entry) => entry.name === "chat")
        ) {
          console.log(
            `Resolved extended command table from WASM memory (${entries.length} entries, stride=${stride}, base=${base})`,
          );
          return entries;
        }
      }
    }

    return [];
  }

  readExtendedCommandEntriesFromBase(base, stride, flagsOffset) {
    if (
      !this.nethackModule ||
      !this.nethackModule.HEAPU8 ||
      !this.nethackModule.HEAP32
    ) {
      return [];
    }

    const heapU8 = this.nethackModule.HEAPU8;
    const heap32 = this.nethackModule.HEAP32;
    const entries = [];

    for (let index = 0; index < 256; index++) {
      const offset = base + index * stride;
      if (offset + stride > heapU8.length) {
        break;
      }

      const keyCode = heap32[offset >> 2];
      const textPtr = heap32[(offset + 4) >> 2];
      if (!Number.isInteger(textPtr) || textPtr <= 0) {
        break;
      }

      const name = this.readHeapCString(textPtr, 64);
      if (!this.isLikelyExtendedCommandName(name)) {
        if (index === 0) {
          return [];
        }
        break;
      }

      const flags = heap32[(offset + flagsOffset) >> 2];
      entries.push({
        index,
        name: name.toLowerCase(),
        keyCode: Number.isInteger(keyCode) ? keyCode : 0,
        flags: Number.isInteger(flags) ? flags : 0,
      });
    }

    return entries;
  }

  readHeapCString(ptr, maxLength = 128) {
    if (
      !this.nethackModule ||
      !this.nethackModule.HEAPU8 ||
      !Number.isInteger(ptr) ||
      ptr <= 0
    ) {
      return "";
    }

    const heap = this.nethackModule.HEAPU8;
    if (ptr >= heap.length) {
      return "";
    }

    const end = Math.min(heap.length, ptr + maxLength);
    let text = "";
    for (let i = ptr; i < end; i++) {
      const code = heap[i];
      if (code === 0) {
        break;
      }
      if (code < 32 || code > 126) {
        return "";
      }
      text += String.fromCharCode(code);
    }
    return text;
  }

  isLikelyExtendedCommandName(name) {
    return (
      typeof name === "string" &&
      name.length > 0 &&
      name.length <= 32 &&
      /^[A-Za-z0-9_?#-]+$/.test(name)
    );
  }

  getFallbackExtendedCommandEntries() {
    const fallbackNames = [
      "#",
      "?",
      "adjust",
      "annotate",
      "apply",
      "attributes",
      "autopickup",
      "call",
      "cast",
      "chat",
      "close",
      "conduct",
      "dip",
      "drop",
      "droptype",
      "eat",
      "engrave",
      "enhance",
      "explode",
      "fight",
      "fire",
      "force",
      "getpos",
      "glance",
      "history",
      "invoke",
      "jump",
      "kick",
      "known",
      "knownclass",
      "look",
      "loot",
      "monster",
      "monsters",
      "name",
      "namefloor",
      "offer",
      "open",
      "options",
      "overview",
      "pay",
      "pickup",
      "pray",
      "prevmsg",
      "puton",
      "quaff",
      "quit",
      "quiver",
      "read",
      "redraw",
      "remove",
      "ride",
      "rub",
      "seeall",
      "seeamulet",
      "seegold",
      "seeinv",
      "seespells",
      "semicolon",
      "set",
      "shell",
      "sit",
      "spells",
      "takeoff",
      "takeoffall",
      "teleport",
      "terrain",
      "throw",
      "tip",
      "travel",
      "turn",
      "twoweapon",
      "untrap",
      "version",
      "versionshort",
      "wield",
      "wipe",
      "wear",
      "whatdoes",
      "whatis",
      "wieldquiver",
      "zap",
    ];
    const fallbackMetaBindings = {
      adjust: "a",
      chat: "c",
      dip: "d",
      enhance: "e",
      force: "f",
      invoke: "i",
      jump: "j",
      loot: "l",
      monster: "m",
      offer: "o",
      pray: "p",
      quit: "q",
      rub: "r",
      sit: "s",
      turn: "t",
      untrap: "u",
      version: "v",
      wipe: "w",
    };

    console.log(
      `Using fallback extended command table (${fallbackNames.length} entries)`,
    );
    return fallbackNames.map((name, index) => ({
      index,
      name,
      keyCode: fallbackMetaBindings[name]
        ? fallbackMetaBindings[name].charCodeAt(0) | 0x80
        : 0,
      flags: 0,
    }));
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
      25: "BL_CHARACTERISTICS",
    };

    if (typeof field !== "number") return String(field);

    const constants =
      globalThis.nethackGlobal && globalThis.nethackGlobal.constants
        ? globalThis.nethackGlobal.constants
        : null;
    if (
      constants &&
      constants.STATUS_FIELD &&
      constants.STATUS_FIELD[field] !== undefined
    ) {
      return String(constants.STATUS_FIELD[field]);
    }

    return fallback[field] || `FIELD_${field}`;
  }

  decodeShimArgValue(name, ptrToArg, type) {
    if (
      !this.nethackModule ||
      typeof this.nethackModule.getValue !== "function" ||
      !globalThis.nethackGlobal ||
      !globalThis.nethackGlobal.helpers ||
      typeof globalThis.nethackGlobal.helpers.getPointerValue !== "function"
    ) {
      return null;
    }

    const argPtr = this.nethackModule.getValue(ptrToArg, "*");
    return globalThis.nethackGlobal.helpers.getPointerValue(name, argPtr, type);
  }

  decodeStatusValue(fieldName, ptrToArg) {
    const rawPointerFields = new Set([
      "BL_CONDITION",
      "BL_RESET",
      "BL_FLUSH",
      "BL_CHARACTERISTICS",
    ]);
    const primaryType = rawPointerFields.has(fieldName) ? "p" : "s";
    const fallbackType = primaryType === "s" ? "p" : "s";

    try {
      const primary = this.decodeShimArgValue(
        "shim_status_update",
        ptrToArg,
        primaryType,
      );
      if (primary !== null && primary !== undefined) {
        return {
          value: primary,
          valueType: primaryType,
          usedFallback: false,
        };
      }
    } catch (error) {
      console.log(
        `Status decode failed (${fieldName}, ${primaryType})`,
        error && error.message ? error.message : error,
      );
    }

    try {
      const fallback = this.decodeShimArgValue(
        "shim_status_update",
        ptrToArg,
        fallbackType,
      );
      if (fallback !== null && fallback !== undefined) {
        return {
          value: fallback,
          valueType: fallbackType,
          usedFallback: true,
        };
      }
    } catch (error) {
      console.log(
        `Status decode fallback failed (${fieldName}, ${fallbackType})`,
        error && error.message ? error.message : error,
      );
    }

    return { value: null, valueType: "unknown", usedFallback: false };
  }

  shouldUseAllCountForMenuItem(item) {
    if (!item || typeof item.text !== "string") {
      return false;
    }

    const text = item.text.trim();
    if (!text) {
      return false;
    }

    // Common NetHack stacked-item patterns.
    if (/^\d+\s+/.test(text)) {
      return true;
    }
    if (/\(\d+\)\s*$/.test(text)) {
      return true;
    }
    if (/\bgold pieces?\b/i.test(text)) {
      return true;
    }

    return false;
  }

  writeMenuSelectionResult(menuListPtrPtr, selectionCount) {
    if (!this.nethackModule || !menuListPtrPtr) {
      return;
    }

    const heapSize =
      this.nethackModule.HEAPU8 && this.nethackModule.HEAPU8.length
        ? this.nethackModule.HEAPU8.length
        : 0;
    const isAlignedPtr =
      Number.isInteger(menuListPtrPtr) &&
      menuListPtrPtr > 0 &&
      (menuListPtrPtr & 3) === 0;
    const isInBounds = !heapSize || menuListPtrPtr + 4 <= heapSize;
    if (!isAlignedPtr || !isInBounds) {
      console.log(
        `Skipping menu selection write: invalid menuListPtrPtr=${menuListPtrPtr} (aligned=${isAlignedPtr}, inBounds=${isInBounds}, heapSize=${heapSize})`,
      );
      return;
    }

    try {
      const selectedItems = Array.from(this.menuSelections.values());
      // This build's menu_item layout is:
      //   anything item;      // +0 (4 bytes on wasm32)
      //   long count;         // +4
      //   unsigned itemflags; // +8
      // Use 12-byte stride by default, allow overrides for diagnostics.
      const bytesPerMenuItem = Number(process.env.NH_MENU_ITEM_STRIDE || 12);
      const configuredCountOffset = process.env.NH_MENU_COUNT_OFFSET;
      const countOffsetPrimary =
        configuredCountOffset !== undefined ? Number(configuredCountOffset) : 4;
      const configuredItemFlagsOffset = process.env.NH_MENU_ITEMFLAGS_OFFSET;
      const itemFlagsOffset =
        configuredItemFlagsOffset !== undefined
          ? Number(configuredItemFlagsOffset)
          : 8;
      const canWriteCountAt = (offset) =>
        Number.isInteger(offset) &&
        offset >= 0 &&
        offset + 4 <= bytesPerMenuItem;

      if (selectionCount <= 0) {
        this.nethackModule.setValue(menuListPtrPtr, 0, "*");
        console.log(
          `Menu selection write: cleared output pointer at menuListPtrPtr=${menuListPtrPtr}`,
        );
        return;
      }

      const priorOutPtr = this.nethackModule.getValue(menuListPtrPtr, "*");
      const outPtr = this.nethackModule._malloc(
        selectionCount * bytesPerMenuItem,
      );
      this.nethackModule.setValue(menuListPtrPtr, outPtr, "*");
      if (this.nethackModule.HEAPU8 && bytesPerMenuItem > 0) {
        // Clear all bytes to avoid stale data in optional struct fields.
        this.nethackModule.HEAPU8.fill(
          0,
          outPtr,
          outPtr + selectionCount * bytesPerMenuItem,
        );
      }
      const confirmOutPtr = this.nethackModule.getValue(menuListPtrPtr, "*");
      console.log(
        `Writing ${selectionCount} selections at outPtr=${outPtr} (menuListPtrPtr=${menuListPtrPtr}, priorOutPtr=${priorOutPtr}, confirmOutPtr=${confirmOutPtr}, stride=${bytesPerMenuItem}, countOffsetPrimary=${countOffsetPrimary}, itemFlagsOffset=${itemFlagsOffset})`,
      );

      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const structOffset = outPtr + i * bytesPerMenuItem;
        let itemIdentifier =
          typeof item.identifier === "number"
            ? item.identifier
            : item.originalAccelerator;
        if (
          typeof itemIdentifier !== "number" &&
          typeof item.menuChar === "string" &&
          item.menuChar.length === 1
        ) {
          itemIdentifier = item.menuChar.charCodeAt(0);
        }

        if (typeof itemIdentifier !== "number") {
          console.log(
            `Skipping item ${i} because identifier is not numeric:`,
            itemIdentifier,
          );
          continue;
        }

        this.nethackModule.setValue(structOffset, itemIdentifier, "i32");
        // Some ports use -1 for "all" stack count semantics, others accept 1.
        // Default behavior is "auto": stacked items select all by default.
        const countMode = process.env.NH_MENU_COUNT_MODE || "auto";
        const countValue =
          countMode === "all"
            ? -1
            : countMode === "one"
              ? 1
              : this.shouldUseAllCountForMenuItem(item)
                ? -1
                : 1;
        // Write count in both likely offsets for compatibility across layouts.
        if (canWriteCountAt(countOffsetPrimary)) {
          this.nethackModule.setValue(
            structOffset + countOffsetPrimary,
            countValue,
            "i32",
          );
        }
        if (
          canWriteCountAt(itemFlagsOffset) &&
          itemFlagsOffset !== countOffsetPrimary
        ) {
          this.nethackModule.setValue(structOffset + itemFlagsOffset, 0, "i32");
        }
        const debugItem = this.nethackModule.getValue(structOffset, "i32");
        const debugCountPrimary = canWriteCountAt(countOffsetPrimary)
          ? this.nethackModule.getValue(
              structOffset + countOffsetPrimary,
              "i32",
            )
          : null;
        const debugItemFlags =
          canWriteCountAt(itemFlagsOffset) &&
          itemFlagsOffset !== countOffsetPrimary
            ? this.nethackModule.getValue(structOffset + itemFlagsOffset, "i32")
            : null;
        console.log(
          `Wrote menu_item[${i}] => item=${debugItem}, countPrimary=${debugCountPrimary}, itemFlags=${debugItemFlags}, countMode=${countMode}`,
        );
      }
      const dumpBytes = Math.min(selectionCount * bytesPerMenuItem, 64);
      const dump = [];
      for (let i = 0; i < dumpBytes; i++) {
        const b = this.nethackModule.getValue(outPtr + i, "i8") & 0xff;
        dump.push(b.toString(16).padStart(2, "0"));
      }
      console.log(
        `menu_item buffer dump (${dumpBytes} bytes): ${dump.join(" ")}`,
      );
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
              4: "WIN_INVEN",
            },
            STATUS_FIELD: {},
            MENU_SELECT: { PICK_NONE: 0, PICK_ONE: 1, PICK_ANY: 2 },
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
                  return String.fromCharCode(
                    this.nethackModule.getValue(ptr, "i8"),
                  );
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
            },
          },
          globals: { WIN_MAP: 2, WIN_INVEN: 4, WIN_STATUS: 3, WIN_MESSAGE: 1 },
        };
      }

      let moduleConfig = null;
      moduleConfig = {
        locateFile: (assetPath) => {
          if (assetPath.endsWith(".wasm")) {
            return resolveRuntimeAssetUrl("nethack.wasm");
          }
          return resolveRuntimeAssetUrl(assetPath);
        },
        preRun: [
          () => {
            if (!moduleConfig.ENV) {
              moduleConfig.ENV = {};
            }
            const runtimeOptions = [
              // Input/menu behavior expected by the browser port.
              "pickup_types:$",
              "number_pad:1",
              // Status tracking fields consumed by the HUD.
              "time",
              "showexp",
              "showscore",
              // Enable status highlight metadata in status callbacks.
              "statushilites",
              "force_invmenu",
              "boulder:0",
            ];
            const existingOptions =
              typeof moduleConfig.ENV.NETHACKOPTIONS === "string"
                ? moduleConfig.ENV.NETHACKOPTIONS.trim()
                : "";
            moduleConfig.ENV.NETHACKOPTIONS = existingOptions
              ? `${existingOptions},${runtimeOptions.join(",")}`
              : runtimeOptions.join(",");
            console.log(
              `Configured NETHACKOPTIONS: ${moduleConfig.ENV.NETHACKOPTIONS}`,
            );
          },
        ],
        onRuntimeInitialized: async () => {
          this.nethackModule = moduleConfig;
          try {
            await moduleConfig.ccall(
              "shim_graphics_set_callback",
              null,
              ["string"],
              ["nethackCallback"],
              { async: true },
            );

            if (moduleConfig.js_helpers_init) {
              moduleConfig.js_helpers_init();
            }

            // NetHack's generated helper may reject "v" (void) arg types in
            // local_callback argument decoding (observed in shim_get_ext_cmd).
            // Treat those as a no-op value to avoid worker crashes.
            this.installHelperCompatibilityShims();
          } catch (error) {
            console.error("Error setting up local NetHack runtime:", error);
          }
        },
      };

      this.nethackInstance = await factory(moduleConfig);
    } catch (error) {
      console.error("Error initializing local NetHack:", error);
      throw error;
    }
  }

  installHelperCompatibilityShims() {
    if (
      !globalThis.nethackGlobal ||
      !globalThis.nethackGlobal.helpers ||
      typeof globalThis.nethackGlobal.helpers.getPointerValue !== "function"
    ) {
      return;
    }

    const helpers = globalThis.nethackGlobal.helpers;
    const existing = helpers.getPointerValue;
    if (existing && existing.__nh3dVoidCompatPatched) {
      return;
    }

    const wrapped = (name, ptr, type) => {
      if (type === "v") {
        return 0;
      }
      return existing(name, ptr, type);
    };
    wrapped.__nh3dVoidCompatPatched = true;
    helpers.getPointerValue = wrapped;
  }

  waitForQuestionInput() {
    this.awaitingQuestionInput = true;
    const requested = this.requestInputCode("event");
    if (requested && typeof requested.then === "function") {
      return requested.finally(() => {
        this.awaitingQuestionInput = false;
      });
    }
    this.awaitingQuestionInput = false;
    return requested;
  }

  handleShimGetNhEvent() {
    if (this.farLookMode === "active" || this.positionInputActive) {
      // Keep get_nh_event non-blocking while position input drives command flow.
      return 0;
    }

    const queuedEventToken = this.inputBroker.dequeueToken("event");
    if (!queuedEventToken) {
      // NetHack calls get_nh_event frequently as an event pump hook.
      // Do not block Asyncify here; keyboard waits belong in nh_poskey/yn flows.
      return 0;
    }

    return this.consumeInputResult(
      {
        requestKind: "event",
        token: queuedEventToken,
        cancelled: false,
        cancelCode: null,
        consumedFromQueue: true,
      },
      "event",
    );
  }

  handleShimYnFunction(args) {
    const [question, choices, defaultChoice] = args;
    console.log(
      `Y/N Question: "${question}" choices: "${choices}" default: ${defaultChoice}`,
    );

    this.lastQuestionText = question;

    if (this.isContainerLootTypeQuestion(question)) {
      console.log('Auto-answering container loot type question with "a"');
      return this.processKey("a");
    }

    if (question && question.toLowerCase().includes("direction")) {
      if (this.eventHandler) {
        this.emit({
          type: "direction_question",
          text: question,
          choices: choices,
          default: defaultChoice,
        });
      }
      return this.waitForQuestionInput();
    }

    if (this.eventHandler) {
      this.emit({
        type: "question",
        text: question,
        choices: choices,
        default: defaultChoice,
        menuItems: [],
      });
    }

    return this.waitForQuestionInput();
  }

  handleShimNhPoskey(args) {
    const [xPtr, yPtr, modPtr] = args;
    void xPtr;
    void yPtr;
    void modPtr;
    console.log("NetHack requesting position key");

    if (this.farLookMode === "armed") {
      this.farLookMode = "active";
      this.setPositionInputActive(true);
      if (!this.positionCursor) {
        this.emitPositionCursor(
          null,
          this.playerPosition.x,
          this.playerPosition.y,
          "nh_poskey_start",
        );
      }
    } else if (this.farLookMode === "active") {
      this.setPositionInputActive(true);
    } else {
      this.setPositionInputActive(false);
    }

    return this.requestInputCode("position");
  }
  handleUICallback(name, args) {
    if (this.isClosed) {
      return 0;
    }
    console.log(`🎮 UI Callback: ${name}`, args);

    const inputCallbackHandlers = {
      shim_get_nh_event: () => this.handleShimGetNhEvent(),
      shim_yn_function: () => this.handleShimYnFunction(args),
      shim_nh_poskey: () => this.handleShimNhPoskey(args),
    };
    const mappedInputHandler = inputCallbackHandlers[name];
    if (mappedInputHandler) {
      return mappedInputHandler();
    }

    switch (name) {
      case "shim_get_ext_cmd":
        const extCommandText = this.consumeQueuedExtendedCommandInput();
        if (extCommandText === null) {
          console.log("Extended command cancelled before submission");
          return -1;
        }

        if (!extCommandText) {
          console.log("Extended command submission was empty");
          return -1;
        }

        const extCommandIndex =
          this.resolveExtendedCommandIndex(extCommandText);
        if (extCommandIndex < 0) {
          console.log(
            `Unknown extended command "${extCommandText}" (canceling command)`,
          );
          return -1;
        }

        console.log(
          `Resolved extended command "${extCommandText}" to index ${extCommandIndex}`,
        );
        return extCommandIndex;

      case "shim_init_nhwindows":
        console.log("Initializing NetHack windows");
        if (this.eventHandler) {
          this.emit({
            type: "name_request",
            text: "What is your name, adventurer?",
            maxLength: 30,
          });
        }
        return 1;
      case "shim_create_nhwindow":
        const [windowType] = args;
        console.log(
          `Creating window [ ${windowType} ] returning ${windowType}`,
        );
        return windowType;
      case "shim_status_init":
        console.log("Initializing status display");
        return 0;
      case "shim_start_menu":
        const [menuWinId, menuOptions] = args;
        console.log("NetHack starting menu:", args);
        this.currentMenuItems = []; // Clear previous menu items
        this.currentWindow = menuWinId;
        this.lastQuestionText = null; // Clear any previous question text when starting new menu

        // Reset selection tracking for new menus
        this.menuSelections.clear();
        this.isInMultiPickup = false;
        this.menuSelectionReadyCount = null;

        if (this.pendingMenuSelection) {
          console.log("Clearing previous pending menu selection resolver");
          this.pendingMenuSelection = null;
        }

        // Log window type for debugging
        const windowTypes = {
          1: "WIN_MESSAGE",
          2: "WIN_MAP",
          3: "WIN_STATUS",
          4: "WIN_INVEN",
        };
        console.log(
          `📋 Starting menu for window ${menuWinId} (${
            windowTypes[menuWinId] || "UNKNOWN"
          })`,
        );
        return 0;
      case "shim_end_menu":
        const [endMenuWinid, menuQuestion] = args;
        console.log("NetHack ending menu:", args);

        // Check if this is just an inventory update vs an actual question
        const isInventoryWindow = endMenuWinid === 4; // WIN_INVEN = 4
        const hasMenuQuestion = menuQuestion && menuQuestion.trim();

        // Log the menu details for debugging
        console.log(
          `📋 Menu ending - Window: ${endMenuWinid}, Question: "${menuQuestion}", Items: ${this.currentMenuItems.length}`,
        );

        // WIN_INVEN is used for both real inventory and informational reports.
        if (isInventoryWindow && !hasMenuQuestion) {
          const classification = this.classifyInventoryWindowMenu(
            this.currentMenuItems,
          );
          const actualItems = this.currentMenuItems.filter(
            (item) => !item.isCategory,
          );
          const categoryHeaders = this.currentMenuItems.filter(
            (item) => item.isCategory,
          );
          console.log(
            `WIN_INVEN no-question menu classified as ${classification.kind} (${actualItems.length} items, ${categoryHeaders.length} categories)`,
          );

          if (this.eventHandler) {
            if (classification.kind === "inventory") {
              this.latestInventoryItems = [...this.currentMenuItems];
              this.emit({
                type: "inventory_update",
                items: this.currentMenuItems,
                window: endMenuWinid,
              });
            } else {
              const infoLines = classification.lines;
              const infoTitle =
                infoLines.length > 0 ? infoLines[0] : "NetHack Information";
              const infoBody =
                infoLines.length > 1 ? infoLines.slice(1) : infoLines;
              this.emit({
                type: "info_menu",
                title: infoTitle,
                lines: infoBody,
                window: endMenuWinid,
              });
            }
          }

          return 0;
        }
        // Special handling for inventory window WITH questions (like drop, wear, etc.)
        if (isInventoryWindow && hasMenuQuestion) {
          console.log(
            `📋 Inventory action question detected: "${menuQuestion}" with ${this.currentMenuItems.length} items`,
          );
          const isMultiSelectQuestion =
            this.isMultiSelectLootQuestion(menuQuestion);
          if (isMultiSelectQuestion) {
            console.log("Multi-select loot dialog detected");
            this.isInMultiPickup = true;
          }
          // Send the inventory question to web client
          if (this.eventHandler) {
            this.emit({
              type: "question",
              text: menuQuestion,
              choices: "",
              default: "",
              menuItems: this.currentMenuItems,
            });
          }

          // Wait for actual user input for inventory questions
          console.log("📋 Waiting for inventory action selection (async)...");
          return this.waitForQuestionInput();
        }

        // If there's a menu question (like "Pick up what?"), send it to the client
        if (hasMenuQuestion && this.currentMenuItems.length > 0) {
          console.log(
            `📋 Menu question detected: "${menuQuestion}" with ${this.currentMenuItems.length} items`,
          );

          if (this.isMultiSelectLootQuestion(menuQuestion)) {
            console.log("Multi-select loot menu detected");
            this.isInMultiPickup = true;
          }

          // Send menu question to web client
          if (this.eventHandler) {
            this.emit({
              type: "question",
              text: menuQuestion,
              choices: "",
              default: "",
              menuItems: this.currentMenuItems,
            });
          }

          // Wait for actual user input for menu questions
          console.log("📋 Waiting for menu selection (async)...");
          return this.waitForQuestionInput();
        }

        // Check if we have menu items but no explicit question - could be a pickup or action menu
        if (
          this.currentMenuItems.length > 0 &&
          !hasMenuQuestion &&
          !isInventoryWindow
        ) {
          console.log(
            `📋 Menu expansion detected with ${this.currentMenuItems.length} items (window ${endMenuWinid})`,
          );

          // Determine the appropriate question based on context and window type
          let contextualQuestion = "Please select an option:";

          // Count non-category items to get actual selectable items
          const selectableItems = this.currentMenuItems.filter(
            (item) => !item.isCategory,
          );
          console.log(
            `📋 Found ${selectableItems.length} selectable items out of ${this.currentMenuItems.length} total`,
          );

          // Try to infer the action from the menu items and context
          if (
            selectableItems.some(
              (item) =>
                item.text &&
                typeof item.text === "string" &&
                (item.text.includes("gold pieces") ||
                  item.text.includes("corpse") ||
                  item.text.includes("here")),
            )
          ) {
            contextualQuestion = "What would you like to pick up?";
          } else if (
            selectableItems.some(
              (item) =>
                item.text &&
                typeof item.text === "string" &&
                (item.text.includes("spell") || item.text.includes("magic")),
            )
          ) {
            contextualQuestion = "Which spell would you like to cast?";
          } else if (
            selectableItems.some(
              (item) =>
                item.text &&
                typeof item.text === "string" &&
                (item.text.includes("wear") ||
                  item.text.includes("wield") ||
                  item.text.includes("armor")),
            )
          ) {
            contextualQuestion = "What would you like to use?";
          }

          // Only show dialog if we have actual selectable items
          if (selectableItems.length > 0) {
            if (this.isMultiSelectLootQuestion(contextualQuestion)) {
              console.log("Expanded multi-select loot menu detected");
              this.isInMultiPickup = true;
            }

            // Send expanded question to web client
            if (this.eventHandler) {
              this.emit({
                type: "question",
                text: contextualQuestion,
                choices: "",
                default: "",
                menuItems: this.currentMenuItems,
              });
            }

            // Wait for actual user input for expanded questions
            console.log("📋 Waiting for expanded menu selection (async)...");
          return this.waitForQuestionInput();
          } else {
            console.log(
              "📋 Menu has no selectable items - treating as informational",
            );
          }
        }

        return 0;
      case "shim_display_nhwindow":
        const [winid, blocking] = args;
        console.log(`🖥️ DISPLAY WINDOW [Win ${winid}], blocking: ${blocking}`);
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
          preselected,
        ] = args;

        // Fix: menuStr is actually at index 6, not 5
        const menuText = String(args[6] || "");

        // In this callback shape, category headers are identified by menuAttr=7.
        const isCategory = menuAttr === 7;
        let menuChar = "";
        let glyphChar = "";

        // Convert glyph to visual character using mapglyphHelper
        if (
          menuGlyph &&
          globalThis.nethackGlobal &&
          globalThis.nethackGlobal.helpers &&
          globalThis.nethackGlobal.helpers.mapglyphHelper
        ) {
          try {
            const glyphInfo = globalThis.nethackGlobal.helpers.mapglyphHelper(
              menuGlyph,
              0,
              0,
              0, // x, y, and other params not needed for menu items
            );
            if (glyphInfo && glyphInfo.ch !== undefined) {
              glyphChar = String.fromCharCode(glyphInfo.ch);
            }
          } catch (error) {
            console.log(
              `⚠️ Error getting glyph info for menu glyph ${menuGlyph}:`,
              error,
            );
          }
        }

        if (!isCategory) {
          // For non-category items, determine the accelerator key
          if (
            typeof accelerator === "number" &&
            accelerator > 32 &&
            accelerator < 127
          ) {
            // If accelerator is a valid ASCII character code, use it
            menuChar = String.fromCharCode(accelerator);
          } else {
            // If accelerator is invalid (like the large numbers we're seeing),
            // assign letters automatically based on the current menu items
            const existingItems = this.currentMenuItems.filter(
              (item) => !item.isCategory,
            );
            const alphabet =
              "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            if (existingItems.length < alphabet.length) {
              menuChar = alphabet[existingItems.length];
            } else {
              menuChar = "?"; // Fallback for too many items
            }
          }

          console.log(
            `📋 MENU ITEM: "${menuText}" (key: ${menuChar}) glyph: ${menuGlyph} -> "${glyphChar}" - accelerator code: ${accelerator}`,
          );
        } else {
          console.log(
            `📋 CATEGORY HEADER: "${menuText}" - accelerator code: ${accelerator}`,
          );
        }

        // Store menu item for current question (only store non-category items or all items for display)
        if (this.currentWindow === menuWinid && menuText) {
          this.currentMenuItems.push({
            text: menuText,
            accelerator: menuChar,
            originalAccelerator: accelerator, // Store the original accelerator code
            identifier: identifier, // NetHack menu identifier used by shim_select_menu
            window: menuWinid,
            glyph: menuGlyph,
            glyphChar: glyphChar, // Add the visual character representation
            isCategory: isCategory,
            menuIndex: this.currentMenuItems.length, // Store the menu item index
          });
        }

        // Send menu item to web client
        if (this.eventHandler) {
          this.emit({
            type: "menu_item",
            text: menuText,
            accelerator: menuChar,
            window: menuWinid,
            glyph: menuGlyph,
            glyphChar: glyphChar, // Include glyph character in client message
            isCategory: isCategory,
            menuItems: this.currentMenuItems,
          });
        }

        return 0;
      case "shim_putstr":
        const [win, textAttr, textStr] = args;
        console.log(`💬 TEXT [Win ${win}]: "${textStr}"`);
        this.gameMessages.push({
          text: textStr,
          window: win,
          timestamp: Date.now(),
          attr: textAttr,
        });
        if (this.gameMessages.length > 100) {
          this.gameMessages.shift();
        }
        if (this.eventHandler) {
          this.emit({
            type: "text",
            text: textStr,
            window: win,
            attr: textAttr,
          });
        }
        return 0;
      case "shim_print_glyph":
        const [printWin, x, y, printGlyph] = args;
        console.log(`🎨 GLYPH [Win ${printWin}] at (${x},${y}): ${printGlyph}`);
        if (printWin === 3) {
          const key = `${x},${y}`;

          // Use NetHack's mapglyph function to get the proper ASCII character
          let glyphChar = null;
          let glyphColor = null;
          if (
            globalThis.nethackGlobal &&
            globalThis.nethackGlobal.helpers &&
            globalThis.nethackGlobal.helpers.mapglyphHelper
          ) {
            try {
              const glyphInfo = globalThis.nethackGlobal.helpers.mapglyphHelper(
                printGlyph,
                x,
                y,
                0,
              );
              console.log(
                `🔍 Raw glyphInfo for glyph ${printGlyph}:`,
                glyphInfo,
              );
              if (glyphInfo && glyphInfo.ch !== undefined) {
                glyphChar = String.fromCharCode(glyphInfo.ch);
                glyphColor = glyphInfo.color;
                console.log(
                  `🔤 Glyph ${printGlyph} -> "${glyphChar}" (ASCII ${glyphInfo.ch}) color ${glyphColor}`,
                );
              } else {
                console.log(
                  `⚠️ No character info for glyph ${printGlyph}, glyphInfo:`,
                  glyphInfo,
                );
              }
            } catch (error) {
              console.log(
                `⚠️ Error getting glyph info for ${printGlyph}:`,
                error,
              );
            }
          } else {
            console.log(`⚠️ mapglyphHelper not available`);
          }

          this.gameMap.set(key, {
            x: x,
            y: y,
            glyph: printGlyph,
            char: glyphChar,
            color: glyphColor,
            timestamp: Date.now(),
          });
          if (this.eventHandler) {
            this.queueMapGlyphUpdate({
              type: "map_glyph",
              x: x,
              y: y,
              glyph: printGlyph,
              char: glyphChar,
              color: glyphColor,
              window: printWin,
            });
          }
          // Comment out automatic character selection prompts for now
          // if (!this.hasShownCharacterSelection) {
          //   this.hasShownCharacterSelection = true;
          //   console.log(
          //     "🎯 Game started - showing interactive character selection"
          //   );          // }
        }
        return 0;
      case "shim_player_selection":
        console.log("NetHack player selection started");
        // Character selection UI is handled automatically in this port.
        return 0;
      case "shim_raw_print":
        const [rawText] = args;
        console.log(`📢 RAW PRINT: "${rawText}"`);

        // Send raw print messages to the UI log
        if (this.eventHandler && rawText && rawText.trim()) {
          this.emit({
            type: "raw_print",
            text: rawText.trim(),
          });
        }
        return 0;
      case "shim_wait_synch":
        console.log("NetHack waiting for synchronization");
        return 0;
      case "shim_select_menu":
        const [menuSelectWinid, menuSelectHow, menuPtrArg] = args;
        let ptrArgSlot = 0;
        let ptrArgValue = 0;
        let ptrResolvedValue = 0;
        if (
          this.nethackModule &&
          typeof this.nethackModule.getValue === "function"
        ) {
          ptrArgSlot = menuPtrArg;
          try {
            ptrArgValue = this.nethackModule.getValue(menuPtrArg, "*");
            if (ptrArgValue > 0) {
              ptrResolvedValue = this.nethackModule.getValue(ptrArgValue, "*");
            }
          } catch (error) {
            console.log("Pointer decode error in shim_select_menu:", error);
          }
        }

        const isPlausiblePtr = (ptr) =>
          Number.isInteger(ptr) && ptr > 0 && (ptr & 3) === 0;
        const ptrMode = isPlausiblePtr(ptrArgValue)
          ? "arg"
          : isPlausiblePtr(ptrResolvedValue)
            ? "resolved_fallback"
            : "invalid";
        const menuListPtrPtr = isPlausiblePtr(ptrArgValue)
          ? ptrArgValue
          : isPlausiblePtr(ptrResolvedValue)
            ? ptrResolvedValue
            : 0;
        console.log(
          `Menu selection request for window ${menuSelectWinid}, how: ${menuSelectHow}, argPtr: ${menuPtrArg}, ptrArgSlot=${ptrArgSlot}, ptrArgValue=${ptrArgValue}, ptrResolvedValue=${ptrResolvedValue}, ptrMode=${ptrMode}, menuListPtrPtr=${menuListPtrPtr}`,
        );

        if (menuSelectHow === 2) {
          if (Number.isInteger(this.menuSelectionReadyCount)) {
            const selectionCount = this.menuSelectionReadyCount;
            this.menuSelectionReadyCount = null;
            this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
            this.menuSelections.clear();
            this.isInMultiPickup = false;
            return selectionCount;
          }

          if (this.menuSelections.size > 0 && !this.isInMultiPickup) {
            const selectionCount = this.menuSelections.size;
            this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
            this.menuSelections.clear();
            return selectionCount;
          }

          if (this.isInMultiPickup) {
            console.log("Multi-pickup menu - waiting for completion (async)...");
            this.pendingMenuSelection = {
              resolver: null,
              menuListPtrPtr,
            };
            return new Promise((resolve) => {
              this.pendingMenuSelection = {
                resolver: resolve,
                menuListPtrPtr,
              };
            });
          }
        }

        if (menuSelectHow === 1 && this.menuSelections.size > 0) {
          const selectedItems = Array.from(this.menuSelections.values());
          const selectedItem = selectedItems[0];
          if (selectedItems.length > 1) {
            console.log(
              `PICK_ONE had ${selectedItems.length} selections; using first item only`,
            );
          }
          console.log(
            `Returning single menu selection count: 1 (${selectedItem.menuChar} ${selectedItem.text})`,
          );
          this.menuSelections = new Map([
            [selectedItem.menuChar, selectedItem],
          ]);
          this.writeMenuSelectionResult(menuListPtrPtr, 1);
          this.menuSelections.clear();
          this.isInMultiPickup = false;
          return 1;
        }

        if (menuSelectHow === 1) {
          console.log("PICK_ONE requested with no selection; returning 0");
          this.writeMenuSelectionResult(menuListPtrPtr, 0);
          this.menuSelections.clear();
          this.isInMultiPickup = false;
          return 0;
        }

        if (menuSelectHow === 2 && this.menuSelections.size > 0) {
          const selectedItems = Array.from(this.menuSelections.values());
          console.log(
            `Returning ${this.menuSelections.size} selected items:`,
            selectedItems.map((item) => `${item.menuChar}:${item.text}`),
          );

          const selectionCount = this.menuSelections.size;
          this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
          this.menuSelections.clear();
          this.isInMultiPickup = false;
          return selectionCount;
        }

        console.log("Returning 0 (no selection)");
        this.writeMenuSelectionResult(menuListPtrPtr, 0);
        this.menuSelections.clear();
        return 0;

      case "shim_askname":
        console.log("NetHack is asking for player name, args:", args);
        if (this.eventHandler) {
          this.emit({
            type: "name_request",
            text: "What is your name?",
            maxLength: 30,
          });
        }

        if (this.pendingTextResponses.length > 0) {
          const name = String(this.pendingTextResponses.shift() || "").trim();
          console.log(`Using player name from input: ${name}`);
          if (name.length > 0) {
            return name;
          }
        }

        console.log("No name provided, using default");
        return "Player";
      case "shim_mark_synch":
        console.log("NetHack marking synchronization");
        return 0;

      case "shim_cliparound":
        const [clipX, clipY] = args;
        console.log(
          `🎯 Cliparound request for position (${clipX}, ${clipY}) - updating player position`,
        );

        if (this.positionInputActive) {
          console.log(
            `🎯 Cliparound in position-input mode; routing to cursor at (${clipX}, ${clipY})`,
          );
          this.emitPositionCursor(null, clipX, clipY, "cliparound");
          return 0;
        }

        // Update player position when NetHack requests clipping around a position
        const oldPlayerPos = { ...this.playerPosition };
        this.playerPosition = { x: clipX, y: clipY };

        // Send updated player position to client
        if (this.eventHandler) {
          this.emit({
            type: "player_position",
            x: clipX,
            y: clipY,
          });

          // Also send a map update to clear the old player position and show new one
          // This helps when NetHack doesn't send explicit glyph updates
          this.emit({
            type: "force_player_redraw",
            oldPosition: oldPlayerPos,
            newPosition: { x: clipX, y: clipY },
          });
        }
        return 0;

      case "shim_clear_nhwindow":
        const [clearWinId] = args;
        console.log(`🗑️ Clearing window ${clearWinId}`);

        // If clearing the map window, clear the 3D scene
        if (clearWinId === 2 || clearWinId === 3) {
          // WIN_MAP = 2, but window 3 is also used for map display in some contexts
          console.log("Map window cleared - clearing 3D scene");
          this.emit({
            type: "clear_scene",
            // message: "Level transition - clearing display",
          });
        }
        return 0;

      case "shim_getmsghistory":
        const [init] = args;
        console.log(`Getting message history, init: ${init}`);
        // Return empty string for message history
        return "";

      case "shim_putmsghistory":
        const [msg, is_restoring] = args;
        console.log(
          `Putting message history: "${msg}", restoring: ${is_restoring}`,
        );
        return 0;

      case "shim_exit_nhwindows":
        console.log("Exiting NetHack windows");
        return 0;
      case "shim_destroy_nhwindow":
        const [destroyWinId] = args;
        console.log(`🗑️ Destroying window ${destroyWinId}`);
        return 0;
      case "shim_curs":
        const [cursWin, cursX, cursY] = args;
        console.log(
          `🖱️ Setting cursor for window ${cursWin} to (${cursX}, ${cursY})`,
        );
        if (this.positionInputActive) {
          this.emitPositionCursor(cursWin, cursX, cursY, "curs");
        }
        return 0;

      case "shim_status_update":
        const [field, ptrToArg, chg, percent, color, colormask] = args;
        const fieldName = this.getStatusFieldName(field);
        const isFlushSignal =
          fieldName === "BL_FLUSH" ||
          fieldName === "BL_RESET" ||
          fieldName === "BL_CHARACTERISTICS";
        if (isFlushSignal) {
          this.flushPendingStatusUpdates(fieldName);
          return 0;
        }

        const decoded = this.decodeStatusValue(fieldName, ptrToArg);
        const statusPayload = {
          type: "status_update",
          field: field,
          fieldName: fieldName,
          value: decoded.value,
          valueType: decoded.valueType,
          ptrToArg: ptrToArg,
          usedFallback: decoded.usedFallback,
          chg: chg,
          percent: percent,
          color: color,
          colormask: colormask,
        };
        this.statusPending.set(field, statusPayload);
        this.latestStatusUpdates.set(field, statusPayload);
        console.log(
          `Queued status update ${fieldName} (${field}) => ${decoded.value} [type=${decoded.valueType}, fallback=${decoded.usedFallback}]`,
        );
        return 0;

      default:
        console.log(`Unknown callback: ${name}`, args);
        return 0;
    }
  }

  flushPendingStatusUpdates(reason = "flush") {
    if (this.statusPending.size === 0) {
      return;
    }

    const orderedUpdates = Array.from(this.statusPending.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, payload]) => payload);
    this.statusPending.clear();

    console.log(
      `Flushing ${orderedUpdates.length} pending status updates (reason=${reason})`,
    );

    for (const payload of orderedUpdates) {
      if (payload && typeof payload.field === "number") {
        this.latestStatusUpdates.set(payload.field, payload);
      }
      if (this.eventHandler) {
        this.emit(payload);
      }
    }
  }

  emit(payload) {
    if (typeof this.eventHandler === "function") {
      this.eventHandler(payload);
    }
  }
}

export default LocalNetHackRuntime;

