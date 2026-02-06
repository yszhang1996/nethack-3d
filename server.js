const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

class NetHackSession {
  constructor(ws) {
    this.ws = ws;
    this.nethackInstance = null;
    this.gameMap = new Map();
    this.playerPosition = { x: 0, y: 0 };
    this.gameMessages = [];
    this.currentMenuItems = [];
    this.currentWindow = null;
    this.hasShownCharacterSelection = false;
    this.lastQuestionText = null; // Store the last question for menu expansion

    // Multi-pickup selection tracking
    this.menuSelections = new Map(); // Track selected items: key=menuChar, value={menuChar, originalAccelerator, menuIndex}
    this.isInMultiPickup = false;
    this.waitingForMenuSelection = false;
    this.menuSelectionResolver = null;
    this.multiPickupReadyToConfirm = false;
    this.pendingMenuListPtrPtr = 0;
    this.autoPickupQueue = [];
    this.queuedInputs = [];

    // Simplified input handling with async support
    this.latestInput = null;
    this.waitingForInput = false;
    this.waitingForPosition = false;
    this.inputResolver = null;
    this.positionResolver = null;

    // Add cooldown for position requests
    this.lastInputTime = 0;
    this.inputCooldown = 100; // 100ms cooldown

    this.initializeNetHack();
  }

  // Handle incoming input from the client
  handleClientInput(input) {
    console.log("🎮 Received client input:", input);

    // Store the input for potential reuse
    this.latestInput = input;
    this.lastInputTime = Date.now();

    // Track multi-pickup selections
    if (
      this.isInMultiPickup &&
      typeof input === "string" &&
      input.length === 1 &&
      input !== "\r" &&
      input !== "\n"
    ) {
      // Find the menu item for this accelerator
      const menuItem = this.currentMenuItems.find(
        (item) => item.accelerator === input && !item.isCategory,
      );
      if (menuItem) {
        if (this.menuSelections.has(input)) {
          // Deselect item
          this.menuSelections.delete(input);
          console.log(
            `📋 Deselected item: ${input} (${menuItem.text}). Current selections:`,
            Array.from(this.menuSelections.keys()),
          );
        } else {
          // Select item - store complete information
          this.menuSelections.set(input, {
            menuChar: input,
            originalAccelerator: menuItem.originalAccelerator,
            identifier: menuItem.identifier,
            menuIndex: menuItem.menuIndex,
            text: menuItem.text,
          });
          console.log(
            `📋 Selected item: ${input} (${menuItem.text}). Current selections:`,
            Array.from(this.menuSelections.keys()),
          );
        }
      } else {
        console.log(
          `📋 Warning: No menu item found for accelerator '${input}'`,
        );
      }
      // DON'T resolve the input promise for individual item selections in multi-pickup
      console.log("📋 Multi-pickup item selection - not resolving promise yet");
      return;
    } else if (
      this.isInMultiPickup &&
      (input === "Enter" || input === "\r" || input === "\n")
    ) {
      // NetHack ABI in this build is stable for one selected menu_item but
      // segfaults on multi-entry writes. Convert extras into a sequential queue.
      if (this.menuSelections.size > 1) {
        const ordered = Array.from(this.menuSelections.entries());
        const [firstKey, firstValue] = ordered[0];
        const queued = ordered.slice(1).map(([k, v]) => ({
          key: k,
          text: v.text,
          identifier: v.identifier,
        }));
        this.menuSelections = new Map([[firstKey, firstValue]]);
        this.autoPickupQueue = queued;
        console.log(
          `Sequential pickup mode: keeping '${firstKey}:${firstValue.text}', queued ${queued.length} more`,
        );
      }

      // Confirm multi-pickup
      const selectedItems = Array.from(this.menuSelections.values()).map(
        (item) => `${item.menuChar}:${item.text}`,
      );
      console.log(`📋 Confirming multi-pickup with selections:`, selectedItems);

      // Resolve the menu selection promise if waiting
      if (this.waitingForMenuSelection && this.menuSelectionResolver) {
        console.log("🎮 Resolving menu selection with selection count");
        this.waitingForMenuSelection = false;
        const resolver = this.menuSelectionResolver;
        this.menuSelectionResolver = null;
        const menuListPtrPtr = this.pendingMenuListPtrPtr || 0;
        this.pendingMenuListPtrPtr = 0;
        const selectionCount = this.menuSelections.size;
        this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
        this.isInMultiPickup = false; // Clear it here when we resolve
        resolver(selectionCount);
        return;
      }

      // If no menu selection is waiting, mark that we're ready to confirm
      // Also resolve the input promise that's waiting in shim_end_menu
      console.log("📋 Multi-pickup ready to confirm - resolving input promise");
      this.multiPickupReadyToConfirm = true;

      // Resolve the general input promise if waiting (from shim_end_menu)
      if (this.waitingForInput && this.inputResolver) {
        console.log(
          "🎮 Resolving waiting input promise for multi-pickup confirmation",
        );
        this.waitingForInput = false;
        const resolver = this.inputResolver;
        this.inputResolver = null;
        resolver(this.processKey("Enter"));
        return;
      }
      return;
    } else if (this.isInMultiPickup && input === "Escape") {
      // Cancel multi-pickup
      console.log(`📋 Cancelling multi-pickup`);
      this.menuSelections.clear();
      this.multiPickupReadyToConfirm = false;

      // Resolve the menu selection promise with 0 (no selection)
      if (this.waitingForMenuSelection && this.menuSelectionResolver) {
        console.log("🎮 Resolving menu selection cancellation with 0");
        this.waitingForMenuSelection = false;
        const resolver = this.menuSelectionResolver;
        this.menuSelectionResolver = null;
        const menuListPtrPtr = this.pendingMenuListPtrPtr || 0;
        this.pendingMenuListPtrPtr = 0;
        this.writeMenuSelectionResult(menuListPtrPtr, 0);
        this.isInMultiPickup = false; // Clear it here when we resolve
        resolver(0);
        return;
      }
      // If no menu selection is waiting, just clear and store the input
      this.isInMultiPickup = false;
      console.log(
        "📋 No menu selection waiting - storing Escape for later use",
      );
      return;
    }

    // If we're waiting for general input, resolve the promise immediately
    if (this.waitingForInput && this.inputResolver) {
      console.log("🎮 Resolving waiting input promise with:", input);
      this.waitingForInput = false;
      const resolver = this.inputResolver;
      this.inputResolver = null;
      resolver(this.processKey(input));
      return;
    }

    // If we're waiting for position input, resolve that promise
    if (this.waitingForPosition && this.positionResolver) {
      console.log("🎮 Resolving waiting position promise with:", input);
      this.waitingForPosition = false;
      const resolver = this.positionResolver;
      this.positionResolver = null;
      resolver(this.processKey(input));
      return;
    }

    // Otherwise, just store for later use (for synchronous phases like character creation)
    console.log("🎮 Storing input for later use:", input);
  }

