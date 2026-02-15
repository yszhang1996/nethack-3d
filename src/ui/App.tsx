import { useEffect, useMemo, useRef, useState } from "react";
import { Nethack3DEngine } from "../game";
import type {
  CharacterCreationConfig,
  NethackMenuItem,
  PlayMode,
} from "../game/ui-types";
import { registerDebugHelpers } from "../app";
import { createEngineUiAdapter } from "../state/engineUiAdapter";
import { useGameStore } from "../state/gameStore";

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

function isSimpleYesNoChoicePrompt(parsedChoices: string[]): boolean {
  if (!Array.isArray(parsedChoices) || parsedChoices.length === 0) {
    return false;
  }

  const normalized = parsedChoices
    .map((choice) => String(choice || "").trim().toLowerCase())
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
const startupPlayModeOptions: Array<{ value: PlayMode; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "fps", label: "FPS" },
];
type StartupFlowStep = "choose" | "create" | "random-name";
type MobileActionEntry = {
  id: string;
  label: string;
  kind: "quick" | "extended";
  value: string;
};
type MobileActionSheetMode = "quick" | "extended";

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

export default function App(): JSX.Element {
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [characterCreationConfig, setCharacterCreationConfig] =
    useState<CharacterCreationConfig | null>(null);
  const [startupFlowStep, setStartupFlowStep] =
    useState<StartupFlowStep>("choose");
  const [createRole, setCreateRole] = useState(startupRoleOptions[0]);
  const [createRace, setCreateRace] = useState(startupRaceOptions[0]);
  const [createGender, setCreateGender] = useState(startupGenderOptions[0]);
  const [createAlign, setCreateAlign] = useState(startupAlignOptions[0]);
  const [createName, setCreateName] = useState("Web_user");
  const [createPlayMode, setCreatePlayMode] = useState<PlayMode>("normal");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileActionSheetVisible, setIsMobileActionSheetVisible] =
    useState(false);
  const [mobileActionSheetMode, setMobileActionSheetMode] =
    useState<MobileActionSheetMode>("quick");
  const [isMobileLogVisible, setIsMobileLogVisible] = useState(false);
  const [statsBarHeight, setStatsBarHeight] = useState(0);
  const [textInputValue, setTextInputValue] = useState("");
  const adapter = useMemo(() => createEngineUiAdapter(), []);
  const setEngineController = useGameStore((state) => state.setEngineController);

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
  const positionRequest = useGameStore((state) => state.positionRequest);
  const connectionState = useGameStore((state) => state.connectionState);
  const extendedCommands = useGameStore((state) => state.extendedCommands);
  const controller = useGameStore((state) => state.engineController);
  const isFpsPlayMode = characterCreationConfig?.playMode === "fps";
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
  const [activeInventoryItemAccelerator, setActiveInventoryItemAccelerator] =
    useState<string | null>(null);

  useEffect(() => {
    if (!canvasRootRef.current || !characterCreationConfig) {
      return;
    }
    const engine = new Nethack3DEngine({
      mountElement: canvasRootRef.current,
      uiAdapter: adapter,
      characterCreationConfig,
    });
    setEngineController(engine);
    registerDebugHelpers(engine);
    return () => {
      setEngineController(null);
    };
  }, [adapter, characterCreationConfig, setEngineController]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia(
      "(max-width: 900px) and (pointer: coarse)",
    );
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
  }, []);

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

  useEffect(() => {
    if (!isMobileGameRunning) {
      setIsMobileActionSheetVisible(false);
      setMobileActionSheetMode("quick");
      setIsMobileLogVisible(false);
    }
  }, [isMobileGameRunning]);

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
  const useInventoryChoiceLabels = !isSimpleYesNoChoicePrompt(
    parsedQuestionChoices,
  );
  const questionMenuPageIndex = question?.menuPageIndex ?? 0;
  const questionMenuPageCount = Math.max(1, question?.menuPageCount ?? 1);
  const questionSelectableMenuItemCount = question
    ? question.menuItems.filter((item) => isSelectableQuestionMenuItem(item)).length
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

  useEffect(() => {
    if (!inventory.visible) {
      setActiveInventoryItemAccelerator(null);
    }
  }, [inventory.visible]);

  return (
    <>
      <div className="nh3d-canvas-root" ref={canvasRootRef} />

      {characterCreationConfig === null ? (
        <div className="nh3d-dialog nh3d-dialog-question is-visible" id="character-setup-dialog">
          {startupFlowStep === "choose" ? (
            <>
              <div className="nh3d-question-text">Choose your character setup:</div>
              <div className="nh3d-choice-list">
                <button
                  className="nh3d-choice-button"
                  onClick={() => setStartupFlowStep("random-name")}
                  type="button"
                >
                  Random character
                </button>
                <button
                  className="nh3d-choice-button"
                  onClick={() => setStartupFlowStep("create")}
                  type="button"
                >
                  Create character
                </button>
              </div>
            </>
          ) : startupFlowStep === "random-name" ? (
            <>
              <div className="nh3d-question-text">Random character name:</div>
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
                  <span>Play Mode</span>
                  <select
                    className="nh3d-startup-config-select"
                    onChange={(event) =>
                      setCreatePlayMode(event.target.value as PlayMode)
                    }
                    value={createPlayMode}
                  >
                    {startupPlayModeOptions.map((playMode) => (
                      <option key={playMode.value} value={playMode.value}>
                        {playMode.label}
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
                      mode: "random",
                      playMode: createPlayMode,
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
                <label className="nh3d-startup-config-field">
                  <span>Play Mode</span>
                  <select
                    className="nh3d-startup-config-select"
                    onChange={(event) =>
                      setCreatePlayMode(event.target.value as PlayMode)
                    }
                    value={createPlayMode}
                  >
                    {startupPlayModeOptions.map((playMode) => (
                      <option key={playMode.value} value={playMode.value}>
                        {playMode.label}
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
                      playMode: createPlayMode,
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
              </div>
            </>
          )}
        </div>
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

      {!isMobileGameRunning ? (
        <div className="top-left-ui with-stats">
          {!isMobileViewport ? <div id="game-status">{statusText}</div> : null}
          <div id="game-log">
            {gameMessages.map((message, index) => (
              <div key={`${index}-${message}`}>{message}</div>
            ))}
          </div>
        </div>
      ) : (
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
          {gameMessages.map((message, index) => (
            <div key={`${index}-${message}`}>{message}</div>
          ))}
        </div>
      )}

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

      {textInputRequest ? (
        <div className="nh3d-dialog nh3d-dialog-text is-visible" id="text-input-dialog">
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
        <div className="nh3d-dialog nh3d-dialog-question is-visible" id="question-dialog">
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
                        controller?.togglePickupChoice(getMenuSelectionInput(item))
                      }
                    >
                      <input
                        checked={question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )}
                        className="nh3d-pickup-checkbox"
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          controller?.togglePickupChoice(getMenuSelectionInput(item))
                        }
                        type="checkbox"
                      />
                      <span className="nh3d-pickup-key">{item.accelerator})</span>
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
                        controller?.chooseQuestionChoice(getMenuSelectionInput(item))
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
                parsedQuestionChoices.every((choice) => choice.trim().length === 1)
                  ? " is-compact"
                  : ""
              }`}
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
        <div className="nh3d-dialog nh3d-dialog-direction is-visible" id="direction-dialog">
          <div className="nh3d-direction-text">{directionQuestion}</div>
          <div className="nh3d-direction-grid">
            {getDirectionChoices(numberPadModeEnabled).map((direction, index) => {
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
                  onClick={() => controller?.chooseDirection(direction.key!)}
                  type="button"
                >
                  <div className="nh3d-direction-symbol">{direction.label}</div>
                  <div className="nh3d-direction-key">{direction.key}</div>
                </button>
              );
            })}
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
      ) : null}

      {infoMenu ? (
        <div className="nh3d-dialog nh3d-dialog-info is-visible" id="info-menu-dialog">
          <div className="nh3d-info-title">{infoMenu.title || "NetHack Information"}</div>
          <div className="nh3d-info-body">
            {infoMenu.lines.length > 0 ? infoMenu.lines.join("\n") : "(No details)"}
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
        <div className="nh3d-dialog nh3d-dialog-inventory is-visible" id="inventory-dialog">
          <div className="nh3d-inventory-title">📦 INVENTORY</div>
          <div className="nh3d-inventory-items">
            {inventory.items.length === 0 ? (
              <div className="nh3d-inventory-empty">Your inventory is empty.</div>
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
                      isFpsPlayMode &&
                      activeInventoryItemAccelerator === item.accelerator
                        ? " nh3d-inventory-item-active"
                        : ""
                    }`}
                    key={`item-${index}`}
                    onClick={() => {
                      if (!isFpsPlayMode) {
                        return;
                      }
                      setActiveInventoryItemAccelerator((previous) =>
                        previous === item.accelerator
                          ? null
                          : typeof item.accelerator === "string"
                            ? item.accelerator
                            : null,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (!isFpsPlayMode) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveInventoryItemAccelerator((previous) =>
                          previous === item.accelerator
                            ? null
                            : typeof item.accelerator === "string"
                              ? item.accelerator
                              : null,
                        );
                      }
                    }}
                    role={isFpsPlayMode ? "button" : undefined}
                    tabIndex={isFpsPlayMode ? 0 : undefined}
                  >
                    <span className="nh3d-inventory-key">{item.accelerator || "?"})</span>
                    <span className="nh3d-inventory-text">{item.text || "Unknown item"}</span>
                    {isFpsPlayMode &&
                    activeInventoryItemAccelerator === item.accelerator &&
                    typeof item.accelerator === "string" ? (
                      <div className="nh3d-inventory-context-actions">
                        {inventoryItemActions.map((action) => (
                          <button
                            className="nh3d-inventory-context-button"
                            key={`${item.accelerator}-${action.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              controller?.runInventoryItemAction(
                                action.id,
                                item.accelerator as string,
                              );
                              setActiveInventoryItemAccelerator(null);
                            }}
                            type="button"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ),
              )
            )}
          </div>
          <div className="nh3d-inventory-keybinds-title">🎮 ITEM COMMANDS</div>
          <div className="nh3d-inventory-keybinds">
            {isFpsPlayMode ? (
              <div className="nh3d-inventory-keybinds-text">
                Click an item to open contextual commands.
              </div>
            ) : (
              <div className="nh3d-inventory-keybinds-text">
                <span className="nh3d-inventory-command-key">a</span>)pply{" "}
                <span className="nh3d-inventory-command-key">d</span>)rop{" "}
                <span className="nh3d-inventory-command-key">e</span>)at{" "}
                <span className="nh3d-inventory-command-key">q</span>)uaff{" "}
                <span className="nh3d-inventory-command-key">r</span>)ead{" "}
                <span className="nh3d-inventory-command-key">t</span>)hrow{" "}
                <span className="nh3d-inventory-command-key">w</span>)ield{" "}
                <span className="nh3d-inventory-command-key">W</span>)ear{" "}
                <span className="nh3d-inventory-command-key">T</span>)ake-off{" "}
                <span className="nh3d-inventory-command-key">P</span>)ut-on{" "}
                <span className="nh3d-inventory-command-key">R</span>)emove{" "}
                <span className="nh3d-inventory-command-key">z</span>)ap{" "}
                <span className="nh3d-inventory-command-key">Z</span>)cast{"\n"}
                Special: <span className="nh3d-inventory-command-key">"</span>)weapons{" "}
                <span className="nh3d-inventory-command-key">[</span>)armor{" "}
                <span className="nh3d-inventory-command-key">=</span>)rings{" "}
                <span className="nh3d-inventory-command-key">"</span>)amulets{" "}
                <span className="nh3d-inventory-command-key">(</span>)tools
              </div>
            )}
          </div>
          <div className="nh3d-inventory-close">Press ENTER, ESC, or 'i' to close</div>
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

      {isMobileGameRunning && isMobileActionSheetVisible ? (
        <div className="nh3d-mobile-actions-sheet">
          <div className="nh3d-mobile-actions-title-row">
            <div className="nh3d-mobile-actions-title">
              {mobileActionSheetMode === "quick" ? "Actions" : "Extended Commands"}
            </div>
            {mobileActionSheetMode === "extended" ? (
              <button
                className="nh3d-mobile-actions-back"
                onClick={() => setMobileActionSheetMode("quick")}
                type="button"
              >
                Back
              </button>
            ) : null}
          </div>
          {mobileActionSheetMode === "quick" ? (
            <div className="nh3d-mobile-actions-grid is-fixed-layout">
              {mobileActions.map((action) => (
                <button
                  className="nh3d-mobile-actions-button"
                  key={action.id}
                  onClick={() => {
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
                <div className="nh3d-mobile-actions-subheader">All commands</div>
                <div className="nh3d-mobile-actions-grid is-extended">
                  {mobileExtendedCommandNames.map((command) => (
                    <button
                      className="nh3d-mobile-actions-button"
                      key={`all-${command}`}
                      onClick={() => {
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

      {isMobileGameRunning ? (
        <div className="nh3d-mobile-bottom-bar">
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => controller?.toggleInventoryDialog()}
            type="button"
          >
            Inventory
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => {
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
            onClick={() => controller?.runQuickAction("pickup")}
            type="button"
          >
            Pick Up
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => controller?.runQuickAction("search")}
            type="button"
          >
            Search
          </button>
          <button
            className={`nh3d-mobile-bottom-button${
              isMobileActionSheetVisible ? " is-active" : ""
            }`}
            onClick={() => {
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
        {positionRequest}
      </div>
    </>
  );
}
