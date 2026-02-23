import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Nethack3DEngine } from "../game";
import type {
  CharacterCreationConfig,
  FpsCrosshairContextState,
  Nh3dClientOptions,
  NethackMenuItem,
} from "../game/ui-types";
import {
  defaultNh3dClientOptions,
  nh3dFpsLookSensitivityMax,
  nh3dFpsLookSensitivityMin,
  normalizeNh3dClientOptions,
} from "../game/ui-types";
import { registerDebugHelpers } from "../app";
import { createEngineUiAdapter } from "../state/engineUiAdapter";
import { useGameStore } from "../state/gameStore";
import type { NethackRuntimeVersion } from "../runtime/types";

type DirectionChoice = {
  key?: string;
  label?: string;
  spacer?: boolean;
};

const numpadDirectionChoices: DirectionChoice[] = [
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

const viDirectionChoices: DirectionChoice[] = [
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

const getDirectionChoices = (numberPadModeEnabled: boolean) =>
  numberPadModeEnabled ? numpadDirectionChoices : viDirectionChoices;

const directionAuxChoices = [
  { key: "<", label: "UP" },
  { key: "s", label: "SELF" },
  { key: ">", label: "DOWN" },
];

const getDirectionHelpText = (numberPadModeEnabled: boolean) =>
  numberPadModeEnabled
    ? "Use numpad (1-4,6-9), arrow keys, <, >, or s. Press ESC to cancel"
    : "Use hjkl/yubn, arrow keys, <, >, or s. Press ESC to cancel";

function expandChoiceSpec(spec: string): string[] {
  const normalized = String(spec || "")
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

  const canExpandRange = (start: string, end: string): boolean => {
    const isLower = (value: string) => value >= "a" && value <= "z";
    const isUpper = (value: string) => value >= "A" && value <= "Z";
    const isDigit = (value: string) => value >= "0" && value <= "9";
    return (
      (isLower(start) && isLower(end)) ||
      (isUpper(start) && isUpper(end)) ||
      (isDigit(start) && isDigit(end))
    );
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const hasRangeEnd = i + 2 < normalized.length && normalized[i + 1] === "-";

    if (hasRangeEnd) {
      const end = normalized[i + 2];
      if (canExpandRange(current, end)) {
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

function parseQuestionChoices(question: string, choices: string): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const addChoice = (value: string): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  };

  for (const choice of expandChoiceSpec(choices)) {
    addChoice(choice);
  }

  const bracketMatch = String(question || "").match(/\[([^\]]+)\]/);
  if (bracketMatch && bracketMatch[1]) {
    for (const choice of expandChoiceSpec(bracketMatch[1])) {
      addChoice(choice);
    }
  }

  return merged;
}

function isYesNoChoicePrompt(parsedChoices: string[]): boolean {
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

  // Include common yes/no prompt auxiliaries so we never map these to inventory labels.
  const allowedChoices = new Set(["y", "n", "a", "q", "#", "?"]);
  const hasYes = normalized.includes("y");
  const hasNo = normalized.includes("n");
  const onlySimpleChoices = normalized.every(
    (choice) => choice.length === 1 && allowedChoices.has(choice),
  );
  return hasYes && hasNo && onlySimpleChoices;
}

function getQuestionChoiceLabel(
  choice: string,
  inventoryItems: NethackMenuItem[],
  useInventoryLabels = true,
): string {
  const normalizedChoice = choice.trim();
  if (!normalizedChoice) {
    return choice;
  }
  if (!useInventoryLabels) {
    return normalizedChoice;
  }
  const inventoryItem = inventoryItems.find((item) => {
    if (!item || item.isCategory || typeof item.accelerator !== "string") {
      return false;
    }
    return (
      item.accelerator === normalizedChoice ||
      item.accelerator.toLowerCase() === normalizedChoice.toLowerCase()
    );
  });
  if (!inventoryItem || typeof inventoryItem.text !== "string") {
    return normalizedChoice;
  }
  return `${normalizedChoice}) ${inventoryItem.text.trim()}`;
}

function getMenuSelectionInput(item: NethackMenuItem): string {
  if (typeof item.selectionInput === "string" && item.selectionInput.trim()) {
    return item.selectionInput;
  }
  return typeof item.accelerator === "string" ? item.accelerator : "";
}

function isSelectableQuestionMenuItem(item: NethackMenuItem): boolean {
  if (!item || item.isCategory) {
    return false;
  }
  return getMenuSelectionInput(item).trim().length > 0;
}

const startupRoleOptions = [
  "Archeologist",
  "Barbarian",
  "Caveman",
  "Healer",
  "Knight",
  "Monk",
  "Priest",
  "Ranger",
  "Rogue",
  "Samurai",
  "Tourist",
  "Valkyrie",
  "Wizard",
];

const startupRaceOptions = ["human", "elf", "dwarf", "gnome", "orc"];
const startupGenderOptions = ["male", "female"];
const startupAlignOptions = ["lawful", "neutral", "chaotic"];
type StartupFlowStep = "choose" | "create" | "random-name";
type MobileActionEntry = {
  id: string;
  label: string;
  kind: "quick" | "extended";
  value: string;
};
type MobileActionSheetMode = "quick" | "extended";
type InventoryContextMenuState = {
  accelerator: string;
  itemText: string;
  x: number;
  y: number;
};
type ClientOptionToggle = {
  key: ClientOptionToggleKey;
  label: string;
  description: string;
  type: "boolean";
};

type ClientOptionSelect = {
  key: "tilesetMode";
  label: string;
  description: string;
  type: "select";
  options: { value: "ascii" | "tiles"; label: string }[];
};

type ClientOption = ClientOptionToggle | ClientOptionSelect;

type ClientOptionLookSensitivityKey =
  | "fpsLookSensitivityX"
  | "fpsLookSensitivityY";

const mobileDefaultFpsLookSensitivity = 1.35;
const nh3dClientOptionsStorageKey = "nh3d-client-options:v1";

const clientOptionsConfig: ClientOption[] = [
  {
    key: "fpsMode",
    label: "FPS mode",
    description: "Use first-person controls and mouselook.",
    type: "boolean",
  },
  {
    key: "tilesetMode",
    label: "Display",
    description: "Use graphical tiles instead of ASCII.",
    type: "select",
    options: [
      { value: "ascii", label: "ASCII" },
      { value: "tiles", label: "Tiles (Nevanda)" },
    ],
  },
  {
    key: "minimap",
    label: "Minimap",
    description: "Show or hide the dungeon minimap.",
    type: "boolean",
  },
  {
    key: "damageNumbers",
    label: "Damage numbers",
    description: "Show floating damage and healing numbers.",
    type: "boolean",
  },
  {
    key: "tileShakeOnHit",
    label: "Tile shake on hit",
    description: "Shake impact tiles when combat lands.",
    type: "boolean",
  },
  {
    key: "blood",
    label: "Blood",
    description: "Render blood mist particle effects on hits.",
    type: "boolean",
  },
  {
    key: "liveMessageLog",
    label: "Live message log",
    description: "Display the scrolling in-game message log.",
    type: "boolean",
  },
];

const clampInventoryContextMenuPosition = (
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const padding = 8;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 220;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 260;
  const maxX = Math.max(padding, window.innerWidth - safeWidth - padding);
  const maxY = Math.max(padding, window.innerHeight - safeHeight - padding);
  return {
    x: Math.min(Math.max(x, padding), maxX),
    y: Math.min(Math.max(y, padding), maxY),
  };
};

const mobileActions: MobileActionEntry[] = [
  { id: "wait", label: "Wait", kind: "quick", value: "wait" },
  { id: "zap", label: "Zap", kind: "extended", value: "zap" },
  { id: "cast", label: "Cast", kind: "extended", value: "cast" },
  { id: "kick", label: "Kick", kind: "extended", value: "kick" },
  { id: "read", label: "Read", kind: "extended", value: "read" },
  { id: "quaff", label: "Quaff", kind: "extended", value: "quaff" },
  { id: "eat", label: "Eat", kind: "extended", value: "eat" },
  { id: "look", label: "Look", kind: "quick", value: "look" },
  { id: "loot", label: "Loot", kind: "quick", value: "loot" },
  { id: "open", label: "Open", kind: "quick", value: "open" },
  { id: "wield", label: "Wield", kind: "extended", value: "wield" },
  { id: "wear", label: "Wear", kind: "extended", value: "wear" },
  { id: "put-on", label: "Put On", kind: "extended", value: "puton" },
  { id: "take-off", label: "Take Off", kind: "extended", value: "takeoff" },
  { id: "extended", label: "Extended", kind: "quick", value: "extended" },
];
const fallbackExtendedCommandNames = [
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
const commonExtendedCommandWhitelist = [
  "apply",
  "autopickup",
  "attributes",
  "drop",
  "engrave",
  "fire",
  "options",
  "pray",
  "quiver",
  "remove",
  "throw",
  "travel",
];

function normalizeStartupCharacterName(value: string): string {
  const normalized = String(value || "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Web_user";
  }
  return normalized.slice(0, 30);
}

function resolveDeviceDefaultClientOptions(): Nh3dClientOptions {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  ) {
    return normalizeNh3dClientOptions({
      ...defaultNh3dClientOptions,
      fpsLookSensitivityX: mobileDefaultFpsLookSensitivity,
      fpsLookSensitivityY: mobileDefaultFpsLookSensitivity,
    });
  }
  return normalizeNh3dClientOptions(defaultNh3dClientOptions);
}

function readPersistedClientOptions(): Partial<Nh3dClientOptions> | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(nh3dClientOptionsStorageKey);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Partial<Nh3dClientOptions>;
  } catch {
    return null;
  }
}

function persistClientOptions(options: Nh3dClientOptions): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      nh3dClientOptionsStorageKey,
      JSON.stringify(options),
    );
  } catch {
    // Ignore write failures (private mode/quota/security policy).
  }
}