  // Handle request for tile update from client
  handleTileUpdateRequest(x, y) {
    console.log(`🔄 Client requested tile update for (${x}, ${y})`);

    const key = `${x},${y}`;
    const tileData = this.gameMap.get(key);

    if (tileData) {
      console.log(`📤 Resending tile data for (${x}, ${y}):`, tileData);

      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            type: "map_glyph",
            x: tileData.x,
            y: tileData.y,
            glyph: tileData.glyph,
            char: tileData.char,
            color: tileData.color,
            window: 2, // WIN_MAP
            isRefresh: true, // Mark this as a refresh to distinguish from new data
          }),
        );
      }
    } else {
      console.log(
        `⚠️ No tile data found for (${x}, ${y}) - tile may not be explored yet`,
      );

      // Optionally, we could send a "blank" tile or request NetHack to redraw the area
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            type: "tile_not_found",
            x: x,
            y: y,
            message: "Tile data not available - may not be explored yet",
          }),
        );
      }
    }
  }

  // Handle request for area update from client
  handleAreaUpdateRequest(centerX, centerY, radius = 3) {
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
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(
              JSON.stringify({
                type: "map_glyph",
                x: tileData.x,
                y: tileData.y,
                glyph: tileData.glyph,
                char: tileData.char,
                color: tileData.color,
                window: 2, // WIN_MAP
                isRefresh: true,
                isAreaRefresh: true,
              }),
            );
          }
          tilesRefreshed++;
        }
      }
    }

    console.log(
      `📤 Refreshed ${tilesRefreshed} tiles in area around (${centerX}, ${centerY})`,
    );

    // Send completion message
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({
          type: "area_refresh_complete",
          centerX: centerX,
          centerY: centerY,
          radius: radius,
          tilesRefreshed: tilesRefreshed,
        }),
      );
    }
  }

  // Helper method for key processing
  processKey(key) {
    // With number_pad:1 option, translate arrow keys to numpad equivalents
    if (key === "ArrowLeft") return "4".charCodeAt(0);
    if (key === "ArrowRight") return "6".charCodeAt(0);
    if (key === "ArrowUp") return "8".charCodeAt(0);
    if (key === "ArrowDown") return "2".charCodeAt(0);
    if (key === "Enter") return 13;
    if (key === "Escape") return 27;
    if (key.length > 0) return key.charCodeAt(0);
    return 0; // Default for empty/unknown input
  }

  enqueueInput(input) {
    if (input === undefined || input === null) {
      return;
    }
    this.queuedInputs.push(input);
    console.log(
      `Queued synthetic input: ${input} (queue size=${this.queuedInputs.length})`,
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
        `Sequential pickup: could not match queued item '${next.key}:${next.text}', dropping it`,
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
      text: matched.text,
    });
    this.multiPickupReadyToConfirm = true;
    this.autoPickupQueue.shift();
    console.log(
      `Sequential pickup: auto-selected '${key}:${matched.text}', remaining queued=${this.autoPickupQueue.length}`,
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
        primaryType
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
        error && error.message ? error.message : error
      );
    }

    try {
      const fallback = this.decodeShimArgValue(
        "shim_status_update",
        ptrToArg,
        fallbackType
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
      // NetHack's menu_item layout can vary by build; default to a safer 16-byte stride.
      const bytesPerMenuItem = Number(process.env.NH_MENU_ITEM_STRIDE || 16);
      const countOffsetPrimary = Number(process.env.NH_MENU_COUNT_OFFSET || 8);
      const countOffsetSecondary = 4;

      if (selectionCount <= 0) {
        this.nethackModule.setValue(menuListPtrPtr, 0, "*");
        console.log(
          `Menu selection write: cleared output pointer at menuListPtrPtr=${menuListPtrPtr}`,
        );
        return;
      }

      const priorOutPtr = this.nethackModule.getValue(menuListPtrPtr, "*");
      const outPtr = this.nethackModule._malloc(selectionCount * bytesPerMenuItem);
      this.nethackModule.setValue(menuListPtrPtr, outPtr, "*");
      const confirmOutPtr = this.nethackModule.getValue(menuListPtrPtr, "*");
      console.log(
        `Writing ${selectionCount} selections at outPtr=${outPtr} (menuListPtrPtr=${menuListPtrPtr}, priorOutPtr=${priorOutPtr}, confirmOutPtr=${confirmOutPtr}, stride=${bytesPerMenuItem}, countOffset=${countOffsetPrimary})`,
      );

      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const structOffset = outPtr + i * bytesPerMenuItem;
        const itemIdentifier =
          typeof item.identifier === "number"
            ? item.identifier
            : item.originalAccelerator;

        if (typeof itemIdentifier !== "number") {
          console.log(
            `Skipping item ${i} because identifier is not numeric:`,
            itemIdentifier,
          );
          continue;
        }

        this.nethackModule.setValue(structOffset, itemIdentifier, "i32");
        // Some ports use -1 for \"all\" stack count semantics, others accept 1.
        const countValue = process.env.NH_MENU_COUNT_MODE === "all" ? -1 : 1;
        // Write count in both likely offsets for compatibility across layouts.
        this.nethackModule.setValue(
          structOffset + countOffsetPrimary,
          countValue,
          "i32",
        );
        if (countOffsetSecondary !== countOffsetPrimary) {
          this.nethackModule.setValue(
            structOffset + countOffsetSecondary,
            countValue,
            "i32",
          );
        }
        const debugItem = this.nethackModule.getValue(structOffset, "i32");
        const debugCountPrimary = this.nethackModule.getValue(
          structOffset + countOffsetPrimary,
          "i32",
        );
        const debugCountSecondary = this.nethackModule.getValue(
          structOffset + countOffsetSecondary,
          "i32",
        );
        console.log(
          `Wrote menu_item[${i}] => item=${debugItem}, countPrimary=${debugCountPrimary}, countSecondary=${debugCountSecondary}, countMode=${process.env.NH_MENU_COUNT_MODE || "one"}`,
        );
      }
      const dumpBytes = Math.min(selectionCount * bytesPerMenuItem, 64);
      const dump = [];
      for (let i = 0; i < dumpBytes; i++) {
        const b = this.nethackModule.getValue(outPtr + i, "i8") & 0xff;
        dump.push(b.toString(16).padStart(2, "0"));
      }
      console.log(`menu_item buffer dump (${dumpBytes} bytes): ${dump.join(" ")}`);
    } catch (error) {
      console.log("Error writing selections to NetHack memory:", error);
    }
  }

  async initializeNetHack() {
    try {
      console.log("Starting NetHack session...");
      const factory = require("./public/nethack.js");
      const wasmPath = path.join(__dirname, "public", "nethack.wasm");
      console.log("Loading WASM from:", wasmPath);
      const wasmBinary = fs.readFileSync(wasmPath);
      console.log("WASM binary loaded, size:", wasmBinary.length);

      globalThis.nethackCallback = (name, ...args) => {
        return this.handleUICallback(name, args);
      };

      if (!globalThis.nethackGlobal) {
        console.log("🌐 Setting up globalThis.nethackGlobal...");
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
            },
          },
          globals: { WIN_MAP: 2, WIN_INVEN: 4, WIN_STATUS: 3, WIN_MESSAGE: 1 },
        };
        console.log("✅ globalThis.nethackGlobal set up");
      }

      const Module = {
        wasmBinary: wasmBinary,
        locateFile: (path, scriptDirectory) => {
          console.log(
            "locateFile called with:",
            path,
            "scriptDirectory:",
            scriptDirectory,
          );
          if (path.endsWith(".wasm")) {
            return wasmPath;
          }
          return path;
        },
        preRun: [
          () => {
            console.log("PreRun: Setting up NETHACKOPTIONS");
            Module.ENV.NETHACKOPTIONS = "pickup_types:$,number_pad:1";
          },
        ],
        onRuntimeInitialized: async () => {
          console.log("NetHack WASM runtime initialized!");
          this.nethackModule = Module;
          try {
            console.log("Setting up graphics callback...");
            await Module.ccall(
              "shim_graphics_set_callback",
              null,
              ["string"],
              ["nethackCallback"],
              { async: true },
            );
            console.log("Graphics callback set up successfully");

            // Initialize JS helpers to make mapglyphHelper available
            if (Module.js_helpers_init) {
              console.log("Initializing JS helpers...");
              Module.js_helpers_init();
              console.log("JS helpers initialized");

              // Verify mapglyphHelper is available
              if (
                globalThis.nethackGlobal &&
                globalThis.nethackGlobal.helpers &&
                globalThis.nethackGlobal.helpers.mapglyphHelper
              ) {
                console.log("✅ mapglyphHelper is available");
              } else {
                console.log("⚠️ mapglyphHelper not found in global helpers");
              }
            } else {
              console.log("⚠️ js_helpers_init function not found");
            }

            // Don't call main() automatically - wait for it to be called naturally
            console.log("Waiting for NetHack to start naturally...");
          } catch (error) {
            console.error("Error setting up NetHack:", error);
          }
        },
      };

      console.log("Starting NetHack with original factory...");
      this.nethackInstance = await factory(Module);
      console.log(
        "NetHack factory completed, instance:",
        typeof this.nethackInstance,
      );
    } catch (error) {
      console.error("Error initializing NetHack:", error);
    }
  }

  handleUICallback(name, args) {
    console.log(`🎮 UI Callback: ${name}`, args);

    const processKey = (key) => {
      return this.processKey(key);
    };

    switch (name) {
      case "shim_get_nh_event":
        if (this.queuedInputs.length > 0) {
          const queued = this.queuedInputs.shift();
          console.log(`Using queued input for event: ${queued}`);
          return processKey(queued);
        }

        // Check if we have recent input available (within input window)
        const timeSinceInput = Date.now() - this.lastInputTime;
        if (this.latestInput && timeSinceInput < this.inputCooldown) {
          const input = this.latestInput;
          this.latestInput = null; // Clear it after use
          console.log(
            `🎮 Reusing recent input for event: ${input} (${timeSinceInput}ms ago)`,
          );
          return processKey(input);
        }

        // We're now in gameplay mode - use Asyncify to wait for real user input
        console.log("🎮 Waiting for player input (async)...");
        return new Promise((resolve) => {
          this.inputResolver = resolve;
          this.waitingForInput = true;
          // No timeout - wait for real user input via WebSocket
        });

      case "shim_yn_function":
        const [question, choices, defaultChoice] = args;
        console.log(
          `🤔 Y/N Question: "${question}" choices: "${choices}" default: ${defaultChoice}`,
        );

        // Store the question text for potential menu expansion
        this.lastQuestionText = question;

        // Check if this is a direction question that needs special handling
        if (question && question.toLowerCase().includes("direction")) {
          console.log(
            "🧭 Direction question detected - waiting for user input",
          );

          // Send direction question to web client
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(
              JSON.stringify({
                type: "direction_question",
                text: question,
                choices: choices,
                default: defaultChoice,
              }),
            );
          }

          // Wait for actual user input for direction questions
          console.log("🧭 Waiting for direction input (async)...");
          return new Promise((resolve) => {
            this.inputResolver = resolve;
            this.waitingForInput = true;
            // No timeout - wait for real user input via WebSocket
          });
        }

        // Send question to web client (don't include menu items for simple Y/N questions)
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "question",
              text: question,
              choices: choices,
              default: defaultChoice,
              // Only include menuItems if this is actually a menu question, not a simple Y/N
              menuItems: [],
            }),
          );
        }

        // Wait for actual user input instead of returning default choice automatically
        console.log("🤔 Y/N Question - waiting for user input (async)...");
        return new Promise((resolve) => {
          this.inputResolver = resolve;
          this.waitingForInput = true;
          // No timeout - wait for real user input via WebSocket
        });

      case "shim_nh_poskey":
        const [xPtr, yPtr, modPtr] = args;
        console.log("🎮 NetHack requesting position key");

        if (this.queuedInputs.length > 0) {
          const queued = this.queuedInputs.shift();
          console.log(`Using queued input for position: ${queued}`);
          return processKey(queued);
        }

        // Check if we have recent input available (within input window)
        const timeSincePositionInput = Date.now() - this.lastInputTime;
        if (this.latestInput && timeSincePositionInput < this.inputCooldown) {
          const input = this.latestInput;
          // Don't clear it yet - let shim_get_nh_event potentially reuse it
          console.log(
            `🎮 Using recent input for position: ${input} (${timeSincePositionInput}ms ago)`,
          );
          return processKey(input);
        }

        // We're now in gameplay mode - use Asyncify to wait for real user input
        console.log("🎮 Waiting for position input (async)...");
        return new Promise((resolve) => {
          this.positionResolver = resolve;
          this.waitingForPosition = true;
          // No timeout - wait for real user input via WebSocket
        });

      case "shim_init_nhwindows":
        console.log("Initializing NetHack windows");
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "name_request",
              text: "What is your name, adventurer?",
              maxLength: 30,
            }),
          );
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
        this.multiPickupReadyToConfirm = false;

        // Also clear any waiting menu selection resolvers
        if (this.waitingForMenuSelection && this.menuSelectionResolver) {
          console.log("📋 Clearing previous menu selection resolver");
          this.waitingForMenuSelection = false;
          this.menuSelectionResolver = null;
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

        // If this is an inventory window without a question, it's just an inventory update
        if (isInventoryWindow && !hasMenuQuestion) {
          console.log(
            `📦 Inventory update detected (${this.currentMenuItems.length} total items) - not showing dialog`,
          );

          // Count actual items vs category headers for better logging
          const actualItems = this.currentMenuItems.filter(
            (item) => !item.isCategory,
          );
          const categoryHeaders = this.currentMenuItems.filter(
            (item) => item.isCategory,
          );
          console.log(
            `📦 -> ${actualItems.length} actual items, ${categoryHeaders.length} category headers`,
          );

          // Send inventory update to client as informational only
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(
              JSON.stringify({
                type: "inventory_update",
                items: this.currentMenuItems,
                window: endMenuWinid,
              }),
            );
          }

          return 0; // Don't wait for input - this is just informational
        }

        // Special handling for inventory window WITH questions (like drop, wear, etc.)
        if (isInventoryWindow && hasMenuQuestion) {
          console.log(
            `📋 Inventory action question detected: "${menuQuestion}" with ${this.currentMenuItems.length} items`,
          );

          // Check if this is a multi-pickup dialog
          if (
            menuQuestion &&
            (menuQuestion.toLowerCase().includes("pick up what") ||
              menuQuestion.toLowerCase().includes("pick up") ||
              menuQuestion
                .toLowerCase()
                .includes("what do you want to pick up"))
          ) {
            console.log("📋 Multi-pickup dialog detected");
            this.isInMultiPickup = true;
            if (this.tryBuildAutoPickupSelection()) {
              console.log(`Sequential pickup: auto-confirming queued selection for this menu`);
              return this.processKey("Enter");
            }
          }

          // Send the inventory question to web client
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(
              JSON.stringify({
                type: "question",
                text: menuQuestion,
                choices: "",
                default: "",
                menuItems: this.currentMenuItems,
              }),
            );
          }

          // Wait for actual user input for inventory questions
          console.log("📋 Waiting for inventory action selection (async)...");
          return new Promise((resolve) => {
            this.inputResolver = resolve;
            this.waitingForInput = true;
            // No timeout - wait for real user input via WebSocket
          });
        }

        // If there's a menu question (like "Pick up what?"), send it to the client
        if (hasMenuQuestion && this.currentMenuItems.length > 0) {
          console.log(
            `📋 Menu question detected: "${menuQuestion}" with ${this.currentMenuItems.length} items`,
          );

          // Send menu question to web client
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(
              JSON.stringify({
                type: "question",
                text: menuQuestion,
                choices: "",
                default: "",
                menuItems: this.currentMenuItems,
              }),
            );
          }

          // Wait for actual user input for menu questions
          console.log("📋 Waiting for menu selection (async)...");
          return new Promise((resolve) => {
            this.inputResolver = resolve;
            this.waitingForInput = true;
            // No timeout - wait for real user input via WebSocket
          });
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
            // Send expanded question to web client
            if (this.ws && this.ws.readyState === 1) {
              this.ws.send(
                JSON.stringify({
                  type: "question",
                  text: contextualQuestion,
                  choices: "",
                  default: "",
                  menuItems: this.currentMenuItems,
                }),
              );
            }

            // Wait for actual user input for expanded questions
            console.log("📋 Waiting for expanded menu selection (async)...");
            return new Promise((resolve) => {
              this.inputResolver = resolve;
              this.waitingForInput = true;
              // No timeout - wait for real user input via WebSocket
            });
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
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "menu_item",
              text: menuText,
              accelerator: menuChar,
              window: menuWinid,
              glyph: menuGlyph,
              glyphChar: glyphChar, // Include glyph character in client message
              isCategory: isCategory,
              menuItems: this.currentMenuItems,
            }),
          );
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
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "text",
              text: textStr,
              window: win,
              attr: textAttr,
            }),
          );
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
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(
              JSON.stringify({
                type: "map_glyph",
                x: x,
                y: y,
                glyph: printGlyph,
                char: glyphChar,
                color: glyphColor,
                window: printWin,
              }),
            );
          }
          // Comment out automatic character selection prompts for now
          // if (!this.hasShownCharacterSelection) {
          //   this.hasShownCharacterSelection = true;
          //   console.log(
          //     "🎯 Game started - showing interactive character selection"
          //   );
          //   if (this.ws && this.ws.readyState === 1) {
          //     this.ws.send(
          //       JSON.stringify({
          //         type: "question",
          //         text: "Welcome to NetHack! Would you like to create a new character?",
          //         choices: "yn",
          //         default: "y",
          //         menuItems: [
          //           {
          //             accelerator: "y",
          //             text: "Yes - Choose character class and race",
          //           },
          //           {
          //             accelerator: "n",
          //             text: "No - Continue with current character",
          //           },
          //         ],
          //       })
          //     );
          //   }
          // }
        }
        return 0;
      case "shim_player_selection":
        console.log("NetHack player selection started");
        // Comment out character selection UI for automatic play
        // if (this.ws && this.ws.readyState === 1) {
        //   this.ws.send(
        //     JSON.stringify({
        //       type: "question",
        //       text: "Choose your character class:",
        //       choices: "",
        //       default: "",
        //       menuItems: [
        //         { accelerator: "a", text: "Archeologist" },
        //         { accelerator: "b", text: "Barbarian" },
        //         { accelerator: "c", text: "Caveman" },
        //         { accelerator: "h", text: "Healer" },
        //         { accelerator: "k", text: "Knight" },
        //         { accelerator: "m", text: "Monk" },
        //         { accelerator: "p", text: "Priest" },
        //         { accelerator: "r", text: "Rogue" },
        //         { accelerator: "s", text: "Samurai" },
        //         { accelerator: "t", text: "Tourist" },
        //         { accelerator: "v", text: "Valkyrie" },
        //         { accelerator: "w", text: "Wizard" },
        //       ],
        //     })
        //   );
        // }
        return 0;
      case "shim_raw_print":
        const [rawText] = args;
        console.log(`📢 RAW PRINT: "${rawText}"`);

        // Send raw print messages to the UI log
        if (this.ws && this.ws.readyState === 1 && rawText && rawText.trim()) {
          this.ws.send(
            JSON.stringify({
              type: "raw_print",
              text: rawText.trim(),
            }),
          );
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
        // In this callback ABI, the menu pointer argument is generally passed as an
        // indirection location; using the raw arg pointer has caused crashes.
        // Prefer the dereferenced location and only fall back if it looks invalid.
        const ptrMode = ptrDerefValue > 0 ? "deref" : "arg";
        const menuListPtrPtr = ptrMode === "deref" ? ptrDerefValue : ptrArgValue;
        console.log(
          `📋 Menu selection request for window ${menuSelectWinid}, how: ${menuSelectHow}, argPtr: ${menuPtrArg}, ptrArgValue=${ptrArgValue}, ptrDerefValue=${ptrDerefValue}, ptrMode=${ptrMode}, menuListPtrPtr=${menuListPtrPtr}`,
        );

        // For multi-pickup menus (how == PICK_ANY), check if we're ready to confirm
        if (menuSelectHow === 2 && this.isInMultiPickup) {
          // If user already confirmed selections, return immediately
          if (this.multiPickupReadyToConfirm) {
            console.log(
              "📋 Multi-pickup already confirmed - returning selection count immediately",
            );
            const selectionCount = this.menuSelections.size;

                        // Write selected menu_item entries and store pointer in *menu_list.
            this.writeMenuSelectionResult(menuListPtrPtr, selectionCount);
            // Clear all multi-pickup state
            this.menuSelections.clear();
            this.isInMultiPickup = false;
            this.multiPickupReadyToConfirm = false;
            return selectionCount;
          }

          console.log(
            "📋 Multi-pickup menu - waiting for completion (async)...",
          );
          this.pendingMenuListPtrPtr = menuListPtrPtr;
          return new Promise((resolve) => {
            // Set up a special resolver for menu selection completion
            this.menuSelectionResolver = resolve;
            this.waitingForMenuSelection = true;
          });
        }

        // If we have completed selections from multi-pickup, return the count
        if (this.menuSelections.size > 0) {
          const selectedItems = Array.from(this.menuSelections.values());
          console.log(
            `📋 Returning ${this.menuSelections.size} selected items:`,
            selectedItems.map((item) => `${item.menuChar}:${item.text}`),
          );

          const selectionCount = this.menuSelections.size;
          // Clear selections and multi-pickup state after returning them
          this.menuSelections.clear();
          this.isInMultiPickup = false;
          return selectionCount;
        }

        // For single-selection menus (how == PICK_ONE), check if we have a single selection
        if (menuSelectHow === 1 && this.menuSelections.size === 1) {
          const selectedItem = Array.from(this.menuSelections.values())[0];
          console.log(
            `📋 Returning single selection: ${selectedItem.menuChar} (${selectedItem.text})`,
          );
          // For single selection, NetHack might expect the accelerator character code
          return (
            selectedItem.identifier ||
            selectedItem.originalAccelerator ||
            selectedItem.menuChar.charCodeAt(0)
          );
        }

        // Default: no selection
        console.log("📋 Returning 0 (no selection)");
        return 0;

      case "shim_askname":
        console.log("NetHack is asking for player name, args:", args);
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "name_request",
              text: "What is your name?",
              maxLength: 30,
            }),
          );
        }

        if (this.latestInput) {
          const name = this.latestInput;
          this.latestInput = null;
          console.log(`Using player name from input: ${name}`);
          return name;
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

        // Update player position when NetHack requests clipping around a position
        const oldPlayerPos = { ...this.playerPos };
        this.playerPos = { x: clipX, y: clipY };

        // Send updated player position to client
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
              type: "player_position",
              x: clipX,
              y: clipY,
            }),
          );

          // Also send a map update to clear the old player position and show new one
          // This helps when NetHack doesn't send explicit glyph updates
          this.ws.send(
            JSON.stringify({
              type: "force_player_redraw",
              oldPosition: oldPlayerPos,
              newPosition: { x: clipX, y: clipY },
            }),
          );
        }
        return 0;

      case "shim_clear_nhwindow":
        const [clearWinId] = args;
        console.log(`🗑️ Clearing window ${clearWinId}`);

        // If clearing the map window, clear the 3D scene
        if (clearWinId === 2 || clearWinId === 3) {
          // WIN_MAP = 2, but window 3 is also used for map display in some contexts
          console.log("Map window cleared - clearing 3D scene");
          this.ws.send(
            JSON.stringify({
              type: "clear_scene",
              message: "Level transition - clearing display",
            }),
          );
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
        if (destroyWinId === 4 && this.autoPickupQueue.length > 0) {
          console.log(`Sequential pickup: scheduling next pickup cycle (remaining=${this.autoPickupQueue.length})`);
          this.enqueueInput(",");
        }
        return 0;
      case "shim_curs":
        const [cursWin, cursX, cursY] = args;
        console.log(
          `🖱️ Setting cursor for window ${cursWin} to (${cursX}, ${cursY})`,
        );
        return 0;

      case "shim_status_update":
        const [field, ptrToArg, chg, percent, color, colormask] = args;
        const fieldName = this.getStatusFieldName(field);
        const decoded = this.decodeStatusValue(fieldName, ptrToArg);
        console.log(
          `Status update ${fieldName} (${field}) => ${decoded.value} [type=${decoded.valueType}, fallback=${decoded.usedFallback}]`
        );

        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(
            JSON.stringify({
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
            }),
          );
        }
        return 0;

      default:
        console.log(`Unknown callback: ${name}`, args);
        return 0;
    }
  }
}

// HTTP Server for serving static files
const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  const extname = path.extname(filePath);

  let contentType = "text/html";
  switch (extname) {
    case ".js":
      contentType = "text/javascript";
      break;
    case ".css":
      contentType = "text/css";
      break;
    case ".json":
      contentType = "application/json";
      break;
    case ".png":
      contentType = "image/png";
      break;
    case ".jpg":
      contentType = "image/jpg";
      break;
    case ".wav":
      contentType = "audio/wav";
      break;
  }

  const fullPath = path.join(__dirname, "public", filePath);

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      if (error.code == "ENOENT") {
        res.writeHead(404);
        res.end("404 - File Not Found");
      } else {
        res.writeHead(500);
        res.end("500 - Internal Server Error");
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

// WebSocket Server
const wss = new WebSocket.Server({ server });
let sessionCount = 0;

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");
  sessionCount++;

  const session = new NetHackSession(ws);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received:", data);

      if (data.type === "input") {
        session.handleClientInput(data.input);
      } else if (data.type === "request_tile_update") {
        session.handleTileUpdateRequest(data.x, data.y);
      } else if (data.type === "request_area_update") {
        session.handleAreaUpdateRequest(
          data.centerX,
          data.centerY,
          data.radius,
        );
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    sessionCount--;
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`NetHack 3D Server running on http://localhost:${PORT}`);
  console.log(`Game sessions: ${sessionCount}`);
});