function resolveInitialClientOptions(): Nh3dClientOptions {
  const deviceDefaults = resolveDeviceDefaultClientOptions();
  const persisted = readPersistedClientOptions();
  if (!persisted) {
    return deviceDefaults;
  }
  return normalizeNh3dClientOptions({
    ...deviceDefaults,
    ...persisted,
  });
}

export default function App(): JSX.Element {
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [characterCreationConfig, setCharacterCreationConfig] =
    useState<CharacterCreationConfig | null>(null);
  const [startupFlowStep, setStartupFlowStep] =
    useState<StartupFlowStep>("choose");
  const [runtimeVersion, setRuntimeVersion] =
    useState<NethackRuntimeVersion>("3.6.7");
  const [createRole, setCreateRole] = useState(startupRoleOptions[0]);
  const [createRace, setCreateRace] = useState(startupRaceOptions[0]);
  const [createGender, setCreateGender] = useState(startupGenderOptions[0]);
  const [createAlign, setCreateAlign] = useState(startupAlignOptions[0]);
  const [createName, setCreateName] = useState("Web_user");
  const [clientOptions, setClientOptions] = useState<Nh3dClientOptions>(() =>
    resolveInitialClientOptions(),
  );
  const [clientOptionsDraft, setClientOptionsDraft] =
    useState<Nh3dClientOptions>(() => resolveInitialClientOptions());
  const [isClientOptionsVisible, setIsClientOptionsVisible] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileActionSheetVisible, setIsMobileActionSheetVisible] =
    useState(false);
  const [mobileActionSheetMode, setMobileActionSheetMode] =
    useState<MobileActionSheetMode>("quick");
  const [isMobileLogVisible, setIsMobileLogVisible] = useState(false);
  const [statsBarHeight, setStatsBarHeight] = useState(0);
  const [textInputValue, setTextInputValue] = useState("");
  const adapter = useMemo(() => createEngineUiAdapter(), []);
  const setEngineController = useGameStore(
    (state) => state.setEngineController,
  );
  const setPositionRequest = useGameStore((state) => state.setPositionRequest);

  const loadingVisible = useGameStore((state) => state.loadingVisible);
  const statusText = useGameStore((state) => state.statusText);
  const gameMessages = useGameStore((state) => state.gameMessages);
  const floatingMessages = useGameStore((state) => state.floatingMessages);
  const playerStats = useGameStore((state) => state.playerStats);
  const question = useGameStore((state) => state.question);
  const directionQuestion = useGameStore((state) => state.directionQuestion);
  const numberPadModeEnabled = useGameStore(
    (state) => state.numberPadModeEnabled,
  );
  const infoMenu = useGameStore((state) => state.infoMenu);
  const inventory = useGameStore((state) => state.inventory);
  const textInputRequest = useGameStore((state) => state.textInput);
  const fpsCrosshairContext = useGameStore(
    (state) => state.fpsCrosshairContext,
  );
  const repeatActionVisible = useGameStore(
    (state) => state.repeatActionVisible,
  );
  const positionRequest = useGameStore((state) => state.positionRequest);
  const connectionState = useGameStore((state) => state.connectionState);
  const extendedCommands = useGameStore((state) => state.extendedCommands);
  const controller = useGameStore((state) => state.engineController);
  const isFpsPlayMode = clientOptions.fpsMode;
  const fpsContextTitle = String(fpsCrosshairContext?.title || "");
  const shouldScrollFpsContextTitle = fpsContextTitle.length > 0;
  const fpsContextTitleDurationSec = Math.max(
    6,
    Math.min(20, fpsContextTitle.length * 0.14),
  );
  const fpsContextTitleStyle: CSSProperties | undefined = shouldScrollFpsContextTitle
    ? ({
        "--nh3d-context-title-scroll-duration": `${fpsContextTitleDurationSec}s`,
      } as CSSProperties)
    : undefined;
  const inventoryItemActions = useMemo(
    () => [
      { id: "apply", label: "Apply" },
      { id: "drop", label: "Drop" },
      { id: "eat", label: "Eat" },
      { id: "quaff", label: "Quaff" },
      { id: "read", label: "Read" },
      { id: "throw", label: "Throw" },
      { id: "wield", label: "Wield" },
      { id: "wear", label: "Wear" },
      { id: "take-off", label: "Take Off" },
      { id: "put-on", label: "Put On" },
      { id: "remove", label: "Remove" },
      { id: "zap", label: "Zap" },
      { id: "cast", label: "Cast" },
    ],
    [],
  );
  const inventoryContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [inventoryContextMenu, setInventoryContextMenu] =
    useState<InventoryContextMenuState | null>(null);
  const inventoryContextTitle = inventoryContextMenu
    ? `${inventoryContextMenu.itemText} (${inventoryContextMenu.accelerator})`
    : "";
  const shouldScrollInventoryContextTitle = inventoryContextTitle.length > 44;
  const inventoryContextTitleDurationSec = Math.max(
    6,
    Math.min(20, inventoryContextTitle.length * 0.14),
  );
  const inventoryContextTitleStyle: CSSProperties | undefined =
    shouldScrollInventoryContextTitle
      ? ({
          "--nh3d-context-title-scroll-duration": `${inventoryContextTitleDurationSec}s`,
        } as CSSProperties)
      : undefined;

  useEffect(() => {
    if (!canvasRootRef.current || !characterCreationConfig) {
      return;
    }
    const engine = new Nethack3DEngine({
      mountElement: canvasRootRef.current,
      uiAdapter: adapter,
      characterCreationConfig,
      clientOptions,
    });
    setEngineController(engine);
    registerDebugHelpers(engine);
    return () => {
      setEngineController(null);
    };
  }, [adapter, characterCreationConfig, setEngineController]);

  useEffect(() => {
    if (!controller) {
      return;
    }
    controller.setClientOptions(clientOptions);
  }, [controller, clientOptions]);

  useEffect(() => {
    persistClientOptions(clientOptions);
  }, [clientOptions]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const handleMediaQueryChange = (): void => {
      setIsMobileViewport(mediaQuery.matches);
    };

    handleMediaQueryChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaQueryChange);
    } else {
      mediaQuery.addListener(handleMediaQueryChange);
    }
    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handleMediaQueryChange);
      } else {
        mediaQuery.removeListener(handleMediaQueryChange);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const statsBar = document.getElementById("stats-bar");
    if (!statsBar) {
      setStatsBarHeight(0);
      return;
    }

    const updateHeight = (): void => {
      setStatsBarHeight(statsBar.getBoundingClientRect().height);
    };

    updateHeight();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateHeight);
      resizeObserver.observe(statsBar);
    }

    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [
    characterCreationConfig,
    connectionState,
    loadingVisible,
    isMobileViewport,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      !window.matchMedia
    ) {
      return;
    }

    const root = document.documentElement;
    if (!isMobileViewport) {
      root.classList.remove("nh3d-mobile-browser-mode");
      return;
    }

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");
    const minimalUiQuery = window.matchMedia("(display-mode: minimal-ui)");

    const updateMobileBrowserModeClass = (): void => {
      const iOSStandalone =
        typeof (window.navigator as { standalone?: boolean }).standalone ===
          "boolean" &&
        Boolean((window.navigator as { standalone?: boolean }).standalone);
      const isStandaloneDisplayMode =
        iOSStandalone ||
        standaloneQuery.matches ||
        fullscreenQuery.matches ||
        minimalUiQuery.matches;
      root.classList.toggle(
        "nh3d-mobile-browser-mode",
        !isStandaloneDisplayMode,
      );
    };

    updateMobileBrowserModeClass();

    const queries = [standaloneQuery, fullscreenQuery, minimalUiQuery];
    const addChangeListener = (query: MediaQueryList): void => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", updateMobileBrowserModeClass);
      } else {
        query.addListener(updateMobileBrowserModeClass);
      }
    };
    const removeChangeListener = (query: MediaQueryList): void => {
      if (typeof query.removeEventListener === "function") {
        query.removeEventListener("change", updateMobileBrowserModeClass);
      } else {
        query.removeListener(updateMobileBrowserModeClass);
      }
    };

    for (const query of queries) {
      addChangeListener(query);
    }

    return () => {
      for (const query of queries) {
        removeChangeListener(query);
      }
      root.classList.remove("nh3d-mobile-browser-mode");
    };
  }, [isMobileViewport]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    if (!isMobileViewport) {
      root.style.removeProperty("--nh3d-mobile-visible-height");
      root.style.removeProperty("--nh3d-mobile-visible-top-offset");
      root.style.removeProperty("--nh3d-mobile-visible-bottom-offset");
      return;
    }

    const updateMobileVisibleViewportMetrics = (): void => {
      const visualViewport = window.visualViewport;
      const layoutViewportHeight = window.innerHeight;
      const viewportOffsetTop = visualViewport ? visualViewport.offsetTop : 0;
      const viewportBottomOffset = visualViewport
        ? Math.max(
            0,
            layoutViewportHeight -
              (visualViewport.height + visualViewport.offsetTop),
          )
        : 0;

      root.style.setProperty(
        "--nh3d-mobile-visible-height",
        `${Math.max(0, Math.round(layoutViewportHeight))}px`,
      );
      root.style.setProperty(
        "--nh3d-mobile-visible-top-offset",
        `${Math.max(0, Math.round(viewportOffsetTop))}px`,
      );
      root.style.setProperty(
        "--nh3d-mobile-visible-bottom-offset",
        `${Math.max(0, Math.round(viewportBottomOffset))}px`,
      );
    };

    updateMobileVisibleViewportMetrics();
    window.addEventListener("resize", updateMobileVisibleViewportMetrics);
    const orientationRefreshTimeoutIds: number[] = [];
    const handleOrientationViewportRefresh = (): void => {
      updateMobileVisibleViewportMetrics();
      orientationRefreshTimeoutIds.push(
        window.setTimeout(updateMobileVisibleViewportMetrics, 120),
      );
      orientationRefreshTimeoutIds.push(
        window.setTimeout(updateMobileVisibleViewportMetrics, 280),
      );
    };
    window.addEventListener(
      "orientationchange",
      handleOrientationViewportRefresh,
    );

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener(
        "resize",
        updateMobileVisibleViewportMetrics,
      );
      visualViewport.addEventListener(
        "scroll",
        updateMobileVisibleViewportMetrics,
      );
    }
    const screenOrientation = window.screen?.orientation;
    if (
      screenOrientation &&
      typeof screenOrientation.addEventListener === "function"
    ) {
      screenOrientation.addEventListener(
        "change",
        handleOrientationViewportRefresh,
      );
    }

    return () => {
      window.removeEventListener("resize", updateMobileVisibleViewportMetrics);
      window.removeEventListener(
        "orientationchange",
        handleOrientationViewportRefresh,
      );
      if (visualViewport) {
        visualViewport.removeEventListener(
          "resize",
          updateMobileVisibleViewportMetrics,
        );
        visualViewport.removeEventListener(
          "scroll",
          updateMobileVisibleViewportMetrics,
        );
      }
      if (
        screenOrientation &&
        typeof screenOrientation.removeEventListener === "function"
      ) {
        screenOrientation.removeEventListener(
          "change",
          handleOrientationViewportRefresh,
        );
      }
      for (const timeoutId of orientationRefreshTimeoutIds) {
        window.clearTimeout(timeoutId);
      }
      root.style.removeProperty("--nh3d-mobile-visible-height");
      root.style.removeProperty("--nh3d-mobile-visible-top-offset");
      root.style.removeProperty("--nh3d-mobile-visible-bottom-offset");
    };
  }, [isMobileViewport]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty("--nh3d-stats-bar-height", `${statsBarHeight}px`);
    return () => {
      root.style.removeProperty("--nh3d-stats-bar-height");
    };
  }, [statsBarHeight]);

  const isMobileGameRunning =
    isMobileViewport &&
    characterCreationConfig !== null &&
    connectionState === "running" &&
    !loadingVisible;

  const isDesktopGameRunning =
    !isMobileViewport &&
    characterCreationConfig !== null &&
    connectionState === "running" &&
    !loadingVisible;

  const startup = !isMobileGameRunning && !isDesktopGameRunning;

  const hasGameplayOverlayOpen =
    Boolean(question) ||
    Boolean(directionQuestion) ||
    Boolean(infoMenu) ||
    inventory.visible ||
    Boolean(textInputRequest) ||
    Boolean(positionRequest) ||
    Boolean(inventoryContextMenu) ||
    Boolean(fpsCrosshairContext);

  useEffect(() => {
    if (!isMobileGameRunning) {
      setIsMobileActionSheetVisible(false);
      setMobileActionSheetMode("quick");
      setIsMobileLogVisible(false);
    }
  }, [isMobileGameRunning]);

  useEffect(() => {
    if (!clientOptions.liveMessageLog) {
      setIsMobileLogVisible(false);
    }
  }, [clientOptions.liveMessageLog]);

  useEffect(() => {
    if (!textInputRequest) {
      return;
    }
    setTextInputValue("");
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        textInputRef.current?.focus();
      }, 0);
    }
  }, [textInputRequest]);

  const hpPercentage =
    playerStats.maxHp > 0
      ? Math.max(0, Math.min(100, (playerStats.hp / playerStats.maxHp) * 100))
      : 0;
  const hpColor =
    hpPercentage > 60 ? "#00ff00" : hpPercentage > 30 ? "#ffaa00" : "#ff0000";
  const powerPercentage =
    playerStats.maxPower > 0
      ? Math.max(
          0,
          Math.min(100, (playerStats.power / playerStats.maxPower) * 100),
        )
      : 0;
  const locationStatusText = [playerStats.hunger, playerStats.encumbrance]
    .filter((value) => Boolean(value))
    .join(" ");
  const parsedQuestionChoices = question
    ? parseQuestionChoices(question.text, question.choices)
    : [];
  const isYesNoQuestionChoices = isYesNoChoicePrompt(parsedQuestionChoices);
  const useInventoryChoiceLabels = !isYesNoQuestionChoices;
  const questionMenuPageIndex = question?.menuPageIndex ?? 0;
  const questionMenuPageCount = Math.max(1, question?.menuPageCount ?? 1);
  const questionSelectableMenuItemCount = question
    ? question.menuItems.filter((item) => isSelectableQuestionMenuItem(item))
        .length
    : 0;
  const showPickupActionButtons =
    Boolean(question?.isPickupDialog) &&
    (questionSelectableMenuItemCount > 1 || isMobileViewport);
  const mobileExtendedCommandNames = useMemo(() => {
    const rawCommands =
      Array.isArray(extendedCommands) && extendedCommands.length > 0
        ? extendedCommands
        : fallbackExtendedCommandNames;
    const uniqueCommands: string[] = [];
    const seen = new Set<string>();
    for (const rawCommand of rawCommands) {
      const normalized = String(rawCommand || "")
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
  }, [extendedCommands]);
  const mobileCommonExtendedCommandNames = useMemo(() => {
    const available = new Set(mobileExtendedCommandNames);
    return commonExtendedCommandWhitelist.filter((command) =>
      available.has(command),
    );
  }, [mobileExtendedCommandNames]);

  const submitTextInput = (value: string): void => {
    controller?.submitTextInput(value);
    setTextInputValue("");
  };

  const openClientOptionsDialog = (): void => {
    setClientOptionsDraft({ ...clientOptions });
    setIsClientOptionsVisible(true);
    controller?.dismissFpsCrosshairContextMenu();
  };

  const closeClientOptionsDialog = (): void => {
    setIsClientOptionsVisible(false);
    setClientOptionsDraft({ ...clientOptions });
  };

  const confirmClientOptionsDialog = (): void => {
    const next = { ...clientOptionsDraft };
    setClientOptions(next);
    setIsClientOptionsVisible(false);
    controller?.setClientOptions(next);
  };

  const updateClientOptionDraft = (
    optionKey: ClientOptionToggleKey | "tilesetMode",
    value: boolean | "ascii" | "tiles",
  ): void => {
    setClientOptionsDraft((previous) => ({
      ...previous,
      [optionKey]: value,
    }));
  };

  const updateClientFovDraft = (rawValue: number): void => {
    const clamped = Math.max(45, Math.min(110, Math.round(rawValue)));
    setClientOptionsDraft((previous) => ({
      ...previous,
      fpsFov: clamped,
    }));
  };

  const updateClientLookSensitivityDraft = (
    key: ClientOptionLookSensitivityKey,
    rawValue: number,
  ): void => {
    const clamped = Number(
      Math.max(
        nh3dFpsLookSensitivityMin,
        Math.min(nh3dFpsLookSensitivityMax, rawValue),
      ).toFixed(2),
    );
    setClientOptionsDraft((previous) => ({
      ...previous,
      [key]: clamped,
    }));
  };

  const renderMobileDialogCloseButton = (
    onClick: () => void,
    label = "Close",
  ): JSX.Element | null =>
    isMobileViewport ? (
      <button
        aria-label={label}
        className="nh3d-mobile-dialog-close"
        onClick={onClick}
        type="button"
      >
        {"\u00D7"}
      </button>
    ) : null;

  const openInventoryContextMenu = (
    item: NethackMenuItem,
    clientX: number,
    clientY: number,
  ): void => {
    if (typeof item.accelerator !== "string") {
      return;
    }

    const initial = clampInventoryContextMenuPosition(
      clientX + 8,
      clientY + 8,
      220,
      260,
    );

    setInventoryContextMenu({
      accelerator: item.accelerator,
      itemText: String(item.text || "Unknown item"),
      x: initial.x,
      y: initial.y,
    });
  };

  const runFpsCrosshairContextAction = (
    action: FpsCrosshairContextState["actions"][number],
  ): void => {
    if (action.kind === "quick") {
      controller?.runQuickAction(action.value);
      return;
    }
    controller?.runExtendedCommand(action.value);
  };

  useEffect(() => {
    if (!inventory.visible) {
      setInventoryContextMenu(null);
    }
  }, [inventory.visible]);

  useEffect(() => {
    if (!inventoryContextMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && inventoryContextMenuRef.current?.contains(target)) {
        return;
      }
      setInventoryContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setInventoryContextMenu(null);
      }
    };

    const handleViewportResize = (): void => {
      setInventoryContextMenu((previous) => {
        if (!previous) {
          return previous;
        }
        const menuElement = inventoryContextMenuRef.current;
        const rect = menuElement?.getBoundingClientRect();
        const clamped = clampInventoryContextMenuPosition(
          previous.x,
          previous.y,
          rect?.width ?? 220,
          rect?.height ?? 260,
        );
        if (clamped.x === previous.x && clamped.y === previous.y) {
          return previous;
        }
        return {
          ...previous,
          x: clamped.x,
          y: clamped.y,
        };
      });
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [inventoryContextMenu]);

  useLayoutEffect(() => {
    if (!inventoryContextMenu) {
      return;
    }

    const menuElement = inventoryContextMenuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    const clamped = clampInventoryContextMenuPosition(
      inventoryContextMenu.x,
      inventoryContextMenu.y,
      rect.width,
      rect.height,
    );
    if (
      clamped.x === inventoryContextMenu.x &&
      clamped.y === inventoryContextMenu.y
    ) {
      return;
    }

    setInventoryContextMenu((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        x: clamped.x,
        y: clamped.y,
      };
    });
  }, [inventoryContextMenu]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleEscapeForClientOptions = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || isMobileViewport) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (isClientOptionsVisible) {
        event.preventDefault();
        event.stopPropagation();
        closeClientOptionsDialog();
        return;
      }

      if (!isDesktopGameRunning || hasGameplayOverlayOpen) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openClientOptionsDialog();
    };

    window.addEventListener("keydown", handleEscapeForClientOptions, true);
    return () => {
      window.removeEventListener("keydown", handleEscapeForClientOptions, true);
    };
  }, [
    clientOptions,
    controller,
    hasGameplayOverlayOpen,
    isClientOptionsVisible,
    isDesktopGameRunning,
    isMobileViewport,
  ]);

  return (
    <>
      <div className="nh3d-canvas-root" ref={canvasRootRef} />
      {startup && (
        <div className="logo-container">
          <pre className="nethack-ascii-logo">
            {`                
  +$$&&&&&$;         :X$&&&&$X:                       :X$&&&&&$X;     :X&&&&&&&$+                               .;;+X$;                                               
    +X&&&&&$X          X&&&$+                           +X&&&$+:        xX&&&&+:                              .$&&&&&+:                                               
    :x&&&&&&&$:        X$&&X;                           ;X&&&$x.        +X&&&$x.                                X$&&$+:                                               
    :x&&&&&&&&$x       X&&&X;                   x&:     ;X&&&$X.        +X&&&$x.                                X$&&&x:                                               
    :x&&x&&&&&&&$      X&&&X:        _       .$&&+:     ;X&&&$x.        +X&&&$x.                                X$&&&x.                                               
    :X&&x;X&&&&&&&:    X&&&X:   :+$&&&&&+   :&&&&$Xxxx; ;X&&&$X;.:;::::.xX&&&$x.   ;+$&&&&$+        :;+XXXXx;:  X$&&$x.   .XXXX+                                      
    :X&&x::+&&&&&&&x   X$&&x:  X&&$;;X&&&$ ;$&&&&XXXX;  ;x$$$$&&&&&&&&&&&&$$$$x  +&$X+;+$&&&$.    :$&&$x++$&&$+ X$$$$+.   +$$+:                                       
    :X&$x:  ;$&$&&$&&  +$&&x: $&&x:  :X&&x+  $&&&;.     ;+XXXXXXXXXXXXXXXX$$$X+  :+:    ;$$$Xx   X&&$;:   .++:  xX$$X+. ;&$+:                                         
    :X$$x:   ;+$$$$$&&:;X$$+.;X&&x  +$$&&xx  $&&&+.     ;+XXX+;. .. .   ;xXXXX+        :$$$$X+  x$$$;;          xXXXX+:$$Xx;                                          
    :X$Xx:    .;$XXXX$&$XX$+.;X&&&$Xx;:      $&$$;.     :+Xxx+;.        ;xXXxx+    ;XXX++XXXX+  xXXX;:          +XxxxxX$XXxx;                                         
    :+Xx+:      ;XXXXXX&&xX+ ;;$$Xx:         $$XX;.     :+x+++;.        ;+x+++;  ;XX+:. ;xxxx+  +xxX++          +x+++::+XxX++:                                        
    :+X++:       :+xxxxxX+x; .;xXX$$:     ,  XXxX+:     :;x+++;.        ;+++++; ;xx++   ;x++++  ;+x+x++         +x+++:.:;++x++:                                       
    :;x++:        :;x+++++x;  :;+XX$&&$XXX;  ++xx&&X+x; :;+++;;.        ;+++++; ;;++xX;;xx++++: .;;++xXXx;:;;+: ;x+++:. :;+++++;                                      
    X$++X&+         :x++++x;   .::+X$$$+::   .;;XX$+::  xX;;;;+;        xx;;;;+: ::+++;:: ++;;;.  ::;++++x+::.  Xx;;;+:  .:++++++.                                    
  :+;;:::::;x+        ;++X+:       :;;;:        ::;:.  ;::::::::::;   .;::::::::::: ...    ::.       .:::::.  .;::::::::::  ::::::::                                   
                                                                                                                                                                      
                                                                                                                                                                      
                                            ;&&&&&&&&&&&&&&&&&&x   x&&&&&&&&&&&&&$X+:.                                                                                
                                            :;&&&&&&&&&&&&&&&&+:   :;&&&&&$&&&&&&&&&&&&+                                                                              
                                            ;+:::::::::$&&&&$:.    :+&&&&&:.    ::&&&&&&$;                                                                            
                                                      $&&&&X:.      ;X&&&&&:.     :;$&&&&&&                                                                           
                                                    $&&&&X;:;+;:    +$&&&&&:.      ++&&&&&XX                                                                           
                                                  :X$$$$&&&&&&&&&+  ;x&&&&&:.      +X&&&&&+x                                                                           
                                                        .:X&&&&&&$; :+$$$$$:.      +X&$$$&++                                                                           
                                                          :+$$$$$:: :;XxxxX..      xxXXxxX;+                                                                           
                                                          :;XxxxX.. .:x+++x..     :+X++++::                                                                            
                                            x&+         :XX;;;;;.   :+;;;+.     XXx;;;+::                                                                             
                                            :;xx$&&$$XXX$X;:::;:.   .;+;;;++&$&&&x;;;+;:                                                                               
                                             ::::::;;;;;::::::      x+;:::;;;;:::::::                                                                                  
                                                                      `}
          </pre>
          <pre className="nethack-ascii-logo">
            {`                
  +$$&&&&&$;         :X$&&&&$X:                       :X$&&&&&$X;     :X&&&&&&&$+                               .;;+X$;                                               
    +X&&&&&$X          X&&&$+                           +X&&&$+:        xX&&&&+:                              .$&&&&&+:                                               
    :x&&&&&&&$:        X$&&X;                           ;X&&&$x.        +X&&&$x.                                X$&&$+:                                               
    :x&&&&&&&&$x       X&&&X;                   x&:     ;X&&&$X.        +X&&&$x.                                X$&&&x:                                               
    :x&&x&&&&&&&$      X&&&X:        _       .$&&+:     ;X&&&$x.        +X&&&$x.                                X$&&&x.                                               
    :X&&x;X&&&&&&&:    X&&&X:   :+$&&&&&+   :&&&&$Xxxx; ;X&&&$X;.:;::::.xX&&&$x.   ;+$&&&&$+        :;+XXXXx;:  X$&&$x.   .XXXX+                                      
    :X&&x::+&&&&&&&x   X$&&x:  X&&$;;X&&&$ ;$&&&&XXXX;  ;x$$$$&&&&&&&&&&&&$$$$x  +&$X+;+$&&&$.    :$&&$x++$&&$+ X$$$$+.   +$$+:                                       
    :X&$x:  ;$&$&&$&&  +$&&x: $&&x:  :X&&x+  $&&&;.     ;+XXXXXXXXXXXXXXXX$$$X+  :+:    ;$$$Xx   X&&$;:   .++:  xX$$X+. ;&$+:                                         
    :X$$x:   ;+$$$$$&&:;X$$+.;X&&x  +$$&&xx  $&&&+.     ;+XXX+;. .. .   ;xXXXX+        :$$$$X+  x$$$;;          xXXXX+:$$Xx;                                          
    :X$Xx:    .;$XXXX$&$XX$+.;X&&&$Xx;:      $&$$;.     :+Xxx+;.        ;xXXxx+    ;XXX++XXXX+  xXXX;:          +XxxxxX$XXxx;                                         
    :+Xx+:      ;XXXXXX&&xX+ ;;$$Xx:         $$XX;.     :+x+++;.        ;+x+++;  ;XX+:. ;xxxx+  +xxX++          +x+++::+XxX++:                                        
    :+X++:       :+xxxxxX+x; .;xXX$$:     ,  XXxX+:     :;x+++;.        ;+++++; ;xx++   ;x++++  ;+x+x++         +x+++:.:;++x++:                                       
    :;x++:        :;x+++++x;  :;+XX$&&$XXX;  ++xx&&X+x; :;+++;;.        ;+++++; ;;++xX;;xx++++: .;;++xXXx;:;;+: ;x+++:. :;+++++;                                      
    X$++X&+         :x++++x;   .::+X$$$+::   .;;XX$+::  xX;;;;+;        xx;;;;+: ::+++;:: ++;;;.  ::;++++x+::.  Xx;;;+:  .:++++++.                                    
  :+;;:::::;x+        ;++X+:       :;;;:        ::;:.  ;::::::::::;   .;::::::::::: ...    ::.       .:::::.  .;::::::::::  ::::::::                                   
                                                                                                                                                                      
                                                                                                                                                                      
                                            ;&&&&&&&&&&&&&&&&&&x   x&&&&&&&&&&&&&$X+:.                                                                                
                                            :;&&&&&&&&&&&&&&&&+:   :;&&&&&$&&&&&&&&&&&&+                                                                              
                                            ;+:::::::::$&&&&$:.    :+&&&&&:.    ::&&&&&&$;                                                                            
                                                      $&&&&X:.      ;X&&&&&:.     :;$&&&&&&                                                                            
                                                    $&&&&X;:;+;:    +$&&&&&:.      ++&&&&&XX                                                                           
                                                  :X$$$$&&&&&&&&&+  ;x&&&&&:.      +X&&&&&+x                                                                           
                                                        .:X&&&&&&$; :+$$$$$:.      +X&$$$&++                                                                           
                                                          :+$$$$$:: :;XxxxX..      xxXXxxX;+                                                                           
                                                          :;XxxxX.. .:x+++x..     :+X++++::                                                                            
                                            x&+         :XX;;;;;.   :+;;;+.     XXx;;;+::                                                                             
                                            :;xx$&&$$XXX$X;:::;:.   .;+;;;++&$&&&x;;;+;:                                                                               
                                             ::::::;;;;;::::::      x+;:::;;;;:::::::                                                                                  
                                                                      `}
          </pre>
        </div>
      )}

      {characterCreationConfig === null ? (
        <>
          <div
            className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions is-visible startup"
            id="character-setup-dialog"
          >
            {startupFlowStep === "choose" ? (
              <>
                <div className="nh3d-question-text">
                  Choose your character setup:
                </div>
                <div className="nh3d-startup-config-grid centered">
                  <label className="nh3d-startup-config-field">
                    <span>NetHack Version</span>
                    <select
                      className="nh3d-startup-config-select"
                      onChange={(event) =>
                        setRuntimeVersion(
                          event.target.value as NethackRuntimeVersion,
                        )
                      }
                      value={runtimeVersion}
                    >
                      <option value="3.6.7">3.6.x (3.6.7)</option>
                      {import.meta.env.DEV && <option value="3.7">3.7</option>}
                    </select>
                  </label>
                </div>
                <div className="nh3d-choice-list">
                  <button
                    className="nh3d-choice-button nh3d-character-setup-choice-button"
                    onClick={() => setStartupFlowStep("random-name")}
                    type="button"
                  >
                    Random character
                  </button>
                  <button
                    className="nh3d-choice-button nh3d-character-setup-choice-button"
                    onClick={() => setStartupFlowStep("create")}
                    type="button"
                  >
                    Create character
                  </button>
                  <button
                    className="nh3d-choice-button nh3d-character-setup-choice-button"
                    onClick={openClientOptionsDialog}
                    type="button"
                  >
                    NetHack 3D Options
                  </button>
                </div>
              </>
            ) : startupFlowStep === "random-name" ? (
              <>
                <div className="nh3d-question-text">Random character name:</div>
                <div className="nh3d-startup-config-grid centered">
                  <label className="nh3d-startup-config-field">
                    <span>Name</span>
                    <input
                      className="nh3d-startup-config-input"
                      maxLength={30}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="Web_user"
                      type="text"
                      value={createName}
                    />
                  </label>
                </div>
                <div className="nh3d-menu-actions">
                  <button
                    className="nh3d-menu-action-button nh3d-menu-action-confirm"
                    onClick={() =>
                      setCharacterCreationConfig({
                        mode: "random",
                        playMode: clientOptions.fpsMode ? "fps" : "normal",
                        runtimeVersion,
                        name: normalizeStartupCharacterName(createName),
                      })
                    }
                    type="button"
                  >
                    Start game
                  </button>
                  <button
                    className="nh3d-menu-action-button nh3d-menu-action-cancel"
                    onClick={() => setStartupFlowStep("choose")}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="nh3d-menu-action-button"
                    onClick={openClientOptionsDialog}
                    type="button"
                  >
                    NetHack 3D Options
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="nh3d-question-text">Create your character:</div>
                <div className="nh3d-startup-config-grid">
                  <label className="nh3d-startup-config-field">
                    <span>Name</span>
                    <input
                      className="nh3d-startup-config-input"
                      maxLength={30}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="Web_user"
                      type="text"
                      value={createName}
                    />
                  </label>
                  <label className="nh3d-startup-config-field">
                    <span>Role</span>
                    <select
                      className="nh3d-startup-config-select"
                      onChange={(event) => setCreateRole(event.target.value)}
                      value={createRole}
                    >
                      {startupRoleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nh3d-startup-config-field">
                    <span>Race</span>
                    <select
                      className="nh3d-startup-config-select"
                      onChange={(event) => setCreateRace(event.target.value)}
                      value={createRace}
                    >
                      {startupRaceOptions.map((race) => (
                        <option key={race} value={race}>
                          {race}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nh3d-startup-config-field">
                    <span>Gender</span>
                    <select
                      className="nh3d-startup-config-select"
                      onChange={(event) => setCreateGender(event.target.value)}
                      value={createGender}
                    >
                      {startupGenderOptions.map((gender) => (
                        <option key={gender} value={gender}>
                          {gender}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nh3d-startup-config-field">
                    <span>Alignment</span>
                    <select
                      className="nh3d-startup-config-select"
                      onChange={(event) => setCreateAlign(event.target.value)}
                      value={createAlign}
                    >
                      {startupAlignOptions.map((align) => (
                        <option key={align} value={align}>
                          {align}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="nh3d-menu-actions">
                  <button
                    className="nh3d-menu-action-button nh3d-menu-action-confirm"
                    onClick={() =>
                      setCharacterCreationConfig({
                        mode: "create",
                        playMode: clientOptions.fpsMode ? "fps" : "normal",
                        runtimeVersion,
                        name: normalizeStartupCharacterName(createName),
                        role: createRole,
                        race: createRace,
                        gender: createGender,
                        align: createAlign,
                      })
                    }
                    type="button"
                  >
                    Start game
                  </button>
                  <button
                    className="nh3d-menu-action-button nh3d-menu-action-cancel"
                    onClick={() => setStartupFlowStep("choose")}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="nh3d-menu-action-button"
                    onClick={openClientOptionsDialog}
                    type="button"
                  >
                    NetHack 3D Options
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}

      <div
        className={`loading${
          loadingVisible && characterCreationConfig !== null ? "" : " is-hidden"
        }`}
        id="loading"
      >
        <div>NetHack 3D</div>
        <div className="loading-subtitle">Starting local runtime...</div>
      </div>

      {!isMobileViewport && isDesktopGameRunning ? (
        <div className="top-left-ui with-stats">
          <div id="game-status">{statusText}</div>
          {clientOptions.liveMessageLog ? (
            <div id="game-log">
              {gameMessages.map((message, index) => (
                <div key={`${index}-${message}`}>{message}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : isMobileGameRunning && clientOptions.liveMessageLog ? (
        <div
          className={`nh3d-mobile-log${
            isMobileLogVisible ? "" : " nh3d-mobile-log-hidden"
          }`}
          id="game-log"
          style={
            {
              "--nh3d-mobile-log-top": `${statsBarHeight}px`,
            } as React.CSSProperties
          }
        >
          {renderMobileDialogCloseButton(
            () => setIsMobileLogVisible(false),
            "Close message log",
          )}
          {gameMessages.map((message, index) => (
            <div key={`${index}-${message}`}>{message}</div>
          ))}
        </div>
      ) : null}

      <div id="floating-log-message-layer">
        {floatingMessages.map((entry, index) => (
          <div
            className="floating-message-container"
            key={entry.id}
            style={{ top: `${-index * 30}px` }}
          >
            <div className="floating-message-text">{entry.text}</div>
          </div>
        ))}
      </div>

      {!startup && (
        <div id="stats-bar">
          <div className="nh3d-stats-name">
            {playerStats.name} (Lvl {playerStats.level})
          </div>
          <div className="nh3d-stats-meter">
            <div className="nh3d-stats-meter-label nh3d-stats-meter-label-hp">
              HP: {playerStats.hp}/{playerStats.maxHp}
            </div>
            <div className="nh3d-stats-meter-track">
              <div
                className="nh3d-stats-meter-fill"
                style={{
                  width: `${hpPercentage}%`,
                  backgroundColor: hpColor,
                }}
              />
            </div>
          </div>
          {playerStats.maxPower > 0 ? (
            <div className="nh3d-stats-meter">
              <div className="nh3d-stats-meter-label nh3d-stats-meter-label-pw">
                Pw: {playerStats.power}/{playerStats.maxPower}
              </div>
              <div className="nh3d-stats-meter-track">
                <div
                  className="nh3d-stats-meter-fill nh3d-stats-meter-fill-pw"
                  style={{ width: `${powerPercentage}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="nh3d-stats-group nh3d-stats-group-core">
            <div className="nh3d-stats-core">St:{playerStats.strength}</div>
            <div className="nh3d-stats-core">Dx:{playerStats.dexterity}</div>
            <div className="nh3d-stats-core">Co:{playerStats.constitution}</div>
            <div className="nh3d-stats-core">In:{playerStats.intelligence}</div>
            <div className="nh3d-stats-core">Wi:{playerStats.wisdom}</div>
            <div className="nh3d-stats-core">Ch:{playerStats.charisma}</div>
            <div className="nh3d-stats-secondary-ac nh3d-stats-mobile-inline-secondary">
              AC:{playerStats.armor}
            </div>
            <div className="nh3d-stats-secondary-exp nh3d-stats-mobile-inline-secondary">
              Exp:{playerStats.experience}
            </div>
            <div className="nh3d-stats-secondary-time nh3d-stats-mobile-inline-secondary">
              T:{playerStats.time}
            </div>
            <div className="nh3d-stats-secondary-gold nh3d-stats-mobile-inline-secondary">
              $:{playerStats.gold}
            </div>
          </div>
          <div className="nh3d-stats-group nh3d-stats-group-secondary">
            <div className="nh3d-stats-secondary-ac nh3d-stats-desktop-secondary">
              AC:{playerStats.armor}
            </div>
            <div className="nh3d-stats-secondary-exp nh3d-stats-desktop-secondary">
              Exp:{playerStats.experience}
            </div>
            <div className="nh3d-stats-secondary-gold nh3d-stats-desktop-secondary">
              $:{playerStats.gold}
            </div>
            <div className="nh3d-stats-secondary-time nh3d-stats-desktop-secondary">
              T:{playerStats.time}
            </div>
            <div className="nh3d-stats-hunger nh3d-stats-desktop-secondary">
              {playerStats.hunger}
              {playerStats.encumbrance ? ` ${playerStats.encumbrance}` : ""}
            </div>
          </div>
          <div className="nh3d-stats-location">
            <div className="nh3d-stats-dungeon">
              {playerStats.dungeon} {playerStats.dlevel}
              {locationStatusText ? (
                <span className="nh3d-stats-mobile-location-status">
                  {locationStatusText}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {isClientOptionsVisible ? (
        <div
          className={`nh3d-dialog nh3d-dialog-options nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible`}
          id="nh3d-client-options-dialog"
        >
          {renderMobileDialogCloseButton(
            closeClientOptionsDialog,
            "Close NetHack 3D options",
          )}
          <div className="nh3d-options-title">NetHack 3D Client Options</div>
          <div className="nh3d-options-list">
            {clientOptionsConfig.map((option) => {
              if (option.type === "boolean") {
                const enabled = Boolean(clientOptionsDraft[option.key]);
                return (
                  <div className="nh3d-option-row" key={option.key}>
                    <div className="nh3d-option-copy">
                      <div className="nh3d-option-label">{option.label}</div>
                      <div className="nh3d-option-description">
                        {option.description}
                      </div>
                    </div>
                    <button
                      aria-checked={enabled}
                      className={`nh3d-option-switch${enabled ? " is-on" : ""}`}
                      onClick={() =>
                        updateClientOptionDraft(option.key, !enabled)
                      }
                      role="switch"
                      type="button"
                    >
                      <span className="nh3d-option-switch-thumb" />
                    </button>
                  </div>
                );
              }
              if (option.type === "select") {
                return (
                  <div className="nh3d-option-row" key={option.key}>
                    <div className="nh3d-option-copy">
                      <div className="nh3d-option-label">{option.label}</div>
                      <div className="nh3d-option-description">
                        {option.description}
                      </div>
                    </div>
                    <select
                      className="nh3d-startup-config-select"
                      onChange={(event) =>
                        updateClientOptionDraft(
                          option.key,
                          event.target.value as "ascii" | "tiles",
                        )
                      }
                      value={clientOptionsDraft[option.key]}
                    >
                      {option.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              return null;
            })}
            {clientOptionsDraft.fpsMode ? (
              <>
                <div className="nh3d-option-row nh3d-option-row-slider">
                  <div className="nh3d-option-copy">
                    <div className="nh3d-option-label">FPS Field of View</div>
                    <div className="nh3d-option-description">
                      Adjust first-person camera FOV.
                    </div>
                  </div>
                  <div className="nh3d-option-slider-control">
                    <input
                      aria-label="FPS Field of View"
                      className="nh3d-option-slider"
                      max={110}
                      min={45}
                      onChange={(event) =>
                        updateClientFovDraft(Number(event.target.value))
                      }
                      step={1}
                      type="range"
                      value={clientOptionsDraft.fpsFov}
                    />
                    <div className="nh3d-option-slider-value">
                      {clientOptionsDraft.fpsFov}°
                    </div>
                  </div>
                </div>

                <div className="nh3d-option-row nh3d-option-row-slider">
                  <div className="nh3d-option-copy">
                    <div className="nh3d-option-label">Look Sensitivity X</div>
                    <div className="nh3d-option-description">
                      Horizontal mouselook/touch-look sensitivity.
                    </div>
                  </div>
                  <div className="nh3d-option-slider-control">
                    <input
                      aria-label="Look Sensitivity X"
                      className="nh3d-option-slider"
                      max={nh3dFpsLookSensitivityMax}
                      min={nh3dFpsLookSensitivityMin}
                      onChange={(event) =>
                        updateClientLookSensitivityDraft(
                          "fpsLookSensitivityX",
                          Number(event.target.value),
                        )
                      }
                      step={0.01}
                      type="range"
                      value={clientOptionsDraft.fpsLookSensitivityX}
                    />
                    <div className="nh3d-option-slider-value">
                      {clientOptionsDraft.fpsLookSensitivityX.toFixed(2)}x
                    </div>
                  </div>
                </div>

                <div className="nh3d-option-row nh3d-option-row-slider">
                  <div className="nh3d-option-copy">
                    <div className="nh3d-option-label">Look Sensitivity Y</div>
                    <div className="nh3d-option-description">
                      Vertical mouselook/touch-look sensitivity.
                    </div>
                  </div>
                  <div className="nh3d-option-slider-control">
                    <input
                      aria-label="Look Sensitivity Y"
                      className="nh3d-option-slider"
                      max={nh3dFpsLookSensitivityMax}
                      min={nh3dFpsLookSensitivityMin}
                      onChange={(event) =>
                        updateClientLookSensitivityDraft(
                          "fpsLookSensitivityY",
                          Number(event.target.value),
                        )
                      }
                      step={0.01}
                      type="range"
                      value={clientOptionsDraft.fpsLookSensitivityY}
                    />
                    <div className="nh3d-option-slider-value">
                      {clientOptionsDraft.fpsLookSensitivityY.toFixed(2)}x
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={confirmClientOptionsDialog}
              type="button"
            >
              Confirm
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={closeClientOptionsDialog}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {textInputRequest ? (
        <div
          className="nh3d-dialog nh3d-dialog-text nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible"
          id="text-input-dialog"
        >
          {renderMobileDialogCloseButton(
            () => submitTextInput(""),
            "Cancel text input",
          )}
          <div className="nh3d-question-text">{textInputRequest.text}</div>
          <input
            className="nh3d-text-input"
            maxLength={textInputRequest.maxLength ?? 256}
            onChange={(event) => setTextInputValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                submitTextInput(textInputValue);
              } else if (event.key === "Escape") {
                event.preventDefault();
                submitTextInput("");
              }
            }}
            placeholder={textInputRequest.placeholder ?? "Enter text"}
            ref={textInputRef}
            type="text"
            value={textInputValue}
          />
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={() => submitTextInput(textInputValue)}
              type="button"
            >
              OK
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={() => submitTextInput("")}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {question ? (
        <div
          className={`nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible${
            question.menuItems.length === 0 && isYesNoQuestionChoices
              ? " nh3d-dialog-question-yes-no"
              : ""
          }`}
          id="question-dialog"
        >
          {renderMobileDialogCloseButton(
            () => controller?.cancelActivePrompt(),
            "Cancel prompt",
          )}
          <div className="nh3d-question-text">{question.text}</div>
          {question.menuItems.length > 0 ? (
            question.isPickupDialog ? (
              <>
                {question.menuItems.map((item, index) =>
                  item.isCategory ||
                  !item.accelerator ||
                  !String(item.accelerator).trim() ? (
                    <div className="nh3d-menu-category" key={`cat-${index}`}>
                      {item.text}
                    </div>
                  ) : (
                    <div
                      className={`nh3d-pickup-item${
                        question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )
                          ? " nh3d-pickup-item-selected"
                          : ""
                      }${
                        question.activeMenuSelectionInput ===
                        getMenuSelectionInput(item)
                          ? " nh3d-pickup-item-active"
                          : ""
                      }`}
                      key={`pickup-${item.accelerator}-${index}`}
                      onClick={() =>
                        controller?.togglePickupChoice(
                          getMenuSelectionInput(item),
                        )
                      }
                    >
                      <input
                        checked={question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )}
                        className="nh3d-pickup-checkbox"
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          controller?.togglePickupChoice(
                            getMenuSelectionInput(item),
                          )
                        }
                        type="checkbox"
                      />
                      <span className="nh3d-pickup-key">
                        {item.accelerator})
                      </span>
                      <span className="nh3d-pickup-text">{item.text}</span>
                    </div>
                  ),
                )}
                {showPickupActionButtons ? (
                  <div className="nh3d-pickup-actions">
                    <button
                      className={`nh3d-pickup-action-button nh3d-pickup-action-confirm${
                        question.activeActionButton === "confirm"
                          ? " nh3d-action-button-active"
                          : ""
                      }`}
                      onClick={() => controller?.confirmPickupChoices()}
                      type="button"
                    >
                      Confirm
                    </button>
                    <button
                      className={`nh3d-pickup-action-button nh3d-pickup-action-cancel${
                        question.activeActionButton === "cancel"
                          ? " nh3d-action-button-active"
                          : ""
                      }`}
                      onClick={() => controller?.cancelActivePrompt()}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {question.menuItems.map((item, index) =>
                  item.isCategory ||
                  !item.accelerator ||
                  !String(item.accelerator).trim() ? (
                    <div className="nh3d-menu-category" key={`cat-${index}`}>
                      {item.text}
                    </div>
                  ) : (
                    <button
                      className={`nh3d-menu-button${
                        question.activeMenuSelectionInput ===
                        getMenuSelectionInput(item)
                          ? " nh3d-menu-button-active"
                          : ""
                      }`}
                      key={`menu-${item.accelerator}-${index}`}
                      onClick={() =>
                        controller?.chooseQuestionChoice(
                          getMenuSelectionInput(item),
                        )
                      }
                      type="button"
                    >
                      <span className="nh3d-menu-button-key">
                        {item.accelerator}){" "}
                      </span>
                      <span>{item.text}</span>
                    </button>
                  ),
                )}
                {questionSelectableMenuItemCount > 1 ? (
                  <div className="nh3d-menu-actions">
                    <button
                      className={`nh3d-menu-action-button nh3d-menu-action-cancel${
                        question.activeActionButton === "cancel"
                          ? " nh3d-action-button-active"
                          : ""
                      }`}
                      onClick={() => controller?.cancelActivePrompt()}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </>
            )
          ) : (
            <div
              className={`nh3d-choice-list${
                parsedQuestionChoices.length > 0 &&
                parsedQuestionChoices.every(
                  (choice) => choice.trim().length === 1,
                )
                  ? " is-compact"
                  : ""
              }${isYesNoQuestionChoices ? " is-yes-no" : ""}`}
            >
              {parsedQuestionChoices.map((choice) => (
                <button
                  className={`nh3d-choice-button${
                    choice === question.defaultChoice
                      ? " nh3d-choice-button-default"
                      : ""
                  }`}
                  key={choice}
                  onClick={() => controller?.chooseQuestionChoice(choice)}
                  type="button"
                >
                  {getQuestionChoiceLabel(
                    choice,
                    inventory.items,
                    useInventoryChoiceLabels,
                  )}
                </button>
              ))}
            </div>
          )}
          {question.menuItems.length > 0 && questionMenuPageCount > 1 ? (
            <div className="nh3d-question-pagination">
              <button
                className="nh3d-question-page-button"
                disabled={questionMenuPageIndex <= 0}
                onClick={() => controller?.goToPreviousQuestionMenuPage()}
                type="button"
              >
                {"<"}
              </button>
              <div className="nh3d-question-page-indicator">
                Page {questionMenuPageIndex + 1} / {questionMenuPageCount}
              </div>
              <button
                className="nh3d-question-page-button"
                disabled={questionMenuPageIndex >= questionMenuPageCount - 1}
                onClick={() => controller?.goToNextQuestionMenuPage()}
                type="button"
              >
                {">"}
              </button>
            </div>
          ) : null}
          <div className="nh3d-dialog-hint">
            {question.menuItems.length > 0 && questionMenuPageCount > 1
              ? "Use < and > to change pages. Press ESC to cancel"
              : "Press ESC to cancel"}
          </div>
        </div>
      ) : null}

      {directionQuestion ? (
        isFpsPlayMode ? (
          <div
            className="nh3d-dialog nh3d-dialog-direction nh3d-dialog-direction-fps nh3d-dialog-has-mobile-close is-visible"
            id="direction-dialog"
          >
            {renderMobileDialogCloseButton(
              () => controller?.cancelActivePrompt(),
              "Cancel direction prompt",
            )}
            <div className="nh3d-direction-text">{directionQuestion}</div>
            <div className="nh3d-direction-fps-hint">
              Look to aim. Left-click or W confirms. S targets self. A/D or
              right-click cancels.
            </div>
          </div>
        ) : (
          <div
            className="nh3d-dialog nh3d-dialog-direction nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible"
            id="direction-dialog"
          >
            {renderMobileDialogCloseButton(
              () => controller?.cancelActivePrompt(),
              "Cancel direction prompt",
            )}
            <div className="nh3d-direction-text">{directionQuestion}</div>
            <div className="nh3d-direction-grid">
              {getDirectionChoices(numberPadModeEnabled).map(
                (direction, index) => {
                  if (direction.spacer || !direction.key || !direction.label) {
                    return (
                      <div
                        aria-hidden="true"
                        className="nh3d-direction-spacer"
                        key={`spacer-${index}`}
                      />
                    );
                  }

                  return (
                    <button
                      className="nh3d-direction-button"
                      key={direction.key}
                      onClick={() =>
                        controller?.chooseDirection(direction.key!)
                      }
                      type="button"
                    >
                      <div className="nh3d-direction-symbol">
                        {direction.label}
                      </div>
                      <div className="nh3d-direction-key">{direction.key}</div>
                    </button>
                  );
                },
              )}
            </div>
            <div className="nh3d-direction-extra-row">
              {directionAuxChoices.map((direction) => (
                <button
                  className="nh3d-direction-button nh3d-direction-button-extra"
                  key={direction.key}
                  onClick={() => controller?.chooseDirection(direction.key)}
                  type="button"
                >
                  <div className="nh3d-direction-symbol">{direction.label}</div>
                  <div className="nh3d-direction-key">{direction.key}</div>
                </button>
              ))}
            </div>
            <div className="nh3d-dialog-hint">
              {getDirectionHelpText(numberPadModeEnabled)}
            </div>
            <div className="nh3d-menu-actions">
              <button
                className="nh3d-menu-action-button nh3d-menu-action-cancel"
                onClick={() => controller?.cancelActivePrompt()}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )
      ) : null}

      {infoMenu ? (
        <div
          className="nh3d-dialog nh3d-dialog-info nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible"
          id="info-menu-dialog"
        >
          {renderMobileDialogCloseButton(
            () => controller?.closeInfoMenuDialog(),
            "Close information window",
          )}
          <div className="nh3d-info-title">
            {infoMenu.title || "NetHack Information"}
          </div>
          <div className="nh3d-info-body">
            {infoMenu.lines.length > 0
              ? infoMenu.lines.join("\n")
              : "(No details)"}
          </div>
          <div className="nh3d-info-hint">
            Press SPACE, ENTER, or ESC to close. Press Ctrl+M to reopen.
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={() => controller?.closeInfoMenuDialog()}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {inventory.visible ? (
        <div
          className="nh3d-dialog nh3d-dialog-inventory nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible"
          id="inventory-dialog"
        >
          {renderMobileDialogCloseButton(
            () => controller?.closeInventoryDialog(),
            "Close inventory",
          )}
          <div className="nh3d-inventory-title">INVENTORY</div>
          <div className="nh3d-inventory-items">
            {inventory.items.length === 0 ? (
              <div className="nh3d-inventory-empty">
                Your inventory is empty.
              </div>
            ) : (
              inventory.items.map((item, index) =>
                item.isCategory ? (
                  <div
                    className={`nh3d-inventory-category${
                      index === 0 ? " nh3d-inventory-category-first" : ""
                    }`}
                    key={`cat-${index}`}
                  >
                    {item.text}
                  </div>
                ) : (
                  <div
                    className={`nh3d-inventory-item${
                      inventoryContextMenu?.accelerator === item.accelerator
                        ? " nh3d-inventory-item-active"
                        : ""
                    }`}
                    key={`item-${index}`}
                    onClick={(event) => {
                      openInventoryContextMenu(
                        item,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openInventoryContextMenu(
                        item,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        const target =
                          event.currentTarget.getBoundingClientRect();
                        openInventoryContextMenu(
                          item,
                          target.right,
                          target.top + target.height / 2,
                        );
                      }
                    }}
                    role={"button"}
                    tabIndex={0}
                  >
                    <span className="nh3d-inventory-key">
                      {item.accelerator || "?"})
                    </span>
                    <span className="nh3d-inventory-text">
                      {item.text || "Unknown item"}
                    </span>
                  </div>
                ),
              )
            )}
          </div>
          <div className="nh3d-inventory-close">
            Select an item to open contextual commands. Press ENTER, ESC, or 'i'
            to close
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={() => controller?.closeInventoryDialog()}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {inventoryContextMenu ? (
        <div
          className="nh3d-context-menu nh3d-inventory-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          ref={inventoryContextMenuRef}
          style={{
            left: `${inventoryContextMenu.x}px`,
            top: `${inventoryContextMenu.y}px`,
          }}
        >
          <div
            className={`nh3d-context-menu-title${
              shouldScrollInventoryContextTitle
                ? " nh3d-context-menu-title-scroll"
                : ""
            }`}
            style={inventoryContextTitleStyle}
          >
            {shouldScrollInventoryContextTitle ? (
              <span className="nh3d-context-menu-title-scroll-track">
                <span>{inventoryContextTitle}</span>
                <span aria-hidden="true">{inventoryContextTitle}</span>
              </span>
            ) : (
              inventoryContextTitle
            )}
          </div>
          <div className="nh3d-context-menu-actions">
            {inventoryItemActions.map((action) => (
              <button
                className="nh3d-context-menu-button"
                key={`inventory-${inventoryContextMenu.accelerator}-${action.id}`}
                onClick={() => {
                  controller?.runInventoryItemAction(
                    action.id,
                    inventoryContextMenu.accelerator,
                  );
                  setInventoryContextMenu(null);
                }}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isFpsPlayMode &&
      characterCreationConfig !== null &&
      connectionState === "running" &&
      !loadingVisible ? (
        <div aria-hidden="true" className="nh3d-fps-crosshair">
          <div className="nh3d-fps-crosshair-dot" />
        </div>
      ) : null}

      {isFpsPlayMode && fpsCrosshairContext ? (
        <div className="nh3d-context-menu nh3d-fps-crosshair-context">
          <div
            className={`nh3d-context-menu-title${
              shouldScrollFpsContextTitle
                ? " nh3d-context-menu-title-scroll"
                : ""
            }`}
            style={fpsContextTitleStyle}
          >
            {shouldScrollFpsContextTitle ? (
              <span className="nh3d-context-menu-title-scroll-track">
                <span>{fpsContextTitle}</span>
                <span aria-hidden="true">{fpsContextTitle}</span>
              </span>
            ) : (
              fpsContextTitle
            )}
          </div>
          <div className="nh3d-context-menu-actions">
            {fpsCrosshairContext.actions.map((action) => (
              <button
                className="nh3d-context-menu-button"
                key={`crosshair-${action.kind}-${action.id}-${action.value}`}
                onClick={() => runFpsCrosshairContextAction(action)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isMobileGameRunning && isMobileActionSheetVisible ? (
        <div className="nh3d-mobile-actions-sheet">
          <div className="nh3d-mobile-actions-title-row">
            <div className="nh3d-mobile-actions-title">
              {mobileActionSheetMode === "quick"
                ? "Actions"
                : "Extended Commands"}
            </div>
            <div className="nh3d-mobile-actions-controls">
              {mobileActionSheetMode === "extended" ? (
                <button
                  className="nh3d-mobile-actions-back"
                  onClick={() => setMobileActionSheetMode("quick")}
                  type="button"
                >
                  Back
                </button>
              ) : null}
              <button
                className="nh3d-mobile-actions-back"
                onClick={() => {
                  setIsMobileActionSheetVisible(false);
                  setMobileActionSheetMode("quick");
                  openClientOptionsDialog();
                }}
                type="button"
              >
                Options
              </button>
              <button
                className="nh3d-mobile-actions-close"
                onClick={() => {
                  setIsMobileActionSheetVisible(false);
                  setMobileActionSheetMode("quick");
                }}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
          {mobileActionSheetMode === "quick" ? (
            <div className="nh3d-mobile-actions-grid is-fixed-layout">
              {mobileActions.map((action) => (
                <button
                  className="nh3d-mobile-actions-button"
                  key={action.id}
                  onClick={() => {
                    controller?.dismissFpsCrosshairContextMenu();
                    if (action.id === "extended") {
                      setMobileActionSheetMode("extended");
                      return;
                    }
                    if (action.kind === "quick") {
                      controller?.runQuickAction(action.value);
                    } else {
                      controller?.runExtendedCommand(action.value);
                    }
                    setIsMobileActionSheetVisible(false);
                    setMobileActionSheetMode("quick");
                  }}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="nh3d-mobile-actions-sections">
              {mobileCommonExtendedCommandNames.length > 0 ? (
                <div className="nh3d-mobile-actions-section">
                  <div className="nh3d-mobile-actions-subheader">
                    Common commands
                  </div>
                  <div className="nh3d-mobile-actions-grid is-extended">
                    {mobileCommonExtendedCommandNames.map((command) => (
                      <button
                        className="nh3d-mobile-actions-button"
                        key={`common-${command}`}
                        onClick={() => {
                          controller?.dismissFpsCrosshairContextMenu();
                          controller?.runExtendedCommand(command);
                          setIsMobileActionSheetVisible(false);
                          setMobileActionSheetMode("quick");
                        }}
                        type="button"
                      >
                        {command}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="nh3d-mobile-actions-section">
                <div className="nh3d-mobile-actions-subheader">
                  All commands
                </div>
                <div className="nh3d-mobile-actions-grid is-extended">
                  {mobileExtendedCommandNames.map((command) => (
                    <button
                      className="nh3d-mobile-actions-button"
                      key={`all-${command}`}
                      onClick={() => {
                        controller?.dismissFpsCrosshairContextMenu();
                        controller?.runExtendedCommand(command);
                        setIsMobileActionSheetVisible(false);
                        setMobileActionSheetMode("quick");
                      }}
                      type="button"
                    >
                      {command}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {isMobileGameRunning && repeatActionVisible ? (
        <button
          className="nh3d-mobile-repeat-button"
          onClick={() => {
            controller?.dismissFpsCrosshairContextMenu();
            controller?.repeatLastAction();
          }}
          type="button"
        >
          Repeat
        </button>
      ) : null}

      {isMobileGameRunning ? (
        <div className="nh3d-mobile-bottom-bar">
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              controller?.toggleInventoryDialog();
            }}
            type="button"
          >
            Inventory
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            disabled={!clientOptions.liveMessageLog}
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              if (!clientOptions.liveMessageLog) {
                return;
              }
              setIsMobileLogVisible((visible) => {
                const next = !visible;
                if (next) {
                  setIsMobileActionSheetVisible(false);
                  setMobileActionSheetMode("quick");
                }
                return next;
              });
            }}
            type="button"
          >
            Log
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              controller?.runQuickAction("pickup");
            }}
            type="button"
          >
            Pick Up
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              controller?.runQuickAction("search");
            }}
            type="button"
          >
            Search
          </button>
          <button
            className={`nh3d-mobile-bottom-button${
              isMobileActionSheetVisible ? " is-active" : ""
            }`}
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              setIsMobileActionSheetVisible((visible) => {
                const next = !visible;
                if (next) {
                  setMobileActionSheetMode("quick");
                  setIsMobileLogVisible(false);
                }
                return next;
              });
            }}
            type="button"
          >
            Actions
          </button>
        </div>
      ) : null}

      <div className={positionRequest ? "is-visible" : ""} id="position-dialog">
        {isMobileViewport && positionRequest ? (
          <button
            aria-label="Close position prompt"
            className="nh3d-position-dialog-close"
            onClick={() => {
              controller?.cancelActivePrompt();
              setPositionRequest(null);
            }}
            type="button"
          >
            {"\u00D7"}
          </button>
        ) : null}
        {positionRequest}
      </div>
    </>
  );
}
